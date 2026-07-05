// electron/main.cjs
const { app, BrowserWindow, ipcMain, session, shell, clipboard, nativeImage, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");
const { checkEngine, getSpeakers, flattenSpeakers, synthesize } = require("./tts.cjs");
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

  const defaultConfig = {
    tiktokUsername: "",
    rcon: { host: "127.0.0.1", port: 25575, password: "" },
    mappings: [],
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
    width: 1200,
    height: 900,
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
  // 置き方が2パターンあり得るので両対応
  // A) <bridgeRoot>/node/node.exe （resources/bridge/node/node.exe）
  const root = getInstalledBridgeRoot();
  const candA = path.join(root, "node", "node.exe");
  if (fs.existsSync(candA)) return candA;

  // B) <resources>/node/node.exe （resources/node/node.exe）
  const candB = path.join(process.resourcesPath, "node", "node.exe");
  if (fs.existsSync(candB)) return candB;

  return null;
}

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
  installProdOnlyCsp();
  ensureBridgeExtracted();
  createWindow();
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

let updateState = { state: "idle", version: null, percent: 0, error: "" };
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => { updateState = { state: "checking", version: null, percent: 0, error: "" }; });
  autoUpdater.on("update-available", info => { updateState = { state: "downloading", version: info.version, percent: 0, error: "" }; });
  autoUpdater.on("update-not-available", info => { updateState = { state: "current", version: info.version, percent: 100, error: "" }; });
  autoUpdater.on("download-progress", p => { updateState = { ...updateState, percent: Math.round(p.percent || 0) }; });
  autoUpdater.on("update-downloaded", info => { updateState = { state: "ready", version: info.version, percent: 100, error: "" }; });
  autoUpdater.on("error", error => { updateState = { state: "error", version: null, percent: 0, error: error?.message || String(error) }; });
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

// --------------------
// IPC: Bridge起動（任意）
// --------------------
ipcMain.handle("bridge:start", async () => {
  const root = getInstalledBridgeRoot();
  const bat = path.join(root, "minecraft_start_all.bat");

  if (!fs.existsSync(root)) throw new Error(`Bridge root not found: ${root}`);
  if (!fs.existsSync(bat)) throw new Error(`minecraft_start_all.bat not found: ${bat}`);

  spawn("cmd.exe", ["/c", bat], {
    cwd: root,
    windowsHide: false,
    detached: true,
  });

  return { ok: true, bat, bridgeRoot: root };
});

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
// Bridge: resources → userData に展開
// --------------------
function copyBridgeRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyBridgeRecursive(srcPath, dstPath);
    } else {
      // config.minecraft.json はユーザー設定なので既存があれば上書きしない
      if (entry.name === "config.minecraft.json" && fs.existsSync(dstPath)) continue;
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// アプリ更新時に doumacmd Mod jar を既存サーバーの mods/ へ差し替える
// （bridge 再展開だけでは Mod が旧版のまま残るため）
function refreshDoumaModJar(serverFolder) {
  try {
    const srcServer = path.join(process.resourcesPath, "server", "Douma_Craft");
    if (!fs.existsSync(srcServer)) return;

    const jars = fs.readdirSync(srcServer).filter((f) => /^doumacmd-.*\.jar$/i.test(f));
    if (jars.length === 0) return;

    const modsDir = path.join(serverFolder, "mods");
    if (!fs.existsSync(modsDir)) return; // サーバー未セットアップなら setup.bat に任せる

    for (const old of fs.readdirSync(modsDir).filter((f) => /^doumacmd-.*\.jar$/i.test(f))) {
      if (!jars.includes(old)) fs.unlinkSync(path.join(modsDir, old));
    }
    for (const j of jars) {
      fs.copyFileSync(path.join(srcServer, j), path.join(modsDir, j));
    }
    console.log(`[main] doumacmd mod jar refreshed in ${modsDir}: ${jars.join(", ")}`);
  } catch (e) {
    console.error("[main] refreshDoumaModJar failed:", e?.message || e);
  }
}

function ensureBridgeExtracted() {
  if (!app.isPackaged) return; // dev は ui/bridge をそのまま使う

  const src = path.join(process.resourcesPath, "bridge");
  if (!fs.existsSync(src)) return; // resources に bridge がない場合は何もしない

  const cfg = readAppConfig();

  // setupComplete=false: セットアップ時に bridge:extractTo で展開するのでスキップ
  if (!cfg.setupComplete || !cfg.serverFolder) return;

  const dst = path.join(cfg.serverFolder, "bridge");
  const currentVersion = app.getVersion();

  // 同バージョン展開済みなら再コピーしない
  if (cfg.bridgeVersion === currentVersion && fs.existsSync(path.join(dst, "index.js"))) return;

  copyBridgeRecursive(src, dst);
  refreshDoumaModJar(cfg.serverFolder);
  writeAppConfig({ bridgeVersion: currentVersion });
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
  copyBridgeRecursive(src, dst);
  writeAppConfig({ bridgeVersion: app.getVersion() });

  return { ok: true, dst };
});

