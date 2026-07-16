// electron/main.cjs
const { app, BrowserWindow, ipcMain, session, shell, clipboard, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const { ENGINE_PORTS, checkEngine, getSpeakers, flattenSpeakers, synthesize } = require("./tts.cjs");
const { validateBridgeConfig } = require("./config_schema.cjs");
const { autoUpdater } = require("electron-updater");
const { RestartPolicy } = require("./restart_policy.cjs");

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
      commandTransport: "douma_mod",
      doumaModHost: "127.0.0.1",
      doumaModPort: 25576,
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

  // 外部リンクはOSブラウザで開く（安全）
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // file:// 以外の遷移は止めて外部へ
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  const indexHtml = path.join(__dirname, "..", "dist", "index.html");
  win.loadFile(indexHtml);

  if (isDev) {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

// --------------------
// Helpers: run process and capture logs
// --------------------
function runProc(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true });

    let out = "";
    let err = "";

    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));

    p.on("close", (code) => {
      if (code === 0) resolve({ out });
      else reject(new Error(err || out || `process failed: ${cmd} ${args.join(" ")} (code=${code})`));
    });
  });
}

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
  setupAutoUpdater();
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

ipcMain.handle("config:write", async (_event, nextConfig) => {
  const validation = validateBridgeConfig(nextConfig);
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

  fs.writeFileSync(configPath, json, "utf-8");
  return { ok: true };
});

ipcMain.handle("config:path", async () => {
  return getConfigPath();
});

let updateState = { state: "idle", version: null, percent: 0, error: "", checkedAt: null };
function setUpdateState(patch) {
  updateState = { ...updateState, ...patch, checkedAt: new Date().toISOString() };
}
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setUpdateState({ state: "checking", version: null, percent: 0, error: "" }));
  autoUpdater.on("update-available", info => setUpdateState({ state: "downloading", version: info.version, percent: 0, error: "" }));
  autoUpdater.on("update-not-available", info => setUpdateState({ state: "current", version: info.version, percent: 100, error: "" }));
  autoUpdater.on("download-progress", p => setUpdateState({ percent: Math.round(p.percent || 0) }));
  autoUpdater.on("update-downloaded", info => setUpdateState({ state: "ready", version: info.version, percent: 100, error: "" }));
  autoUpdater.on("error", error => setUpdateState({ state: "error", version: null, percent: 0, error: error?.message || String(error) }));
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
}
ipcMain.handle("updater:status", () => updateState);
ipcMain.handle("updater:check", async () => {
  if (!app.isPackaged) return { state: "development" };
  await autoUpdater.checkForUpdates();
  return updateState;
});
ipcMain.handle("updater:install", () => {
  if (updateState.state === "ready") autoUpdater.quitAndInstall(false, true);
  return { ok: updateState.state === "ready" };
});
ipcMain.handle("config:validate", async (_event, value) => validateBridgeConfig(value));

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
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
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
  if (cfg.serverFolder && fs.existsSync(cfg.serverFolder)) return cfg.serverFolder;
  // フォールバック: 未パッケージ時は開発フォルダ、パッケージ後はextraResources
  if (!app.isPackaged) return path.resolve(__dirname, "..", "server", "Douma_Craft");
  return path.join(process.resourcesPath, "server", "Douma_Craft");
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
  "runtime-status.json",
]);
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

// アプリ更新・セットアップ時に doumacmd Mod jar をサーバーの mods/ へ最新版で揃える。
// 旧実装はテンプレートの「ルート」から jar を探していたため、ルートに残置された
// 旧版 jar（doumacmd-1.1.1.jar 等）を配布して mods/ の最新版を消す逆向きの動作をしていた。
// 正しい供給元はテンプレートの mods/ 配下。
function refreshDoumaModJar(serverFolder) {
  try {
    const srcMods = path.join(getServerTemplatePath(), "mods");
    if (!fs.existsSync(srcMods)) return;

    const jars = fs.readdirSync(srcMods).filter((f) => /^doumacmd-.*\.jar$/i.test(f));
    if (jars.length === 0) return;

    // 旧フローの残骸掃除：serverFolder ルートに doumacmd jar が残っていると
    // setup.bat が mods/ の最新版を削除して旧版を移動してしまうため、必ず撤去する
    try {
      for (const stray of fs.readdirSync(serverFolder).filter((f) => /^doumacmd-.*\.jar$/i.test(f))) {
        fs.unlinkSync(path.join(serverFolder, stray));
        console.log(`[main] stale doumacmd jar removed from server root: ${stray}`);
      }
    } catch { /* ルートを読めなくても mods 差し替えは続行 */ }

    const modsDir = path.join(serverFolder, "mods");
    fs.mkdirSync(modsDir, { recursive: true });

    for (const old of fs.readdirSync(modsDir).filter((f) => /^doumacmd-.*\.jar$/i.test(f))) {
      if (!jars.includes(old)) fs.unlinkSync(path.join(modsDir, old));
    }
    for (const j of jars) {
      fs.copyFileSync(path.join(srcMods, j), path.join(modsDir, j));
    }
    console.log(`[main] doumacmd mod jar refreshed in ${modsDir}: ${jars.join(", ")}`);
  } catch (e) {
    console.error("[main] refreshDoumaModJar failed:", e?.message || e);
  }
}

