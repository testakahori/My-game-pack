// electron/main.cjs
const { app, BrowserWindow, ipcMain, session, net, shell, clipboard, nativeImage, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const { validateBridgeConfig } = require("./config_schema.cjs");
const { RestartPolicy } = require("./restart_policy.cjs");
const { runProc } = require("./process_runner.cjs");
// サーバー・BRIDGE の停止を、出どころ（どのボタン・操作から来たか）付きで logs/stop-requests.log に残す。
const { createStopRequestLog, isConsoleStop } = require("./stop_requests.cjs");
const stopRequests = createStopRequestLog({ file: () => path.join(app.getPath("userData"), "logs", "stop-requests.log") });
const { createSettingsBackups, validCommand } = require("./settings_backups.cjs");
const { usesBridgeModTransport } = require("../bridge/command_files.cjs");
const { bridgeModTokenPath, withBridgeModToken } = require("../bridge/bridge_mod_token.cjs");
const { createStreamSessions, streamBuckets } = require("./stream_sessions.cjs");
const { saveGiftPanelPng } = require("./image_export.cjs");
const { exportStreamStatsMarkdown } = require("./stats_export.cjs");
const { assertGameCommands } = require('./game_command_scope.cjs');
// main.cjs から分けた仕事（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// electron は main だけが読み込み、必要なものを渡す。あとで定義するもの（サーバーの状態など）は、呼ばれたときに読む関数で渡す。
const { createAppConfig } = require('./app_config.cjs');
const appConfig = createAppConfig({
  app,
  assertGameProfileIdle: () => assertGameProfileIdle(),
  assertMapIdle: () => assertMapIdle(),
  isServerStarting: () => serverStarting,
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
  assertGameProfileIdle: () => assertGameProfileIdle(), assertMapIdle: () => assertMapIdle(),
  serverChild: () => serverProcRef,
});
// 初期セットアップの「作業中」は setup_ipc.cjs が持つ。サーバーの起動・MAP・ゲームの切り替え・ウィンドウを閉じるときに見る。
const { isRunning: isInitialSetupRunning } = setupIpc;
setupIpc.register(ipcMain);
const { createGamesIpc } = require('./games_ipc.cjs');
const gamesIpc = createGamesIpc({
  app, process, appDir: __dirname, dialog, readAppConfig, writeAppConfig, getServerRoot, getConfigPath, getServerTemplatePath,
  assertMapIdle: () => assertMapIdle(),
  isInitialSetupRunning: () => isInitialSetupRunning(),
  isServerStarting: () => serverStarting,
  isServerStopping: () => serverStopping,
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
const streamSessions = createStreamSessions(() => path.join(getBridgeBatDir(), "stream-sessions.json"));
const settingsBackups = createSettingsBackups({
  validateRestore: (config, commands) => assertGameCommands(config, [...selectableCommandNames(), ...Object.keys(commands).filter(name => !name.startsWith('game_'))], gameProfiles.list()),
  paths: () => ({
    config: getConfigPath(), app: getAppConfigPath(), tts: getTtsSettingsPath(),
    bridgeTts: path.join(getBridgeBatDir(), "tts-settings.json"),
    commands: path.join(getBridgeBatDir(), "commands", "minecraft"),
    backups: path.join(app.getPath("userData"), "settings-backups", crypto.createHash("sha256").update(path.resolve(getConfigPath())).digest("hex").slice(0, 16)),
  }),
  version: () => app.getVersion(), readTts: () => readTtsSettings(),
  isRunning: () => Boolean(bridgeProcRef || bridgeRestartTimer || mapOperationBusy || serverStarting || isGameProfileBusy() || gameProfiles.list().recoveryRequired),
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
  serverChild: () => serverProcRef,
  isServerPortOpen: () => isServerPortOpen(),
});
// BRIDGE の配布は bridge_sync.cjs が持つ。起動時の同期・BRIDGE の起動・ギフトの取得・配信の確認が使う。
const { ensureNodeRuntimeAvailable, getBridgeEntryPoint, scheduleBridgeSync, refreshGameModsOnStartup } = bridgeSync;
bridgeSync.register(ipcMain);
const { createMinecraftClient } = require('./minecraft_client.cjs');
const minecraftClient = createMinecraftClient({ process, spawn, readAppConfig, assertGameProfileIdle });
minecraftClient.register(ipcMain);

const isDev = process.env.ELECTRON_DEV === "1";
const { createAppWindow } = require('./window.cjs');
// 保存・準備中（初期セットアップ・MAP の作業・サーバーの起動と停止・ゲームの切り替え）はウィンドウを閉じない。
// 名前のある関数にして、テストから5つの作業ごとに確かめる（main.cjs の分割 PR1 レビュー）。
function isAppBusy() {
  return isInitialSetupRunning() || mapOperationBusy || serverStarting || serverStopping || isGameProfileBusy();
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

// --------------------
// IPC: サーバー起動 (run.bat)
// --------------------
let serverPid  = null;
let serverProcRef = null;
const SERVER_LOG_LIMIT = 500;
const serverLogBuffer = [];
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

function appendServerLog(message) {
  const text = String(message ?? "").replace(/\r/g, "");
  for (const line of text.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    serverLogBuffer.push(`[${new Date().toLocaleTimeString("ja-JP")}] ${trimmed}`);
  }
  if (serverLogBuffer.length > SERVER_LOG_LIMIT) {
    serverLogBuffer.splice(0, serverLogBuffer.length - SERVER_LOG_LIMIT);
  }
}

function pipeServerStream(stream, prefix) {
  if (!stream) return;
  stream.on("data", (chunk) => {
    appendServerLog(`${prefix}${chunk.toString("utf8")}`);
  });
}

async function startServer(resumeAfterMap = false) {
  assertGameProfileIdle();
  if (!resumeAfterMap) assertMapIdle();
  if (serverStarting || serverStopping) throw new Error("サーバーを起動・停止中です。完了までお待ちください。");
  serverStarting = true;
  try {
  if (isInitialSetupRunning()) throw new Error("環境構築が完了するまでお待ちください。");
  const dir = getServerRoot();
  const bat = path.join(dir, "run.bat");
  if (!fs.existsSync(bat)) throw new Error(`run.bat not found: ${bat}`);
  if (serverProcRef) return { ok: true, alreadyRunning: true, backup: null };

  // アプリを開き直しても、動作中のサーバーを再起動したりMAPに触れたりしない。
  const existing = await getServerProcessStatus();
  if (existing.running) {
    if (existing.modAuthFailed) throw new Error(`起動済みのサーバーが見つかりましたが、${BRIDGE_MOD_AUTH_FAILED}`);
    if (!existing.modReady) throw new Error("起動済みのサーバーが見つかりましたが、MyGamePackのModに接続できません。サーバーの起動完了とModの設定を確認してください。");
    appendServerLog("[SERVER] 起動済みのサーバーを使用します（このアプリからの停止・MAP操作はできません）");
    return { ok: true, alreadyRunning: true, external: true, backup: null };
  }

  await mapSaves.recover();
  require('./bridge_mod_migration.cjs').retireLegacyEnvironment(dir);
  // MAPは「保存する」を押した時だけ作成。旧autoBackup設定が残っていても自動保存しない。

  // 黒い別窓は開かず、出力をアプリ内（ダッシュボードのForgeログ）へ取り込む。
  // run.bat 末尾の pause は NO_PAUSE=1 で無効化される。stdin は stop コマンド送信用。
  serverLogBuffer.length = 0;
  appendServerLog("[SERVER] Forgeサーバーを起動します");

  // 重力反転などの浮遊系コマンドで「このワールドでは飛行が禁止されています」キックが
  // 出ないよう、起動前に allow-flight=true を強制する（server.properties は起動時にのみ
  // 読み込まれるため、ここが唯一の安全な適用タイミング）。
  try {
    const propsPath = path.join(dir, "server.properties");
    if (fs.existsSync(propsPath)) {
      const props = fs.readFileSync(propsPath, "utf8");
      // (\r?) を捕捉して戻すことで CRLF ファイルの行末を LF に変えてしまわないようにする
      if (/^allow-flight=false[ \t]*\r?$/m.test(props)) {
        fs.writeFileSync(propsPath, props.replace(/^allow-flight=false[ \t]*(\r?)$/m, "allow-flight=true$1"), "utf8");
        appendServerLog("[SERVER] allow-flight=true を適用しました（浮遊コマンドのキック対策）");
      }
    }
  } catch { /* 設定に失敗しても起動は続行 */ }
  // 開発版（パッケージ前）は、BRIDGE とゲームの切替がリポジトリの bridge/commands/minecraft を使う。
  // BridgeMOD はふだんサーバーフォルダーの bridge/commands/minecraft を読むので、同じ場所を環境変数で教える。
  // インストール版はどちらもサーバーフォルダーなので渡さない（利用者の環境に残っていても消す）。
  const serverEnv = { ...process.env, NO_PAUSE: "1" };
  if (app.isPackaged) delete serverEnv.BRIDGE_MOD_COMMANDS_DIR;
  else serverEnv.BRIDGE_MOD_COMMANDS_DIR = path.join(getBridgeBatDir(), "commands", "minecraft");
  const proc = spawn("cmd.exe", ["/c", bat], {
    cwd: dir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: serverEnv,
  });
  serverProcRef = proc;
  serverPid = proc.pid;
  pipeServerStream(proc.stdout, "");
  pipeServerStream(proc.stderr, "[stderr] ");
  proc.on("error", (e) => appendServerLog(`[SERVER] 起動エラー: ${e?.message || e}`));
  proc.on("exit", (code, signal) => {
    appendServerLog(`[SERVER] 終了しました code=${code ?? "null"} signal=${signal ?? "null"}`);
    if (serverProcRef === proc) { serverPid = null; serverProcRef = null; }
  });

  return { ok: true };
  } finally { serverStarting = false; }
}
ipcMain.handle("server:start", () => startServer());

// --------------------
// IPC: サーバー停止（保存完了を待ち、保存中の強制終了はしない）
// --------------------
ipcMain.handle("server:stop", async (_event, origin) => {
  assertMapIdle();
  if (serverStarting || serverStopping) throw new Error("サーバーを起動・停止中です。完了までお待ちください。");
  const proc = serverProcRef;
  if (!proc) {
    if ((await getServerProcessStatus()).running) throw new Error("このアプリを開く前から起動しているサーバーです。起動した画面で stop を実行してください。BRIDGEは単独で停止できます。");
    return { ok: true, alreadyStopped: true, graceful: true };
  }
  serverStopping = true;
  try {
    await stopMapServer(origin);
    return { ok: true, graceful: true };
  } finally { serverStopping = false; }
});

// --------------------
// IPC: サーバーログ・稼働状態（ダッシュボードのForgeログパネル用）
// --------------------
ipcMain.handle("server:logs", () => ({ ok: true, lines: [...serverLogBuffer] }));

// Forgeサーバーのコンソールへコマンドを1行送る（op 付与やデバッグの脱出ハッチ）。
// 先頭の "/" は付けても付けなくてもよい（コンソールでは不要なので取り除く）。
ipcMain.handle("server:command", async (_event, command) => {
  assertMapIdle();
  if (!isOperatorAuthed()) throw new Error("運営ログインが必要です。ログインし直してからコンソールコマンドを送信してください。");
  const cmd = String(command || "").trim().replace(/^\//, "");
  if (!cmd) throw new Error("コマンドが空です");
  if (/[\r\n]/.test(cmd)) throw new Error("コマンドは1行で入力してください");
  if (!serverProcRef?.stdin?.writable) throw new Error("Minecraftサーバーが起動していません");
  appendServerLog(`> ${cmd}`);
  if (isConsoleStop(cmd)) stopRequests.record("server", "console");
  serverProcRef.stdin.write(cmd + "\n");
  return { ok: true };
});
async function getServerProcessStatus() {
  if (serverProcRef) return { running: true, managed: true, pid: serverPid };
  const listening = await isServerPortOpen();
  if (!listening) return { running: false, managed: false, pid: null };
  let modReady = false, modAuthFailed = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
    const host = String(cfg.options?.bridgeModHost || cfg.options?.doumaModHost || "127.0.0.1").toLowerCase();
    if (["127.0.0.1", "localhost", "::1"].includes(host)) {
      const status = await requestBridgeMod("GET", "/bridge/status");
      modReady = status.ok === true && Number.isFinite(status.tps) && typeof status.player?.online === "boolean";
    }
  } catch (e) { modAuthFailed = e?.authFailed === true; /* ポートは開いている。Modが準備中なら再起動せず案内する。 */ }
  return { running: true, managed: false, pid: null, modReady, modAuthFailed };
}
ipcMain.handle("server:processStatus", getServerProcessStatus);

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

ipcMain.handle("bridge:launch", async () => { assertMapIdle(); return launchBridge(); });

// --------------------
// IPC: Bridge 停止
// --------------------
ipcMain.handle("bridge:stop", async (_event, origin) => { assertMapIdle(); return stopBridge(origin); });

// --------------------
// IPC: Bridge 再起動（停止完了を待ってから起動する。UI側の stop→launch 連打は使わない）
// --------------------
ipcMain.handle("bridge:restart", async (_event, origin) => {
  assertMapIdle();
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

const BRIDGE_MOD_AUTH_FAILED = "BridgeMODは応答していますが、認証に失敗しました。Minecraftサーバーを起動し直すと直ります。直らない場合は、初期セットアップのサーバーフォルダーと、実際に起動しているサーバーが同じか確認してください。";

function requestBridgeMod(method, requestPath, body, configOverride) {
  return new Promise((resolve, reject) => {
    let cfg = configOverride || {};
    if (!configOverride) try { cfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
    const host = cfg.options?.bridgeModHost || cfg.options?.doumaModHost || "127.0.0.1";
    const port = Number(cfg.options?.bridgeModPort || cfg.options?.doumaModPort || 25576);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    // BridgeMOD はサーバー起動ごとのトークンがない要求を 403 で拒否する。
    const headers = withBridgeModToken(bridgeModTokenPath(getServerRoot()),
      data ? { "Content-Type": "application/json", "Content-Length": data.length } : {});
    const req = http.request({ host, port, path: requestPath, method, timeout: 1500, headers },
    (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = {}; try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
        // 403 は「MODは動いているが認証に失敗」。オフラインと区別して原因と直し方を出す。
        if (res.statusCode === 403) reject(Object.assign(new Error(BRIDGE_MOD_AUTH_FAILED), { status: 403, authFailed: true }));
        else if (res.statusCode >= 400 || parsed.ok === false) reject(Object.assign(new Error(parsed.message || `HTTP ${res.statusCode}`), { status: res.statusCode }));
        else resolve(parsed);
      });
    });
    req.on("timeout", () => req.destroy(new Error("Mod status timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function getOperationsHistoryPath() { return path.join(getBridgeBatDir(), "operations-history.json"); }

// operations-history.json は bridge（Node）と electron（main）の両方が書き込む。
// 従来の「全体読み込み→unshift→全体書き込み」は同時書き込みで履歴が巻き戻る事故があったため、
// 追記のみ（JSONL: 1行1イベント、古い順）に変更した。読み出し時に新しい順へ変換して返す。
// 旧フォーマット（JSON配列、新しい順）のファイルもそのまま読めるよう互換を維持する。
function readOperationsHistory() {
  let raw = "";
  try { raw = fs.readFileSync(getOperationsHistoryPath(), "utf8"); } catch { return []; }
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    // 旧フォーマット（JSON配列）
    try { return JSON.parse(trimmed); } catch { return []; }
  }
  const rows = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* 壊れた行はスキップ */ }
  }
  return rows.reverse(); // 新しい順
}

// 旧バージョン（JSON配列・新しい順）で運用していたファイルをJSONL（1行1イベント・古い順）へ
// その場で一度だけ変換する。以降は追記のみで済むため、bridgeとelectronの同時書き込みで
// 履歴が巻き戻る事故が起きなくなる。
function migrateOperationsHistoryToJsonlIfNeeded(historyPath) {
  let raw = "";
  try { raw = fs.readFileSync(historyPath, "utf8"); } catch { return; }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return; // 既にJSONL、または空
  let rows;
  try { rows = JSON.parse(trimmed); } catch { return; }
  if (!Array.isArray(rows)) return;
  const oldestFirst = [...rows].reverse(); // 旧フォーマットは新しい順→古い順に戻す
  const lines = oldestFirst.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(historyPath, lines ? lines + "\n" : "", "utf8");
}

// 30日より古いイベント履歴を起動時に削除（配信集計リストの保持期間）
function pruneOperationsHistoryOldRows(days = 30) {
  const historyPath = getOperationsHistoryPath();
  try {
    migrateOperationsHistoryToJsonlIfNeeded(historyPath);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const lines = fs.readFileSync(historyPath, "utf8").split("\n").filter((l) => l.trim());
    const kept = lines.filter((line) => {
      try { return (Date.parse(JSON.parse(line).at) || 0) >= cutoff; } catch { return false; }
    });
    if (kept.length !== lines.length) {
      fs.writeFileSync(historyPath, kept.length ? kept.join("\n") + "\n" : "", "utf8");
      console.log(`[stats] pruned operations history: ${lines.length} -> ${kept.length} rows (${days}d)`);
    }
  } catch { /* ファイルが無ければ何もしない */ }
}

// bridge が記録する視聴者数メトリクス（stream-metrics.jsonl）を読む
function readViewerMetrics() {
  const p = path.join(getBridgeBatDir(), "stream-metrics.jsonl");
  try {
    return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .map((r) => ({ t: Date.parse(r.at) || 0, viewers: Number(r.viewers) || 0 }))
      .filter((r) => r.t > 0);
  } catch { return []; }
}

ipcMain.handle("mod:status", async () => {
  try { return { online: true, ...(await requestBridgeMod("GET", "/bridge/status")) }; }
  catch (e) { return { online: false, authFailed: e?.authFailed === true, error: e.message }; }
});
// 妨害の一時停止・再開（BridgeMOD 1.8.0 の /bridge/control。2026-10-16 ユーザーの決定）。停止と同じく出どころを記録する。
async function setDisruptionPause(pause, origin) {
  stopRequests.record(pause ? "pause" : "resume", origin);
  try {
    const result = await requestBridgeMod("POST", "/bridge/control", { action: pause ? "pause" : "resume" });
    return { ok: true, paused: result.paused === true };
  } catch (error) {
    // 1.7.5〜1.7.6 は 400（受け付けない指示）、1.7.4 より前は /bridge/control がなく 404（HTML）を返す。
    if (error?.status === 400 || error?.status === 404) return { ok: false, message: "BridgeMOD を新しくすると使えます（1.8.0 以上）。" };
    // 認証の失敗は直し方を含んだ文言を返す。つながらない・応答がないときは、英語の生の文字列を出さない。
    if (error?.authFailed) return { ok: false, message: error.message };
    if (!error?.status) return { ok: false, message: "BridgeMOD とつながっていません。Minecraft サーバーが動いているか確かめてください。" };
    return { ok: false, message: error?.message || String(error) };
  }
}
ipcMain.handle("mod:pause", (_event, origin) => setDisruptionPause(true, origin));
ipcMain.handle("mod:resume", (_event, origin) => setDisruptionPause(false, origin));
// テスト発火は BRIDGE に渡し、本番と同じ処理・同じ送る列を通す（2026-10-16 ユーザーの決定。
// 設計書 docs/superpowers/specs/2026-10-16-test-fire-parity-design.md）。BRIDGE は結果を最大10秒待つので、返事は15秒まで待つ。
let testEventReplyMs = 15000;
function askBridgeTestEvent(input) {
  const child = bridgeProcRef;
  if (!child?.connected) return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let timer = null;
    const onMessage = message => { if (message?.type === "testEventResult" && message.id === id) finish(resolve, message.result); };
    const onExit = () => finish(reject, new Error("BRIDGE が止まったため、結果を受け取れませんでした。"));
    function finish(settle, value) {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      settle(value);
    }
    child.on("message", onMessage);
    child.on("exit", onExit);
    timer = setTimeout(() => finish(reject, new Error("BRIDGE から返事がありません。BRIDGE のログを確認してください。")), testEventReplyMs);
    try { child.send({ type: "testEvent", id, input }, error => { if (error) finish(reject, new Error("BRIDGE へ送れませんでした: " + error.message)); }); }
    catch (error) { finish(reject, new Error("BRIDGE へ送れませんでした: " + error.message)); }
  });
}

const BRIDGE_STOPPED_FOR_TEST = { ok: false, bridgeStopped: true, message: "BRIDGE を起動すると試せます。" };
let testEventRunning = false;
ipcMain.handle("mod:testEvent", async (_event, value) => {
  if (testEventRunning) return { ok: false, message: "別のテストを実行中です。完了後にお試しください。" };
  const bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
  assertGameCommands(bridgeCfg, selectableCommandNames(), gameProfiles.list());
  if (value?.type === "gift") assertGameCommands({ gameProfile: bridgeCfg.gameProfile, commandFile: value.commandFile }, selectableCommandNames(), gameProfiles.list());
  // RCON・7DTD では BridgeMOD の状態を読みに行かず、使えない理由をそのまま返す（最後のレビュー Minor #5）。
  if (!usesBridgeModTransport(bridgeCfg)) return { ok: false, message: "テスト発火は、Minecraft を BridgeMOD で動かしているときだけ使えます。" };
  if (!bridgeProcRef?.connected) return { ...BRIDGE_STOPPED_FOR_TEST };
  const preview = value?.preview === true;
  testEventRunning = true;
  try {
    // 一時停止中でも待ちに積む。実行は再開まで待つことを結果に書く（2026-10-16）。
    // 読み取りは実行中の印を立てたあとに行う（待っている間に押された2つ目を、同時に動かさない）。
    let paused = false;
    if (!preview) {
      try { paused = (await requestBridgeMod("GET", "/bridge/status", null, bridgeCfg)).paused === true; }
      catch (error) {
        // つながらないときは送らない。止まっている間に送る列へ入れると、あとでサーバーを起動したときに思いがけず動く（設計書 7）。
        // HTTP の応答が返ったとき（403 など）はつながっているので送り、BRIDGE の送り直しに任せる。
        if (!Number.isInteger(error?.status)) return { ok: false, message: "Minecraft サーバー（BridgeMOD）につながりません。サーバーを起動してから試してください。" };
      }
    }
    const result = await askBridgeTestEvent({ ...value, preview });
    if (!result) return { ...BRIDGE_STOPPED_FOR_TEST };
    if (!result.ok) throw new Error(result.error || "テスト発火に失敗しました。");
    const steps = result.steps || [], notes = result.notes || [], fired = result.fired || [];
    if (preview || !steps.length) return {
      ok: true, matched: steps.length > 0, preview: true, steps, notes,
      message: steps.length ? steps.length + "件の設定が条件に一致しました（未送信）。" : "発火する設定はありません。条件・有効設定を確認してください。",
    };
    const count = state => fired.filter(row => row.state === state).length;
    const delivered = count("delivered"), pending = count("pending"), failed = count("failed"), discarded = count("discarded");
    const parts = ["BridgeMOD が受け付けた " + delivered + "件"];
    if (pending) parts.push("送り直し中 " + pending + "件");
    if (failed) parts.push("送れなかった " + failed + "件");
    if (discarded) parts.push("取りやめ " + discarded + "件");
    // 手順があるのに何も受け付けられなかったら（ルーレットを途中で無効にしたなど）、成功にしない（最後のレビュー Important #1）。
    return { ok: failed === 0 && discarded === 0 && delivered + pending > 0, matched: true, fired, steps, notes,
      // 送れなかった分は再開しても実行されないので、受け付けた分・送り直し中の分があるときだけ書く。
      message: parts.join("・") + "。ゲーム内の結果も確認してください。" + (paused && delivered + pending > 0 ? " 一時停止中です。再開すると実行されます。" : "") };
  } finally { testEventRunning = false; }
});

ipcMain.handle("stream:session:status", () => {
  const sessions = streamSessions.read();
  const current = streamBuckets([], sessions, 90 * 60000).find(s => s.source === 'automatic' && s.active);
  let runtime = {};
  try { runtime = JSON.parse(fs.readFileSync(path.join(getBridgeBatDir(), 'runtime-status.json'), 'utf8')); } catch {}
  return { active: current && bridgeProcRef ? sessions.find(s => s.id === current.id) : null, monitoring: Boolean(bridgeProcRef), error: bridgeProcRef ? runtime.recording?.error || '' : '' };
});
ipcMain.handle("stream:session:start", (_event, title) => streamSessions.start(title));
ipcMain.handle("stream:session:end", (_event, value) => streamSessions.end(value?.id, value?.endedAt));
ipcMain.handle("image:saveGiftPanel", (_event, value) => saveGiftPanelPng(dialog, value));

// --------------------
// IPC: マイクラIDへ OP 権限を付与（_op.txt を書いて Mod 経由で実行）
// --------------------

// Mod HTTP (25576) が応答するまで待つ。Forge起動直後はワールド読み込み中でまだ
// 待ち受けが開いておらず、即送信すると ECONNREFUSED になる（一括起動時の
// OP自動付与とゲームルール適用が毎回「スキップ」されていた真因）。
// 同一サーバープロセスで一度タイムアウトしたら記録し、以降の呼び出しは1回の確認だけで
// 即諦める（一括起動で gamerules→OP付与 と連続150秒ずつ待って計5分固まる事故の防止）。
let bridgeModWaitTimedOutFor = null;
async function waitForBridgeMod(timeoutMs = 150000, intervalMs = 3000) {
  let authFailed = false;
  const quickCheck = async () => {
    for (let attempt = 0; ; attempt++) {
      try { await requestBridgeMod("GET", "/bridge/status"); authFailed = false; return true; }
      catch (e) {
        authFailed = e?.authFailed === true;
        // トークンの書き換えと読み込みがすれ違うと、正常でも1回だけ 403 になる。少し待って読み直してから判断する。
        if (!authFailed || attempt >= 1) return false;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };
  // 認証の失敗は待っても直らない（トークンはサーバー起動時に HTTP より先に書かれる）。すぐ原因を出す。
  const reportAuthFailure = () => { appendServerLog(`[SERVER] ${BRIDGE_MOD_AUTH_FAILED}（トークンファイル: ${bridgeModTokenPath(getServerRoot())}）`); return false; };
  if (await quickCheck()) { bridgeModWaitTimedOutFor = null; return true; }
  if (authFailed) return reportAuthFailure();
  if (serverProcRef && bridgeModWaitTimedOutFor === serverProcRef) return false;
  appendServerLog("[SERVER] Mod（BridgeMod）のHTTP応答を待っています。ワールド読み込み完了（Done表示）までお待ちください…");
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() >= deadline || !serverProcRef) {
      if (serverProcRef) {
        bridgeModWaitTimedOutFor = serverProcRef;
        appendServerLog("[SERVER] Modの応答待ちがタイムアウトしました（HTTP:25576）。mods/ の bridgemod jar 配置とサーバーログを確認してください。");
      }
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (await quickCheck()) {
      bridgeModWaitTimedOutFor = null;
      appendServerLog("[SERVER] Mod（HTTP:25576）と接続できました。");
      return true;
    }
    if (authFailed) return reportAuthFailure();
  }
}

// サーバー停止中でも OP を付与できるよう ops.json へ直接書く。
// 過去に一度でもログインしていれば usercache.json から UUID を引ける。
function grantOpOffline(name) {
  const root = getServerRoot();
  let cache = [];
  try { cache = JSON.parse(fs.readFileSync(path.join(root, "usercache.json"), "utf8")); } catch {}
  const entry = Array.isArray(cache)
    ? cache.find((c) => c && String(c.name || "").toLowerCase() === name.toLowerCase())
    : null;
  if (!entry?.uuid) return false;
  const opsPath = path.join(root, "ops.json");
  let ops = [];
  try { ops = JSON.parse(fs.readFileSync(opsPath, "utf8")); } catch {}
  if (!Array.isArray(ops)) ops = [];
  if (!ops.some((o) => o && String(o.name || "").toLowerCase() === name.toLowerCase())) {
    ops.push({ uuid: entry.uuid, name: entry.name, level: 4, bypassesPlayerLimit: false });
    fs.writeFileSync(opsPath, JSON.stringify(ops, null, 2) + "\n", "utf8");
  }
  return true;
}

ipcMain.handle("minecraft:grantOp", async () => {
  const name = String(readAppConfig().minecraftPlayerName || "").trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error("マイクラIDが未設定か形式が不正です（英数字と_で3〜16文字）。ダッシュボードで保存してください。");
  }
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "_op.txt"), `# TITLE: OP付与\nop ${name}\n`, "utf8");
  try {
    // サーバー起動直後ならワールド読み込み完了（Mod HTTP 開通）まで待ってから送る
    if (serverProcRef) await waitForBridgeMod();
    await requestBridgeMod("POST", "/bridge/event", {
      type: "other", key: "_op", count: 1, listenerName: "system", announce: false,
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/ECONNREFUSED|timeout|ENOTFOUND|ECONNRESET/i.test(msg)) {
      // サーバー停止中：ops.json へ直接登録（次回起動から有効）
      if (!serverProcRef && grantOpOffline(name)) {
        return { ok: true, name, offline: true, message: `サーバー停止中のため ops.json に直接登録しました。次回サーバー起動から「${name}」はOPになります。` };
      }
      if (!serverProcRef) {
        throw new Error("Minecraftサーバーが起動しておらず、過去のログイン記録も無いため付与できません。一度サーバーに接続（ログイン）してから再度お試しください。");
      }
      throw new Error("Minecraftサーバーは起動中ですが、Mod（BridgeMod）に接続できません。ワールドの読み込み完了（コンソールに Done 表示）を待ってから再度お試しください。");
    }
    throw e;
  }
  return { ok: true, name };
});
ipcMain.handle("operations:history", () => readOperationsHistory());
ipcMain.handle("operations:history:clear", () => {
  fs.writeFileSync(getOperationsHistoryPath(), "[]", "utf8"); return { ok: true };
});

let mapOperationBusy = false;
let serverStarting = false;
let serverStopping = false;
function assertMapIdle() {
  if (mapOperationBusy || mapSaves.isBusy()) throw new Error('MAPを保存・読込中です。完了までお待ちください。');
}
async function portIsOpen(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const socket = require('node:net').connect({ port, host });
    socket.setTimeout(1200);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('サーバーの稼働状態を確認できません。時間をおいて再試行してください。')); });
    socket.once('error', error => { socket.destroy(); if (['ECONNREFUSED', 'EADDRNOTAVAIL'].includes(error.code)) resolve(false); else reject(error); });
  });
}
async function assertMapServerStopped() {
  if (serverProcRef || serverPid) throw new Error('サーバーが停止していません。MAP操作を中止しました。');
  if (await isServerPortOpen()) throw new Error('別のMinecraftサーバーが起動しています。停止してからMAPを操作してください。');
}
async function isServerPortOpen() {
  if (!fs.existsSync(path.join(getServerRoot(), 'server.properties'))) return false;
  const props = fs.readFileSync(path.join(getServerRoot(), 'server.properties'), 'utf8');
  const port = Number(props.match(/^server-port=(.+)$/m)?.[1]?.trim() || 25565);
  const host = props.match(/^server-ip=(.+)$/m)?.[1]?.trim();
  for (const address of new Set(['127.0.0.1', '::1', ...(host && host !== '0.0.0.0' && host !== '::' ? [host] : [])])) {
    if (await portIsOpen(port, address)) return true;
  }
  return false;
}
const mapSaves = require('./map_saves.cjs').createMapSaves({ getRoot: getServerRoot, assertStopped: assertMapServerStopped });
function waitChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const done = value => { clearTimeout(timer); child.removeListener('exit', ended); resolve(value); };
    const ended = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    child.once('exit', ended);
  });
}
// サーバーへ stop を書くのはここだけ（コンソールコマンドを除く）。origin はどのボタン・操作から止めたか。
async function stopMapServer(origin) {
  const child = serverProcRef;
  if (!child) { await assertMapServerStopped(); return; }
  if (!child.stdin?.writable) throw new Error('サーバーに保存・停止を送信できません。ダッシュボードで停止してください。');
  const ended = waitChildExit(child, 120000);
  appendServerLog(`[SERVER] ワールドを保存して停止します（${stopRequests.record('server', origin)}）`);
  child.stdin.write('stop\n');
  if (!await ended) throw new Error('サーバーの保存・停止がまだ完了していません。強制終了せずに待機しています。Forgeログを確認し、停止完了後に再試行してください。');
  if (serverProcRef === child) { serverProcRef = null; serverPid = null; }
  if (child.exitCode !== 0) throw new Error('サーバーが正常終了しませんでした。Forgeログを確認してください。');
  await assertMapServerStopped();
}
async function runMapOperation(origin, action) {
  assertGameProfileIdle();
  assertMapIdle();
  if (isInitialSetupRunning() || serverStarting || serverStopping) throw new Error('サーバーの準備・停止が終わるまでお待ちください。');
  mapOperationBusy = true;
  const restartServer = Boolean(serverProcRef), restartBridge = Boolean(bridgeProcRef || bridgeRestartTimer);
  try {
    if (restartBridge) await stopBridge(origin);
    await stopMapServer(origin);
    const result = await action();
    let restartError = '';
    try {
      if (restartServer) await startServer(true);
      if (restartBridge) await launchBridge();
    } catch (error) { restartError = error.message; }
    return { ok: true, ...result, restarted: restartServer, restartError };
  } finally { mapOperationBusy = false; }
}
ipcMain.handle('world:saves:list', async () => ({ ...(await mapSaves.list()), busy: mapOperationBusy || mapSaves.isBusy() }));
ipcMain.handle('world:saves:save', (_event, name) => runMapOperation('map:save', async () => ({ saved: await mapSaves.save(name) })));
ipcMain.handle('world:saves:load', (_event, id) => runMapOperation('map:load', () => mapSaves.load(id)));