// --------------------
// IPC: サーバー起動 (run.bat)
// --------------------
let serverPid  = null;
let bridgePid  = null;
let bridgeProcRef = null;
let bridgeStopRequested = false;
let bridgeRestartTimer = null;
const bridgeRestartPolicy = new RestartPolicy();

ipcMain.handle("server:start", async () => {
  const dir = getServerRoot();
  const bat = path.join(dir, "run.bat");
  if (!fs.existsSync(bat)) throw new Error(`run.bat not found: ${bat}`);
  if (readAppConfig().autoBackupOnServerStart !== false) await createWorldBackup("server-start");

  const proc = spawn("cmd.exe", ["/k", bat], {
    cwd: dir,
    windowsHide: false,
    detached: true,
    stdio: "ignore",
  });
  serverPid = proc.pid;
  proc.on("exit", () => { serverPid = null; });
  proc.unref();

  return { ok: true };
});

// --------------------
// IPC: サーバー停止
// --------------------
ipcMain.handle("server:stop", async () => {
  if (!serverPid) throw new Error("このセッションで起動したサーバーが見つかりません。ウィンドウを直接閉じてください。");
  spawn("taskkill", ["/F", "/T", "/PID", String(serverPid)], { windowsHide: true });
  serverPid = null;
  return { ok: true };
});

// --------------------
// IPC: Bridge 起動（同梱 node 優先、なければ PATH の node）
// --------------------
ipcMain.handle("bridge:launch", async () => {
  const dir = getBridgeBatDir();
  const indexJs = path.join(dir, "index.js");
  if (!fs.existsSync(indexJs)) throw new Error(`index.js not found: ${indexJs}`);

  const nodeCmd = getNodeCommand();

  bridgeStopRequested = false;
  bridgeRestartPolicy.start();
  const launch = () => {
    const child = spawn(nodeCmd, [indexJs, "--config", path.join(dir, "config.minecraft.json")], {
      cwd: dir, windowsHide: true, stdio: "ignore",
    });
    bridgeProcRef = child;
    bridgePid = child.pid;
    child.on("exit", () => {
      bridgePid = null; bridgeProcRef = null;
      if (!bridgeStopRequested && bridgeRestartPolicy.shouldRestart()) {
        bridgeRestartTimer = setTimeout(launch, 2000);
      }
    });
  };
  if (!bridgeProcRef) launch();

  return { ok: true };
});

// --------------------
// IPC: Bridge 停止
// --------------------
ipcMain.handle("bridge:stop", async () => {
  bridgeStopRequested = true;
  bridgeRestartPolicy.requestStop();
  if (bridgeRestartTimer) clearTimeout(bridgeRestartTimer);
  if (bridgePid) {
    spawn("taskkill", ["/F", "/T", "/PID", String(bridgePid)], { windowsHide: true });
    bridgePid = null;
  } else {
    // Fallback: kill by window title (e.g. launched from a previous session)
    spawn("taskkill", ["/F", "/FI", "WINDOWTITLE eq MC TikTok Bridge"], { windowsHide: true });
  }
  return { ok: true };
});
ipcMain.handle("bridge:processStatus", () => bridgeRestartPolicy.status(bridgePid));

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
function readOperationsHistory() {
  try { return JSON.parse(fs.readFileSync(getOperationsHistoryPath(), "utf8")); } catch { return []; }
}
function appendOperationsHistory(row) {
  const rows = readOperationsHistory();
  rows.unshift(row);
  fs.writeFileSync(getOperationsHistoryPath(), JSON.stringify(rows.slice(0, 1000), null, 2), "utf8");
}

