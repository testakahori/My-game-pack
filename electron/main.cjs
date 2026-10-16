// electron/main.cjs
const { app, BrowserWindow, ipcMain, session, net, shell, clipboard, nativeImage, dialog, safeStorage } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const { pathToFileURL } = require("url");
const { ENGINE_PORTS, checkEngine, getSpeakers, flattenSpeakers, synthesize } = require("./tts.cjs");
const { validateBridgeConfig } = require("./config_schema.cjs");
const { RestartPolicy } = require("./restart_policy.cjs");
const { runProc } = require("./process_runner.cjs");
// サーバー・BRIDGE の停止を、出どころ（どのボタン・操作から来たか）付きで logs/stop-requests.log に残す。
const { createStopRequestLog, isConsoleStop } = require("./stop_requests.cjs");
const stopRequests = createStopRequestLog({ file: () => path.join(app.getPath("userData"), "logs", "stop-requests.log") });
const { createSettingsBackups, atomicWrite, validCommand } = require("./settings_backups.cjs");
const { commandFileProblem } = require("../bridge/command_files.cjs");
const { bridgeModTokenPath, withBridgeModToken } = require("../bridge/bridge_mod_token.cjs");
const { runPreflight } = require("./preflight.cjs");
const { createStreamSessions, streamBuckets } = require("./stream_sessions.cjs");
const { saveGiftPanelPng } = require("./image_export.cjs");
const { EULA_URL, inspectSetup, inspectForgeClient, launchForgeInstaller, prepareServerEnvironment } = require("./initial_setup.cjs");
const { migrateRetiredCommands } = require("./command_migration.cjs");
const { exportStreamStatsMarkdown } = require("./stats_export.cjs");
const { createGameProfiles } = require('./game_profiles.cjs');
const { refreshGameModsAfterUpdate, gameModsOutdated } = require('./game_mods_refresh.cjs');
const { availableGameCommands, assertGameCommands } = require('./game_command_scope.cjs');
const { discoverMinecraftLocations, validateMinecraftFolder } = require('./minecraft_locations.cjs');
const { tasklistNames, minecraftProcesses, readJavaCommandLines, switchBlockedMessage } = require('./minecraft_processes.cjs');
function minecraftLocationOptions() {
  return { appData: app.getPath('appData'), currentFolder: readAppConfig().minecraftGameFolder, serverRoot: getServerRoot() };
}
let gameProfileBusy = false;
const gameProfiles = createGameProfiles({
  storage: () => path.join(app.getPath('userData'), 'game-profiles', crypto.createHash('sha256').update(path.resolve(getServerRoot())).digest('hex').slice(0, 16)),
  serverRoot: () => getServerRoot(),
  clientRoot: () => readAppConfig().minecraftGameFolder || path.join(app.getPath('appData'), '.minecraft'),
  configPath: () => getConfigPath(),
  bundledPackages: () => {
    const folder = app.isPackaged ? path.join(process.resourcesPath, 'game-packs', 'saikutu') : path.resolve(__dirname, '..', 'build', 'game-packs', 'saikutu');
    return fs.existsSync(path.join(folder, 'game.json')) ? [{ id: 'saikutu', folder }] : [];
  },
  displayJar: () => {
    const dir = app.isPackaged ? path.join(getServerTemplatePath(), 'mods') : path.resolve(__dirname, '..', 'DisplayMod', 'build', 'libs');
    const jars = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^displaymod-[0-9.]+\.jar$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
    return jars.length ? path.join(dir, jars[0]) : null;
  },
  bridgeJar: () => {
    const dir = app.isPackaged ? path.join(getServerTemplatePath(), 'mods') : path.resolve(__dirname, '..', 'BridgeMod', 'build', 'libs');
    const jars = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^bridgemod-[0-9.]+\.jar$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
    if (!jars.length) throw new Error('BridgeMODのjarがありません。開発版のビルドまたは配布ファイルを確認してください');
    return path.join(dir, jars[0]);
  },
  ensureStopped: async () => {
    assertMapIdle();
    if (initialSetupRunning || serverStarting || serverStopping || bridgeProcRef || bridgeRestartTimer || (await getServerProcessStatus()).running) throw new Error('サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください');
    const minecraft = await getMinecraftProcessStatus(true);
    if (minecraft.running) throw new Error(switchBlockedMessage(minecraft.processes));
  },
});
function assertGameProfileIdle() {
  if (gameProfileBusy || gameProfiles.list().recoveryRequired) throw new Error('ゲームの切替中、または切替の復旧が必要です。ホームのゲーム選択を確認してください');
}
async function gameProfileOperation(action) {
  if (gameProfileBusy) throw new Error('ゲームの操作が進行中です');
  gameProfileBusy = true;
  try { return await action(); } finally { gameProfileBusy = false; }
}
// ホームのゲームの状態。どの応答にも、アプリの更新で MOD が古いままかとその理由を含める（PR #91 再レビュー）。
function gamesStatus() {
  const cfg = readAppConfig();
  return { ...gameProfiles.list(), modsOutdatedAfterUpdate: gameModsOutdated(cfg, app.getVersion()), modsRefreshError: cfg.gameModsRefreshError || '' };
}
ipcMain.handle('games:list', () => gamesStatus());
ipcMain.handle('games:activate', (_event, id) => gameProfileOperation(async () => {
  const result = await gameProfiles.activate(id);
  // 「保存」で今の版の MOD を置いたので、アプリ更新後の入れ替えは済んだことにする（2026-10-13）。
  // 開発版は配布版とアプリ設定の場所が同じなので書かない。書けなくても切替は成功として返す（PR #91 レビュー）。
  if (app.isPackaged) {
    try { writeAppConfig({ gameModsVersion: app.getVersion(), gameModsRefreshFailed: '', gameModsRefreshError: '' }); }
    catch (e) { console.warn("[games] アプリ更新後の入れ替えの記録を書けませんでした:", e?.message || e); }
  }
  return { ...result, ...gamesStatus() };
}));
ipcMain.handle('games:recover', () => gameProfileOperation(async () => { await gameProfiles.recover(); return gamesStatus(); }));
ipcMain.handle('games:install', () => gameProfileOperation(async () => {
  const selected = await dialog.showOpenDialog({ title: 'ゲームパックを登録', properties: ['openDirectory'] });
  if (selected.canceled) return { canceled: true };
  await gameProfiles.install(selected.filePaths[0]);
  return gamesStatus();
}));
// ホームの「今すぐ入れ替える」：アプリの更新に合わせた入れ替えを、もう一度試す。「保存」と違ってほかの MOD を退避しない（PR #91 再レビュー）。
ipcMain.handle('games:refreshMods', async () => {
  if (!app.isPackaged) throw new Error('開発版では使えません。ゲームを「保存」してください');
  const result = await refreshGameModsAfterUpdate({ version: app.getVersion(), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation });
  if (result.state === 'failed') throw new Error(result.error);
  return gamesStatus();
});
ipcMain.handle('games:clientFolders', () => discoverMinecraftLocations(minecraftLocationOptions()));
async function saveMinecraftFolder(value, requireCandidate) {
  const options = minecraftLocationOptions();
  const { candidates } = await discoverMinecraftLocations(options);
  const folder = await validateMinecraftFolder(value, { ...options, candidates, requireCandidate });
  writeAppConfig({ minecraftGameFolder: folder });
  return gameProfiles.list();
}
ipcMain.handle('games:selectClientFolder', (_event, folder) => gameProfileOperation(async () => {
  if (gameProfiles.list().recoveryRequired) throw new Error('切替を復旧してから保存先を変更してください');
  return saveMinecraftFolder(folder, true);
}));
ipcMain.handle('games:clientFolder', () => gameProfileOperation(async () => {
  if (gameProfiles.list().recoveryRequired) throw new Error('切替を復旧してから保存先を変更してください');
  const selected = await dialog.showOpenDialog({ title: 'Minecraftのゲームフォルダー（modsの1つ上）', properties: ['openDirectory'] });
  if (selected.canceled) return { canceled: true };
  return saveMinecraftFolder(selected.filePaths[0], false);
}));
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
  isRunning: () => Boolean(bridgeProcRef || bridgeRestartTimer || mapOperationBusy || serverStarting || gameProfileBusy || gameProfiles.list().recoveryRequired),
});

const isDev = process.env.ELECTRON_DEV === "1";

// --------------------
// Paths (A方式: Bridge同梱)
// --------------------
// ✅ 重要：dev/prod ではなく「パッケージ済みか」で分岐する
// - electron . / electron:dev / electron:prod（未パッケージ） => ui/bridge_runtime を見る
// - exe化（electron-builder）後（パッケージ）             => <install>/resources/bridge を見る
function getInstalledBridgeRoot() {
  if (!app.isPackaged) {
    return path.resolve(__dirname, "..", "bridge_runtime"); // ui/bridge_runtime
  }
  return path.join(process.resourcesPath, "bridge"); // <install>/resources/bridge
}

/**
 * resources/bridge/
 * ├─ start_all.bat
 * ├─ node/                     (同梱nodeをここに置くなら)
 * ├─ server/
 * └─ bridge/
 *    ├─ config.minecraft.json
 *    ├─ tools/
 *    │   ├─ fetch_gifts.js
 *    │   └─ gifts_to_html.js
 *    └─ data/
 *        └─ gifts/
 *            ├─ gifts.min.json
 *            ├─ gifts.full.json
 *            ├─ gifts.meta.json
 *            └─ gifts.html
 */
function getBridgeDir() {
  return path.join(getInstalledBridgeRoot(), "bridge");
}

function getConfigPath() {
  return path.join(getBridgeBatDir(), "config.minecraft.json");
}