function scheduleBridgeSync() {
  if (!app.isPackaged) return;
  setTimeout(() => {
    ensureBridgeExtracted().catch((e) => {
      const message = e?.message || String(e);
      console.error("[main] bridge background sync failed:", message);
      setBridgeSyncState({ state: "error", phase: "failed", error: message });
    });
  }, 1000);
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
  refreshDoumaModJar(cfg.serverFolder);
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
  refreshDoumaModJar(targetFolder);

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

ipcMain.handle("server:start", async () => {
  const dir = getServerRoot();
  const bat = path.join(dir, "run.bat");
  if (!fs.existsSync(bat)) throw new Error(`run.bat not found: ${bat}`);
  if (serverProcRef) return { ok: true, alreadyRunning: true, backup: null };

  // 起動前バックアップ。失敗してもサーバー起動は絶対にブロックしない
  // （旧実装は失敗時に throw して Forge が起動不能になる事故があった）。
  let backup = null;
  if (readAppConfig().autoBackupOnServerStart !== false) {
    try {
      const result = await createWorldBackup("server-start");
      backup = { ok: true, message: result.message };
    } catch (e) {
      backup = { ok: false, message: e.message };
    }
  }

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
      if (/^allow-flight=false\s*$/m.test(props)) {
        fs.writeFileSync(propsPath, props.replace(/^allow-flight=false\s*$/m, "allow-flight=true"), "utf8");
        appendServerLog("[SERVER] allow-flight=true を適用しました（浮遊コマンドのキック対策）");
      }
    }
  } catch { /* 設定に失敗しても起動は続行 */ }
  const proc = spawn("cmd.exe", ["/c", bat], {
    cwd: dir,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_PAUSE: "1" },
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

  return { ok: true, backup };
});