ipcMain.handle("mod:status", async () => {
  try { return { online: true, ...(await requestDouma("GET", "/douma/status")) }; }
  catch (e) { return { online: false, error: e.message }; }
});
ipcMain.handle("mod:testEvent", async (_event, value) => {
  let bridgeCfg = {};
  try { bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
  const protection = bridgeCfg.options?.protection || {};
  const payload = {
    type: value?.type === "like" ? "like" : "gift",
    key: path.basename(String(value?.commandFile || ""), ".txt"),
    count: Math.max(1, Math.min(100, Number(value?.count || 1))),
    listenerName: String(value?.listenerName || "テスト視聴者").slice(0, 40),
    announce: true,
    protectionEnabled: protection.enabled === true,
    protectX1: Number(protection.x1 || 0), protectX2: Number(protection.x2 || 0),
    protectZ1: Number(protection.z1 || 0), protectZ2: Number(protection.z2 || 0),
  };
  let result;
  try { await requestDouma("POST", "/douma/event", payload); result = { ok: true }; }
  catch (e) { result = { ok: false, message: e.message }; }
  appendOperationsHistory({ at: new Date().toISOString(), type: payload.type, sender: payload.listenerName,
    commandFile: `${payload.key}.txt`, count: payload.count, ...result });
  return result;
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
  await new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Compress-Archive -LiteralPath $args[0] -DestinationPath $args[1] -CompressionLevel Fastest", world, zip],
      { windowsHide: true });
    ps.on("exit", code => code === 0 ? resolve() : reject(new Error(`バックアップ失敗 (${code})`)));
    ps.on("error", reject);
  });
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

  const summarize = (b) => {
    const byCommand = {}, bySender = {};
    let gift = 0, like = 0, other = 0, succeeded = 0, failed = 0;
    for (const r of b.rows) {
      const amount = Number(r.count || 1);
      if (r.ok) succeeded++; else failed++;
      if (r.type === "gift") gift += amount;
      else if (r.type === "like") like += amount;
      else other += amount;
      byCommand[r.commandFile || "unknown"] = (byCommand[r.commandFile || "unknown"] || 0) + amount;
      bySender[r.sender || "unknown"] = (bySender[r.sender || "unknown"] || 0) + amount;
    }
    return {
      start: new Date(b.startT).toISOString(),
      end: new Date(b.lastT).toISOString(),
      durationMs: b.lastT - b.startT,
      events: b.rows.length,
      gift, like, other, succeeded, failed,
      uniqueSenders: Object.keys(bySender).length,
      topCommands: top(byCommand),
      topSenders: top(bySender),
    };
  };

  const streams = buckets.map(summarize).reverse(); // 新しい配信を先頭に
  const sum = (key) => streams.reduce((a, s) => a + s[key], 0);
  return {
    gapMinutes: gapMs / 60000,
    overall: {
      streams: streams.length,
      events: sorted.length,
      gift: sum("gift"), like: sum("like"), other: sum("other"),
      succeeded: sum("succeeded"), failed: sum("failed"),
    },
    streams,
  };
}
ipcMain.handle("operations:streamStats", (_event, gapMinutes) => computeStreamStats(gapMinutes));

// --------------------
// IPC: Minecraft 起動
// --------------------
const MINECRAFT_PATHS = [
  "C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe",
  "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe",
];

