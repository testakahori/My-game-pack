// electron/main.cjs：アプリの起動と終了、各モジュールを作って必要なものを渡す配線だけを持つ（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 仕事の処理は electron/ の各モジュールに置く。main.cjs は 400 行以下、ほかの electron/*.cjs は各 800 行以下（electron/test/file-size-limits.test.cjs が見張る）。
const { app, BrowserWindow, ipcMain, session, net, shell, clipboard, nativeImage, dialog, safeStorage } = require("electron");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const { runProc } = require("./process_runner.cjs");
// サーバー・BRIDGE の停止を、出どころ（どのボタン・操作から来たか）付きで logs/stop-requests.log に残す。
const { createStopRequestLog } = require("./stop_requests.cjs");
const stopRequests = createStopRequestLog({ file: () => path.join(app.getPath("userData"), "logs", "stop-requests.log") });
const { createSettingsBackups } = require("./settings_backups.cjs");
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
  isBridgeActive: () => bridgeProcess.isActive(),
  getServerProcessStatus: () => getServerProcessStatus(),
  getMinecraftProcessStatus: strict => minecraftClient.getMinecraftProcessStatus(strict),
});
// ゲームの切り替え中かは games_ipc.cjs が持つ。設定の保存・バックアップの復元・ウィンドウを閉じるときに見る。
const { gameProfiles, isGameProfileBusy, assertGameProfileIdle, gameProfileOperation } = gamesIpc;
gamesIpc.register(ipcMain);
const eulerCredentials = require('./euler_credentials.cjs').createEulerCredentials({
  filePath: () => path.join(app.getPath('userData'), 'euler-credentials.json'), safeStorage,
});
const settingsBackups = createSettingsBackups({
  validateRestore: (config, commands) => assertGameCommands(config, [...selectableCommandNames(), ...Object.keys(commands).filter(name => !name.startsWith('game_'))], gameProfiles.list()),
  paths: () => ({
    config: getConfigPath(), app: getAppConfigPath(), tts: getTtsSettingsPath(),
    bridgeTts: path.join(getBridgeBatDir(), "tts-settings.json"),
    commands: path.join(getBridgeBatDir(), "commands", "minecraft"),
    backups: path.join(app.getPath("userData"), "settings-backups", crypto.createHash("sha256").update(path.resolve(getConfigPath())).digest("hex").slice(0, 16)),
  }),
  version: () => app.getVersion(), readTts: () => readTtsSettings(),
  isRunning: () => Boolean(bridgeProcess.isActive() || mapOperations.isBusy() || serverProcess.isStarting() || isGameProfileBusy() || gameProfiles.list().recoveryRequired),
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
  isBridgeRunning: () => Boolean(bridgeProcess.child()),
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
  isBridgeActive: () => bridgeProcess.isActive(),
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
const operationsStats = createOperationsStats({ BrowserWindow, dialog, getBridgeBatDir, bridgeChild: () => bridgeProcess.child() });
// 起動のときに古い操作履歴を整理する（app.whenReady の中で呼ぶ）。
const { pruneOperationsHistoryOldRows } = operationsStats;
operationsStats.register(ipcMain);
const { createBridgeModClient } = require('./bridge_mod_client.cjs');
const bridgeModClient = createBridgeModClient({
  getConfigPath, getServerRoot, stopRequests, selectableCommandNames, gameProfiles, appendServerLog,
  serverChild: () => serverProcess.child(),
  bridgeChild: () => bridgeProcess.child(),
});
// BridgeMOD との通信は bridge_mod_client.cjs が持つ。配信前チェック・サーバーの起動・OP の付与・ゲームルールが使う。
const { requestBridgeMod, waitForBridgeMod } = bridgeModClient;
bridgeModClient.register(ipcMain);
const { createBridgeProcess } = require('./bridge_process.cjs');
const bridgeProcess = createBridgeProcess({
  process, spawn, spawnSync, shell, runProc, stopRequests, eulerCredentials, getBridgeBatDir, getServerRoot, getConfigPath, getNodeCommand, getGvToolPath,
  getBridgeEntryPoint, ensureNodeRuntimeAvailable, assertGameProfileIdle, selectableCommandNames, gameProfiles, waitChildExit,
  assertMapIdle: () => mapOperations.assertIdle(),
});
// BRIDGE の子プロセス・再起動の待ちは bridge_process.cjs が持つ。main とほかのモジュールは、それを読む関数（child・isActive）を
// 呼ばれたときに bridgeProcess.xxx() で読み、分割代入では受けない（テストが差し替えて配線を確かめるため）。下の操作の関数は受けてよい。
const { launchBridge, stopBridge } = bridgeProcess;
bridgeProcess.register(ipcMain);

const isDev = process.env.ELECTRON_DEV === "1";
const { createAppWindow } = require('./window.cjs');
// 保存・準備中（初期セットアップ・MAP の作業・サーバーの起動と停止・ゲームの切り替え）はウィンドウを閉じない。
// 名前のある関数にして、テストから作業ごとに確かめる（MAP・サーバーの起動と停止は差し替えて、初期セットアップ・ゲームの操作は本当に作業中にして）。
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
  // 古い版で保存した設定は、画面が読む前に1回だけ直す。直せなくても起動は止めない（2026-10-18 設計書の 7）。
  let configMigration = { changes: [] };
  try { configMigration = bridgeSettings.migrateSavedConfigOnStartup(); } catch (e) { console.error("[Config] 保存済みの設定を直せませんでした:", e?.message || e); }
  createWindow();
  bridgeSettings.notifyConfigMigration(configMigration.changes).catch(e => console.warn("[Config]", e?.message || e));
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