// gifts データは GiftsViewer と共有（tools-bundled を使うため）
function getGiftsDir() {
  const dir = !app.isPackaged
    ? path.resolve(__dirname, "..", "GiftsViewer", "data", "gifts")
    : path.join(app.getPath("userData"), "gv-data", "gifts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getGiftsMinPath() {
  return path.join(getGiftsDir(), "gifts.min.json");
}

function getGiftsMetaPath() {
  return path.join(getGiftsDir(), "gifts.meta.json");
}

function getGiftsHtmlPath() {
  return path.join(getGiftsDir(), "gifts.html");
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function ensureConfigExists(configPath) {
  if (fs.existsSync(configPath)) return;

  ensureDir(path.dirname(configPath));

  // options/likeEvents/各種イベントを欠いた最小configだと、config:write の commandsDir矯正
  // （options が無いと発火しない）や各イベントの既定動作が効かなくなるため、完全な形で書き出す。
  const defaultConfig = {
    tiktokUsername: "",
    rcon: { host: "127.0.0.1", port: 25575, password: "" },
    mappings: [],
    likeEvents: [],
    unmappedGiftEvent: { commandFile: "", repeat: 1, enabled: false },
    shareEvent: { commandFile: "", repeat: 1, enabled: false },
    followEvent: { commandFile: "", repeat: 1, enabled: false },
    memberEvent: { commandFile: "", repeat: 1, enabled: false },
    options: {
      giftCooldownMs: 300,
      maxCommandsPerGift: 200,
      commandTransport: "bridge_mod",
      bridgeModHost: "127.0.0.1",
      bridgeModPort: 25576,
      maxLikeCatchUpPerEvent: 5,
      logUnknownGifts: true,
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
}

// --------------------
// CSP (prod only-ish)
// --------------------
// ELECTRON_DEV=1 のときは付けない（Vite開発や調査が楽）
// それ以外は付ける（electron:prod / exe）
function installProdOnlyCsp() {
  if (isDev) return;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            // gifts画像URLが https のため許可
            "img-src 'self' data: https:",
            "font-src 'self' data:",
            // TTS テスト再生の base64 wav data URI を許可
            "media-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        ],
      },
    });
  });
}

// --------------------
// Window
// --------------------
function createWindow() {
  const iconPath = path.join(__dirname, "..", "assets", "icon.ico");
  const indexHtml = path.join(__dirname, "..", "dist", "index.html");
  const indexPageUrl = pathToFileURL(indexHtml).href;

  const win = new BrowserWindow({
    width: 1488,
    height: 1000,
    minWidth: 1120,
    minHeight: 720,
    frame: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on("close", event => {
    if (!initialSetupRunning && !mapOperationBusy && !serverStarting && !serverStopping && !gameProfileBusy) return;
    event.preventDefault();
    void dialog.showMessageBox(win, { type: "info", title: "保存・準備中です",
      message: "ワールドと設定を準備しています。保存とサーバー停止が終わるまで、このアプリを開いたままお待ちください。" });
  });

  const openExternalHttpUrl = (rawUrl) => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
      void shell.openExternal(parsed.href);
    } catch {}
  };

  // 外部リンクは http(s) だけOSブラウザで開く。
  // 任意のカスタムプロトコルをshellへ渡すと、別アプリの危険なURLハンドラを起動し得る。
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url);
    return { action: "deny" };
  });

  // preload API はこのアプリのindex.htmlだけに公開する。別のローカルHTMLへの
  // file:// 遷移を許すと、そのHTMLから特権IPCを呼べるため必ず遮断する。
  win.webContents.on("will-navigate", (e, url) => {
    const targetWithoutHash = String(url).split("#", 1)[0];
    if (targetWithoutHash === indexPageUrl) return;
    e.preventDefault();
    openExternalHttpUrl(url);
  });

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question", title: "未保存の変更があります",
      message: "編集中の設定が保存されていません。",
      detail: "変更を残す場合は編集に戻り、保存してから終了してください。",
      buttons: ["編集に戻る", "変更を破棄して終了"], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice === 1) event.preventDefault();
  });
  win.loadFile(indexHtml);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

// --------------------
// Helpers: run process and capture logs
// --------------------
function detectBundledNodeExe() {
  // 置き方が複数あり得るので順に探す。
  // v1.0.12以降: resources/bridge/bridge-runtime.zip を serverFolder/bridge へ必要時展開する。
  const candidates = [];
  try { candidates.push(path.join(getBridgeBatDir(), "node", "node.exe")); } catch {}
  try { candidates.push(path.join(app.getPath("userData"), "bridge", "node", "node.exe")); } catch {}
  try { candidates.push(path.join(getInstalledBridgeRoot(), "node", "node.exe")); } catch {}
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, "node", "node.exe"));

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}

ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.on("window:maximizeToggle", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());

function getNodeCommand() {
  if (process.platform !== "win32") return "node";
  const bundled = detectBundledNodeExe();
  return bundled || "node"; // 最悪PATH
}

function getToolsPath(name) {
  return path.join(getBridgeDir(), "tools", name);
}

function ensureToolsExist() {
  const fetchJs = getToolsPath("fetch_gifts.js");
  const htmlJs = getToolsPath("gifts_to_html.js");
  if (!fs.existsSync(fetchJs)) throw new Error(`tools not found: ${fetchJs}`);
  if (!fs.existsSync(htmlJs)) throw new Error(`tools not found: ${htmlJs}`);
}

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
// IPC: config read/write
// --------------------
ipcMain.handle("config:read", async () => {
  const configPath = getConfigPath();
  ensureConfigExists(configPath);

  const raw = fs.readFileSync(configPath, "utf-8");
  return JSON.parse(raw);
});

const { updateGiftMapping } = require("./gift_mapping.cjs");

// 保存済みの設定（読めなければ null）。前からある割り当てを、新しい問題と区別するために使う。
function readSavedBridgeConfig() {
  try { return JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch { return null; }
}

function writeBridgeConfig(nextConfig, { alsoKnown = [] } = {}) {
  assertGameProfileIdle();
  assertGameCommands(nextConfig, selectableCommandNames(), gameProfiles.list());
  const validation = validateBridgeConfig(nextConfig, { previous: [readSavedBridgeConfig(), ...alsoKnown] });
  if (!validation.ok) throw new Error(`設定エラー:\n${validation.errors.join("\n")}`);
  const configPath = getConfigPath();
  ensureConfigExists(configPath);

  // commandsDir を常にセットアップフォルダ内の絶対パスに固定
  const bridgeDir = getBridgeBatDir();
  const commandsDirAbs = path.join(bridgeDir, "commands", "minecraft");
  const merged = { ...nextConfig };
  if (merged.options) {
    merged.options = { ...merged.options, commandsDir: commandsDirAbs };
  }

  const json = JSON.stringify(merged, null, 2);
  if (json.length > 2_000_000) throw new Error("Config too large.");

  if (fs.readFileSync(configPath, "utf8") !== json) settingsBackups.create("automatic");
  atomicWrite(configPath, json);
  return { ok: true };
}

ipcMain.handle("config:write", async (_event, nextConfig) => writeBridgeConfig(nextConfig));
ipcMain.handle("config:mappings:write", async (_event, mappings) => {
  const configPath = getConfigPath();
  ensureConfigExists(configPath);
  return writeBridgeConfig({ ...JSON.parse(fs.readFileSync(configPath, "utf8")), mappings });
});

ipcMain.handle("config:giftMapping:save", (_event, request) => {
  const configPath = getConfigPath();
  ensureConfigExists(configPath);
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  const names = selectableCommandNames();
  const next = updateGiftMapping(JSON.parse(fs.readFileSync(configPath, "utf8")), request, names);
  // Keep read / compare / write synchronous so another IPC cannot interleave.
  writeBridgeConfig(next);
  return { ok: true, mappings: next.mappings };
});

const { createGiftTemplates } = require("./gift_templates.cjs");
const giftTemplates = createGiftTemplates({
  dialog, appVersion: () => app.getVersion(), writeConfig: writeBridgeConfig,
  context: () => { const configPath = getConfigPath(); ensureConfigExists(configPath); return { configPath, commands: readCommandMetadata() }; },
});
ipcMain.handle("giftTemplate:save", () => giftTemplates.save());
ipcMain.handle("giftTemplate:open", () => giftTemplates.open());
ipcMain.handle("giftTemplate:apply", (_event, token) => giftTemplates.apply(token));
ipcMain.handle("giftTemplate:cancel", (_event, token) => giftTemplates.cancel(token));

ipcMain.handle("config:path", async () => {
  return getConfigPath();
});

ipcMain.handle("settings:backups:list", () => settingsBackups.list());
ipcMain.handle("settings:backups:create", () => settingsBackups.create("manual"));
ipcMain.handle("settings:backups:restore", (_event, id) => { assertGameProfileIdle(); return settingsBackups.restore(id); });
let preflightTask = null;
ipcMain.handle("preflight:run", () => {
  if (!preflightTask) preflightTask = runPreflight({
    configPath: getConfigPath(), serverRoot: getServerRoot(),
    commandsDir: path.join(getBridgeBatDir(), "commands", "minecraft"),
    giftsPath: getGiftsMinPath(), giftsMetaPath: getGiftsMetaPath(),
    modStatus: async () => { try { return { ...(await requestBridgeMod("GET", "/bridge/status")), online: true }; } catch (e) { return { online: false, authFailed: e?.authFailed === true, error: e?.message || "" }; } },
    bridgeStatus: () => {
      let runtime = {};
      try { runtime = JSON.parse(fs.readFileSync(path.join(getBridgeBatDir(), "runtime-status.json"), "utf8")); } catch {}
      return { running: Boolean(bridgeProcRef), tiktok: runtime.tiktok };
    },
    ttsStatus: async () => { const settings = readTtsSettings(); return { enabled: settings.enabled, engine: settings.engine, online: settings.enabled ? await checkEngine(settings.engine) : false }; },
  }).finally(() => { preflightTask = null; });
  return preflightTask;
});

// Compatibility IPCs never contact GitHub or launch an installer. Distribution is manual.
function manualUpdateStatus() {
  return { state: "manual", version: app.getVersion(), percent: 0, error: "", checkedAt: null,
    message: "最新版は配布者から受け取り、インストーラーを実行してください。" };
}
ipcMain.handle("updater:status", manualUpdateStatus);
ipcMain.handle("updater:check", manualUpdateStatus);
ipcMain.handle("updater:install", () => ({ ok: false, ...manualUpdateStatus() }));
ipcMain.handle("config:validate", async (_event, value) => validateBridgeConfig(value, { previous: [readSavedBridgeConfig()] }));

// ✅ preload側の「bridgeRoot / bridgeDir」ズレ事故を防ぐため両方返す
ipcMain.handle("bridge:root", async () => getInstalledBridgeRoot());
ipcMain.handle("bridge:dir", async () => getBridgeDir());
ipcMain.handle("bridge:syncStatus", () => bridgeSyncState);

// アプリバージョン（UIのハードコード表記を廃してこれを使う）
ipcMain.handle("app:version", () => app.getVersion());

// --------------------
// IPC: Gifts read (UIタブ用)
// --------------------
ipcMain.handle("gifts:read", async () => {
  const minPath = getGiftsMinPath();
  const metaPath = getGiftsMetaPath();

  if (!fs.existsSync(minPath)) {
    return { gifts: [], meta: null, exists: false };
  }

  const gifts = JSON.parse(fs.readFileSync(minPath, "utf-8"));
  let meta = null;
  if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));

  return { gifts, meta, exists: true, minPath, metaPath };
});