async function createWorldBackup() {
  const saved = await mapSaves.save('', 'manual');
  return { ok: true, path: path.join(getServerRoot(), 'map-saves', saved.id), reason, message: 'MAPを保存しました: ' + saved.name };
}
ipcMain.handle('world:backup', () => runMapOperation('map:backup', () => createWorldBackup()));

function getPresetDir() {
  const dir = path.join(getBridgeBatDir(), "presets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
ipcMain.handle("presets:list", () =>
  fs.readdirSync(getPresetDir()).filter(name => name.endsWith(".json")).sort()
);
ipcMain.handle("presets:save", (_event, name) => {
  const safe = String(name || "").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 60);
  if (!safe) throw new Error("プリセット名が空です");
  fs.copyFileSync(getConfigPath(), path.join(getPresetDir(), `${safe}.json`));
  return { ok: true };
});
ipcMain.handle("presets:load", (_event, name) => {
  const safe = path.basename(String(name || ""));
  const source = path.join(getPresetDir(), safe);
  if (!fs.existsSync(source)) throw new Error("プリセットがありません");
  const value = JSON.parse(fs.readFileSync(source, "utf8"));
  // 以前保存したプリセットは、その中の割り当ても「前からあるもの」として扱う（使えない名前は警告に留める）。
  const validation = validateBridgeConfig(value, { previous: [readSavedBridgeConfig(), value] });
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  writeBridgeConfig(value, { alsoKnown: [value] });
  return { ok: true, config: value };
});
ipcMain.handle("operations:stats", () => {
  const rows = readOperationsHistory();
  const byCommand = {};
  const bySender = {};
  let succeeded = 0;
  for (const row of rows) {
    if (row.ok) succeeded++;
    // 回数0の行（音・粒子だけ失敗）を1回と数えない（PR #85 レビュー。stream_statistics と同じ数え方）。
    const count = Number(row.count);
    const amount = Number.isFinite(count) && count >= 0 ? count : 1;
    byCommand[row.commandFile || "unknown"] = (byCommand[row.commandFile || "unknown"] || 0) + amount;
    bySender[row.sender || "unknown"] = (bySender[row.sender || "unknown"] || 0) + amount;
  }
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count]) => ({ name, count }));
  return { total: rows.length, succeeded, failed: rows.length - succeeded,
    topCommands: top(byCommand), topSenders: top(bySender) };
});

