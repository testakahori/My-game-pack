// 配置の場所（同梱の BRIDGE・設定・ギフト・サーバー・同梱 node・GiftsViewer）。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// app・process・appDir（main.cjs の __dirname）は main から受け取る。テストは main.cjs を一時フォルダーで動かすので、自分の __dirname は使わない。
const path = require("path");
const fs = require("fs");
const { newBridgeConfig } = require("../bridge/config_defaults.cjs");
// 一時ファイルに書いてディスクに確実に残してから差し替える（設定ファイルの PR1・PR3）。
const { writeFileDurable } = require("../bridge/safe_json_file.cjs");

function createPaths({ app, process, appDir, readAppConfig }) {
  // ✅ 重要：dev/prod ではなく「パッケージ済みか」で分岐する
  // - electron . / electron:dev / electron:prod（未パッケージ） => ui/bridge_runtime を見る
  // - exe化（electron-builder）後（パッケージ）             => <install>/resources/bridge を見る
  function getInstalledBridgeRoot() {
    if (!app.isPackaged) {
      return path.resolve(appDir, "..", "bridge_runtime"); // ui/bridge_runtime
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
      ? path.resolve(appDir, "..", "GiftsViewer", "data", "gifts")
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
    // 雛形は bridge/config_defaults.cjs の1か所（配布の準備 scripts/prepare-bridge-runtime.cjs と同じ。処理のコピー PR4）。
    writeFileDurable(configPath, JSON.stringify(newBridgeConfig(), null, 2));
  }

  // テンプレートパス（常にバンドル版を返す）
  function getServerTemplatePath() {
    if (!app.isPackaged) return path.resolve(appDir, "..", "server", "Douma_Craft");
    return path.join(process.resourcesPath, "server", "Douma_Craft");
  }

  function getServerRoot() {
    // app-config.json に保存されたフォルダを優先
    const cfg = readAppConfig();
    // 指定先が消えていても別のサーバーに切り替えない。診断画面で同じパスを示す。
    if (cfg.serverFolder) return path.resolve(cfg.serverFolder);
    // 初回の保存先はアプリの外。更新・アンインストールでワールドを失わない。
    if (!app.isPackaged) return path.resolve(appDir, "..", "server", "Douma_Craft");
    return path.join(app.getPath("documents"), "MyGamePack", "Server");
  }

  function getBridgeBatDir() {
    // dev: ui/bridge をそのまま使用
    if (!app.isPackaged) {
      return path.resolve(appDir, "..", "bridge");
    }
    // packaged: setupComplete=true なら serverFolder/bridge、それ以外は userData/bridge（フォールバック）
    const cfg = readAppConfig();
    if (cfg.setupComplete && cfg.serverFolder && fs.existsSync(cfg.serverFolder)) {
      return path.join(cfg.serverFolder, "bridge");
    }
    return path.join(app.getPath("userData"), "bridge");
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

  function getNodeCommand() {
    if (process.platform !== "win32") return "node";
    const bundled = detectBundledNodeExe();
    return bundled || "node"; // 最悪PATH
  }

  // 同梱 BRIDGE の tools の場所を返す getToolsPath・ensureToolsExist は、分ける前から誰も呼んでいなかったので移さずに消した（2026-10-17 PR1 の最終レビュー M2）。
  // ギフトの取得の道具は GiftsViewer のもの（getGvToolPath）を使う。

  // GiftsViewer
  function getGvToolsDir() {
    if (!app.isPackaged) {
      // tools-bundled を優先（.cjs バンドル済み）、なければ tools
      const bundled = path.resolve(appDir, "..", "GiftsViewer", "tools-bundled");
      if (fs.existsSync(bundled)) return bundled;
      return path.resolve(appDir, "..", "GiftsViewer", "tools");
    }
    return path.join(process.resourcesPath, "gv-tools");
  }

  function getGvDataDir() {
    const dir = !app.isPackaged
      ? path.resolve(appDir, "..", "GiftsViewer", "data", "gifts")
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

  return {
    getInstalledBridgeRoot, getBridgeDir, getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath,
    ensureDir, ensureConfigExists, getServerTemplatePath, getServerRoot, getBridgeBatDir,
    detectBundledNodeExe, getNodeCommand,
    getGvToolsDir, getGvDataDir, getGvSettingsPath, getGvToolPath,
  };
}

module.exports = { createPaths };
