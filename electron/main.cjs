// electron/main.cjs
const { app, BrowserWindow, ipcMain, session, net, shell, clipboard, nativeImage, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { RestartPolicy } = require("./restart_policy.cjs");
const { runProc } = require("./process_runner.cjs");
// サーバー・BRIDGE の停止を、出どころ（どのボタン・操作から来たか）付きで logs/stop-requests.log に残す。
const { createStopRequestLog } = require("./stop_requests.cjs");
const stopRequests = createStopRequestLog({ file: () => path.join(app.getPath("userData"), "logs", "stop-requests.log") });
const { createSettingsBackups, validCommand } = require("./settings_backups.cjs");
const { bridgeModTokenPath } = require("../bridge/bridge_mod_token.cjs");
const { assertGameCommands } = require('./game_command_scope.cjs');
// main.cjs から分けた仕事（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// electron は main だけが読み込み、必要なものを渡す。あとで定義するもの（サーバーの状態など）は、呼ばれたときに読む関数で渡す。
const { createAppConfig } = require('./app_config.cjs');
const appConfig = createAppConfig({
  app,
  assertGameProfileIdle: () => assertGameProfileIdle(),
  assertMapIdle: () => mapOperations.assertIdle(),
  isServerStarting: () => serverProcess.isStarting(),
  getConfigPath: () => getConfigPath(),
  getSettingsBackups: () => settingsBackups,
  refreshGameModsOnStartup: () => refreshGameModsOnStartup(),
});
const { getAppConfigPath, readAppConfig, writeAppConfig, consumeInstallerSetupReset } = appConfig;
appConfig.register(ipcMain);
const { createPaths } = require('./paths.cjs');
// テスト（loadApp）は main.cjs を一時フォルダーで動かし、__dirname と process を偽物にする。モジュールにはこちらを渡す。
const paths = createPaths({ app, process, appDir: __dirname, readAppConfig });
const {
  getInstalledBridgeRoot, getBridgeDir, getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath,
  ensureDir, ensureConfigExists, getServerTemplatePath, getServerRoot, getBridgeBatDir,
  getNodeCommand, getGvDataDir, getGvSettingsPath, getGvToolPath,
} = paths;
const { createOperatorAuth } = require('./operator_auth.cjs');
const operatorAuth = createOperatorAuth({ readAppConfig, writeAppConfig });
// コンソール送信（server:command）などの強い操作は、main 側でもログイン済みかを確かめる。
const { isOperatorAuthed } = operatorAuth;
operatorAuth.register(ipcMain);
const { createSetupIpc } = require('./setup_ipc.cjs');
const setupIpc = createSetupIpc({
  app, dialog, shell, spawnSync, getServerRoot, getGvDataDir,
  assertGameProfileIdle: () => assertGameProfileIdle(), assertMapIdle: () => mapOperations.assertIdle(),
  serverChild: () => serverProcess.child(),
});
// 初期セットアップの「作業中」は setup_ipc.cjs が持つ。サーバーの起動・MAP・ゲームの切り替え・ウィンドウを閉じるときに見る。
const { isRunning: isInitialSetupRunning } = setupIpc;
setupIpc.register(ipcMain);
const { createGamesIpc } = require('./games_ipc.cjs');
const gamesIpc = createGamesIpc({
  app, process, appDir: __dirname, dialog, readAppConfig, writeAppConfig, getServerRoot, getConfigPath, getServerTemplatePath,
  assertMapIdle: () => mapOperations.assertIdle(),
  isInitialSetupRunning: () => isInitialSetupRunning(),
  isServerStarting: () => serverProcess.isStarting(),
  isServerStopping: () => serverProcess.isStopping(),
  isBridgeActive: () => Boolean(bridgeProcRef || bridgeRestartTimer),
  getServerProcessStatus: () => getServerProcessStatus(),
  getMinecraftProcessStatus: strict => minecraftClient.getMinecraftProcessStatus(strict),
});
// ゲームの切り替え中かは games_ipc.cjs が持つ。設定の保存・バックアップの復元・ウィンドウを閉じるときに見る。
const { gameProfiles, isGameProfileBusy, assertGameProfileIdle, gameProfileOperation } = gamesIpc;
gamesIpc.register(ipcMain);
const eulerCredentials = require('./euler_credentials.cjs').createEulerCredentials({
  filePath: () => path.join(app.getPath('userData'), 'euler-credentials.json'), safeStorage,
});
let bridgeEulerRevision = null;
const settingsBackups = createSettingsBackups({
  validateRestore: (config, commands) => assertGameCommands(config, [...selectableCommandNames(), ...Object.keys(commands).filter(name => !name.startsWith('game_'))], gameProfiles.list()),
  paths: () => ({
    config: getConfigPath(), app: getAppConfigPath(), tts: getTtsSettingsPath(),
    bridgeTts: path.join(getBridgeBatDir(), "tts-settings.json"),
    commands: path.join(getBridgeBatDir(), "commands", "minecraft"),
    backups: path.join(app.getPath("userData"), "settings-backups", crypto.createHash("sha256").update(path.resolve(getConfigPath())).digest("hex").slice(0, 16)),
  }),
  version: () => app.getVersion(), readTts: () => readTtsSettings(),
  isRunning: () => Boolean(bridgeProcRef || bridgeRestartTimer || mapOperations.isBusy() || serverProcess.isStarting() || isGameProfileBusy() || gameProfiles.list().recoveryRequired),
});
const { createTtsIpc } = require('./tts_ipc.cjs');
const ttsIpc = createTtsIpc({ app, process, shell, spawn, getBridgeBatDir, getConfigPath, settingsBackups });
const { getTtsSettingsPath, readTtsSettings } = ttsIpc;
ttsIpc.register(ipcMain);
const { createBridgeSettings } = require('./bridge_settings.cjs');
const bridgeSettings = createBridgeSettings({
  app, dialog, shell, getConfigPath, ensureConfigExists, getBridgeBatDir, getServerRoot, getGiftsMinPath, getGiftsMetaPath,
  getInstalledBridgeRoot, getBridgeDir, gameProfiles, assertGameProfileIdle, settingsBackups, readTtsSettings,
  requestBridgeMod: (...args) => requestBridgeMod(...args),
  isBridgeRunning: () => Boolean(bridgeProcRef),
});
const { readSavedBridgeConfig, writeBridgeConfig, selectableCommandNames } = bridgeSettings;
bridgeSettings.register(ipcMain);
const { createGiftsViewer } = require('./gifts_viewer.cjs');
const giftsViewer = createGiftsViewer({
  BrowserWindow, shell, net, clipboard, nativeImage, runProc, eulerCredentials,
  getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath, ensureDir,
  getGvDataDir, getGvSettingsPath, getGvToolPath, getNodeCommand,
  ensureNodeRuntimeAvailable: () => ensureNodeRuntimeAvailable(),
});
const { autoUpdateGiftsIfStale } = giftsViewer;
giftsViewer.register(ipcMain);
const { createBridgeSync } = require('./bridge_sync.cjs');
const bridgeSync = createBridgeSync({
  app, process, appDir: __dirname, BrowserWindow, runProc, readAppConfig, writeAppConfig, getBridgeBatDir, getServerTemplatePath,
  gameProfiles, gameProfileOperation, assertGameProfileIdle,
  serverChild: () => serverProcess.child(),
  isServerPortOpen: () => serverProcess.isServerPortOpen(),
});
// BRIDGE の配布は bridge_sync.cjs が持つ。起動時の同期・BRIDGE の起動・ギフトの取得・配信の確認が使う。
const { ensureNodeRuntimeAvailable, getBridgeEntryPoint, scheduleBridgeSync, refreshGameModsOnStartup } = bridgeSync;
bridgeSync.register(ipcMain);
const { createMinecraftClient } = require('./minecraft_client.cjs');
const minecraftClient = createMinecraftClient({ process, spawn, readAppConfig, assertGameProfileIdle });
minecraftClient.register(ipcMain);
const { createServerProcess } = require('./server_process.cjs');
const serverProcess = createServerProcess({
  app, process, spawn, getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, isOperatorAuthed, stopRequests,
  assertMapIdle: () => mapOperations.assertIdle(),
  isInitialSetupRunning: () => isInitialSetupRunning(),
  recoverMapSaves: () => mapOperations.mapSaves.recover(),
  requestBridgeMod: (...args) => requestBridgeMod(...args),
  authFailedMessage: () => bridgeModClient.BRIDGE_MOD_AUTH_FAILED,
});
// サーバーの子プロセス・起動中・停止中は server_process.cjs が持つ。main とほかのモジュールは、それを読む関数（child・isStarting・isStopping
// など）を呼ばれたときに serverProcess.xxx() で読み、分割代入では受けない（テストが差し替えて配線を確かめるため）。
// 下の操作の関数（ログ・起動・停止・状態の確かめ・終了待ち）は差し替えないので、分割代入で受けてよい。
const { appendLog: appendServerLog, startServer, stopMapServer, getServerProcessStatus, waitChildExit } = serverProcess;
serverProcess.register(ipcMain);
const { createMapOperations } = require('./map_operations.cjs');
const mapOperations = createMapOperations({
  getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, readSavedBridgeConfig, writeBridgeConfig, startServer, stopMapServer,
  isInitialSetupRunning: () => isInitialSetupRunning(),
  isServerStarting: () => serverProcess.isStarting(),
  isServerStopping: () => serverProcess.isStopping(),
  serverChild: () => serverProcess.child(),
  assertMapServerStopped: () => serverProcess.assertMapServerStopped(),
  isBridgeActive: () => Boolean(bridgeProcRef || bridgeRestartTimer),
  stopBridge: origin => stopBridge(origin),
  launchBridge: () => launchBridge(),
});
// MAP の作業中は map_operations.cjs が持つ。main とほかのモジュールは、呼ばれたときに mapOperations.xxx() で読む。
mapOperations.register(ipcMain);
const { createServerFiles } = require('./server_files.cjs');
const serverFiles = createServerFiles({
  getServerRoot, getBridgeBatDir, readAppConfig,
  assertMapIdle: () => mapOperations.assertIdle(),
  serverChild: () => serverProcess.child(),
  waitForBridgeMod: () => waitForBridgeMod(),
  requestBridgeMod: (...args) => requestBridgeMod(...args),
});
serverFiles.register(ipcMain);
const { createOperationsStats } = require('./operations_stats.cjs');
const operationsStats = createOperationsStats({ BrowserWindow, dialog, getBridgeBatDir, bridgeChild: () => bridgeProcRef });
// 起動のときに古い操作履歴を整理する（app.whenReady の中で呼ぶ）。
const { pruneOperationsHistoryOldRows } = operationsStats;
operationsStats.register(ipcMain);
const { createBridgeModClient } = require('./bridge_mod_client.cjs');
const bridgeModClient = createBridgeModClient({
  getConfigPath, getServerRoot, stopRequests, selectableCommandNames, gameProfiles, appendServerLog,
  serverChild: () => serverProcess.child(),
  bridgeChild: () => bridgeProcRef,
});
// BridgeMOD との通信は bridge_mod_client.cjs が持つ。配信前チェック・サーバーの起動・OP の付与・ゲームルールが使う。
const { requestBridgeMod, waitForBridgeMod } = bridgeModClient;
bridgeModClient.register(ipcMain);

const isDev = process.env.ELECTRON_DEV === "1";
const { createAppWindow } = require('./window.cjs');
// 保存・準備中（初期セットアップ・MAP の作業・サーバーの起動と停止・ゲームの切り替え）はウィンドウを閉じない。
// 名前のある関数にして、テストから5つの作業ごとに確かめる（main.cjs の分割 PR1 レビュー）。
function isAppBusy() {
  return isInitialSetupRunning() || mapOperations.isBusy() || serverProcess.isStarting() || serverProcess.isStopping() || isGameProfileBusy();
}
const appWindow = createAppWindow({ BrowserWindow, session, dialog, shell, appDir: __dirname, isDev, isBusy: () => isAppBusy() });
const { installProdOnlyCsp, createWindow } = appWindow;
appWindow.register(ipcMain);

// --------------------
// App lifecycle
// --------------------

// 多重起動防止: 2つ目以降の起動は1つ目のウィンドウをフォーカスして終了
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  consumeInstallerSetupReset();
  pruneOperationsHistoryOldRows(30);
  installProdOnlyCsp();
  createWindow();
  scheduleBridgeSync();
  setTimeout(() => autoUpdateGiftsIfStale().catch(e =>
    console.warn("[gifts:auto-update]", e?.message || e)), 5000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let bridgePid  = null;
let bridgeProcRef = null;
let bridgeStopRequested = false;
let bridgeRestartTimer = null;
const bridgeRestartPolicy = new RestartPolicy();
const BRIDGE_LOG_LIMIT = 300;
const bridgeLogBuffer = [];

function appendBridgeLog(message) {
  const text = String(message ?? "").replace(/\r/g, "");
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    bridgeLogBuffer.push(`[${new Date().toLocaleTimeString("ja-JP")}] ${trimmed}`);
  }
  if (bridgeLogBuffer.length > BRIDGE_LOG_LIMIT) {
    bridgeLogBuffer.splice(0, bridgeLogBuffer.length - BRIDGE_LOG_LIMIT);
  }
}

function pipeBridgeStream(stream, prefix) {
  if (!stream) return;
  stream.on("data", (chunk) => {
    appendBridgeLog(`${prefix} ${chunk.toString("utf8")}`);
  });
}

function getProcessMetrics(pid) {
  if (!pid || process.platform !== "win32") return { cpuPercent: null, memMb: null };
  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$p=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$_.IDProcess -eq ${Number(pid)}} | Select-Object -First 1 PercentProcessorTime,WorkingSet; if ($p) { "$($p.PercentProcessorTime)|$([math]::Round($p.WorkingSet/1MB,1))" }`,
    ], { windowsHide: true, timeout: 1500, encoding: "utf8" });
    const raw = String(result.stdout || "").trim();
    const [cpu, mem] = raw.split("|");
    return {
      cpuPercent: Number.isFinite(Number(cpu)) ? Number(cpu) : null,
      memMb: Number.isFinite(Number(mem)) ? Number(mem) : null,
    };
  } catch {
    return { cpuPercent: null, memMb: null };
  }
}

const checkTikTokLive = require("./tiktok_live_status.cjs").createLiveStatusChecker({
  query: async username => {
    await ensureNodeRuntimeAvailable();
    const tool = getGvToolPath("live_status.cjs");
    const { env } = eulerCredentials.runtime();
    const result = await runProc(getNodeCommand(), [tool, username], path.dirname(tool), { timeoutMs: 20000, env });
    return JSON.parse(result.out.trim());
  },
});
ipcMain.handle("tiktok:liveStatus", (_event, username) => checkTikTokLive(username));
const eulerStatus = () => eulerCredentials.status(bridgeEulerRevision, Boolean(bridgeProcRef));
ipcMain.handle('euler:status', eulerStatus);
ipcMain.handle('euler:save', (_event, key) => {
  eulerCredentials.save(key);
  checkTikTokLive.clearCache();
  return eulerStatus();
});
ipcMain.handle('euler:clear', () => {
  eulerCredentials.clear();
  checkTikTokLive.clearCache();
  return eulerStatus();
});
ipcMain.handle('euler:openPortal', () => shell.openExternal('https://www.eulerstream.com/dashboard'));

// --------------------
// IPC: Bridge 起動（同梱 node 優先、なければ PATH の node）
// --------------------
// 前セッション由来を含む「このBridge」の node プロセスだけをコマンドラインで特定して停止する。
// PID直killはPID再利用で無関係なプロセスを殺す危険があるため、commandLine一致で限定する。
function killBridgeByCommandLine() {
  if (process.platform !== "win32") return;
  try {
    const dir = getBridgeBatDir().replace(/'/g, "''");
    const ps =
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' " +
      "-and $_.CommandLine -like '*config.minecraft.json*' " +
      `-and $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true, timeout: 5000 });
  } catch { /* ベストエフォート */ }
}

