// 初期セットアップ・Forge インストーラー・セットアップの確認・環境の実測・フォルダー選択の ipc。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・child_process は読み込まず、main から受け取る。
const path = require("path");
const fs = require("fs");
const { EULA_URL, inspectSetup, inspectForgeClient, launchForgeInstaller, prepareServerEnvironment } = require("./initial_setup.cjs");

// あとで main で作られるもの（MAP の作業・サーバーの子プロセスなど）は、呼ばれたときに読む関数で受け取る。
function createSetupIpc({ app, dialog, shell, spawnSync, getServerRoot, getGvDataDir, assertGameProfileIdle, assertMapIdle, serverChild }) {
  // --------------------
  // IPC: 同梱資材から初期設定を構築（PowerShell・外部コンソール不要）
  // --------------------
  let initialSetupRunning = false;
  let initialSetupState = { state: "idle", message: "" };
  async function setupServerAtPath(folderPath) {
    assertGameProfileIdle();
    assertMapIdle();
    if (!folderPath || typeof folderPath !== "string") throw new Error("folderPath is required");
    if (initialSetupRunning) throw new Error("環境構築が進行中です。完了までお待ちください。");
    if (serverChild()) throw new Error("Minecraftサーバーを停止してから環境構築を実行してください。");
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

  // 初期セットアップの最中か（サーバーの起動・MAP の作業・ゲームの切り替え・ウィンドウを閉じるときに main が見る）。
  function isRunning() {
    return initialSetupRunning;
  }

  function register(ipcMain) {
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

    ipcMain.handle("server:setup:status", () => initialSetupState);
    ipcMain.handle("server:setup:atPath", (_event, folderPath) => setupServerAtPath(folderPath));

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
  }

  return { isRunning, setupServerAtPath, register };
}

module.exports = { createSetupIpc };
