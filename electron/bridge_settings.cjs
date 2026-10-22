// BRIDGE の設定（config.minecraft.json）の読み書き・ギフトの割り当て・テンプレート・設定のバックアップ・配信前チェック・コマンド txt の ipc。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、app・dialog・shell は main から受け取る。
const path = require("path");
const fs = require("fs");
const { validateBridgeConfig } = require("./config_schema.cjs");
const { CONFIG_VERSION, migrateBridgeConfig } = require("../bridge/config_migration.cjs");
const { updateGiftMapping } = require("./gift_mapping.cjs");
const { createGiftTemplates } = require("./gift_templates.cjs");
const { runPreflight } = require("./preflight.cjs");
const { atomicWrite } = require("./settings_backups.cjs");
const { commandFileProblem, isTxtName } = require("../bridge/command_files.cjs");
const { parseCommandText } = require("../bridge/command_text.cjs");
const { bridgeCommandsDir } = require("../bridge/config_defaults.cjs");
const { availableGameCommands, assertGameCommands } = require("./game_command_scope.cjs");
const { checkEngine } = require("./tts.cjs");

// BRIDGE の子プロセスと BridgeMOD との通信は、あとで main で作られるので、呼ばれたときに読む関数で受け取る。
function createBridgeSettings({
  app, dialog, shell, getConfigPath, ensureConfigExists, getBridgeBatDir, getServerRoot, getGiftsMinPath, getGiftsMetaPath,
  getInstalledBridgeRoot, getBridgeDir, gameProfiles, assertGameProfileIdle, settingsBackups, readTtsSettings, requestBridgeMod, isBridgeRunning,
}) {
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

    // commandsDir を常にセットアップフォルダ内の絶対パスに固定（場所の決め方は BRIDGE と同じ bridge/config_defaults.cjs）
    const commandsDirAbs = bridgeCommandsDir(getBridgeBatDir());
    // 確かめを通った値なので、今の決まりの版を書く（画面が送る設定に版が無くても、次の起動で手で書き換えた値を黙って直さないように）。
    const merged = { ...nextConfig, configVersion: CONFIG_VERSION };
    if (merged.options) {
      merged.options = { ...merged.options, commandsDir: commandsDirAbs };
    }

    const json = JSON.stringify(merged, null, 2);
    if (json.length > 2_000_000) throw new Error("Config too large.");

    if (fs.readFileSync(configPath, "utf8") !== json) settingsBackups.create("automatic");
    atomicWrite(configPath, json);
    return { ok: true };
  }

  // 古い版で保存した設定（回数 2.5・"3"・500、閾値 0 など）を、アプリの更新のあとの起動で1回だけ直す
  // （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7）。画面が設定を読む前に呼ぶ。
  // 設定が無い・読めない、または版が今の決まり以上なら何もしない。直すものがあれば、直す前にバックアップを取る。
  function migrateSavedConfigOnStartup() {
    const saved = readSavedBridgeConfig();
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { changes: [] };
    if (Number(saved.configVersion) >= CONFIG_VERSION) return { changes: [] };
    const { config, changes } = migrateBridgeConfig(saved);
    if (changes.length) settingsBackups.create("migration");
    atomicWrite(getConfigPath(), JSON.stringify(config, null, 2));
    if (changes.length) console.log(`[Config] 保存済みの設定を直しました: ${changes.join("、")}`);
    return { changes };
  }

  // 起動のとき以外の直し（初期セットアップを終えたとき・保存先を変えたとき・BRIDGE を起動する前）。手動インストールのあとは、
  // セットアップを終えるまで設定の場所が userData/bridge の予備を指すので、起動のときの直しが配信者の設定に届かない（PR3 の最終レビュー）。
  // 直したらその場で知らせる。失敗しても呼んだ側（保存・起動）は止めず、ログに残す（直せなかった値は確かめのエラーとして出る）。
  function ensureSavedConfigMigrated() {
    try {
      const { changes } = migrateSavedConfigOnStartup();
      notifyConfigMigration(changes).catch(e => console.warn("[Config]", e?.message || e));
      return changes;
    } catch (e) {
      console.error("[Config] 保存済みの設定を直せませんでした:", e?.message || e);
      return [];
    }
  }

  // 直したものを配信者に1回だけ知らせる（ウィンドウを出したあとに呼ぶ）。直したものがなければ何も出さない。
  async function notifyConfigMigration(changes) {
    if (!changes?.length) return;
    const shown = changes.slice(0, 10).join("\n") + (changes.length > 10 ? `\nほか ${changes.length - 10} 件` : "");
    await dialog.showMessageBox({ type: "info", title: "設定を直しました", message: "古い版で保存した設定の一部を、今の決まりに合わせて直しました。",
      // 「戻せます」とは書かない。バックアップを戻すともう一度直すので、直す前の値には戻らない。
      detail: `${shown}\n\n直す前の設定は「設定のバックアップ」に「更新で直す前の自動保存」として残っています。` });
  }

  // --------------------
  // bridge/commands/minecraft/ 内の .txt ファイル一覧
  // --------------------
  function selectableCommandNames() {
    const dir = bridgeCommandsDir(getBridgeBatDir());
    if (!fs.existsSync(dir)) return [];
    const names = fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isFile()).map(entry => entry.name);
    return availableGameCommands(names, gameProfiles.list()).sort();
  }

  // --------------------
  // bridge/commands/minecraft/ の TITLE + CATEGORY + 説明文 メタ情報一覧
  // --------------------
  function readCommandMetadata() {
    const dir = bridgeCommandsDir(getBridgeBatDir());
    if (!fs.existsSync(dir)) return [];
    const files = selectableCommandNames();
    return files.map((name) => {
      let title = name;
      let category = "";
      let description = "";
      try {
        // 読み方は BRIDGE・BridgeMOD と同じ command_text.cjs（2026-10-18）。説明文は最初の // の行（コマンド一覧ページの表示用）。
        const parsed = parseCommandText(fs.readFileSync(path.join(dir, name), "utf8"));
        if (parsed.meta.TITLE) title = parsed.meta.TITLE;
        category = parsed.meta.CATEGORY || "";
        description = parsed.description;
      } catch {}
      // Explorer で作った「ネコ.txt」「tnt - コピー.txt」なども一覧には出るが、BridgeMOD では実行できない。
      // title はルーレット名やギフト画像にそのまま使われるので変えず、印だけを付ける（割り当てた保存は理由付きで止まる）。
      return { name, title, category, description, ...(commandFileProblem(name) ? { invalidName: true } : {}) };
    });
  }

  const giftTemplates = createGiftTemplates({
    dialog, appVersion: () => app.getVersion(), writeConfig: writeBridgeConfig,
    context: () => { const configPath = getConfigPath(); ensureConfigExists(configPath); return { configPath, commands: readCommandMetadata() }; },
  });
  let preflightTask = null;

  function register(ipcMain) {
    // --------------------
    // IPC: config read/write
    // --------------------
    ipcMain.handle("config:read", async () => {
      const configPath = getConfigPath();
      ensureConfigExists(configPath);

      const raw = fs.readFileSync(configPath, "utf-8");
      return JSON.parse(raw);
    });

    ipcMain.handle("config:write", async (_event, nextConfig) => writeBridgeConfig(nextConfig));
    ipcMain.handle("config:mappings:write", async (_event, mappings) => {
      const configPath = getConfigPath();
      ensureConfigExists(configPath);
      return writeBridgeConfig({ ...JSON.parse(fs.readFileSync(configPath, "utf8")), mappings });
    });

    ipcMain.handle("config:giftMapping:save", (_event, request) => {
      const configPath = getConfigPath();
      ensureConfigExists(configPath);
      const dir = bridgeCommandsDir(getBridgeBatDir());
      const names = selectableCommandNames();
      const next = updateGiftMapping(JSON.parse(fs.readFileSync(configPath, "utf8")), request, names);
      // Keep read / compare / write synchronous so another IPC cannot interleave.
      writeBridgeConfig(next);
      return { ok: true, mappings: next.mappings };
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
    ipcMain.handle("preflight:run", () => {
      if (!preflightTask) preflightTask = runPreflight({
        configPath: getConfigPath(), serverRoot: getServerRoot(),
        commandsDir: bridgeCommandsDir(getBridgeBatDir()),
        giftsPath: getGiftsMinPath(), giftsMetaPath: getGiftsMetaPath(),
        modStatus: async () => { try { return { ...(await requestBridgeMod("GET", "/bridge/status")), online: true }; } catch (e) { return { online: false, authFailed: e?.authFailed === true, error: e?.message || "" }; } },
        bridgeStatus: () => {
          let runtime = {};
          try { runtime = JSON.parse(fs.readFileSync(path.join(getBridgeBatDir(), "runtime-status.json"), "utf8")); } catch {}
          return { running: isBridgeRunning(), tiktok: runtime.tiktok };
        },
        ttsStatus: async () => { const settings = readTtsSettings(); return { enabled: settings.enabled, engine: settings.engine, online: settings.enabled ? await checkEngine(settings.engine) : false }; },
      }).finally(() => { preflightTask = null; });
      return preflightTask;
    });

    ipcMain.handle("config:validate", async (_event, value) => validateBridgeConfig(value, { previous: [readSavedBridgeConfig()] }));

    // ✅ preload側の「bridgeRoot / bridgeDir」ズレ事故を防ぐため両方返す
    ipcMain.handle("bridge:root", async () => getInstalledBridgeRoot());
    ipcMain.handle("bridge:dir", async () => getBridgeDir());

    // --------------------
    // IPC: bridge/commands/minecraft/ 内の .txt ファイル一覧
    // --------------------
    ipcMain.handle("bridge:commands:list", () => readCommandMetadata().map(({ name, title, invalidName }) => ({ name, title, ...(invalidName ? { invalidName } : {}) })));
    ipcMain.handle("bridge:commands:readMeta", () => readCommandMetadata());

    // --------------------
    // IPC: bridge/commands/minecraft/ にTXTを書き込む
    // --------------------
    ipcMain.handle("bridge:commands:write", async (_event, { filename, content }) => {
      assertGameProfileIdle();
      if (/^game_(umetate|run|saikutu)_/.test(filename || '')) throw new Error('ゲームパックのコマンドはパックを再登録して更新してください');
      if (!filename || typeof filename !== "string" || !isTxtName(filename)) {
        throw new Error("Invalid filename: must be a .txt file");
      }
      if (typeof content !== "string") throw new Error("content must be a string");
      if (filename !== path.basename(filename) || filename.includes("/") || filename.includes("\\")) {
        throw new Error("Invalid filename: path separators are not allowed");
      }
      const nameProblem = commandFileProblem(filename);
      if (nameProblem) throw new Error(nameProblem);
      if (Buffer.byteLength(content, "utf8") > 1024 * 1024) throw new Error("command file is too large (max 1MB)");
      const dir = bridgeCommandsDir(getBridgeBatDir());
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
      const dir = bridgeCommandsDir(getBridgeBatDir());
      fs.mkdirSync(dir, { recursive: true });
      await shell.openPath(dir);
      return { ok: true };
    });
  }

  return { readSavedBridgeConfig, writeBridgeConfig, migrateSavedConfigOnStartup, ensureSavedConfigMigrated, notifyConfigMigration, selectableCommandNames, readCommandMetadata, register };
}

module.exports = { createBridgeSettings };
