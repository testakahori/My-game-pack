const { app, BrowserWindow, ipcMain, shell, clipboard, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const isDev = process.env.ELECTRON_DEV === "1";
const isPackaged = app.isPackaged;

// --------------------
// Paths
// --------------------
function projectRoot() {
  // パッケージ化されてない時（electron:dev / electron:prod）は、常に作業ディレクトリ基準が安全
  return process.cwd();
}

function toolsDir() {
  // packaged: resources/tools（extraResources）
  // unpacked: <project>/tools
  return isPackaged ? path.join(process.resourcesPath, "tools") : path.join(projectRoot(), "tools");
}

function appDataDir() {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function giftsDir() {
  const dir = path.join(appDataDir(), "gifts");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function giftsMinPath() {
  return path.join(giftsDir(), "gifts.min.json");
}
function giftsMetaPath() {
  return path.join(giftsDir(), "gifts.meta.json");
}
function giftsHtmlPath() {
  return path.join(giftsDir(), "gifts.html");
}

// node 同梱（任意）
// packaged: resources/node/node.exe（extraResources）
// unpacked: <project>/node/node.exe があればそれ、なければ PATH の node
function nodeExe() {
  if (process.platform !== "win32") return "node";

  const cand = isPackaged
    ? path.join(process.resourcesPath, "node", "node.exe")
    : path.join(projectRoot(), "node", "node.exe");

  return fs.existsSync(cand) ? cand : "node";
}

function toolPath(name) {
  return path.join(toolsDir(), name);
}

function ensureToolsExist() {
  const a = toolPath("fetch_gifts.cjs");
  const b = toolPath("gifts_to_html.cjs");
  if (!fs.existsSync(a)) throw new Error(`tools not found: ${a}`);
  if (!fs.existsSync(b)) throw new Error(`tools not found: ${b}`);
}

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

// --------------------
// Window
// --------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "../assets/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    // ※ 先に `npm run dev` (vite) を起動してから `npm run electron:dev`
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    // unpacked electron:prod は dist がプロジェクト直下にある前提
    const indexHtml = isPackaged
      ? path.join(app.getAppPath(), "dist", "index.html")
      : path.join(projectRoot(), "dist", "index.html");
    win.loadFile(indexHtml);
  }
}

// --------------------
// App lifecycle
// --------------------
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --------------------
// IPC
// --------------------
ipcMain.handle("gifts:read", async () => {
  const min = giftsMinPath();
  const meta = giftsMetaPath();

  if (!fs.existsSync(min)) return { gifts: [], meta: null, exists: false };

  const gifts = JSON.parse(fs.readFileSync(min, "utf-8"));
  const m = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, "utf-8")) : null;

  return { gifts, meta: m, exists: true };
});

ipcMain.handle("gifts:openFolder", async () => {
  const dir = giftsDir();
  await shell.openPath(dir);
  return { ok: true, dir };
});

ipcMain.handle("gifts:openHtml", async () => {
  const html = giftsHtmlPath();
  if (!fs.existsSync(html)) throw new Error(`gifts.html not found: ${html}`);
  await shell.openPath(html);
  return { ok: true, html };
});

// username 保存（任意）
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

ipcMain.handle("settings:read", async () => {
  const p = settingsPath();
  if (!fs.existsSync(p)) return { username: "" };
  return JSON.parse(fs.readFileSync(p, "utf-8"));
});

ipcMain.handle("settings:write", async (_e, v) => {
  const p = settingsPath();
  const next = { username: String(v?.username || "").trim().replace(/^@/, "") };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  return { ok: true };
});

ipcMain.handle("gifts:update", async (_e, username) => {
  const user = String(username || "").trim().replace(/^@/, "");
  if (!user) throw new Error("username is empty");

  ensureToolsExist();

  const cwd = giftsDir(); // 生成物は userData 側に集約（配布向き）
  const node = nodeExe();

  // tools 側が --out / --in を受け取れる完全版（下に貼る）とセット
  await runProc(node, [toolPath("fetch_gifts.cjs"), user, "--out", cwd], cwd);
  await runProc(node, [toolPath("gifts_to_html.cjs"), "--in", path.join(cwd, "gifts.min.json"), "--out", cwd], cwd);

  return { ok: true, dir: cwd };
});
ipcMain.handle("gifts:fetchImageBase64", async (_e, url) => {
  if (!url) throw new Error("URL is empty");

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = response.headers.get("content-type") || "image/webp";

    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch (err) {
    throw new Error(`Failed to fetch image: ${err.message || err}`);
  }
});

ipcMain.handle("gifts:copyPngDataUrl", async (_e, dataUrl) => {
  if (!dataUrl) throw new Error("Data URL is empty");

  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) throw new Error("Failed to decode PNG image");

    clipboard.writeImage(image);
    return { ok: true };
  } catch (err) {
    throw new Error(`Failed to copy image: ${err.message || err}`);
  }
});