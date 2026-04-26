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

  // --------------------
  // Bridge (A方式: 同梱) 起動 / パス確認
  // --------------------
  bridgeStart: () => ipcRenderer.invoke("bridge:start"),

  // main.cjs は "bridge:root" を実装してるので、preload側も合わせる
  bridgeRoot: () => ipcRenderer.invoke("bridge:root"),

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

  // run.bat を起動（別ウィンドウ）
  serverStart: () => ipcRenderer.invoke("server:start"),

  // サーバー停止
  serverStop: () => ipcRenderer.invoke("server:stop"),

  // bridge起動.bat を起動（別ウィンドウ）
  bridgeLaunch: () => ipcRenderer.invoke("bridge:launch"),

  // Bridge 停止
  bridgeStop: () => ipcRenderer.invoke("bridge:stop"),

  // Minecraft ランチャー起動
  minecraftLaunch: () => ipcRenderer.invoke("minecraft:launch"),

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