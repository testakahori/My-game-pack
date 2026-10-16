// 画面のウィンドウと CSP、ウィンドウ操作の ipc。main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// electron は読み込まない。BrowserWindow・session・dialog・shell と appDir（main.cjs の __dirname）は main から受け取る。
const path = require("path");
const { pathToFileURL } = require("url");

// isBusy は「保存・準備中で閉じられない」とき（初期セットアップ・MAP の作業・サーバーの起動と停止・ゲームの切り替え）に真を返す関数。
function createAppWindow({ BrowserWindow, session, dialog, shell, appDir, isDev, isBusy }) {
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

  function createWindow() {
    const iconPath = path.join(appDir, "..", "assets", "icon.ico");
    const indexHtml = path.join(appDir, "..", "dist", "index.html");
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
        preload: path.join(appDir, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.on("close", event => {
      if (!isBusy()) return;
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
    return win;
  }

  function register(ipcMain) {
    ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
    ipcMain.on("window:maximizeToggle", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    });
    ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  }

  return { installProdOnlyCsp, createWindow, register };
}

module.exports = { createAppWindow };