async function launchBridge() {
  assertGameProfileIdle();
  assertGameCommands(JSON.parse(fs.readFileSync(getConfigPath(), "utf8")), selectableCommandNames(), gameProfiles.list());
  const dir = getBridgeBatDir();
  const indexJs = getBridgeEntryPoint(dir);
  if (!fs.existsSync(indexJs)) throw new Error(`Bridge entry not found: ${indexJs}`);

  await ensureNodeRuntimeAvailable();
  const nodeCmd = getNodeCommand();

  bridgeStopRequested = false;
  bridgeRestartPolicy.start();
  const spawnOnce = () => {
    const { env, revision } = eulerCredentials.runtime();
    appendBridgeLog(`[BRIDGE] 起動します: ${indexJs}`);
    // BridgeMOD の認証トークンはサーバーフォルダーにある。開発時は bridge とサーバーの場所が離れているので明示する。
    const child = spawn(nodeCmd, [indexJs, "--config", path.join(dir, "config.minecraft.json")], {
      cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: { ...env, BRIDGE_MOD_TOKEN_FILE: bridgeModTokenPath(getServerRoot()) },
    });
    bridgeEulerRevision = revision;
    bridgeProcRef = child;
    bridgePid = child.pid;
    appendBridgeLog(`[BRIDGE] PID ${bridgePid} で起動しました`);
    pipeBridgeStream(child.stdout, "[stdout]");
    pipeBridgeStream(child.stderr, "[stderr]");
    child.on("exit", (code, signal) => {
      appendBridgeLog(`[BRIDGE] 終了しました code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (bridgeProcRef === child) { bridgePid = null; bridgeProcRef = null; }
      if (!bridgeStopRequested && bridgeRestartPolicy.shouldRestart()) {
        const backoffMs = bridgeRestartPolicy.nextDelayMs ? bridgeRestartPolicy.nextDelayMs() : 2000;
        appendBridgeLog(`[BRIDGE] ${Math.round(backoffMs / 1000)}秒後に自動再起動します`);
        bridgeRestartTimer = setTimeout(() => {
          bridgeRestartTimer = null;
          try { spawnOnce(); } catch (error) { appendBridgeLog(`[BRIDGE] ${error.message}`); }
        }, backoffMs);
      } else if (bridgeRestartPolicy.exhausted && bridgeRestartPolicy.exhausted()) {
        appendBridgeLog("[BRIDGE] 自動再起動の上限に達しました。設定を確認して手動で再起動してください。");
      }
    });
  };
  if (!bridgeProcRef) spawnOnce();

  return { ok: true, pid: bridgePid };
}

// origin はどのボタン・操作から止めたか（stop_requests.cjs の名前）。ログ欄と logs/stop-requests.log に残す。
async function stopBridge(origin) {
  bridgeStopRequested = true;
  bridgeRestartPolicy.requestStop();
  if (bridgeRestartTimer) { clearTimeout(bridgeRestartTimer); bridgeRestartTimer = null; }
  const child = bridgeProcRef;
  if (!child) return { ok: true };
  appendBridgeLog(`[BRIDGE] 停止します（${stopRequests.record("bridge", origin)}）`);
  if (child.connected) {
    const ended = waitChildExit(child, 7000);
    child.send({ type: 'shutdown' }, error => { if (error) appendBridgeLog('[BRIDGE] ' + error.message); });
    if (await ended) return { ok: true };
  }
  const ended = waitChildExit(child, 5000);
  try { spawn('taskkill.exe', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true }); } catch {}
  if (!await ended) throw new Error('Bridgeを停止できませんでした。ログを確認してください。');
  return { ok: true };
}

ipcMain.handle("bridge:launch", async () => { mapOperations.assertIdle(); return launchBridge(); });

// --------------------
// IPC: Bridge 停止
// --------------------
ipcMain.handle("bridge:stop", async (_event, origin) => { mapOperations.assertIdle(); return stopBridge(origin); });

// --------------------
// IPC: Bridge 再起動（停止完了を待ってから起動する。UI側の stop→launch 連打は使わない）
// --------------------
ipcMain.handle("bridge:restart", async (_event, origin) => {
  mapOperations.assertIdle();
  await stopBridge(origin);
  await new Promise((r) => setTimeout(r, 400)); // ポート/ファイル解放の猶予
  return launchBridge();
});
ipcMain.handle("bridge:processStatus", () => {
  const status = bridgeRestartPolicy.status(bridgePid);
  let runtime = {};
  try {
    runtime = JSON.parse(fs.readFileSync(path.join(getBridgeBatDir(), "runtime-status.json"), "utf8"));
  } catch {}
  return { ...status, ...getProcessMetrics(bridgePid), tiktok: status.running ? (runtime.tiktok || null) : null, recording: status.running ? (runtime.recording || null) : null,
    delivery: status.running ? (runtime.delivery || null) : null };
});

ipcMain.handle("bridge:logs", () => ({ ok: true, lines: [...bridgeLogBuffer] }));
