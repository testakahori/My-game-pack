// electron/preload.cjs
const { contextBridge, ipcRenderer } = require("electron");

// 超最低限：JSONっぽいものだけ通す（変な型を避ける）
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isString(v) {
  return typeof v === "string";
}

function normalizeUsername(u) {
  if (!isString(u)) return "";
  return u.trim().replace(/^@/, "");
}

contextBridge.exposeInMainWorld("mygamepack", {
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximizeToggle: () => ipcRenderer.send("window:maximizeToggle"),
  windowClose: () => ipcRenderer.send("window:close"),
  // --------------------
  // config read/write
  // --------------------
  configRead: () => ipcRenderer.invoke("config:read"),

  configWrite: (cfg) => {
    if (!isPlainObject(cfg)) {
      throw new Error("configWrite: cfg must be an object");
    }
    return ipcRenderer.invoke("config:write", cfg);
  },

  configPath: () => ipcRenderer.invoke("config:path"),
  configValidate: (cfg) => ipcRenderer.invoke("config:validate", cfg),

  // --------------------
  // Bridge (A方式: 同梱) パス確認
  // --------------------
  // main.cjs は "bridge:root" を実装してるので、preload側も合わせる
  bridgeRoot: () => ipcRenderer.invoke("bridge:root"),
  bridgeSyncStatus: () => ipcRenderer.invoke("bridge:syncStatus"),

  // アプリバージョン
  appVersion: () => ipcRenderer.invoke("app:version"),

  // セットアップ完了画面「検出された環境」の実測
  setupInspectEnvironment: () => ipcRenderer.invoke("setup:inspectEnvironment"),

  // --------------------
  // Gifts
  // --------------------

  // gifts.min.json / gifts.meta.json を読む（UIのギフト一覧タブ用）
  giftsRead: () => ipcRenderer.invoke("gifts:read"),

  // UIからギフト一覧を更新（bat不要化）
  // username は "akahoridouma" / "@akahoridouma" どちらでもOK
  giftsUpdate: (username) => {
    const u = normalizeUsername(username);
    if (!u) throw new Error("giftsUpdate: username is empty");
    return ipcRenderer.invoke("gifts:update", u);
  },

  // エクスプローラーで data/gifts を開く
  giftsOpenFolder: () => ipcRenderer.invoke("gifts:openFolder"),

  // 生成済みの gifts.html を開く（既定ブラウザ）
  giftsOpenHtml: () => ipcRenderer.invoke("gifts:openHtml"),

  // --------------------
  // サーバー管理（統合UI追加）
  // --------------------

  // run.bat を起動（アプリ内コンソール取り込み）
  serverStart: () => ipcRenderer.invoke("server:start"),

  // サーバー停止（graceful → 強制のフォールバック）
  serverStop: () => ipcRenderer.invoke("server:stop"),

  // Forgeサーバーのログ・稼働状態（ダッシュボード表示用）
  serverLogs: () => ipcRenderer.invoke("server:logs"),
  serverProcessStatus: () => ipcRenderer.invoke("server:processStatus"),
  // Forgeサーバーコンソールへコマンド送信（op 付与などの脱出ハッチ）
  serverCommand: (command) => ipcRenderer.invoke("server:command", command),

  // Minecraftランチャー/ゲーム本体の稼働検知
  minecraftStatus: () => ipcRenderer.invoke("minecraft:status"),

  // bridge起動.bat を起動（別ウィンドウ）
  bridgeLaunch: () => ipcRenderer.invoke("bridge:launch"),

  // Bridge 停止
  bridgeStop: () => ipcRenderer.invoke("bridge:stop"),
  // Bridge 再起動（停止完了を待ってから起動：stop→launch連打の空振りを防ぐ）
  bridgeRestart: () => ipcRenderer.invoke("bridge:restart"),
  bridgeProcessStatus: () => ipcRenderer.invoke("bridge:processStatus"),
  bridgeLogs: () => ipcRenderer.invoke("bridge:logs"),
  modStatus: () => ipcRenderer.invoke("mod:status"),
  testEvent: (event) => ipcRenderer.invoke("mod:testEvent", event),
  operationsHistory: () => ipcRenderer.invoke("operations:history"),
  operationsHistoryClear: () => ipcRenderer.invoke("operations:history:clear"),
  worldBackup: () => ipcRenderer.invoke("world:backup"),
  presetsList: () => ipcRenderer.invoke("presets:list"),
  presetsSave: (name) => ipcRenderer.invoke("presets:save", name),
  presetsLoad: (name) => ipcRenderer.invoke("presets:load", name),
  operationsStats: () => ipcRenderer.invoke("operations:stats"),
  operationsStreamStats: (gapMinutes) => ipcRenderer.invoke("operations:streamStats", gapMinutes),
  updaterStatus: () => ipcRenderer.invoke("updater:status"),
  updaterCheck: () => ipcRenderer.invoke("updater:check"),
  updaterInstall: () => ipcRenderer.invoke("updater:install"),

  // Minecraft ランチャー起動
  minecraftLaunch: () => ipcRenderer.invoke("minecraft:launch"),

  // マイクラIDへ OP 権限を付与（app-config の minecraftPlayerName を使用）
  minecraftGrantOp: () => ipcRenderer.invoke("minecraft:grantOp"),

  // Bridge を指定フォルダ/bridge/ へ展開（初期セットアップ時）
  bridgeExtractTo: (targetFolder) => {
    if (!isString(targetFolder) || !targetFolder.trim()) throw new Error("bridgeExtractTo: targetFolder is empty");
    return ipcRenderer.invoke("bridge:extractTo", targetFolder.trim());
  },

  // server.properties を読む → Record<string, string>
  serverPropsRead: () => ipcRenderer.invoke("server:props:read"),

  // server.properties を更新 → { ok: true }
  serverPropsWrite: (updates) => {
    if (!isPlainObject(updates)) throw new Error("serverPropsWrite: updates must be an object");
    return ipcRenderer.invoke("server:props:write", updates);
  },

  // forge_install.bat を起動（Forge インストーラ GUI を表示）
  serverForgeInstall: () => ipcRenderer.invoke("server:forgeInstall"),

  serverForgeInstallAtPath: (folderPath) => {
    if (!isString(folderPath) || !folderPath.trim()) throw new Error("serverForgeInstallAtPath: folderPath is empty");
    return ipcRenderer.invoke("server:forgeInstall:atPath", folderPath.trim());
  },

  // setup.bat を起動（別ウィンドウ、インタラクティブ）
  serverSetup: () => ipcRenderer.invoke("server:setup"),

  // RCONパスワード.txt を読み込む
  serverRconPasswordRead: () => ipcRenderer.invoke("server:rconpassword:read"),

  // フォルダ選択ダイアログを開く
  dialogPickFolder: (title) => ipcRenderer.invoke("dialog:pickFolder", title || ""),

  // ファイル選択ダイアログを開く（ランチャーの場所指定など）
  dialogPickFile: (options) => ipcRenderer.invoke("dialog:pickFile", isPlainObject(options) ? options : {}),

  folderOpen: (folderPath) => {
    if (!isString(folderPath) || !folderPath.trim()) throw new Error("folderOpen: folderPath is empty");
    return ipcRenderer.invoke("folder:open", folderPath.trim());
  },

  // 任意フォルダの setup.bat を実行
  serverSetupAtPath: (folderPath) => {
    if (!isString(folderPath) || !folderPath.trim()) throw new Error("serverSetupAtPath: folderPath is empty");
    return ipcRenderer.invoke("server:setup:atPath", folderPath.trim());
  },

  // --------------------
  // GiftsViewer 統合（gv プレフィックス）
  // --------------------
  gvGiftsRead: () => ipcRenderer.invoke("gv:gifts:read"),

  gvGiftsUpdate: (username) => {
    const u = normalizeUsername(username);
    if (!u) throw new Error("gvGiftsUpdate: username is empty");
    return ipcRenderer.invoke("gv:gifts:update", u);
  },

  gvGiftsOpenFolder: () => ipcRenderer.invoke("gv:gifts:openFolder"),
  gvGiftsOpenHtml: () => ipcRenderer.invoke("gv:gifts:openHtml"),

  gvGiftsFetchImageBase64: (url) => {
    if (!isString(url) || !url.startsWith("http")) throw new Error("gvGiftsFetchImageBase64: invalid url");
    return ipcRenderer.invoke("gv:gifts:fetchImageBase64", url);
  },

  gvGiftsCopyPngDataUrl: (dataUrl) => {
    if (!isString(dataUrl)) throw new Error("gvGiftsCopyPngDataUrl: invalid dataUrl");
    return ipcRenderer.invoke("gv:gifts:copyPngDataUrl", dataUrl);
  },

  gvSettingsRead: () => ipcRenderer.invoke("gv:settings:read"),

  gvSettingsWrite: (v) => {
    if (!isPlainObject(v)) throw new Error("gvSettingsWrite: v must be an object");
    return ipcRenderer.invoke("gv:settings:write", v);
  },

  // --------------------
  // TTS (読み上げ)
  // --------------------
  ttsSettingsRead: () => ipcRenderer.invoke("tts:settings:read"),

  ttsSettingsWrite: (s) => {
    if (!isPlainObject(s)) throw new Error("ttsSettingsWrite: s must be an object");
    return ipcRenderer.invoke("tts:settings:write", s);
  },

  ttsCheckEngine: (engine) => {
    if (!isString(engine)) throw new Error("ttsCheckEngine: engine must be a string");
    return ipcRenderer.invoke("tts:checkEngine", engine);
  },

  ttsGetSpeakers: (engine) => {
    if (!isString(engine)) throw new Error("ttsGetSpeakers: engine must be a string");
    return ipcRenderer.invoke("tts:getSpeakers", engine);
  },

  ttsLaunchEngine: (engine) => {
    if (!isString(engine)) throw new Error("ttsLaunchEngine: engine must be a string");
    return ipcRenderer.invoke("tts:launchEngine", engine);
  },

  ttsTest: (settings) => {
    if (!isPlainObject(settings)) throw new Error("ttsTest: settings must be an object");
    return ipcRenderer.invoke("tts:test", settings);
  },

  // --------------------
  // 運営ログイン認証
  // --------------------
  authStatus: () => ipcRenderer.invoke("auth:status"),

  authLogin: (payload) => {
    if (!isPlainObject(payload)) throw new Error("authLogin: payload must be an object");
    return ipcRenderer.invoke("auth:login", payload);
  },

  authLogout: () => ipcRenderer.invoke("auth:logout"),

  // --------------------
  // App config
  // --------------------
  appConfigRead: () => ipcRenderer.invoke("app:config:read"),

  appConfigWrite: (data) => {
    if (!isPlainObject(data)) throw new Error("appConfigWrite: data must be an object");
    return ipcRenderer.invoke("app:config:write", data);
  },

  // --------------------
  // セットアップ支援
  // --------------------
  serverCopyTemplate: (targetFolder) => {
    if (!isString(targetFolder) || !targetFolder.trim()) throw new Error("serverCopyTemplate: targetFolder is empty");
    return ipcRenderer.invoke("server:copyTemplate", targetFolder.trim());
  },
  serverCopyTemplateStatus: () => ipcRenderer.invoke("server:copyTemplateStatus"),

  serverCheckSetupComplete: () => ipcRenderer.invoke("server:checkSetupComplete"),

  // haihu_world/ 内のサブフォルダ一覧を返す
  serverWorldsList: () => ipcRenderer.invoke("server:worlds:list"),

  // bridge/commands/minecraft/ 内の .txt ファイル一覧
  bridgeCommandsList: () => ipcRenderer.invoke("bridge:commands:list"),

  // bridge/commands/minecraft/ の TITLE + CATEGORY メタ情報一覧
  bridgeCommandsReadMeta: () => ipcRenderer.invoke("bridge:commands:readMeta"),

  // bridge/commands/minecraft/ にTXTを書き込む
  bridgeCommandsWrite: ({ filename, content }) => {
    if (!isString(filename) || !filename.endsWith(".txt")) throw new Error("bridgeCommandsWrite: invalid filename");
    if (!isString(content)) throw new Error("bridgeCommandsWrite: content must be a string");
    return ipcRenderer.invoke("bridge:commands:write", { filename, content });
  },

  // bridge/commands/minecraft/ をエクスプローラーで開く
  bridgeCommandsOpenFolder: () => ipcRenderer.invoke("bridge:commands:openFolder"),

  // ゲームルール一括適用（RCON経由）
  serverGamerulesApply: () => ipcRenderer.invoke("server:gamerules:apply"),

  // 暗視データパックを現在ワールドに展開
  serverDatapackDeployNightVision: () => ipcRenderer.invoke("server:datapack:deployNightVision"),
});