ipcMain.handle("minecraft:launch", async () => {
  const found = MINECRAFT_PATHS.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      "Minecraft ランチャーが見つかりませんでした。\n確認したパス:\n" +
      MINECRAFT_PATHS.join("\n")
    );
  }
  spawn(found, [], { detached: true, stdio: "ignore" }).unref();
  return { ok: true };
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
  const configPath = getConfigPath();
  ensureConfigExists(configPath);
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const { host = "127.0.0.1", port = 25575, password = "" } = cfg.rcon || {};
  if (!password) throw new Error("RCON パスワードが設定されていません（config.minecraft.json を確認してください）");

  const rcon = new Rcon({ host, port: Number(port), password });
  await rcon.connect();

  const commands = [
    "gamerule keepInventory true",
    "gamerule doDaylightCycle false",
    "time set day",
    "gamerule doWeatherCycle false",
    "weather clear",
  ];

  const results = [];
  for (const cmd of commands) {
    const res = await rcon.send(cmd);
    results.push({ cmd, res });
  }
  await rcon.end();
  return { ok: true, results };
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
  await runProc(getNodeCommand(), [getGvToolPath("fetch_gifts.cjs"), username, "--out", dir], dir);
  await runProc(getNodeCommand(), [getGvToolPath("gifts_to_html.cjs"),
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
// IPC: サーバーテンプレートをコピー（空フォルダ対応）
// --------------------
ipcMain.handle("server:copyTemplate", async (_event, targetFolder) => {
  if (!targetFolder || typeof targetFolder !== "string") throw new Error("targetFolder is required");

  const template = getServerTemplatePath();
  if (!fs.existsSync(template)) throw new Error(`テンプレートが見つかりません: ${template}`);

  function copyRecursive(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        copyRecursive(srcPath, dstPath);
      } else {
        // 既存ファイルはスキップ（上書きしない）
        if (!fs.existsSync(dstPath)) {
          fs.copyFileSync(srcPath, dstPath);
        }
      }
    }
  }

  copyRecursive(template, targetFolder);

  // MODが読む bridge/commands/minecraft/ をテンプレートコピー時点で展開
  // (bridge:extractTo は確認ボタン後だが、MODはサーバー起動時に読むため早めに配置する)
  const commandsSrc = app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "commands", "minecraft")
    : path.resolve(__dirname, "..", "bridge", "commands", "minecraft");
  const commandsDst = path.join(targetFolder, "bridge", "commands", "minecraft");
  if (fs.existsSync(commandsSrc)) {
    copyRecursive(commandsSrc, commandsDst);
  }

  return { ok: true };
});

// --------------------
// IPC: bridge/commands/minecraft/ 内の .txt ファイル一覧
// --------------------
ipcMain.handle("bridge:commands:list", async () => {
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
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
// IPC: bridge/commands/minecraft/ の TITLE + CATEGORY メタ情報一覧
// --------------------
ipcMain.handle("bridge:commands:readMeta", async () => {
  const dir = path.join(getBridgeBatDir(), "commands", "minecraft");
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort();
  return files.map((name) => {
    let title = name;
    let category = "";
    try {
      const content = fs.readFileSync(path.join(dir, name), "utf8");
      const titleMatch = content.match(/^#\s*TITLE:\s*(.+)$/m);
      if (titleMatch) title = titleMatch[1].trim();
      const catMatch = content.match(/^#\s*CATEGORY:\s*(.+)$/m);
      if (catMatch) category = catMatch[1].trim();
    } catch {}
    return { name, title, category };
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
  voicevox: path.join(require("os").homedir(), "AppData", "Local", "Programs", "VOICEVOX", "VOICEVOX.exe"),
  aivis: path.join(require("os").homedir(), "AppData", "Local", "Programs", "AivisSpeech", "AivisSpeech.exe"),
};

ipcMain.handle("tts:launchEngine", async (_event, engine) => {
  const exePath = ENGINE_EXE_PATHS[engine];
  if (!fs.existsSync(exePath)) {
    return { ok: false, message: `実行ファイルが見つかりません。公式サイトからインストールしてください。\n${exePath}` };
  }
  try {
    spawn(exePath, [], { detached: true, stdio: "ignore" }).unref();
    return { ok: true };
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