// --------------------
// IPC: サーバー停止（graceful: stdin へ stop → 15秒待ち → taskkill フォールバック）
// --------------------
ipcMain.handle("server:stop", async () => {
  const proc = serverProcRef;
  const pid = serverPid;
  if (!proc && !pid) throw new Error("このセッションで起動したサーバーが見つかりません。");

  const waitExit = new Promise((resolve) => {
    let done = false;
    const finish = (graceful) => { if (!done) { done = true; resolve(graceful); } };
    if (proc) proc.once("exit", () => finish(true));
    setTimeout(() => finish(false), 15000);
  });

  let wroteStop = false;
  try {
    if (proc?.stdin?.writable) {
      appendServerLog("[SERVER] 停止コマンド（stop）を送信しました");
      proc.stdin.write("stop\n");
      wroteStop = true;
    }
  } catch { /* stdin が閉じていたら強制停止に回す */ }

  const graceful = wroteStop ? await waitExit : false;
  if (!graceful && pid) {
    appendServerLog("[SERVER] 猶予内に終了しなかったため強制停止します");
    try { spawnSync("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true, timeout: 10000 }); } catch { /* ベストエフォート */ }
  }
  serverPid = null;
  serverProcRef = null;
  return { ok: true, graceful };
});

// --------------------
// IPC: サーバーログ・稼働状態（ダッシュボードのForgeログパネル用）
// --------------------
ipcMain.handle("server:logs", () => ({ ok: true, lines: [...serverLogBuffer] }));

// Forgeサーバーのコンソールへコマンドを1行送る（op 付与やデバッグの脱出ハッチ）。
// 先頭の "/" は付けても付けなくてもよい（コンソールでは不要なので取り除く）。
ipcMain.handle("server:command", async (_event, command) => {
  const cmd = String(command || "").trim().replace(/^\//, "");
  if (!cmd) throw new Error("コマンドが空です");
  if (/[\r\n]/.test(cmd)) throw new Error("コマンドは1行で入力してください");
  if (!serverProcRef?.stdin?.writable) throw new Error("Minecraftサーバーが起動していません");
  appendServerLog(`> ${cmd}`);
  serverProcRef.stdin.write(cmd + "\n");
  return { ok: true };
});
ipcMain.handle("server:processStatus", () => ({ running: !!serverProcRef, pid: serverPid }));

// --------------------
// IPC: Minecraft ランチャー/ゲーム本体の稼働検知（Gameノード表示用）
// --------------------
// ランチャーはゲーム起動と同時に自動で閉じる設定が既定のため、ゲーム本体
// （javaw.exe）も検知対象に含める。
const MINECRAFT_PROC_NAMES = new Set(["minecraftlauncher.exe", "minecraft.exe", "javaw.exe"]);
ipcMain.handle("minecraft:status", async () => {
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
  const found = new Set();
  for (const line of String(csv).split("\n")) {
    const name = (line.split('","')[0] || "").replace(/^"/, "").trim().toLowerCase();
    if (MINECRAFT_PROC_NAMES.has(name)) found.add(name);
  }
  return { running: found.size > 0, processes: [...found] };
});

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
  const dir = getBridgeBatDir();
  const indexJs = getBridgeEntryPoint(dir);
  if (!fs.existsSync(indexJs)) throw new Error(`Bridge entry not found: ${indexJs}`);

  await ensureNodeRuntimeAvailable();
  const nodeCmd = getNodeCommand();

  bridgeStopRequested = false;
  bridgeRestartPolicy.start();
  const spawnOnce = () => {
    appendBridgeLog(`[BRIDGE] 起動します: ${indexJs}`);
    const child = spawn(nodeCmd, [indexJs, "--config", path.join(dir, "config.minecraft.json")], {
      cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
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
        bridgeRestartTimer = setTimeout(spawnOnce, backoffMs);
      } else if (bridgeRestartPolicy.exhausted && bridgeRestartPolicy.exhausted()) {
        appendBridgeLog("[BRIDGE] 自動再起動の上限に達しました。設定を確認して手動で再起動してください。");
      }
    });
  };
  if (!bridgeProcRef) spawnOnce();

  return { ok: true, pid: bridgePid };
}

async function stopBridge() {
  bridgeStopRequested = true;
  bridgeRestartPolicy.requestStop();
  if (bridgeRestartTimer) { clearTimeout(bridgeRestartTimer); bridgeRestartTimer = null; }

  const child = bridgeProcRef;
  // このセッションで起動した child があるなら exit を待つ（taskkill は非同期なので待たないと再起動が空振りする）
  const waitExit = child
    ? new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        child.once("exit", finish);
        setTimeout(finish, 5000); // 保険：5秒でタイムアウト
      })
    : Promise.resolve();

  const pid = bridgePid || (child && child.pid) || null;
  if (pid) {
    appendBridgeLog(`[BRIDGE] 停止要求 PID ${pid}`);
    try { spawn("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }); } catch { /* fallthrough */ }
  } else {
    appendBridgeLog("[BRIDGE] PID不明のためコマンドラインで停止を試行します");
  }

  await waitExit;
  killBridgeByCommandLine(); // 前セッション由来のオーファンを掃除（このbridgeのcommandLineに限定）
  bridgePid = null;
  bridgeProcRef = null;
  return { ok: true };
}

ipcMain.handle("bridge:launch", async () => launchBridge());

// --------------------
// IPC: Bridge 停止
// --------------------
ipcMain.handle("bridge:stop", async () => stopBridge());

// --------------------
// IPC: Bridge 再起動（停止完了を待ってから起動する。UI側の stop→launch 連打は使わない）
// --------------------
ipcMain.handle("bridge:restart", async () => {
  await stopBridge();
  await new Promise((r) => setTimeout(r, 400)); // ポート/ファイル解放の猶予
  return launchBridge();
});
ipcMain.handle("bridge:processStatus", () => {
  const status = bridgeRestartPolicy.status(bridgePid);
  return { ...status, ...getProcessMetrics(bridgePid) };
});

ipcMain.handle("bridge:logs", () => ({ ok: true, lines: [...bridgeLogBuffer] }));

function requestDouma(method, requestPath, body) {
  return new Promise((resolve, reject) => {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
    const host = cfg.options?.doumaModHost || "127.0.0.1";
    const port = Number(cfg.options?.doumaModPort || 25576);
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host, port, path: requestPath, method, timeout: 1500,
      headers: data ? { "Content-Type": "application/json", "Content-Length": data.length } : {} },
    (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = {}; try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
        if (res.statusCode >= 400) reject(new Error(parsed.message || `HTTP ${res.statusCode}`));
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

function compactOperationsHistoryIfLarge(historyPath) {
  try {
    const stat = fs.statSync(historyPath);
    if (stat.size < 2 * 1024 * 1024) return; // 2MB未満は行カウストをしない（頻繁なfs呼び出しを避ける）
    const lines = fs.readFileSync(historyPath, "utf8").split("\n").filter((l) => l.trim());
    if (lines.length <= 2000) return;
    fs.writeFileSync(historyPath, lines.slice(lines.length - 2000).join("\n") + "\n", "utf8");
  } catch { /* 圧縮に失敗しても記録自体は既に成功しているので無視 */ }
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

function appendOperationsHistory(row) {
  const historyPath = getOperationsHistoryPath();
  try {
    migrateOperationsHistoryToJsonlIfNeeded(historyPath);
    fs.appendFileSync(historyPath, JSON.stringify(row) + "\n", "utf8");
    compactOperationsHistoryIfLarge(historyPath);
  } catch { /* ignore */ }
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
  try { return { online: true, ...(await requestDouma("GET", "/douma/status")) }; }
  catch (e) { return { online: false, error: e.message }; }
});
// テスト発火は Bridge を経由せず Mod へ直送するため、「ルーレット」仮想コマンドは
// ここで横取りして抽選しないと roulette.txt のプレースホルダー
// （「ルーレットが無効です」の表示）がそのまま実行されてしまう。Bridge 側と同じ
// 重み付き抽選＋回転演出を簡易再現し、当選コマンドを発火する。
function mcJsonStringEscapeMain(s, maxLen = 40) {
  let v = String(s ?? "");
  v = v.replace(/[\r\n\t]/g, " ").replace(/[\u0000-\u001F\u007F]/g, "");
  if (v.length > maxLen) v = v.slice(0, maxLen);
  return JSON.stringify(v).slice(1, -1);
}
function readCommandDescriptionMain(commandFile) {
  try {
    const file = path.basename(String(commandFile || "").trim());
    const p = path.join(getBridgeBatDir(), "commands", "minecraft", file.toLowerCase().endsWith(".txt") ? file : `${file}.txt`);
    const m = fs.readFileSync(p, "utf8").match(/^\/\/\s*(.+)$/m);
    return m ? m[1].trim() : "";
  } catch { return ""; }
}
let testRouletteBusy = false;
async function fireDoumaEventMaybeRoulette(payload, bridgeCfg) {
  if (payload.key !== "roulette") {
    await requestDouma("POST", "/douma/event", payload);
    return { key: payload.key, count: payload.count, roulette: false };
  }
  const rl = bridgeCfg?.roulette;
  const items = (Array.isArray(rl?.items) ? rl.items : [])
    .filter((i) => i && String(i.commandFile || "").trim())
    .map((i) => ({
      commandFile: String(i.commandFile).trim(),
      label: String(i.label || i.commandFile).replace(/\.txt$/i, "").slice(0, 24),
      weight: Math.max(1, Number(i.weight || 1)),
      repeat: Math.max(1, Math.min(100, Number(i.repeat || 1))),
    }));
  if (rl?.enabled !== true || items.length === 0) {
    throw new Error("ルーレットが無効か、項目が未設定です。イベント設定②のルーレットを有効にして項目を追加し、保存してください。");
  }
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let r = Math.random() * total;
  let winner = items[items.length - 1];
  for (const item of items) { r -= item.weight; if (r <= 0) { winner = item; break; } }

  // 回転演出（Bridge の runRoulette と同じ見た目：黄色タイトル＋黄緑の説明サブタイトル）
  if (!testRouletteBusy) {
    testRouletteBusy = true;
    try {
      let step = 110;
      for (let i = 0; i < 8; i++) {
        const item = items[Math.floor(Math.random() * items.length)];
        const desc = readCommandDescriptionMain(item.commandFile);
        await requestDouma("POST", "/douma/exec", {
          listenerName: payload.listenerName || "roulette",
          commands: [
            "title @a times 0 12 4",
            `title @a title {"text":"${mcJsonStringEscapeMain(item.label.toUpperCase(), 30)}","color":"yellow","bold":true}`,
            `title @a subtitle {"text":"${mcJsonStringEscapeMain(desc || "ルーレット回転中…", 36)}","color":"green"}`,
            "playsound block.note_block.hat master @a ~ ~ ~ 0.7 1.4",
          ],
        }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, step));
        step = Math.min(420, Math.round(step * 1.22));
      }
      const winnerDesc = readCommandDescriptionMain(winner.commandFile);
      await requestDouma("POST", "/douma/exec", {
        listenerName: payload.listenerName || "roulette",
        commands: [
          "title @a times 5 55 15",
          `title @a title {"text":"▶ ${mcJsonStringEscapeMain(winner.label.toUpperCase(), 26)} ◀","color":"yellow","bold":true}`,
          `title @a subtitle {"text":"${mcJsonStringEscapeMain(winnerDesc || winner.label, 36)}","color":"green"}`,
          "playsound entity.player.levelup master @a ~ ~ ~ 1 1",
        ],
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      testRouletteBusy = false;
    }
  }

  await requestDouma("POST", "/douma/event", {
    ...payload,
    key: path.basename(winner.commandFile, ".txt"),
    // 本番（bridge の fireRouletteWinner）と同じく当選項目の repeat をそのまま使う
    count: winner.repeat,
    announce: false,
  });
  return { key: path.basename(winner.commandFile, ".txt"), count: winner.repeat, roulette: true, label: winner.label };
}

ipcMain.handle("mod:testEvent", async (_event, value) => {
  let bridgeCfg = {};
  try { bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
  const protection = bridgeCfg.options?.protection || {};
  const protectionPayload = {
    protectionEnabled: protection.enabled === true,
    protectX1: Number(protection.x1 || 0), protectX2: Number(protection.x2 || 0),
    protectZ1: Number(protection.z1 || 0), protectZ2: Number(protection.z2 || 0),
  };
  const listenerName = String(value?.listenerName || "テスト視聴者").slice(0, 40);

  // いいね発火テスト：本番と同じ「しきい値ラダー」をシミュレートする。
  // 旧実装は選択中の commandFile を type=like で直送しており、実質ギフト発火と
  // 同じ動きだった（Mod は type をキュー振り分けにしか使わない）。
  if (value?.type === "like") {
    const likeCount = Math.max(1, Math.min(10000, Number(value?.likeCount ?? value?.count ?? 1)));
    const rules = (Array.isArray(bridgeCfg.likeEvents) ? bridgeCfg.likeEvents : [])
      .filter((r) => r && r.enabled !== false && r.commandFile && Number(r.threshold) > 0);
    if (rules.length === 0) {
      return { ok: false, message: "いいねイベントが未設定です。イベント設定①でしきい値ルールを追加してください。" };
    }
    const fired = [];
    let anyOk = false;
    for (const rule of rules) {
      const threshold = Math.max(1, Number(rule.threshold));
      const triggers = Math.floor(likeCount / threshold);
      if (triggers <= 0) continue;
      const repeat = Math.max(1, Math.min(100, Number(rule.repeat || 1)));
      const count = Math.max(1, Math.min(100, triggers * repeat));
      const payload = {
        type: "like",
        key: path.basename(String(rule.commandFile), ".txt"),
        count,
        listenerName,
        announce: threshold >= 100,
        ...protectionPayload,
      };
      let result;
      let firedKey = payload.key;
      try {
        const outcome = await fireDoumaEventMaybeRoulette(payload, bridgeCfg);
        firedKey = outcome.key;
        result = { ok: true }; anyOk = true;
      }
      catch (e) { result = { ok: false, message: e.message }; }
      appendOperationsHistory({ at: new Date().toISOString(), type: "like", sender: listenerName,
        commandFile: `${firedKey}.txt`, count, ...result });
      fired.push({ commandFile: `${firedKey}.txt`, threshold, count, ok: result.ok });
    }
    if (fired.length === 0) {
      const minThreshold = Math.min(...rules.map((r) => Number(r.threshold)));
      return { ok: false, message: `いいね${likeCount}回では最小しきい値（${minThreshold}）に届きません。` };
    }
    const detail = fired.map((f) => `${f.commandFile}×${f.count}`).join(" / ");
    return { ok: anyOk, fired, message: `いいね${likeCount}回 → ${fired.length}ルール発火（${detail}）` };
  }

  const payload = {
    type: "gift",
    key: path.basename(String(value?.commandFile || ""), ".txt"),
    count: Math.max(1, Math.min(100, Number(value?.count || 1))),
    listenerName,
    announce: true,
    ...protectionPayload,
  };
  let result;
  let firedKey = payload.key;
  try {
    const outcome = await fireDoumaEventMaybeRoulette(payload, bridgeCfg);
    firedKey = outcome.key;
    result = outcome.roulette
      ? { ok: true, message: `ルーレット抽選 → ${outcome.label}（${outcome.key}.txt）を発火しました` }
      : { ok: true };
  }
  catch (e) { result = { ok: false, message: e.message }; }
  appendOperationsHistory({ at: new Date().toISOString(), type: payload.type, sender: payload.listenerName,
    commandFile: `${firedKey}.txt`, count: payload.count, ...result });
  return result;
});

// --------------------
// IPC: マイクラIDへ OP 権限を付与（_op.txt を書いて Mod 経由で実行）
// --------------------

// Mod HTTP (25576) が応答するまで待つ。Forge起動直後はワールド読み込み中でまだ
// 待ち受けが開いておらず、即送信すると ECONNREFUSED になる（一括起動時の
// OP自動付与とゲームルール適用が毎回「スキップ」されていた真因）。
async function waitForDoumaMod(timeoutMs = 150000, intervalMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await requestDouma("GET", "/douma/status"); return true; }
    catch { /* まだ起動中 */ }
    if (Date.now() >= deadline || !serverProcRef) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
    if (serverProcRef) await waitForDoumaMod();
    await requestDouma("POST", "/douma/event", {
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
      throw new Error("Minecraftサーバーは起動中ですが、Mod（DoumaCmdMod）に接続できません。ワールドの読み込み完了（コンソールに Done 表示）を待ってから再度お試しください。");
    }
    throw e;
  }
  return { ok: true, name };
});
ipcMain.handle("operations:history", () => readOperationsHistory());
ipcMain.handle("operations:history:clear", () => {
  fs.writeFileSync(getOperationsHistoryPath(), "[]", "utf8"); return { ok: true };
});
async function createWorldBackup(reason = "manual") {
  const propsPath = path.join(getServerRoot(), "server.properties");
  if (!fs.existsSync(propsPath)) throw new Error("server.properties がありません");
  const m = fs.readFileSync(propsPath, "utf8").match(/^level-name=(.+)$/m);
  const world = path.join(getServerRoot(), (m?.[1] || "world").trim());
  if (!fs.existsSync(world)) throw new Error(`ワールドがありません: ${world}`);
  const outDir = path.join(getServerRoot(), "backups");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const zip = path.join(outDir, `world-${stamp}.zip`);
  // powershell -Command に後続引数を渡しても $args には入らない（旧実装が常に
  // 「バックアップ失敗 (1)」になっていた真因）。パスは環境変数経由で渡す。
  // session.lock はサーバー稼働中ロックされて読めないため、robocopy で一時フォルダーへ
  // 除外コピーしてから圧縮する（robocopy は exit code 0〜7 が成功扱い）。
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$world = $env:DOUMA_BACKUP_WORLD",
    "$zip = $env:DOUMA_BACKUP_ZIP",
    "$staging = Join-Path $env:TEMP ('douma-backup-' + [guid]::NewGuid().ToString('N'))",
    "robocopy $world (Join-Path $staging 'world') /E /R:1 /W:1 /XF session.lock | Out-Null",
    "if ($LASTEXITCODE -ge 8) { throw ('robocopy failed: exit ' + $LASTEXITCODE) }",
    "Compress-Archive -LiteralPath (Join-Path $staging 'world') -DestinationPath $zip -CompressionLevel Fastest",
    "Remove-Item -LiteralPath $staging -Recurse -Force",
    "exit 0",
  ].join("; ");
  await new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      env: { ...process.env, DOUMA_BACKUP_WORLD: world, DOUMA_BACKUP_ZIP: zip },
    });
    let errText = "";
    ps.stderr.on("data", chunk => { errText += String(chunk); });
    ps.on("exit", code => {
      if (code === 0) return resolve();
      const detail = errText.split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
      reject(new Error(`バックアップ失敗 (${code})${detail ? `: ${detail}` : ""}`));
    });
    ps.on("error", reject);
  });
  // ディスク圧迫防止：直近10件だけ残して古いバックアップを削除
  try {
    const old = fs.readdirSync(outDir).filter(name => /^world-.*\.zip$/.test(name)).sort().reverse().slice(10);
    for (const name of old) fs.rmSync(path.join(outDir, name), { force: true });
  } catch {}
  return { ok: true, path: zip, reason, message: `バックアップ完了: ${path.basename(zip)}` };
}
ipcMain.handle("world:backup", async () => createWorldBackup("manual"));

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
  const validation = validateBridgeConfig(value);
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  fs.writeFileSync(getConfigPath(), JSON.stringify(value, null, 2), "utf8");
  return { ok: true, config: value };
});
ipcMain.handle("operations:stats", () => {
  const rows = readOperationsHistory();
  const byCommand = {};
  const bySender = {};
  let succeeded = 0;
  for (const row of rows) {
    if (row.ok) succeeded++;
    const amount = Number(row.count || 1);
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
  const gapMs = Math.max(5, Number(gapMinutes) || 90) * 60 * 1000;
  const sorted = readOperationsHistory()
    .map((r) => ({ ...r, t: Date.parse(r.at) || 0 }))
    .filter((r) => r.t > 0)
    .sort((a, b) => a.t - b.t);

  const buckets = [];
  let cur = null;
  for (const r of sorted) {
    if (!cur || r.t - cur.lastT > gapMs) {
      cur = { startT: r.t, lastT: r.t, rows: [] };
      buckets.push(cur);
    }
    cur.rows.push(r);
    cur.lastT = r.t;
  }

  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, count]) => ({ name, count }));

  const viewerMetrics = readViewerMetrics();

  const summarize = (b) => {
    const byCommand = {}, bySender = {};
    // type は gift/like に加えて、historyType経由で share/follow/member が実値として記録される
    // （Mod向けキューは常に"other"だが、統計上の内訳はここで区別する）。それ以外は other に集約。
    let gift = 0, like = 0, share = 0, follow = 0, member = 0, other = 0, succeeded = 0, failed = 0;
    let diamonds = 0;
    for (const r of b.rows) {
      const amount = Number(r.count || 1);
      if (r.ok) succeeded++; else failed++;
      if (r.type === "gift") gift += amount;
      else if (r.type === "like") like += amount;
      else if (r.type === "share") share += amount;
      else if (r.type === "follow") follow += amount;
      else if (r.type === "member") member += amount;
      else other += amount;
      if (Number(r.diamond) > 0) diamonds += Number(r.diamond) * amount;
      byCommand[r.commandFile || "unknown"] = (byCommand[r.commandFile || "unknown"] || 0) + amount;
      bySender[r.sender || "unknown"] = (bySender[r.sender || "unknown"] || 0) + amount;
    }
    // 配信区間内の視聴者数（bridge が60秒毎に記録）から 最高同接/平均 を求める
    const windowMetrics = viewerMetrics.filter((m) => m.t >= b.startT - 60000 && m.t <= b.lastT + 60000);
    const maxViewers = windowMetrics.length ? Math.max(...windowMetrics.map((m) => m.viewers)) : 0;
    const avgViewers = windowMetrics.length
      ? Math.round(windowMetrics.reduce((a, m) => a + m.viewers, 0) / windowMetrics.length)
      : 0;
    return {
      start: new Date(b.startT).toISOString(),
      end: new Date(b.lastT).toISOString(),
      durationMs: b.lastT - b.startT,
      events: b.rows.length,
      gift, like, share, follow, member, other, succeeded, failed,
      diamonds,
      maxViewers,
      avgViewers,
      uniqueSenders: Object.keys(bySender).length,
      topCommands: top(byCommand),
      topSenders: top(bySender),
    };
  };

  const streams = buckets.map(summarize).reverse(); // 新しい配信を先頭に
  const sum = (key) => streams.reduce((a, s) => a + (s[key] || 0), 0);

  // 今月（ローカル時刻基準）の配信合計時間
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStreams = streams.filter((s) => {
    const d = new Date(s.start);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  return {
    gapMinutes: gapMs / 60000,
    overall: {
      streams: streams.length,
      events: sorted.length,
      gift: sum("gift"), like: sum("like"), share: sum("share"), follow: sum("follow"),
      member: sum("member"), other: sum("other"),
      succeeded: sum("succeeded"), failed: sum("failed"),
      diamonds: sum("diamonds"),
    },
    monthly: {
      month: monthKey,
      streams: monthStreams.length,
      totalDurationMs: monthStreams.reduce((a, s) => a + s.durationMs, 0),
      diamonds: monthStreams.reduce((a, s) => a + (s.diamonds || 0), 0),
    },
    streams,
  };
}
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
// IPC: 任意フォルダの setup.bat を実行
// --------------------
ipcMain.handle("server:setup:atPath", async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== "string") throw new Error("folderPath is required");
  const bat = path.join(folderPath, "setup.bat");
  if (!fs.existsSync(bat)) throw new Error(`setup.bat が見つかりません: ${bat}`);

  // "start" 経由で新コンソールウィンドウを作成 → stdin/stdout が正しく繋がる
  spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/c", bat], {
    cwd: folderPath,
    detached: true,
    stdio: "ignore",
  }).unref();

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
ipcMain.handle("server:gamerules:apply", async () => {
  // ゲームルールは DoumaCmdMod 経由（/douma/event, key=_gamerules）で適用する。
  // 旧実装は rcon-client を require せずに new Rcon(...) しており常に ReferenceError で失敗していた
  // （UI側は「サーバー未起動のためスキップ」と誤表示していた）。Mod経路に一本化して事故を無くす。
  try {
    // 一括起動直後はワールド読み込み中で Mod がまだ待ち受けていないため、開通まで待つ
    if (serverProcRef) await waitForDoumaMod();
    await requestDouma("POST", "/douma/event", {
      type: "other",
      key: "_gamerules",
      count: 1,
      listenerName: "system",
      announce: false,
    });
    return { ok: true, transport: "douma_mod" };
  } catch (e) {
    throw new Error(`ゲームルール適用に失敗しました（サーバー/Mod が未起動の可能性）: ${e?.message || e}`);
  }
});