// 配信単位（per-stream）の統計。
// operations-history.json のイベントを時刻ギャップで「配信セッション」に分割し、
// 配信ごとにギフト数・発動数・失敗数・最頻ギフト・トップギフターを集計する。
// gapMinutes 以上イベントが途切れたら別の配信とみなす（既定90分）。
function computeStreamStats(gapMinutes) {
  return require('./stream_statistics.cjs').computeStreamStats({ rows: readOperationsHistory(), sessions: streamSessions.read(), viewerMetrics: readViewerMetrics(), audience: require("../bridge/audience_stats.cjs").readAudienceStats(path.join(getBridgeBatDir(), "stream-audience.json")), earnings: require("./stream_earnings.cjs").readEarnings(path.join(getBridgeBatDir(), "stream-earnings.json")), gapMinutes });
}
ipcMain.handle('operations:stats:export', (_event, streamId) => exportStreamStatsMarkdown({
  stats: computeStreamStats(), streamId, dialog, parent: BrowserWindow.getFocusedWindow(),
}));

ipcMain.handle("operations:earnings:save", (_event, id, amount) => require("./stream_earnings.cjs").saveEarnings(path.join(getBridgeBatDir(), "stream-earnings.json"), computeStreamStats().streams, id, amount));

ipcMain.handle("operations:streamStats", (_event, gapMinutes) => computeStreamStats(gapMinutes));