// フォルダ/HTMLを開く（便利）
ipcMain.handle("gifts:openFolder", async () => {
  const dir = getGiftsDir();
  ensureDir(dir);
  await shell.openPath(dir);
  return { ok: true, dir };
});

ipcMain.handle("gifts:openHtml", async () => {
  const html = getGiftsHtmlPath();
  if (!fs.existsSync(html)) throw new Error(`gifts.html not found: ${html}`);
  await shell.openPath(html);
  return { ok: true, html };
});

// --------------------
// App config (userData/app-config.json)
// --------------------
function getAppConfigPath() {
  return path.join(app.getPath("userData"), "app-config.json");
}

function readAppConfig() {
  const p = getAppConfigPath();
  if (!fs.existsSync(p)) return { serverFolder: "", setupComplete: false };
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
  catch { return { serverFolder: "", setupComplete: false }; }
}

function writeAppConfig(data) {
  const p = getAppConfigPath();
  const current = readAppConfig();
  const next = { ...current, ...data };
  if (next.serverFolder) next.serverFolder = path.resolve(next.serverFolder);
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
}

function readPublicAppConfig() {
  const config = readAppConfig();
  const { authEmail: _authEmail, authToken: _authToken, authLoginAt: _authLoginAt, ...publicConfig } = config;
  return publicConfig;
}

const RENDERER_APP_CONFIG_FIELDS = new Set([
  "serverFolder",
  "setupComplete",
  "setupRequiredByInstall",
  "minecraftPlayerName",
  "minecraftLauncherPath",
  "autoBackupOnServerStart",
]);

function sanitizeRendererAppConfigUpdate(data) {
  const next = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (!RENDERER_APP_CONFIG_FIELDS.has(key)) throw new Error(`変更できないアプリ設定です: ${key}`);
    if (["setupComplete", "setupRequiredByInstall", "autoBackupOnServerStart"].includes(key)) {
      if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
      next[key] = value;
      continue;
    }
    if (typeof value !== "string" || value.length > 4096) throw new Error(`${key} must be a string`);
    next[key] = value;
  }
  return next;
}

// --------------------
// 運営ログイン認証
// --------------------
// リポジトリは public のため平文パスワードは一切置かない。PBKDF2ハッシュのみを埋め込む。
// ログイン成功後は authEmail + authToken(HMAC) を app-config.json に保存し、次回起動時は
// トークン再計算で照合する（パスワード自体は保存しない）。
const OPERATOR_AUTH = {
  salt: "fa2e3d72dcba1a83977e4cac983c5366",
  hash: "8365be19bbae0379de9af9cb411e3883ae9faa82d6eb244ce5e1725a810d1c0c",
  iterations: 210000,
  keyLen: 32,
};

function verifyOperatorPassword(password) {
  const derived = crypto.pbkdf2Sync(
    String(password),
    OPERATOR_AUTH.salt,
    OPERATOR_AUTH.iterations,
    OPERATOR_AUTH.keyLen,
    "sha256"
  );
  const expected = Buffer.from(OPERATOR_AUTH.hash, "hex");
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function operatorLoginToken(email) {
  return crypto
    .createHmac("sha256", OPERATOR_AUTH.hash)
    .update(String(email).trim().toLowerCase())
    .digest("hex");
}

function isValidLoginEmail(email) {
  const v = String(email || "").trim();
  return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

let failedAuthAttempts = 0;
let authLockedUntil = 0;

// 運営ログイン済みかどうか（auth:status と同じ判定）。UI 全体は LoginPage でゲートされて
// いるが、コンソール送信のような強い操作は main 側でも二重に確認する（多層防御）。
function isOperatorAuthed() {
  try {
    const cfg = readAppConfig();
    const email = String(cfg.authEmail || "").trim();
    return !!email && cfg.authToken === operatorLoginToken(email);
  } catch { return false; }
}

/**
 * The NSIS installer writes this one-shot marker after every successful install.
 * Consuming it here makes an installed build always open behind the setup gate,
 * while preserving the previously selected server folder for returning users.
 */
function consumeInstallerSetupReset() {
  if (!app.isPackaged) return;

  const markerPath = path.join(app.getPath("userData"), "require-initial-setup.flag");
  if (!fs.existsSync(markerPath)) return;

  try {
    writeAppConfig({
      setupComplete: false,
      setupRequiredByInstall: true,
      setupRequiredAt: new Date().toISOString(),
    });
    fs.unlinkSync(markerPath);
  } catch (error) {
    console.warn("[setup] failed to consume installer reset marker:", error?.message || error);
  }
}

// --------------------
// Paths: Server / Bridge (UI統合用)
// --------------------

// テンプレートパス（常にバンドル版を返す）
function getServerTemplatePath() {
  if (!app.isPackaged) return path.resolve(__dirname, "..", "server", "Douma_Craft");
  return path.join(process.resourcesPath, "server", "Douma_Craft");
}

function getServerRoot() {
  // app-config.json に保存されたフォルダを優先
  const cfg = readAppConfig();
  // 指定先が消えていても別のサーバーに切り替えない。診断画面で同じパスを示す。
  if (cfg.serverFolder) return path.resolve(cfg.serverFolder);
  // 初回の保存先はアプリの外。更新・アンインストールでワールドを失わない。
  if (!app.isPackaged) return path.resolve(__dirname, "..", "server", "Douma_Craft");
  return path.join(app.getPath("documents"), "MyGamePack", "Server");
}

function getBridgeBatDir() {
  // dev: ui/bridge をそのまま使用
  if (!app.isPackaged) {
    return path.resolve(__dirname, "..", "bridge");
  }
  // packaged: setupComplete=true なら serverFolder/bridge、それ以外は userData/bridge（フォールバック）
  const cfg = readAppConfig();
  if (cfg.setupComplete && cfg.serverFolder && fs.existsSync(cfg.serverFolder)) {
    return path.join(cfg.serverFolder, "bridge");
  }
  return path.join(app.getPath("userData"), "bridge");
}

// --------------------
// Bridge: resources → serverFolder/bridge へ差分同期
// --------------------
const BRIDGE_SYNC_MARKER = ".bridge-sync-state.json";
const BRIDGE_RUNTIME_STATE = ".bridge-runtime-state.json";
const BRIDGE_HEAVY_DIRS = new Set(["node", "node_modules"]);
const BRIDGE_GENERATED_DIRS = new Set(["logs", "presets", "test"]);
const BRIDGE_INTERNAL_BUNDLE_FILES = new Set(["bridge-runtime.zip", "bridge-runtime-manifest.json"]);
const BRIDGE_PRESERVE_FILES = new Set([
  "config.minecraft.json",
  "config.7dtd.json",
  "tts-settings.json",
  "operations-history.json",
  "stream-sessions.json",
  "stream-metrics.jsonl",
  "stream-audience.json",
  "stream-earnings.json",
  "runtime-status.json",
]);
// バンドルから廃止したファイルの墓標リスト。差分同期はコピーのみで配信先の余剰ファイルを
// 消さないため、過去に同梱していて削除したものはここへ列挙して同期時に撤去する
// （名前が完全一致するものだけ消すので、ユーザー自作のコマンドtxtには触れない）。
const BRIDGE_REMOVED_BUNDLE_FILES = [
  "commands/minecraft/giant.txt",
  "commands/minecraft/invisible.txt",
  "commands/minecraft/tiny.txt",
  "commands/minecraft/seichi_donut.txt",
  "commands/minecraft/tornado.txt",
  "commands/minecraft/hukitobasu.txt",
  "commands/minecraft/hurricane.txt",
  "commands/minecraft/husk01.txt",
  "commands/minecraft/give_blindness.txt",
  "commands/minecraft/petsummon.txt",
];
const COPY_HASH_LIMIT_BYTES = 1024 * 1024;

let bridgeSyncState = {
  state: "idle",
  phase: "",
  error: "",
  stats: null,
  updatedAt: null,
};

function setBridgeSyncState(patch) {
  bridgeSyncState = { ...bridgeSyncState, ...patch, updatedAt: new Date().toISOString() };
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("bridge:syncStatus", bridgeSyncState);
  }
}

async function pathExists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

async function safeStat(p) {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

async function sha256File(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function sha256FileIfExists(filePath) {
  try {
    return await sha256File(filePath);
  } catch {
    return "";
  }
}

async function readPackageVersion(filePath) {
  try {
    const json = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    return String(json.version || "");
  } catch {
    return "";
  }
}

function normalizeBridgeRelPath(relPath) {
  return relPath.replace(/\\/g, "/");
}

function shouldPreserveBridgeFile(relPath) {
  return BRIDGE_PRESERVE_FILES.has(normalizeBridgeRelPath(relPath));
}

async function getBridgeRuntimeSignature(root) {
  const nodeExe = path.join(root, "node", "node.exe");
  const nodeStat = await safeStat(nodeExe);
  const bundlePath = path.join(root, "index.bundle.cjs");
  const bundleStat = await safeStat(bundlePath);
  const nodeModulesDir = path.join(root, "node_modules");
  const tiktokPkg = path.join(nodeModulesDir, "tiktok-live-connector", "package.json");
  const rconPkg = path.join(nodeModulesDir, "rcon-client", "package.json");

  return {
    bundleExists: !!bundleStat,
    bundleBytes: bundleStat?.size || 0,
    bundleSha256: await sha256FileIfExists(bundlePath),
    packageJsonSha256: await sha256FileIfExists(path.join(root, "package.json")),
    packageLockSha256: await sha256FileIfExists(path.join(root, "package-lock.json")),
    nodeExeBytes: nodeStat?.size || 0,
    nodeExeSha256: await sha256FileIfExists(nodeExe),
    nodeExeExists: !!nodeStat,
    nodeModulesReady: await pathExists(tiktokPkg) && await pathExists(rconPkg),
    tiktokLiveConnectorVersion: await readPackageVersion(tiktokPkg),
    rconClientVersion: await readPackageVersion(rconPkg),
  };
}

function getBridgeRuntimeArchivePath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "bridge", "bridge-runtime.zip");
  return path.resolve(__dirname, "..", "build", "bridge-runtime.zip");
}

function getBridgeRuntimeManifestPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "bridge", "bridge-runtime-manifest.json");
  return path.resolve(__dirname, "..", "build", "bridge-runtime-manifest.json");
}