// --------------------
// IPC: 暗視データパック展開（現在ワールドに配置）
// --------------------
ipcMain.handle("server:datapack:deployNightVision", async () => {
  const propsPath = path.join(getServerRoot(), "server.properties");
  if (!fs.existsSync(propsPath)) throw new Error("server.properties が見つかりません");

  const content = fs.readFileSync(propsPath, "utf-8");
  const match = content.match(/^level-name=(.+)$/m);
  if (!match) throw new Error("server.properties に level-name が見つかりません");
  const levelName = match[1].trim();

  const dpRoot = path.join(getServerRoot(), levelName, "datapacks", "NightVision_Pack");
  fs.mkdirSync(path.join(dpRoot, "data", "minecraft", "tags", "functions"), { recursive: true });
  fs.mkdirSync(path.join(dpRoot, "data", "nv_pack", "functions"), { recursive: true });

  fs.writeFileSync(
    path.join(dpRoot, "pack.mcmeta"),
    JSON.stringify({ pack: { pack_format: 15, description: "Persistent night vision for all players" } }, null, 2)
  );
  fs.writeFileSync(
    path.join(dpRoot, "data", "minecraft", "tags", "functions", "tick.json"),
    JSON.stringify({ values: ["nv_pack:tick"] })
  );
  fs.writeFileSync(
    path.join(dpRoot, "data", "nv_pack", "functions", "tick.mcfunction"),
    "execute as @a at @s if entity @s[gamemode=!spectator] run effect give @s minecraft:night_vision 60 0 true\n"
  );

  return { ok: true, world: levelName };
});

