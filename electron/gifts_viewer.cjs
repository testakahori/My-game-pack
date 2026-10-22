// ギフト一覧（UI タブ・GiftsViewer）の読み込み・更新・画像・コピーの ipc。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・process_runner は読み込まず、main から受け取る
// （テストの loadApp が偽物に差し替えるのは main が読み込んだものだけのため）。
const path = require("path");
const fs = require("fs");
const { fetchGiftImage } = require("./gift_image.cjs");
const { normalizeTikTokId } = require("../bridge/tiktok_id.cjs");

// 同梱 node の準備（BRIDGE の配布）は、あとで main で定義されるので、呼ばれたときに読む関数で受け取る。
function createGiftsViewer({
  BrowserWindow, shell, net, clipboard, nativeImage, runProc, eulerCredentials,
  getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath, ensureDir,
  getGvDataDir, getGvSettingsPath, getGvToolPath, getNodeCommand, ensureNodeRuntimeAvailable,
}) {
  // ====================
  // GiftsViewer 統合 (gv:* プレフィックス)
  // ====================

  // --------------------
  // GiftsViewer（場所は paths.cjs）
  // --------------------
  async function autoUpdateGiftsIfStale() {
    let bridgeCfg = {};
    try { bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
    // 配信前チェック・BRIDGE と同じ形に整える（2026-10-18 設計書の 9）。取った一覧の ID も同じ形で比べる。
    const username = normalizeTikTokId(bridgeCfg.tiktokUsername);
    if (!username) return { skipped: "username" };
    const metaPath = path.join(getGvDataDir(), "gifts.meta.json");
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const age = Date.now() - Date.parse(meta.generatedAt);
      if (normalizeTikTokId(meta.username) === username && meta.count > 0 && age >= 0 && age < 86400000 &&
          fs.existsSync(path.join(getGvDataDir(), "gifts.min.json"))) return { skipped: "fresh" };
    } catch { /* 壊れたメタデータも再取得する */ }
    await updateGifts(username);
    console.log(`[gifts:auto-update] updated for @${username}`);
    return { ok: true };
  }

  // --------------------
  // gv:gifts:update
  // --------------------
  let giftUpdateTask = null;
  let giftUpdateUsername = "";

  async function updateGifts(username) {
    // 自動更新と同じ形に整える。形が違うと、自動更新の最中に押した同じ ID の更新が「別のアカウント」で止まる。
    const user = normalizeTikTokId(username);
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

  function register(ipcMain) {
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
  }

  return { autoUpdateGiftsIfStale, updateGifts, register };
}

module.exports = { createGiftsViewer };