// --------------------
// IPC: server.properties 読み込み
// --------------------
ipcMain.handle("server:props:read", async () => {
  const propsPath = path.join(getServerRoot(), "server.properties");
  if (!fs.existsSync(propsPath)) throw new Error(`server.properties not found: ${propsPath}`);

  const text = fs.readFileSync(propsPath, "utf-8");
  const props = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1); // 末尾スペース等を保持
    props[key] = val;
  }
  return props;
});

// --------------------
// IPC: server.properties 書き込み
// --------------------
ipcMain.handle("server:props:write", async (_event, updates) => {
  assertMapIdle();
  if (typeof updates !== "object" || updates === null) throw new Error("updates must be an object");

  const propsPath = path.join(getServerRoot(), "server.properties");
  if (!fs.existsSync(propsPath)) throw new Error(`server.properties not found: ${propsPath}`);

  let text = fs.readFileSync(propsPath, "utf-8");

  for (const [key, value] of Object.entries(updates)) {
    const lines = text.split(/\r?\n/);
    let found = false;
    const updated = lines.map((line) => {
      if (line.startsWith("#") || !line.includes("=")) return line;
      const idx = line.indexOf("=");
      const k = line.slice(0, idx).trim();
      if (k === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    text = updated.join("\n");
  }

  fs.writeFileSync(propsPath, text, "utf-8");
  return { ok: true };
});

// --------------------
// IPC: RCONパスワード.txt 読み込み
// --------------------
ipcMain.handle("server:rconpassword:read", async () => {
  const txtPath = path.join(getServerRoot(), "RCON_password.txt");
  if (!fs.existsSync(txtPath)) return { found: false, password: "" };
  const raw = fs.readFileSync(txtPath, "utf-8").trim();
  return { found: true, password: raw };
});

// --------------------
// IPC: ゲームルール一括適用（RCON）
// --------------------
// Environment is owned by BridgeMOD; this legacy IPC now verifies it only.
ipcMain.handle("server:gamerules:apply", async () => {
  if (serverProcRef) await waitForBridgeMod();
  const status = await requestBridgeMod("GET", "/bridge/status");
  if (status.environmentFixed !== true) throw new Error("固定環境に対応したBridgeMODが必要です");
  return { ok: true, transport: "bridge_mod" };
});
// No new datapack is written. Old packs are retired only while the server is stopped.
ipcMain.handle("server:datapack:deployNightVision", () => ({ ok: true, managedBy: "BridgeMOD" }));

// --------------------
// IPC: haihu_world/ 内のサブフォルダ一覧
// --------------------
ipcMain.handle("server:worlds:list", async () => {
  const dir = path.join(getServerRoot(), "haihu_world");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
});