// --------------------
// IPC: Forge インストーラ起動 (forge_install.bat)
// --------------------
ipcMain.handle("server:forgeInstall", async () => {
  const dir = getServerRoot();
  const bat = path.join(dir, "forge_install.bat");
  if (!fs.existsSync(bat)) throw new Error(`forge_install.bat not found: ${bat}`);

  spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/c", bat], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
  }).unref();

  return { ok: true };
});

ipcMain.handle("server:forgeInstall:atPath", async (_event, folderPath) => {
  if (!folderPath || typeof folderPath !== "string") throw new Error("folderPath is required");
  const bat = path.join(folderPath, "forge_install.bat");
  if (!fs.existsSync(bat)) throw new Error(`forge_install.bat が見つかりません: ${bat}`);

  spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/c", bat], {
    cwd: folderPath,
    detached: true,
    stdio: "ignore",
  }).unref();

  return { ok: true };
});

// --------------------
// IPC: 初期セットアップ (setup.bat) ※インタラクティブ
// --------------------
ipcMain.handle("server:setup", async () => {
  const dir = getServerRoot();
  const bat = path.join(dir, "setup.bat");
  if (!fs.existsSync(bat)) throw new Error(`setup.bat not found: ${bat}`);

  // "start" 経由で新コンソールウィンドウを作成 → stdin/stdout が正しく繋がる
  spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", bat], {
    cwd: dir,
    detached: true,
    stdio: "ignore",
  }).unref();

  return { ok: true };
});