async function readJsonFileIfExists(filePath) {
  try {
    return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readBridgeRuntimeManifest() {
  return readJsonFileIfExists(getBridgeRuntimeManifestPath());
}

function getPackagedBridgeResourceDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "bridge");
  return path.resolve(__dirname, "..", "build", "bridge-bundle");
}

function bridgeRuntimeMatchesManifest(signature, manifest) {
  if (!signature?.nodeExeExists || !manifest) return false;
  if (manifest.runtimeKind === "bundle") {
    if (!signature.bundleExists) return false;
    if (manifest.bundleSha256 && signature.bundleSha256 !== manifest.bundleSha256) return false;
    if (Number(signature.nodeExeBytes || 0) !== Number(manifest.nodeExeBytes || 0)) return false;
    if (manifest.nodeExeSha256 && signature.nodeExeSha256 !== manifest.nodeExeSha256) return false;
    return true;
  }
  if (!signature.nodeModulesReady) return false;
  if (Number(signature.nodeExeBytes || 0) !== Number(manifest.nodeExeBytes || 0)) return false;
  if (manifest.nodeExeSha256 && signature.nodeExeSha256 !== manifest.nodeExeSha256) return false;
  const deps = manifest.dependencies || {};
  if (deps["tiktok-live-connector"] && signature.tiktokLiveConnectorVersion !== deps["tiktok-live-connector"]) return false;
  if (deps["rcon-client"] && signature.rconClientVersion !== deps["rcon-client"]) return false;
  return true;
}

async function writeBridgeRuntimeState(bridgeDir, manifest, mode) {
  if (!manifest) return;
  const state = {
    appVersion: app.getVersion(),
    mode,
    runtimeKind: manifest.runtimeKind || "archive",
    updatedAt: new Date().toISOString(),
    archiveSha256: manifest.archiveSha256,
    bundleSha256: manifest.bundleSha256,
    packageJsonSha256: manifest.packageJsonSha256,
    packageLockSha256: manifest.packageLockSha256,
    nodeExeBytes: manifest.nodeExeBytes,
    nodeExeSha256: manifest.nodeExeSha256,
    dependencies: manifest.dependencies || {},
  };
  await fs.promises.writeFile(path.join(bridgeDir, BRIDGE_RUNTIME_STATE), JSON.stringify(state, null, 2), "utf8");
}

async function expandBridgeRuntimeArchive(archivePath, bridgeDir) {
  await fs.promises.mkdir(bridgeDir, { recursive: true });
  try {
    // Windows 10+ 標準の bsdtar。PowerShell Expand-Archive より大量ファイル展開がかなり速い。
    await runProc("tar.exe", ["-xf", archivePath, "-C", bridgeDir], bridgeDir);
  } catch (tarError) {
    const script = [
      "& { param($zip, $dest)",
      "$ErrorActionPreference='Stop';",
      "Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force",
      "}",
    ].join(" ");
    try {
      await runProc("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, archivePath, bridgeDir], bridgeDir);
    } catch (psError) {
      throw new Error(`Bridge runtime extraction failed. tar: ${tarError.message}; powershell: ${psError.message}`);
    }
  }
}

async function copyBundledRuntimeFiles(bridgeDir, manifest) {
  const sourceRoot = getPackagedBridgeResourceDir();
  const entry = manifest?.entry || "index.bundle.cjs";
  const srcBundle = path.join(sourceRoot, entry);
  const srcNode = path.join(sourceRoot, "node", "node.exe");
  if (!await pathExists(srcBundle)) throw new Error(`Bridge bundle not found: ${srcBundle}`);
  if (!await pathExists(srcNode)) throw new Error(`Bridge node.exe not found: ${srcNode}`);
  await fs.promises.mkdir(path.join(bridgeDir, "node"), { recursive: true });
  await fs.promises.copyFile(srcBundle, path.join(bridgeDir, entry));
  await fs.promises.copyFile(srcNode, path.join(bridgeDir, "node", "node.exe"));
}

async function ensureBridgeRuntimeReady(bridgeDir, stats = null) {
  const signature = await getBridgeRuntimeSignature(bridgeDir);
  const manifest = await readBridgeRuntimeManifest();
  const archivePath = getBridgeRuntimeArchivePath();
  const archiveExists = await pathExists(archivePath);
  const state = await readJsonFileIfExists(path.join(bridgeDir, BRIDGE_RUNTIME_STATE));
  const runtimeKind = manifest?.runtimeKind || "archive";
  const stateMatches = !!manifest && !!state &&
    (state.runtimeKind || "archive") === runtimeKind &&
    Number(state.nodeExeBytes || 0) === Number(manifest.nodeExeBytes || 0) &&
    (!manifest.nodeExeSha256 || state.nodeExeSha256 === manifest.nodeExeSha256) &&
    (runtimeKind === "bundle"
      ? state.bundleSha256 === manifest.bundleSha256
      : state.archiveSha256 === manifest.archiveSha256 && state.packageLockSha256 === manifest.packageLockSha256);

  if (bridgeRuntimeMatchesManifest(signature, manifest) && stateMatches) {
    const result = { ready: true, extracted: false, skipped: true, reason: "current" };
    if (stats) stats.runtime = result;
    return result;
  }

  if (bridgeRuntimeMatchesManifest(signature, manifest) && !stateMatches) {
    await writeBridgeRuntimeState(bridgeDir, manifest, "adopt-existing");
    const result = { ready: true, extracted: false, skipped: true, reason: "adopt-existing" };
    if (stats) stats.runtime = result;
    return result;
  }

  if (runtimeKind === "bundle") {
    setBridgeSyncState({ state: "running", phase: "copying-runtime", error: "", stats });
    await copyBundledRuntimeFiles(bridgeDir, manifest);
    const after = await getBridgeRuntimeSignature(bridgeDir);
    if (!bridgeRuntimeMatchesManifest(after, manifest)) {
      throw new Error(`Bridge bundled runtime copy failed: ${bridgeDir}`);
    }
    await writeBridgeRuntimeState(bridgeDir, manifest, "copied-bundle");
    const result = {
      ready: true,
      extracted: false,
      copied: true,
      skipped: false,
      reason: "copied-bundle",
      bundleBytes: manifest?.bundleBytes || after.bundleBytes || 0,
    };
    if (stats) stats.runtime = result;
    return result;
  }

  if (!archiveExists) {
    if (signature.nodeExeExists && signature.nodeModulesReady) {
      const result = { ready: true, extracted: false, skipped: true, reason: "existing-no-archive" };
      if (stats) stats.runtime = result;
      return result;
    }
    throw new Error(`Bridge runtime archive not found: ${archivePath}`);
  }

  setBridgeSyncState({ state: "running", phase: "extracting-runtime", error: "", stats });
  await expandBridgeRuntimeArchive(archivePath, bridgeDir);
  const after = await getBridgeRuntimeSignature(bridgeDir);
  if (!after.nodeExeExists || !after.nodeModulesReady) {
    throw new Error(`Bridge runtime extraction failed: ${bridgeDir}`);
  }
  await writeBridgeRuntimeState(bridgeDir, manifest, "extracted");
  const result = {
    ready: true,
    extracted: true,
    skipped: false,
    reason: "extracted",
    archiveBytes: manifest?.archiveBytes || (await safeStat(archivePath))?.size || 0,
  };
  if (stats) stats.runtime = result;
  return result;
}

async function ensureNodeRuntimeAvailable() {
  if (!app.isPackaged) return { ready: true, development: true };
  return ensureBridgeRuntimeReady(getBridgeBatDir());
}

function getBridgeEntryPoint(dir) {
  const bundled = path.join(dir, "index.bundle.cjs");
  if (fs.existsSync(bundled)) return bundled;
  return path.join(dir, "index.js");
}

async function filesSame(srcPath, dstPath, srcStat) {
  const dstStat = await safeStat(dstPath);
  if (!dstStat) return false;
  if (srcStat.size !== dstStat.size) return false;

  // 大きいファイルはサイズ一致なら同一扱いにする。
  // node/node_modules は基本的にディレクトリ単位でスキップ判定するため、
  // ここで巨大ファイルを毎回ハッシュしない。
  if (srcStat.size > COPY_HASH_LIMIT_BYTES) return true;

  // 同じコピー由来なら mtime も近いことが多い。軽量な早期 return。
  if (Math.abs(srcStat.mtimeMs - dstStat.mtimeMs) < 2000) return true;

  const [srcHash, dstHash] = await Promise.all([sha256File(srcPath), sha256File(dstPath)]);
  return srcHash === dstHash;
}

async function copyFileIfChanged(srcPath, dstPath, stats) {
  const srcStat = await safeStat(srcPath);
  if (!srcStat || !srcStat.isFile()) return;
  if (await filesSame(srcPath, dstPath, srcStat)) {
    stats.skippedFiles++;
    return;
  }
  await fs.promises.mkdir(path.dirname(dstPath), { recursive: true });
  await fs.promises.copyFile(srcPath, dstPath);
  stats.copiedFiles++;
  stats.copiedBytes += srcStat.size;
}

function shouldSkipHeavyDir(entryName, srcSig, dstSig, forceHeavy) {
  if (forceHeavy) return false;
  if (entryName === "node") {
    return srcSig.nodeExeExists && dstSig.nodeExeExists && srcSig.nodeExeBytes === dstSig.nodeExeBytes;
  }
  if (entryName === "node_modules") {
    return (
      dstSig.nodeModulesReady &&
      srcSig.packageJsonSha256 &&
      srcSig.packageLockSha256 &&
      srcSig.packageJsonSha256 === dstSig.packageJsonSha256 &&
      srcSig.packageLockSha256 === dstSig.packageLockSha256
    );
  }
  return false;
}

async function copyBridgeDifferential(src, dst, options = {}) {
  migrateRetiredCommands(dst);
  require("./saikutu_commands.cjs").retireCommands(dst);
  const forceHeavy = options.forceHeavy === true;
  const preserveUserFiles = options.preserveUserFiles !== false;
  const srcSig = await getBridgeRuntimeSignature(src);
  const dstSig = await getBridgeRuntimeSignature(dst);
  const stats = {
    copiedFiles: 0,
    copiedBytes: 0,
    skippedFiles: 0,
    preservedFiles: 0,
    skippedDirs: 0,
    skippedHeavyDirs: [],
    removedFiles: 0,
  };

  async function walk(srcDir, dstDir, relDir = "") {
    await fs.promises.mkdir(dstDir, { recursive: true });
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
      const srcPath = path.join(srcDir, entry.name);
      const dstPath = path.join(dstDir, entry.name);

      if (entry.name === BRIDGE_SYNC_MARKER) {
        stats.skippedFiles++;
        continue;
      }
      if (!relDir && BRIDGE_INTERNAL_BUNDLE_FILES.has(entry.name)) {
        stats.skippedFiles++;
        continue;
      }

      if (entry.isDirectory()) {
        if (!relDir && BRIDGE_GENERATED_DIRS.has(entry.name)) {
          stats.skippedDirs++;
          continue;
        }
        if (!relDir && BRIDGE_HEAVY_DIRS.has(entry.name) && shouldSkipHeavyDir(entry.name, srcSig, dstSig, forceHeavy)) {
          stats.skippedHeavyDirs.push(entry.name);
          stats.skippedDirs++;
          continue;
        }
        await walk(srcPath, dstPath, relPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (preserveUserFiles && shouldPreserveBridgeFile(relPath) && await pathExists(dstPath)) {
        stats.preservedFiles++;
        continue;
      }
      await copyFileIfChanged(srcPath, dstPath, stats);
    }
  }

  await walk(src, dst);

  // 廃止済みバンドルファイルの掃除。万一同名がバンドルに復活していたら消さない。
  for (const rel of BRIDGE_REMOVED_BUNDLE_FILES) {
    if (await pathExists(path.join(src, rel))) continue;
    const target = path.join(dst, rel);
    if (!(await pathExists(target))) continue;
    try {
      await fs.promises.unlink(target);
      stats.removedFiles++;
      console.log(`[main] removed obsolete bundled file: ${rel}`);
    } catch { /* 消せなくても同期は続行 */ }
  }

  return { stats, signature: srcSig };
}

async function writeBridgeSyncMarker(dst, signature, stats) {
  const marker = {
    appVersion: app.getVersion(),
    syncedAt: new Date().toISOString(),
    signature,
    stats,
  };
  await fs.promises.writeFile(path.join(dst, BRIDGE_SYNC_MARKER), JSON.stringify(marker, null, 2), "utf8");
}

// アプリ更新・セットアップ時に bridgemod Mod jar をサーバーの mods/ へ最新版で揃える。
// 旧実装はテンプレートの「ルート」から jar を探していたため、ルートに残置された
// 旧版 jar（bridgemod-1.1.1.jar 等）を配布して mods/ の最新版を消す逆向きの動作をしていた。
// 正しい供給元はテンプレートの mods/ 配下。
async function refreshBridgeModJar(serverFolder) {
  const srcMods = path.join(getServerTemplatePath(), "mods");
  const jars = fs.existsSync(srcMods) ? fs.readdirSync(srcMods).filter(n => /^bridgemod-.*\.jar$/i.test(n)) : [];
  if (!jars.length) return;
  if (serverProcRef || (await isServerPortOpen())) {
    throw new Error("BridgeMODを入れ替える前にMinecraftサーバーを停止してください");
  }
  jars.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  require("./bridge_mod_migration.cjs").replaceCommonMod(path.join(srcMods, jars[0]), serverFolder);
  const display = fs.readdirSync(srcMods).filter(n => /^displaymod-[0-9.]+\.jar$/i.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (display) require("./bridge_mod_migration.cjs").replaceCommonMod(path.join(srcMods, display), serverFolder, 'displaymod');
}

function scheduleBridgeSync() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    ensureBridgeExtracted()
      .then(() => refreshGameModsOnStartup())
      .catch((e) => {
        const message = e?.message || String(e);
        console.error("[main] bridge background sync failed:", message);
        setBridgeSyncState({ state: "error", phase: "failed", error: message });
      });
  }, 1000);
}

// アプリを更新したあと、今選んでいるゲームの MOD（サーバーと Minecraft の両方）とコマンドを、ホームの「保存」と同じ処理で新しくする。
// 入れ替えられないときは何も変えず、次の起動でもう一度試す。どちらでもホームへ知らせて、ゲームの状態を読み直させる（2026-10-13 ユーザーの決定）。
// 手動インストール（更新も含む）では初期セットアップをやり直すので、そのときはセットアップを終えたとき（app:config:write）に呼ぶ。
async function refreshGameModsOnStartup() {
  if (!app.isPackaged) return;
  const cfg = readAppConfig();
  if (!cfg.setupComplete || !cfg.serverFolder) return;
  let result;
  try {
    result = await refreshGameModsAfterUpdate({ version: app.getVersion(), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation });
  } catch (e) {
    // ゲームの状態が読めないときなど。BRIDGE の展開の失敗とは分けて、ログに残すだけにする。
    console.warn("[games] アプリの更新に合わせたMODの入れ替えを確かめられませんでした:", e?.message || e);
    return;
  }
  if (result.state === "done") console.log("[games] アプリの更新に合わせて、選んでいるゲームのMODを新しくしました:", result.game);
  else if (result.state === "failed") console.warn("[games] アプリの更新に合わせたMODの入れ替えをやめました（次の起動でもう一度試す）:", result.error);
  if (result.state === "done" || result.state === "failed") {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("games:changed", { state: result.state, changed: result.changed === true });
  }
}

async function ensureBridgeExtracted() {
  if (!app.isPackaged) return; // dev は ui/bridge をそのまま使う

  const src = path.join(process.resourcesPath, "bridge");
  if (!fs.existsSync(src)) return; // resources に bridge がない場合は何もしない

  const cfg = readAppConfig();

  // setupComplete=false: セットアップ時に bridge:extractTo で展開するのでスキップ
  if (!cfg.setupComplete || !cfg.serverFolder) return;

  const dst = path.join(cfg.serverFolder, "bridge");
  const currentVersion = app.getVersion();

  // 同バージョン展開済みなら再コピーしない
  if (cfg.bridgeVersion === currentVersion && fs.existsSync(path.join(dst, "index.js"))) {
    setBridgeSyncState({ state: "running", phase: "checking-runtime", error: "", stats: null });
    const runtime = await ensureBridgeRuntimeReady(dst);
    setBridgeSyncState({ state: "current", phase: "skipped", error: "", stats: { runtime } });
    return;
  }

  setBridgeSyncState({ state: "running", phase: "copying", error: "", stats: null });
  const result = await copyBridgeDifferential(src, dst, { preserveUserFiles: true });
  await ensureBridgeRuntimeReady(dst, result.stats);
  await refreshBridgeModJar(cfg.serverFolder);
  await writeBridgeSyncMarker(dst, await getBridgeRuntimeSignature(dst), result.stats);
  writeAppConfig({ bridgeVersion: currentVersion });
  setBridgeSyncState({ state: "done", phase: "complete", error: "", stats: result.stats });
}

// --------------------
// IPC: Bridge を指定フォルダ/bridge/ へ展開（初期セットアップ時）
// --------------------
ipcMain.handle("bridge:extractTo", async (_event, targetFolder) => {
  if (!targetFolder || typeof targetFolder !== "string") throw new Error("targetFolder is required");

  if (!app.isPackaged) {
    // dev: ui/bridge/ をそのまま使うので何もしない
    return { ok: true, skipped: true };
  }

  const src = path.join(process.resourcesPath, "bridge");
  if (!fs.existsSync(src)) throw new Error(`resources/bridge not found: ${src}`);

  const dst = path.join(targetFolder, "bridge");
  const dstConfigPath = path.join(dst, "config.minecraft.json");
  const hadUserConfig = fs.existsSync(dstConfigPath);
  const result = await copyBridgeDifferential(src, dst, { forceHeavy: true, preserveUserFiles: true });
  await ensureBridgeRuntimeReady(dst, result.stats);
  await writeBridgeSyncMarker(dst, await getBridgeRuntimeSignature(dst), result.stats);
  writeAppConfig({ bridgeVersion: app.getVersion() });

  // 新規セットアップ（既存configなし）の場合、同梱テンプレ由来のアカウント情報を
  // 引き継がせない。ID はユーザー自身がダッシュボードで入力して承認する。
  if (!hadUserConfig && fs.existsSync(dstConfigPath)) {
    try {
      const fresh = JSON.parse(fs.readFileSync(dstConfigPath, "utf8"));
      fresh.tiktokUsername = "";
      if (fresh.rcon) fresh.rcon.password = "";
      fs.writeFileSync(dstConfigPath, JSON.stringify(fresh, null, 2), "utf8");
    } catch (e) {
      console.warn("[bridge:extractTo] fresh config sanitize failed:", e?.message || e);
    }
  }

  // 過去バージョンでセットアップされたフォルダを再利用しても mod jar を最新に揃える
  await refreshBridgeModJar(targetFolder);

  return { ok: true, dst, stats: result.stats };
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
  if (initialSetupRunning) throw new Error("環境構築が完了するまでお待ちください。");
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
// IPC: Minecraft ランチャー/ゲーム本体の稼働検知（Gameノード表示用）
// --------------------
// 数える名前と java.exe の見分け方は minecraft_processes.cjs にある。
async function getMinecraftProcessStatus(strict = false) {
  if (process.platform !== "win32") return { running: false, processes: [] };
  const csv = await new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(out); } };
    let p;
    try {
      p = spawn("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true });
    } catch {
      return finish();
    }
    p.stdout.on("data", (d) => (out += d.toString("utf8")));
    p.on("close", finish);
    p.on("error", finish);
    setTimeout(() => { try { p.kill(); } catch { /* ignore */ } finish(); }, 4000);
  });
  if (strict && !String(csv).trim()) throw new Error('Minecraftの停止状態を確認できません。切替を中止しました');
  const names = tasklistNames(csv);
  const javaCommandLines = strict && names.includes('java.exe') ? await readJavaCommandLines() : null;
  const processes = minecraftProcesses(names, { strict, javaCommandLines });
  return { running: processes.length > 0, processes };
}
ipcMain.handle("minecraft:status", () => getMinecraftProcessStatus());

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
    return { ok: failed === 0 && discarded === 0, matched: true, fired, steps, notes,
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
  if (initialSetupRunning || serverStarting || serverStopping) throw new Error('サーバーの準備・停止が終わるまでお待ちください。');
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
// IPC: Minecraft 起動
// --------------------
function getMinecraftLauncherCandidates() {
  const cfg = readAppConfig();
  const list = [];
  if (cfg.minecraftLauncherPath) list.push(cfg.minecraftLauncherPath); // 設定で明示指定を最優先
  list.push(
    "C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe",
    "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Minecraft Launcher", "MinecraftLauncher.exe"),
    path.join(process.env.PROGRAMFILES || "", "Minecraft Launcher", "MinecraftLauncher.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Minecraft Launcher", "MinecraftLauncher.exe"),
  );
  return list.filter(Boolean);
}