// --------------------
// IPC: Gifts update (bat不要化)
// --------------------
ipcMain.handle("gifts:update", async (_event, username) => {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!user) throw new Error("username is empty");

  const dir = getGiftsDir();
  const fetchTool = getGvToolPath("fetch_gifts.cjs");
  const htmlTool  = getGvToolPath("gifts_to_html.cjs");

  if (!fs.existsSync(fetchTool)) throw new Error(`fetch_gifts.cjs not found: ${fetchTool}`);
  if (!fs.existsSync(htmlTool))  throw new Error(`gifts_to_html.cjs not found: ${htmlTool}`);

  await ensureNodeRuntimeAvailable();
  const nodeCmd = getNodeCommand();

  await runProc(nodeCmd, [fetchTool, user, "--out", dir], dir);
  await runProc(nodeCmd, [htmlTool, "--in", path.join(dir, "gifts.min.json"), "--out", dir], dir);

  return {
    ok: true,
    giftsDir: dir,
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
  if (fs.existsSync(metaPath) && Date.now() - fs.statSync(metaPath).mtimeMs < 24 * 60 * 60 * 1000) {
    return { skipped: "fresh" };
  }
  const dir = getGvDataDir();
  await ensureNodeRuntimeAvailable();
  const nodeCmd = getNodeCommand();
  await runProc(nodeCmd, [getGvToolPath("fetch_gifts.cjs"), username, "--out", dir], dir);
  await runProc(nodeCmd, [getGvToolPath("gifts_to_html.cjs"),
    "--in", path.join(dir, "gifts.min.json"), "--out", dir], dir);
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
ipcMain.handle("gv:gifts:update", async (_event, username) => {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!user) throw new Error("username is empty");

  const toolsDir = getGvToolsDir();
  const fetchTool = getGvToolPath("fetch_gifts.cjs");
  const htmlTool = getGvToolPath("gifts_to_html.cjs");

  if (!fs.existsSync(fetchTool)) throw new Error(`fetch_gifts.cjs not found: ${fetchTool}`);
  if (!fs.existsSync(htmlTool)) throw new Error(`gifts_to_html.cjs not found: ${htmlTool}`);

  const dir = getGvDataDir();
  await ensureNodeRuntimeAvailable();
  const nodeCmd = getNodeCommand();

  await runProc(nodeCmd, [fetchTool, user, "--out", dir], dir);
  await runProc(nodeCmd, [htmlTool, "--in", path.join(dir, "gifts.min.json"), "--out", dir], dir);

  return { ok: true, dir };
});

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
ipcMain.handle("gv:gifts:fetchImageBase64", async (_event, url) => {
  if (!url) throw new Error("URL is empty");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = response.headers.get("content-type") || "image/webp";

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
});

// --------------------
// gv:gifts:copyPngDataUrl
// --------------------
ipcMain.handle("gv:gifts:copyPngDataUrl", async (_event, dataUrl) => {
  if (!dataUrl) throw new Error("Data URL is empty");

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
ipcMain.handle("app:config:read", async () => readAppConfig());

ipcMain.handle("app:config:write", async (_event, data) => {
  if (typeof data !== "object" || data === null) throw new Error("data must be an object");
  writeAppConfig(data);
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
  const email = String(payload?.email || "").trim();
  const password = String(payload?.password || "");
  if (!isValidLoginEmail(email)) {
    return { ok: false, message: "メールアドレスの形式が正しくありません" };
  }
  if (!verifyOperatorPassword(password)) {
    return { ok: false, message: "パスワードが違います" };
  }
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
    // 旧版の doumacmd jar が残り得る。ここで最新版に揃える（ルートの残骸も撤去）。
    refreshDoumaModJar(targetFolder);
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
ipcMain.handle("bridge:commands:list", async () => {
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  if (!fs.existsSync(dir)) return [];
  // アンダースコア始まり（_gamerules など内部用）はギフト/イベント割当のドロップダウンに出さない
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt") && !f.startsWith("_")).sort();
  return files.map((name) => {
    let title = name;
    try {
      const content = fs.readFileSync(path.join(dir, name), "utf8");
      const match = content.match(/^#\s*TITLE:\s*(.+)$/m);
      if (match) title = match[1].trim();
    } catch {}
    return { name, title };
  });
});

// --------------------
// IPC: bridge/commands/minecraft/ の TITLE + CATEGORY + 説明文 メタ情報一覧
// --------------------
ipcMain.handle("bridge:commands:readMeta", async () => {
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt") && !f.startsWith("_")).sort();
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
    return { name, title, category, description };
  });
});

// --------------------
// IPC: bridge/commands/minecraft/ にTXTを書き込む
// --------------------
ipcMain.handle("bridge:commands:write", async (_event, { filename, content }) => {
  if (!filename || typeof filename !== "string" || !filename.endsWith(".txt")) {
    throw new Error("Invalid filename: must be a .txt file");
  }
  if (typeof content !== "string") throw new Error("content must be a string");
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, content, "utf8");
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
  const hasProps = fs.existsSync(path.join(dir, "server.properties"));
  const hasLibraries = fs.existsSync(path.join(dir, "libraries"));
  const hasRunBat = fs.existsSync(path.join(dir, "run.bat"));
  const complete = hasProps && (hasLibraries || hasRunBat);
  return { complete, dir };
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
    const forgeLibDir = path.join(dir, "libraries", "net", "minecraftforge", "forge");
    if (fs.existsSync(forgeLibDir)) {
      const versionDirs = fs.readdirSync(forgeLibDir, { withFileTypes: true }).filter((e) => e.isDirectory());
      if (versionDirs.length > 0) {
        forgeVersion = versionDirs[0].name; // 例: "1.20.1-47.3.0"
        minecraftVersion = forgeVersion.split("-")[0] || "";
      }
    }
  } catch { /* 検出できなければ未検出のまま */ }

  let javaVersion = "";
  try {
    const result = spawnSync("java", ["-version"], { encoding: "utf8" });
    // java -version は多くのJDKでstderrに出力する
    const out = String(result.stderr || result.stdout || "").split("\n")[0].trim();
    if (out) javaVersion = out;
  } catch { /* javaがPATHに無ければ未検出のまま */ }

  const modsDir = path.join(dir, "mods");
  let doumaModJar = "";
  try {
    if (fs.existsSync(modsDir)) {
      doumaModJar = fs.readdirSync(modsDir).find((f) => /^doumacmd-.*\.jar$/i.test(f)) || "";
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
    doumaMod: { detected: Boolean(doumaModJar), version: doumaModJar || "未検出" },
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

function getTtsSettingsPath() {
  return path.join(app.getPath("userData"), "tts-settings.json");
}

function readTtsSettings() {
  const p = getTtsSettingsPath();
  if (!fs.existsSync(p)) return { ...TTS_DEFAULTS };
  try {
    return { ...TTS_DEFAULTS, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
  } catch {
    return { ...TTS_DEFAULTS };
  }
}

function writeTtsSettings(settings) {
  const p = getTtsSettingsPath();
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), "utf-8");

  // bridge フォルダにも同期（bridge/index.js が読む）
  try {
    const bridgeTtsPath = path.join(getBridgeBatDir(), "tts-settings.json");
    fs.mkdirSync(path.dirname(bridgeTtsPath), { recursive: true });
    fs.writeFileSync(bridgeTtsPath, JSON.stringify(settings, null, 2), "utf-8");
  } catch { /* bridge フォルダが未作成でも無視 */ }
}

ipcMain.handle("tts:settings:read", () => readTtsSettings());

ipcMain.handle("tts:settings:write", (_event, settings) => {
  writeTtsSettings(settings);
  return { ok: true };
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
    spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: "ignore" }).unref();
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
    const ok = await checkEngine(settings.engine);
    if (!ok) return { ok: false, message: "エンジンが起動していません" };
    const text = (settings.testText && String(settings.testText).trim()) || "テスト再生。こんにちは！";
    const wav = await synthesize(
      settings.engine,
      text,
      settings.speakerId,
      settings.speedScale,
      settings.pitchScale,
      settings.intonationScale
    );
    return { ok: true, base64: wav.toString("base64") };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