ipcMain.handle("minecraft:launch", async () => {
  assertGameProfileIdle();
  const candidates = getMinecraftLauncherCandidates();
  const found = candidates.find((p) => fs.existsSync(p));
  if (found) {
    spawn(found, [], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, path: found };
  }
  // Microsoft Store 版をシェル経由で起動（存在すれば開く。無ければ何も起きないだけ）
  try {
    spawn("explorer.exe", ["shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft"],
      { detached: true, stdio: "ignore" }).unref();
    return { ok: true, viaShell: true };
  } catch {
    throw new Error(
      "Minecraft ランチャーが見つかりませんでした。手動で起動するか、ランチャーの場所を設定してください。\n確認したパス:\n" +
      candidates.join("\n")
    );
  }
});

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
// IPC: フォルダ選択ダイアログ
// --------------------
ipcMain.handle("dialog:pickFolder", async (_event, title) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: title || "フォルダを選択",
  });
  if (canceled || filePaths.length === 0) return { canceled: true, path: "" };
  return { canceled: false, path: filePaths[0] };
});

// ファイル選択ダイアログ（Minecraftランチャーの場所指定などに使用）
ipcMain.handle("dialog:pickFile", async (_event, options) => {
  const title = String(options?.title || "ファイルを選択");
  const filters = Array.isArray(options?.filters) && options.filters.length > 0
    ? options.filters
    : [{ name: "実行ファイル", extensions: ["exe"] }];
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ["openFile"],
    title,
    filters,
  });
  if (canceled || filePaths.length === 0) return { canceled: true, path: "" };
  return { canceled: false, path: filePaths[0] };
});

ipcMain.handle("folder:open", async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== "string") throw new Error("folderPath is required");
  if (!fs.existsSync(folderPath)) throw new Error(`フォルダが見つかりません: ${folderPath}`);
  const error = await shell.openPath(folderPath);
  if (error) throw new Error(error);
  return { ok: true, path: folderPath };
});

// --------------------
// IPC: 同梱資材から初期設定を構築（PowerShell・外部コンソール不要）
// --------------------
let initialSetupRunning = false;
let initialSetupState = { state: "idle", message: "" };
ipcMain.handle("server:setup:status", () => initialSetupState);
async function setupServerAtPath(folderPath) {
  assertGameProfileIdle();
  assertMapIdle();
  if (!folderPath || typeof folderPath !== "string") throw new Error("folderPath is required");
  if (initialSetupRunning) throw new Error("環境構築が進行中です。完了までお待ちください。");
  if (serverProcRef) throw new Error("Minecraftサーバーを停止してから環境構築を実行してください。");
  initialSetupRunning = true;
  initialSetupState = { state: "running", message: "Minecraft利用規約への同意を確認しています…" };
  try {
    let eulaAccepted = false;
    try { eulaAccepted = /^\s*eula\s*=\s*true\s*$/m.test(fs.readFileSync(path.join(folderPath, "eula.txt"), "utf8")); } catch {}
    if (!eulaAccepted) {
      const choice = await dialog.showMessageBox({
        type: "question", title: "Minecraft 利用規約への同意",
        message: "Minecraftの利用規約（EULA）に同意して、サーバー環境を構築しますか？",
        detail: `${EULA_URL}\n\n保存先: ${folderPath}\n「規約を開く」で内容を確認できます。`,
        buttons: ["同意して構築", "規約を開く", "キャンセル"], defaultId: 2, cancelId: 2, noLink: true,
      });
      if (choice.response === 1) await shell.openExternal(EULA_URL);
      if (choice.response !== 0) {
        initialSetupState = { state: "idle", message: "環境構築をキャンセルしました。" };
        return { ok: false, canceled: true };
      }
      eulaAccepted = true;
    }
    const result = await prepareServerEnvironment(folderPath, { eulaAccepted,
      onProgress: message => { initialSetupState = { state: "running", message }; },
    });
    initialSetupState = { state: "done", message: `環境構築が完了しました。配信ワールド: ${result.world}` };
    return result;
  } catch (error) {
    initialSetupState = { state: "error", message: String(error?.message || error) };
    throw error;
  } finally { initialSetupRunning = false; }
}
ipcMain.handle("server:setup:atPath", (_event, folderPath) => setupServerAtPath(folderPath));

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
// IPC: Forgeインストーラーを同梱Javaで直接起動
// --------------------
ipcMain.handle("server:forgeInstall", () => launchForgeInstaller(getServerRoot()));

ipcMain.handle("server:forgeInstall:atPath", (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== "string") throw new Error("folderPath is required");
  return launchForgeInstaller(folderPath);
});
ipcMain.handle("server:forgeClientStatus", () => inspectForgeClient(path.join(app.getPath("appData"), ".minecraft")));

// --------------------
// IPC: 初期セットアップ
// --------------------
ipcMain.handle("server:setup", () => setupServerAtPath(getServerRoot()));

// --------------------
// IPC: Gifts update (bat不要化)
// --------------------
ipcMain.handle("gifts:update", async (_event, username) => {
  const result = await updateGifts(username);
  return {
    ...result,
    giftsDir: result.dir,
    minPath: getGiftsMinPath(),
    htmlPath: getGiftsHtmlPath(),
  };
});

// ====================
// IPC: GiftsViewer 統合 (gv:* プレフィックス)
// ====================

// --------------------
// Paths: GiftsViewer
// --------------------
function getGvToolsDir() {
  if (!app.isPackaged) {
    // tools-bundled を優先（.cjs バンドル済み）、なければ tools
    const bundled = path.resolve(__dirname, "..", "GiftsViewer", "tools-bundled");
    if (fs.existsSync(bundled)) return bundled;
    return path.resolve(__dirname, "..", "GiftsViewer", "tools");
  }
  return path.join(process.resourcesPath, "gv-tools");
}

function getGvDataDir() {
  const dir = !app.isPackaged
    ? path.resolve(__dirname, "..", "GiftsViewer", "data", "gifts")
    : path.join(app.getPath("userData"), "gv-data", "gifts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getGvSettingsPath() {
  return path.join(app.getPath("userData"), "gv-settings.json");
}

function getGvToolPath(name) {
  return path.join(getGvToolsDir(), name);
}

async function autoUpdateGiftsIfStale() {
  let bridgeCfg = {};
  try { bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
  const username = String(bridgeCfg.tiktokUsername || "").trim().replace(/^@/, "");
  if (!username) return { skipped: "username" };
  const metaPath = path.join(getGvDataDir(), "gifts.meta.json");
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const age = Date.now() - Date.parse(meta.generatedAt);
    if (meta.username === username && meta.count > 0 && age >= 0 && age < 86400000 &&
        fs.existsSync(path.join(getGvDataDir(), "gifts.min.json"))) return { skipped: "fresh" };
  } catch { /* 壊れたメタデータも再取得する */ }
  await updateGifts(username);
  console.log(`[gifts:auto-update] updated for @${username}`);
  return { ok: true };
}

// --------------------
// gv:gifts:read
// --------------------
ipcMain.handle("gv:gifts:read", async () => {
  const dir = getGvDataDir();
  const minPath = path.join(dir, "gifts.min.json");
  const metaPath = path.join(dir, "gifts.meta.json");

  if (!fs.existsSync(minPath)) return { gifts: [], meta: null, exists: false };

  const gifts = JSON.parse(fs.readFileSync(minPath, "utf-8"));
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf-8")) : null;

  return { gifts, meta, exists: true };
});

// --------------------
// gv:gifts:update
// --------------------
let giftUpdateTask = null;
let giftUpdateUsername = "";

async function updateGifts(username) {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!/^[\w.]{1,64}$/.test(user)) throw new Error("TikTok IDを入力してください（英数字・ピリオド・アンダースコア）。");
  if (giftUpdateTask) {
    if (giftUpdateUsername !== user) throw new Error("別のアカウントのギフトを更新中です。完了してからお試しください。");
    return giftUpdateTask;
  }
  giftUpdateUsername = user;
  giftUpdateTask = performGiftUpdate(user);
  try { return await giftUpdateTask; }
  finally { giftUpdateTask = null; giftUpdateUsername = ""; }
}

async function performGiftUpdate(user) {
  const fetchTool = getGvToolPath("fetch_gifts.cjs");
  const htmlTool = getGvToolPath("gifts_to_html.cjs");

  if (!fs.existsSync(fetchTool)) throw new Error(`fetch_gifts.cjs not found: ${fetchTool}`);
  if (!fs.existsSync(htmlTool)) throw new Error(`gifts_to_html.cjs not found: ${htmlTool}`);

  const dir = getGvDataDir();
  await ensureNodeRuntimeAvailable();
  const nodeCmd = getNodeCommand();

  // 失敗時に既存データを壊さないよう、取得・HTML生成が完了してから置き換える。
  const staging = fs.mkdtempSync(path.join(dir, ".update-"));
  try {
    const { env } = eulerCredentials.runtime();
    await runProc(nodeCmd, [fetchTool, user, "--out", staging], dir, { timeoutMs: 60000, env });
    await runProc(nodeCmd, [htmlTool, "--in", path.join(staging, "gifts.min.json"), "--out", staging], dir, { timeoutMs: 15000 });
    const gifts = JSON.parse(fs.readFileSync(path.join(staging, "gifts.min.json"), "utf8"));
    const meta = JSON.parse(fs.readFileSync(path.join(staging, "gifts.meta.json"), "utf8"));
    if (!Array.isArray(gifts) || !gifts.length || meta.username !== user || meta.count !== gifts.length) {
      throw new Error("ギフトデータの検証に失敗しました。保存済みの一覧は変更していません。");
    }
    const files = ["gifts.full.json", "gifts.min.json", "gifts.html", "gifts.meta.json"];
    for (const name of files) {
      if (!fs.statSync(path.join(staging, name)).isFile()) throw new Error(`取得ファイルが不正です: ${name}`);
    }
    for (const name of files) {
      fs.renameSync(path.join(staging, name), path.join(dir, name));
    }
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("gifts:updated", meta);
    return { ok: true, dir, meta };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

ipcMain.handle("gv:gifts:update", async (_event, username) => updateGifts(username));

// --------------------
// gv:gifts:openFolder
// --------------------
ipcMain.handle("gv:gifts:openFolder", async () => {
  const dir = getGvDataDir();
  await shell.openPath(dir);
  return { ok: true, dir };
});

// --------------------
// gv:gifts:openHtml
// --------------------
ipcMain.handle("gv:gifts:openHtml", async () => {
  const html = path.join(getGvDataDir(), "gifts.html");
  if (!fs.existsSync(html)) throw new Error(`gifts.html not found: ${html}`);
  await shell.openPath(html);
  return { ok: true, html };
});

// --------------------
// gv:gifts:fetchImageBase64
// --------------------
const { fetchGiftImage } = require("./gift_image.cjs");
ipcMain.handle("gv:gifts:fetchImageBase64", (_event, url) =>
  fetchGiftImage(url, (input, init) => net.fetch(input, init)));

// --------------------
// gv:gifts:copyPngDataUrl
// --------------------
ipcMain.handle("clipboard:writeText", (_event, text) => {
  if (typeof text !== "string" || text.length > 65536) {
    throw new Error("コピーする文字列が不正です");
  }
  clipboard.writeText(text);
  return { ok: true };
});

ipcMain.handle("gv:gifts:copyPngDataUrl", async (_event, dataUrl) => {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png;base64,")) throw new Error("PNG Data URL is invalid");
  if (dataUrl.length > 14 * 1024 * 1024) throw new Error("PNG is too large (max 10MB)");

  const image = nativeImage.createFromDataURL(dataUrl);
  if (image.isEmpty()) throw new Error("Failed to decode PNG image");

  clipboard.writeImage(image);
  return { ok: true };
});

// --------------------
// gv:settings:read / write
// --------------------
ipcMain.handle("gv:settings:read", async () => {
  const p = getGvSettingsPath();
  if (!fs.existsSync(p)) return { username: "" };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
});

ipcMain.handle("gv:settings:write", async (_event, v) => {
  const p = getGvSettingsPath();
  const next = { username: String(v?.username || "").trim().replace(/^@/, "") };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  return { ok: true };
});

// --------------------
// IPC: App config
// --------------------
ipcMain.handle("app:config:read", async () => readPublicAppConfig());

ipcMain.handle("app:config:write", async (_event, data) => {
  assertGameProfileIdle();
  if (data && ('serverFolder' in data || 'world' in data)) { assertMapIdle(); if (serverStarting) throw new Error('サーバーの起動中は保存先を変更できません。'); }
  if (typeof data !== "object" || data === null) throw new Error("data must be an object");
  if (Object.hasOwn(data, "autoBackupOnServerStart") && data.autoBackupOnServerStart !== readAppConfig().autoBackupOnServerStart && fs.existsSync(getConfigPath())) settingsBackups.create("automatic");
  const wasSetupComplete = readAppConfig().setupComplete === true;
  writeAppConfig(sanitizeRendererAppConfigUpdate(data));
  // 手動インストール（更新も含む）のあとは初期セットアップをやり直す。終えたら、アプリの更新に合わせて MOD を入れ替える（PR #91 レビュー）。
  if (!wasSetupComplete && readAppConfig().setupComplete === true) setTimeout(() => { refreshGameModsOnStartup().catch(e => console.warn("[games]", e?.message || e)); }, 0);
  return { ok: true };
});

// --------------------
// IPC: 運営ログイン認証
// --------------------
ipcMain.handle("auth:status", async () => {
  const cfg = readAppConfig();
  const email = String(cfg.authEmail || "").trim();
  if (!email || !cfg.authToken) return { authenticated: false, email: "" };
  const valid = cfg.authToken === operatorLoginToken(email);
  return { authenticated: valid, email: valid ? email : "" };
});

ipcMain.handle("auth:login", async (_event, payload) => {
  const now = Date.now();
  if (now < authLockedUntil) {
    const seconds = Math.max(1, Math.ceil((authLockedUntil - now) / 1000));
    return { ok: false, message: `ログイン試行が多すぎます。${seconds}秒後に再試行してください` };
  }
  const email = String(payload?.email || "").trim();
  const password = String(payload?.password || "");
  if (!isValidLoginEmail(email)) {
    return { ok: false, message: "メールアドレスの形式が正しくありません" };
  }
  if (!verifyOperatorPassword(password)) {
    failedAuthAttempts += 1;
    if (failedAuthAttempts >= 5) {
      failedAuthAttempts = 0;
      authLockedUntil = Date.now() + 60000;
    }
    return { ok: false, message: "パスワードが違います" };
  }
  failedAuthAttempts = 0;
  authLockedUntil = 0;
  writeAppConfig({
    authEmail: email,
    authToken: operatorLoginToken(email),
    authLoginAt: new Date().toISOString(),
  });
  return { ok: true, email };
});

ipcMain.handle("auth:logout", async () => {
  writeAppConfig({ authEmail: "", authToken: "" });
  return { ok: true };
});

// --------------------
// IPC: サーバーテンプレートをコピー（空フォルダ対応）
// --------------------
// 数百MB・数千ファイルのJDK同梱テンプレートを同期fsで丸ごとコピーするとメインプロセスが
// 完全にブロックされ、アプリ全体が無応答になる。fs.promises化した上で、一定件数ごとに
// setImmediateでイベントループへ制御を返し、進捗はポーリング用の状態に積んでUIへ公開する。
let copyTemplateState = { state: "idle", copied: 0, total: 0, error: "" };

function countFilesRecursive(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    count += entry.isDirectory() ? countFilesRecursive(p) : 1;
  }
  return count;
}

async function copyRecursiveAsync(src, dst, onFileCopied) {
  await fs.promises.mkdir(dst, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  let sinceYield = 0;
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyRecursiveAsync(srcPath, dstPath, onFileCopied);
    } else {
      // 既存ファイルはスキップ（上書きしない）
      if (!(await pathExists(dstPath))) {
        await fs.promises.copyFile(srcPath, dstPath);
      }
      onFileCopied();
      sinceYield += 1;
      if (sinceYield >= 25) {
        sinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }
}

ipcMain.handle("server:copyTemplate", async (_event, targetFolder) => {
  assertGameProfileIdle();
  if (!targetFolder || typeof targetFolder !== "string") throw new Error("targetFolder is required");

  const template = getServerTemplatePath();
  if (!fs.existsSync(template)) throw new Error(`テンプレートが見つかりません: ${template}`);

  const commandsSrc = app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "commands", "minecraft")
    : path.resolve(__dirname, "..", "bridge", "commands", "minecraft");
  const commandsDst = path.join(targetFolder, "bridge", "commands", "minecraft");
  const hasCommandsSrc = fs.existsSync(commandsSrc);

  const total = countFilesRecursive(template) + (hasCommandsSrc ? countFilesRecursive(commandsSrc) : 0);
  copyTemplateState = { state: "running", copied: 0, total, error: "" };

  try {
    const onFileCopied = () => { copyTemplateState.copied += 1; };
    await copyRecursiveAsync(template, targetFolder, onFileCopied);

    // MODが読む bridge/commands/minecraft/ をテンプレートコピー時点で展開
    // (bridge:extractTo は確認ボタン後だが、MODはサーバー起動時に読むため早めに配置する)
    if (hasCommandsSrc) {
      await copyRecursiveAsync(commandsSrc, commandsDst, onFileCopied);
    }
    // copyRecursiveAsync は既存ファイルを上書きしないため、再利用フォルダには
    // 旧版の bridgemod jar が残り得る。ここで最新版に揃える（ルートの残骸も撤去）。
    await refreshBridgeModJar(targetFolder);
    copyTemplateState = { ...copyTemplateState, state: "done" };
  } catch (err) {
    copyTemplateState = { ...copyTemplateState, state: "error", error: String(err?.message || err) };
    throw err;
  }

  return { ok: true };
});

ipcMain.handle("server:copyTemplateStatus", () => copyTemplateState);

// --------------------
// IPC: bridge/commands/minecraft/ 内の .txt ファイル一覧
// --------------------
function selectableCommandNames() {
  const dir = path.join(getBridgeBatDir(), 'commands', 'minecraft');
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
  return availableGameCommands(names, gameProfiles.list()).sort();
}
ipcMain.handle("bridge:commands:list", () => readCommandMetadata().map(({ name, title, invalidName }) => ({ name, title, ...(invalidName ? { invalidName } : {}) })));

// --------------------
// IPC: bridge/commands/minecraft/ の TITLE + CATEGORY + 説明文 メタ情報一覧
// --------------------
function readCommandMetadata() {
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  if (!fs.existsSync(dir)) return [];
  const files = selectableCommandNames();
  return files.map((name) => {
    let title = name;
    let category = "";
    let description = "";
    try {
      const content = fs.readFileSync(path.join(dir, name), "utf8");
      const titleMatch = content.match(/^#\s*TITLE:\s*(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim();
      const catMatch = content.match(/^#\s*CATEGORY:\s*(.+)$/m);
      if (catMatch) category = catMatch[1].trim();
      // 説明文はファイル先頭の // コメント行（コマンド一覧ページの表示用）
      const descMatch = content.match(/^\/\/\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim();
    } catch {}
    // Explorer で作った「ネコ.txt」「tnt - コピー.txt」なども一覧には出るが、BridgeMOD では実行できない。
    // title はルーレット名やギフト画像にそのまま使われるので変えず、印だけを付ける（割り当てた保存は理由付きで止まる）。
    return { name, title, category, description, ...(commandFileProblem(name) ? { invalidName: true } : {}) };
  });
}
ipcMain.handle("bridge:commands:readMeta", () => readCommandMetadata());

// --------------------
// IPC: bridge/commands/minecraft/ にTXTを書き込む
// --------------------
ipcMain.handle("bridge:commands:write", async (_event, { filename, content }) => {
  assertGameProfileIdle();
  if (/^game_(umetate|run|saikutu)_/.test(filename || '')) throw new Error('ゲームパックのコマンドはパックを再登録して更新してください');
  if (!filename || typeof filename !== "string" || !filename.endsWith(".txt")) {
    throw new Error("Invalid filename: must be a .txt file");
  }
  if (typeof content !== "string") throw new Error("content must be a string");
  if (filename !== path.basename(filename) || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Invalid filename: path separators are not allowed");
  }
  const nameProblem = commandFileProblem(filename);
  if (nameProblem) throw new Error(nameProblem);
  if (Buffer.byteLength(content, "utf8") > 1024 * 1024) throw new Error("command file is too large (max 1MB)");
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  if (fs.existsSync(getConfigPath())) settingsBackups.create("automatic");
  atomicWrite(fullPath, content);
  return { ok: true, path: fullPath };
});

// --------------------
// IPC: bridge/commands/minecraft/ をエクスプローラーで開く
// --------------------
ipcMain.handle("bridge:commands:openFolder", async () => {
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return { ok: true };
});

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

// --------------------
// IPC: セットアップ完了チェック
// --------------------
ipcMain.handle("server:checkSetupComplete", async () => {
  const dir = getServerRoot();
  return inspectSetup(dir);
});

// --------------------
// IPC: 完了画面「検出された環境」の実測（旧: 固定配列のハードコード）
// --------------------
ipcMain.handle("setup:inspectEnvironment", async () => {
  const dir = getServerRoot();
  const hasLibraries = fs.existsSync(path.join(dir, "libraries"));
  const hasRunBat = fs.existsSync(path.join(dir, "run.bat"));

  let forgeVersion = "";
  let minecraftVersion = "";
  try {
    forgeVersion = require("./forge_version.cjs").detectServerForgeVersion(dir);
    minecraftVersion = forgeVersion.split("-")[0] || "";
  } catch { /* 検出できなければ未検出のまま */ }

  let javaVersion = "";
  try {
    const result = spawnSync("java", ["-version"], { encoding: "utf8" });
    // java -version は多くのJDKでstderrに出力する
    const out = String(result.stderr || result.stdout || "").split("\n")[0].trim();
    if (out) javaVersion = out;
  } catch { /* javaがPATHに無ければ未検出のまま */ }

  const modsDir = path.join(dir, "mods");
  let bridgeModJar = "";
  try {
    if (fs.existsSync(modsDir)) {
      bridgeModJar = fs.readdirSync(modsDir).find((f) => /^bridgemod-.*\.jar$/i.test(f)) || "";
    }
  } catch { /* ignore */ }

  const giftsMetaPath = path.join(getGvDataDir(), "gifts.meta.json");
  let tiktokApiFresh = false;
  let tiktokApiAgeMs = null;
  if (fs.existsSync(giftsMetaPath)) {
    tiktokApiAgeMs = Date.now() - fs.statSync(giftsMetaPath).mtimeMs;
    tiktokApiFresh = tiktokApiAgeMs < 24 * 60 * 60 * 1000;
  }

  return {
    forge: { detected: hasLibraries || hasRunBat, version: forgeVersion || "未検出" },
    minecraft: { detected: Boolean(minecraftVersion), version: minecraftVersion || "未検出" },
    java: { detected: Boolean(javaVersion), version: javaVersion || "未検出（PATHにjavaがありません）" },
    bridge: { detected: true, version: app.getVersion() },
    bridgeMod: { detected: Boolean(bridgeModJar), version: bridgeModJar || "未検出" },
    tiktokApi: {
      detected: tiktokApiFresh,
      version: tiktokApiAgeMs === null
        ? "未確認（gifts.meta.jsonなし）"
        : tiktokApiFresh
        ? "接続 OK（ギフトデータ取得済み）"
        : "未確認（ギフトデータが24時間以上前）",
    },
  };
});

// --------------------
// TTS (読み上げ)
// --------------------
const TTS_DEFAULTS = {
  engine: "voicevox",
  speakerId: 2,
  speedScale: 1.2,
  pitchScale: 0.0,
  intonationScale: 1.0,
  volume: 1.0,
  enabled: true,
  commentEnabled: true,
  giftEnabled: true,
  giftTemplate: "{sender}さんから{gift}が来たよ！",
};

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeTtsSettings(settings) {
  const value = { ...TTS_DEFAULTS, ...(settings && typeof settings === "object" ? settings : {}) };
  return {
    engine: value.engine === "aivis" ? "aivis" : "voicevox",
    speakerId: Math.trunc(clampNumber(value.speakerId, 0, Number.MAX_SAFE_INTEGER, TTS_DEFAULTS.speakerId)),
    speedScale: clampNumber(value.speedScale, 0.5, 2.0, TTS_DEFAULTS.speedScale),
    pitchScale: clampNumber(value.pitchScale, -0.15, 0.15, TTS_DEFAULTS.pitchScale),
    intonationScale: clampNumber(value.intonationScale, 0.0, 2.0, TTS_DEFAULTS.intonationScale),
    volume: clampNumber(value.volume, 0.0, 2.0, TTS_DEFAULTS.volume),
    enabled: value.enabled !== false,
    commentEnabled: value.commentEnabled !== false,
    giftEnabled: value.giftEnabled !== false,
    giftTemplate: String(value.giftTemplate || TTS_DEFAULTS.giftTemplate).slice(0, 200),
  };
}

function getTtsSettingsPath() {
  return path.join(app.getPath("userData"), "tts-settings.json");
}

function readTtsSettingsFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return normalizeTtsSettings(JSON.parse(fs.readFileSync(filePath, "utf-8")));
  } catch {
    return null;
  }
}

function readTtsSettings() {
  // ライブコメントを処理する bridge/index.js は bridge/tts-settings.json を読む。
  // ここで userData 側を先に読むと、UIが起動するエンジンとBridgeが使用する
  // エンジンが食い違い、正常に保存済みでも無音になるためBridge側を正とする。
  const bridgeSettings = readTtsSettingsFile(path.join(getBridgeBatDir(), "tts-settings.json"));
  if (bridgeSettings) return bridgeSettings;
  return readTtsSettingsFile(getTtsSettingsPath()) || { ...TTS_DEFAULTS };
}

function writeTtsSettings(settings) {
  const normalized = normalizeTtsSettings(settings);
  const p = getTtsSettingsPath();
  // bridge フォルダにも同期（bridge/index.js が読む）
  const bridgeTtsPath = path.join(getBridgeBatDir(), "tts-settings.json");
  fs.mkdirSync(path.dirname(bridgeTtsPath), { recursive: true });
  fs.writeFileSync(bridgeTtsPath, JSON.stringify(normalized, null, 2), "utf-8");
  fs.writeFileSync(p, JSON.stringify(normalized, null, 2), "utf-8");
  return normalized;
}

ipcMain.handle("tts:settings:read", () => readTtsSettings());

ipcMain.handle("tts:settings:write", (_event, settings) => {
  if (fs.existsSync(getConfigPath()) && JSON.stringify(readTtsSettings()) !== JSON.stringify(settings)) settingsBackups.create("automatic");
  return { ok: true, settings: writeTtsSettings(settings) };
});

ipcMain.handle("tts:checkEngine", async (_event, engine) => {
  return await checkEngine(engine);
});

ipcMain.handle("tts:getSpeakers", async (_event, engine) => {
  try {
    const raw = await getSpeakers(engine);
    return flattenSpeakers(raw);
  } catch {
    return [];
  }
});

const ENGINE_EXE_PATHS = {
  voicevox: [
    path.join(require("os").homedir(), "AppData", "Local", "Programs", "VOICEVOX", "VOICEVOX.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "VOICEVOX", "VOICEVOX.exe"),
    path.join(process.env.PROGRAMFILES || "", "VOICEVOX", "VOICEVOX.exe"),
  ],
  aivis: [
    path.join(require("os").homedir(), "AppData", "Local", "Programs", "AivisSpeech", "AivisSpeech.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "AivisSpeech", "AivisSpeech.exe"),
    path.join(process.env.PROGRAMFILES || "", "AivisSpeech", "AivisSpeech.exe"),
  ],
};

function resolveEngineExe(engine) {
  const candidates = ENGINE_EXE_PATHS[engine] || [];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

async function waitForTtsEngine(engine, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkEngine(engine)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

ipcMain.handle("tts:launchEngine", async (_event, engine) => {
  if (!ENGINE_PORTS[engine]) {
    return { ok: false, message: `未対応の読み上げエンジンです: ${engine}` };
  }
  if (await checkEngine(engine)) {
    return { ok: true, alreadyRunning: true, message: "すでに起動しています。" };
  }

  const exePath = resolveEngineExe(engine);
  if (!exePath) {
    const expected = (ENGINE_EXE_PATHS[engine] || []).filter(Boolean).join("\n");
    return { ok: false, message: `実行ファイルが見つかりません。公式サイトからインストールしてください。\n${expected}` };
  }
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("spawn", () => { child.unref(); resolve(); });
    });
  } catch (spawnError) {
    const shellError = await shell.openPath(exePath);
    if (shellError) {
      return { ok: false, message: spawnError?.message || shellError };
    }
  }

  try {
    const ready = await waitForTtsEngine(engine);
    if (ready) {
      return { ok: true, message: "起動しました。" };
    }
    const port = ENGINE_PORTS[engine];
    return { ok: false, message: `起動は実行しましたが、APIがまだ応答していません。${port}番ポートで起動しているか確認してください。` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle("tts:test", async (_event, settings) => {
  try {
    const normalized = normalizeTtsSettings(settings);
    const ok = await checkEngine(normalized.engine);
    if (!ok) return { ok: false, message: "エンジンが起動していません" };
    const text = ((settings?.testText && String(settings.testText).trim()) || "テスト再生。こんにちは！").slice(0, 200);
    const wav = await synthesize(
      normalized.engine,
      text,
      normalized.speakerId,
      normalized.speedScale,
      normalized.pitchScale,
      normalized.intonationScale
    );
    return { ok: true, base64: wav.toString("base64") };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
