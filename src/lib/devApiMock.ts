import pkg from "../../package.json";
import miningPack from "../../game-packs/saikutu/game.json";
// ゲームの一覧はアプリ・BRIDGE と同じ bridge/games.json（処理のコピー PR6）。
import GAMES from "../../bridge/games.json";
import { normalizeTikTokId, tiktokIdProblem } from "./tiktokId";
import TTS_SETTINGS from "../../bridge/tts_settings.json";

// 開発用の表示の TikTok ID の確かめ（設定の確かめと同じ文）。
function mockTikTokIdProblem(next: any): string {
  return !normalizeTikTokId(next?.tiktokUsername)
    ? "TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。ダッシュボードでIDを入力して承認してください"
    : tiktokIdProblem(next?.tiktokUsername);
}

// ゲームパックのゲームのコマンド（game_<id>_）か。アプリの bridge/game_commands.cjs の gameOfCommand と同じく、一覧から作り、大文字小文字を区別しない。
const packGamePrefix = new RegExp(`^game_(${GAMES.filter(game => game.id !== "common").map(game => game.id).join("|")})_`, "i");

type DevAppConfig = {
  serverFolder: string;
  setupComplete: boolean;
  setupRequiredByInstall?: boolean;
};

const win = window as typeof window & { mygamepack?: Record<string, (...args: any[]) => Promise<any>> };

if (import.meta.env.DEV && !win.mygamepack) {
  const DEV_APP_CONFIG_KEY = "mygamepack_dev_app_config_v2";
  const defaultServerFolder = "D:\\MyGamePack-Test-Server";
  let appConfig: DevAppConfig = {
    serverFolder: defaultServerFolder,
    setupComplete: new URLSearchParams(window.location.search).get("setup") !== "first",
    setupRequiredByInstall: true,
  };
  try {
    appConfig = { ...appConfig, ...JSON.parse(localStorage.getItem(DEV_APP_CONFIG_KEY) || "{}") };
  } catch { /* ignore */ }

  let bridgeConfig: any = {
    tiktokUsername: "test_streamer",
    rcon: { host: "127.0.0.1", port: 25575, password: "test-password" },
    mappings: [],
    likeEvents: [
      { threshold: 10, label: "10いいね", commandFile: "cod.txt", repeat: 1, enabled: true },
      { threshold: 50, label: "50いいね", commandFile: "zombie.txt", repeat: 1, enabled: true },
      { threshold: 100, label: "100いいね", commandFile: "tnt.txt", repeat: 1, enabled: true },
    ],
    unmappedGiftEvent: { commandFile: "skeleton.txt", repeat: 1, enabled: true },
    followEvent: { commandFile: "creeper.txt", repeat: 1, enabled: true },
    shareEvent: { commandFile: "slime.txt", repeat: 1, enabled: true },
    memberEvent: { commandFile: "villager.txt", repeat: 1, enabled: true },
    options: {
      giftCooldownMs: 300,
      likeBatchWindowMs: 1200,
      maxLikeCatchUpPerEvent: 5,
      maxCommandsPerGift: 200,
      gameplay: { combo: { windowMs: 10000, levels: [] } },
    },
  };

  // 実カタログは開発サーバーの /__dev/gifts/read から取得する。
  // GiftsViewer/data は実行時生成物でgit管理外のため、clean cloneでは空配列にフォールバックする。
  const catalog: Array<{ id: number; name: string; diamond_count: number; image?: string | null }> = [];
  const readDevGifts = async () => {
    try {
      const response = await fetch("/__dev/gifts/read", { cache: "no-store" });
      if (response.ok) return response.json();
    } catch { /* fallback below */ }
    return {
      gifts: catalog,
      meta: { generatedAt: now, username: "test_streamer", count: catalog.length },
      exists: true,
    };
  };
  const readDevCommands = async () => {
    try {
      const response = await fetch("/__dev/commands/minecraft", { cache: "no-store" });
      if (response.ok) {
        const commands = await response.json();
        if (!previewModsApplied) return [];
        const common = commands.filter((item: any) => !item.name.startsWith("_") && !packGamePrefix.test(item.name) && !miningPack.commands.some(command => item.name === command.key + ".txt"));
        return previewActiveGame === "saikutu" ? [...common, ...miningPack.commands.map(command => ({ name: `game_saikutu_${command.key}.txt`, title: command.title, category: "saikutuMOD", chatKey: command.key }))] : common;
      }
    } catch { /* ignore */ }
    return [];
  };
  const readDevWorlds = async () => {
    try {
      const response = await fetch(`/__dev/worlds/list?root=${encodeURIComponent(appConfig.serverFolder || "")}`, { cache: "no-store" });
      if (response.ok) return response.json();
    } catch { /* ignore */ }
    return [];
  };
  const readDevServerProps = async () => {
    try {
      const response = await fetch(`/__dev/server/props/read?root=${encodeURIComponent(appConfig.serverFolder || "")}`, { cache: "no-store" });
      if (response.ok) return response.json();
    } catch { /* ignore */ }
    return { "level-name": "haihu_world/sakura", "enable-command-block": "true" };
  };

  const ok = async () => ({ ok: true as const });
  const now = new Date().toISOString();
  let devServerRunning = false;
  let devBridgeRunning = false;
  let devAuthState = true;
  const devBridgeLogs: string[] = [
    `[${new Date().toLocaleTimeString("ja-JP")}] [BRIDGE] 開発モードで待機中`,
  ];
  const addBridgeLog = (message: string) => {
    devBridgeLogs.push(`[${new Date().toLocaleTimeString("ja-JP")}] ${message}`);
    if (devBridgeLogs.length > 120) devBridgeLogs.splice(0, devBridgeLogs.length - 120);
  };
  type TtsEngine = "voicevox" | "aivis";
  type TtsSettings = {
    engine: TtsEngine;
    speakerId: number;
    speedScale: number;
    pitchScale: number;
    intonationScale: number;
    volume: number;
    enabled: boolean;
    commentEnabled: boolean;
    giftEnabled: boolean;
    giftTemplate: string;
  };
  const ttsProxyBase: Record<TtsEngine, string> = {
    voicevox: "/__tts/voicevox",
    aivis: "/__tts/aivis",
  };
  // 既定値はアプリ・BRIDGE と同じ表（bridge/tts_settings.json。処理のコピー PR9。前は話者 3・速さ 1・抑揚 1.5 と違っていた）。
  let ttsSettings: TtsSettings = { ...TTS_SETTINGS.defaults, engine: TTS_SETTINGS.defaults.engine === "aivis" ? "aivis" : "voicevox" };

  const ttsFetch = (engine: TtsEngine, requestPath: string, init?: RequestInit) => {
    return fetch(`${ttsProxyBase[engine]}${requestPath}`, {
      ...init,
      cache: "no-store",
    });
  };

  const ttsCheck = async (engine: TtsEngine) => {
    try {
      const response = await ttsFetch(engine, "/version");
      return response.ok;
    } catch {
      return false;
    }
  };

  const flattenSpeakers = (rawSpeakers: any[]) => {
    const list: Array<{ id: number; label: string }> = [];
    for (const speaker of Array.isArray(rawSpeakers) ? rawSpeakers : []) {
      for (const style of Array.isArray(speaker?.styles) ? speaker.styles : []) {
        list.push({ id: Number(style.id), label: `${speaker.name}（${style.name}）` });
      }
    }
    return list.filter((speaker) => Number.isFinite(speaker.id));
  };

  const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  };
  const devHistoryStart = Date.now() - 20 * 60 * 1000;
  const devHistoryRows = [
    { at: new Date(devHistoryStart + 19 * 60 * 1000).toISOString(), type: "gift", sender: "sakura", commandFile: "creeper.txt", count: 1, ok: true },
    { at: new Date(devHistoryStart + 12 * 60 * 1000).toISOString(), type: "like", sender: "sakura", commandFile: "cod.txt", count: 10, ok: true },
    { at: new Date(devHistoryStart + 8 * 60 * 1000).toISOString(), type: "share", sender: "yuki", commandFile: "slime.txt", count: 1, ok: true },
    { at: new Date(devHistoryStart + 3 * 60 * 1000).toISOString(), type: "member", sender: "kai", commandFile: "villager.txt", count: 1, ok: true },
  ].reverse(); // 新しい順（本物のoperations-history.jsonと同じ並び）
  const streamStats = {
    gapMinutes: 90,
    overall: { streams: 1, events: devHistoryRows.length, gift: 1, like: 10, share: 1, follow: 0, member: 1, other: 0, succeeded: devHistoryRows.length, failed: 0 },
    streams: [{
      received: null, earnings: null,
      id: "preview-stream", source: "estimated", recorded: false, viewerSamples: 0,
      start: new Date(devHistoryStart).toISOString(),
      end: now,
      durationMs: Date.now() - devHistoryStart,
      events: devHistoryRows.length,
      gift: 1,
      like: 10,
      share: 1,
      follow: 0,
      member: 1,
      other: 0,
      succeeded: devHistoryRows.length,
      failed: 0,
      uniqueSenders: 3,
      topCommands: [{ name: "creeper.txt", count: 1 }],
      topSenders: [{ name: "sakura", count: 11 }],
    }],
  };

  // Folder fixtures are only used by the browser preview. Native discovery runs in Electron.
  const previewMinecraftFolders = [
    { path: 'C:\\Users\\Demo\\AppData\\Roaming\\.minecraft', sources: ['標準の保存先'], profiles: [{ name: 'forge', version: '1.20.1-forge-47.4.10' }], exists: true, selectable: true, recommended: true },
    { path: 'D:\\Minecraft\\配信用の採掘', sources: ['ランチャーの起動構成'], profiles: [{ name: '採掘の配信', version: '1.20.1-forge-47.4.10' }], exists: true, selectable: true, recommended: true },
    { path: 'D:\\Minecraft\\以前のワールド', sources: ['ランチャーの起動構成'], profiles: [{ name: '以前の構成', version: 'fabric-loader-0.16.10-1.21' }], exists: false, selectable: false, recommended: false, reason: 'フォルダーがありません。ランチャーの保存先を確認してください。' },
  ];
  let previewClientFolder = previewMinecraftFolders[0].path;
  let previewActiveGame = 'common';
  let previewModsApplied = false;
  const previewProfiles: Record<string, any> = {};
  const previewProfileKeys = ['mappings', 'likeEvents', 'unmappedGiftEvent', 'shareEvent', 'followEvent', 'memberEvent', 'roulette', 'deathRoulette', 'commentGifts'];
  const previewGameStatus = () => ({ active: previewActiveGame, applied: previewModsApplied, displayBundled: true, recoveryRequired: false,
    serverMods: appConfig.serverFolder + '\\mods', clientMods: previewClientFolder + '\\mods',
    games: GAMES.map(game => ({ ...game, installed: game.id === 'common' || game.id === 'saikutu' })) });
  win.mygamepack = {
    gamesList: async () => previewGameStatus(),
    gamesClientFolders: async () => ({ candidates: previewMinecraftFolders.map(folder => ({ ...folder, modsPath: folder.path + '\\mods', current: folder.path === previewClientFolder })), warnings: [] }),
    gamesSelectClientFolder: async (folder: string) => {
      if (!previewMinecraftFolders.some(candidate => candidate.path === folder && candidate.selectable)) throw new Error('候補を再検索してください。');
      previewClientFolder = folder; previewModsApplied = false; return previewGameStatus();
    },
    gamesActivate: async (id: string) => {
      if (!previewGameStatus().games.some(game => game.id === id && game.installed)) throw new Error('ゲームパックを登録してください。');
      previewProfiles[previewActiveGame] = Object.fromEntries(previewProfileKeys.map(key => [key, structuredClone(bridgeConfig[key])]));
      for (const key of previewProfileKeys) delete bridgeConfig[key];
      Object.assign(bridgeConfig, structuredClone(previewProfiles[id] || { mappings: [], likeEvents: [] }), { gameProfile: id });
      previewActiveGame = id; previewModsApplied = true; return previewGameStatus();
    },
    gamesRecover: async () => previewGameStatus(),
    gamesRefreshMods: async () => previewGameStatus(),
    gamesInstall: async () => { throw new Error('ゲームパックの登録はアプリで利用できます。'); },
    gamesClientFolder: async () => { throw new Error('手動のフォルダー選択はアプリで利用できます。'); },

    clipboardWriteText: async (text: string) => {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    },
    giftPanelSavePng: async (dataUrl: string, filename: string) => {
      const a = document.createElement('a'); a.href = dataUrl; a.download = filename; a.click();
      return { canceled: false };
    },
    streamSessionStatus: async () => ({ active: null, monitoring: false, error: '' }),
    streamSessionStart: async (title: string) => {
      const existing = JSON.parse(localStorage.getItem('dev-stream-session') || 'null');
      if (existing) return existing;
      const session = { id: crypto.randomUUID(), title, startedAt: new Date().toISOString(), endedAt: null };
      localStorage.setItem('dev-stream-session', JSON.stringify(session)); return session;
    },
    streamSessionEnd: async (_id: string, endedAt?: string) => {
      const session = JSON.parse(localStorage.getItem('dev-stream-session') || 'null');
      if (!session) throw new Error('配信記録がありません。');
      localStorage.removeItem('dev-stream-session'); return { ...session, endedAt: endedAt || new Date().toISOString() };
    },
    windowMinimize: ok,
    windowMaximizeToggle: ok,
    windowClose: ok,
    preflightRun: async () => ({ checkedAt: new Date().toISOString(), checks: [{ id: "preview", title: "ブラウザープレビュー", status: "warn", detail: "実際の配信前チェックはインストール版で実行してください。", page: "dashboard" }] }),
    settingsBackupsList: async () => [],
    settingsBackupCreate: async () => { throw new Error("バックアップはインストール版で利用できます。"); },
    settingsBackupRestore: async () => { throw new Error("復元はインストール版で利用できます。"); },
    appConfigRead: async () => ({ ...appConfig }),
    appConfigWrite: async (patch: Partial<DevAppConfig>) => {
      appConfig = { ...appConfig, ...patch };
      localStorage.setItem(DEV_APP_CONFIG_KEY, JSON.stringify(appConfig));
      return { ok: true };
    },
    dialogPickFolder: async () => {
      // 開発ブラウザーにネイティブフォルダ選択は存在しない。window.prompt()はUXが悪く
      // 「手入力しろと言われた」という誤解を生むため、呼び出し元(handlePickFolder)の
      // 手入力フォールバックへ即座に委ねる。
      throw new Error("開発ブラウザーではネイティブのフォルダ選択ダイアログを利用できません");
    },
    serverCheckSetupComplete: async () => ({ complete: true, dir: appConfig.serverFolder || defaultServerFolder }),
    serverCopyTemplate: async (targetFolder: string) => {
      appConfig = { ...appConfig, serverFolder: targetFolder || appConfig.serverFolder };
      localStorage.setItem(DEV_APP_CONFIG_KEY, JSON.stringify(appConfig));
      addBridgeLog(`[SETUP] テンプレート確認: ${appConfig.serverFolder}`);
      return { ok: true };
    },
    serverCopyTemplateStatus: async () => ({ state: "done", copied: 1, total: 1, error: "" }),
    serverForgeClientStatus: async () => ({ installed: true, version: "1.20.1-47.4.10", launcherReady: true }),
    serverSetupStatus: async () => ({ state: "done", message: "環境構築が完了しました。配信ワールド: haihu_world/world" }),
    serverForgeInstallAtPath: async (targetFolder: string) => {
      addBridgeLog(`[SETUP] Forgeインストーラー起動: ${targetFolder}`);
      return { ok: true };
    },
    serverSetup: ok,
    serverSetupAtPath: async (targetFolder: string) => {
      appConfig = { ...appConfig, serverFolder: targetFolder || appConfig.serverFolder };
      localStorage.setItem(DEV_APP_CONFIG_KEY, JSON.stringify(appConfig));
      addBridgeLog(`[SETUP] 環境構築完了: ${appConfig.serverFolder}`);
      return { ok: true };
    },
    bridgeExtractTo: ok,
    folderOpen: async (targetPath: string) => {
      try {
        const response = await fetch(`/__dev/folder/open?path=${encodeURIComponent(targetPath)}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({ ok: true, path: targetPath, devOnly: true }));
        if (!result.ok) throw new Error(result.message);
        return result;
      } catch {
        return { ok: true, path: targetPath, devOnly: true };
      }
    },
    serverPropsRead: readDevServerProps,
    serverPropsWrite: async (updates: Record<string, string>) => {
      const response = await fetch("/__dev/server/props/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: appConfig.serverFolder, updates }),
      });
      const result = await response.json().catch(() => ({ ok: false, message: "server.propertiesを書き込めませんでした" }));
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    serverWorldsList: readDevWorlds,
    serverRconPasswordRead: async () => ({ found: true, password: "test-password" }),
    serverStart: async () => {
      devServerRunning = true;
      addBridgeLog("[FORGE] 開発モード: serverStart");
      return { ok: true, backup: { ok: true, message: "バックアップ完了: world-dev.zip（模擬）" } };
    },
    serverStop: async () => {
      devServerRunning = false;
      addBridgeLog("[FORGE] 開発モード: serverStop");
      return { ok: true, graceful: true };
    },
    serverLogs: async () => ({
      ok: true,
      lines: devServerRunning
        ? ["[12:00:00] [SERVER] 開発モード: Forgeサーバーログの表示例", "[12:00:01] Done (3.2s)! For help, type \"help\""]
        : [],
    }),
    serverProcessStatus: async () => ({ running: devServerRunning, pid: devServerRunning ? 4321 : null }),
    serverCommand: async (command: string) => {
      if (!devServerRunning) throw new Error("Minecraftサーバーが起動していません");
      addBridgeLog(`[FORGE] 開発モード: コマンド送信 > ${command}`);
      return { ok: true };
    },
    minecraftStatus: async () => ({ running: devServerRunning, processes: devServerRunning ? ["javaw.exe"] : [] }),
    dialogPickFile: async () => {
      throw new Error("開発ブラウザーではネイティブのファイル選択ダイアログを利用できません");
    },
    bridgeLaunch: async () => {
      devBridgeRunning = true;
      addBridgeLog(`[BRIDGE] 開発モード: @${bridgeConfig.tiktokUsername || "test_streamer"} で起動`);
      return { ok: true };
    },
    bridgeStop: async () => {
      devBridgeRunning = false;
      addBridgeLog("[BRIDGE] 開発モード: 停止");
      return { ok: true };
    },
    bridgeRestart: async () => {
      addBridgeLog("[BRIDGE] 開発モード: 再起動中…");
      devBridgeRunning = false;
      addBridgeLog("[BRIDGE] 開発モード: 停止");
      devBridgeRunning = true;
      addBridgeLog(`[BRIDGE] 開発モード: @${bridgeConfig.tiktokUsername || "test_streamer"} で起動`);
      return { ok: true };
    },
    minecraftLaunch: async () => {
      addBridgeLog("[MINECRAFT] 開発モード: ランチャー起動要求");
      return { ok: true };
    },
    serverGamerulesApply: ok,
    serverDatapackDeployNightVision: ok,
    eulerStatus: async () => ({ configured: false, storageAvailable: false, restartRequired: false, error: 'APIキーの保存はインストール版アプリで利用できます。' }),
    eulerSave: async () => { throw new Error('インストール版アプリで設定してください。'); },
    eulerClear: async () => ({ configured: false, storageAvailable: false, restartRequired: false }),
    eulerOpenPortal: async () => { window.open('https://www.eulerstream.com/dashboard', '_blank', 'noopener,noreferrer'); },
    configRead: async () => {
      // Explicit visual QA fixture; never enabled in packaged Electron or written to a server.
      if (new URLSearchParams(window.location.search).get("demo") === "panels" && !bridgeConfig.mappings.length) {
        const data = await readDevGifts();
        const samples = [
          ["7934", "zombie.txt", 20], ["6090", "flood.txt", 1], ["5655", "heal.txt", 1],
          ["5658", "villager.txt", 5], ["6097", "tnt.txt", 1], ["6064", "skeleton.txt", 10],
          ["5269", "superjump.txt", 1], ["5585", "meteorshower.txt", 1], ["5586", "goldapple.txt", 3],
          ["5660", "iceage.txt", 1], ["5487", "lovedog.txt", 1], ["6544", "daiyasoubi.txt", 1],
        ];
        bridgeConfig.mappings = samples.map(([id, commandFile, repeat]) => ({
          giftId: id, name: data.gifts.find((gift: any) => String(gift.id) === id)?.name || id, commandFile, repeat,
        }));
      }
      return structuredClone(bridgeConfig);
    },
    giftTemplateSave: async () => {
      if (!bridgeConfig.mappings.length) throw new Error("保存するギフト設定がありません。");
      const mappings = bridgeConfig.mappings.map((row: any) => ({ giftId: String(row.giftId), name: row.name || String(row.giftId), commandFile: row.commandFile, repeat: row.repeat ?? 1 }));
      const name = 'ギフト設定';
      const data = { format: 'mygamepack-gift-template', version: 1, name, appVersion: pkg.version, createdAt: new Date().toISOString(), mappings };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = name + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { canceled: false, name, count: mappings.length };
    },
    giftTemplateOpen: async () => {
      // Native file handling and strict import validation are covered in Electron.
      // Browser previews must never pretend to have read/applied a local file.
      throw new Error("テンプレートのファイル読込はデスクトップ版で確認してください。");
    },
    giftTemplateApply: async () => { throw new Error("先にデスクトップ版でテンプレートを読み込んでください。"); },
    giftTemplateCancel: async () => {},
    configGiftMappingSave: async (request: any) => {
      const matches = bridgeConfig.mappings.filter((row: any) => String(row.giftId) === request.giftId);
      if (JSON.stringify(matches) !== JSON.stringify(request.expected)) throw new Error("このギフトの設定が別の操作で変更されました。閉じて開き直してください。");
      if (matches.length > 1) throw new Error("このギフトが重複登録されています。");
      const commands = await readDevCommands();
      if (!commands.some((command: any) => command.name === request.commandFile) || !Number.isInteger(request.repeat) || request.repeat < 1 || request.repeat > 100) throw new Error("コマンドと回数を確認してください。");
      const updated = { ...matches[0], giftId: request.giftId, name: request.name, commandFile: request.commandFile, repeat: request.repeat };
      bridgeConfig.mappings = matches.length ? bridgeConfig.mappings.map((row: any) => String(row.giftId) === request.giftId ? updated : row) : [...bridgeConfig.mappings, updated];
      return { ok: true, mappings: structuredClone(bridgeConfig.mappings) };
    },
    // 承認（configWrite）でも TikTok ID を確かめる（アプリの config:write と同じく、通らなければ保存しない。PR9 の最後のレビュー）。
    configWrite: async (next: any) => {
      const problem = mockTikTokIdProblem(next);
      if (problem) throw new Error(problem);
      bridgeConfig = structuredClone(next);
      return { ok: true };
    },
    configPath: async () => "config.minecraft.json（開発ブラウザーでは実パスなし）",
    // TikTok ID だけはアプリと同じ決まりで確かめる（src/lib/tiktokId.ts。処理のコピー PR9）。前は何でも ok だった。
    configValidate: async (next: any) => {
      const problem = mockTikTokIdProblem(next);
      return problem ? { ok: false, errors: [problem], warnings: [] } : { ok: true, errors: [], warnings: [] };
    },
    bridgeCommandsList: readDevCommands,
    bridgeCommandsReadMeta: readDevCommands,
    bridgeCommandsWrite: ok,
    // 確かめはアプリと同じ bridge/command_rows.cjs（vite.config.ts の /__dev/commands/check。処理のコピー PR8）。
    bridgeCommandsCheck: async (request: { filename: string; content: string }) => {
      const response = await fetch("/__dev/commands/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const body = await response.json().catch(() => null);
      // 失敗の理由（vite.config.ts の返す message）を捨てない（PR8 の最後のレビュー）。
      if (!response.ok) throw new Error(body?.message || "TXT の確かめに失敗しました（開発用）");
      return body;
    },
    bridgeCommandsOpenFolder: ok,
    giftsRead: readDevGifts,
    giftsUpdate: ok,
    giftsOpenFolder: ok,
    giftsOpenHtml: ok,
    gvGiftsRead: readDevGifts,
    gvGiftsUpdate: ok,
    gvSettingsRead: async () => ({ username: "test_streamer" }),
    gvSettingsWrite: ok,
    gvGiftsOpenFolder: ok,
    gvGiftsOpenHtml: ok,
    gvGiftsCopyPngDataUrl: async (dataUrl: string) => {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        if ("ClipboardItem" in window && navigator.clipboard?.write) {
          await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
          return { ok: true };
        }
        await navigator.clipboard.writeText(dataUrl);
        return { ok: true, fallback: "text" };
      } catch (error: any) {
        throw new Error(error?.message ?? String(error));
      }
    },
    gvGiftsFetchImageBase64: async (url: string) => {
      const response = await fetch(`/__dev/image/base64?url=${encodeURIComponent(url)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({ ok: false, message: "画像を取得できませんでした" }));
      if (!result.ok) throw new Error(result.message);
      return result.dataUrl;
    },
    ttsSettingsRead: async () => structuredClone(ttsSettings),
    ttsSettingsWrite: async (next: TtsSettings) => {
      ttsSettings = structuredClone(next);
      return { ok: true };
    },
    ttsCheckEngine: async (engine: TtsEngine) => ttsCheck(engine),
    ttsGetSpeakers: async (engine: TtsEngine) => {
      const response = await ttsFetch(engine, "/speakers");
      if (!response.ok) return [];
      return flattenSpeakers(await response.json());
    },
    ttsLaunchEngine: async (engine: TtsEngine) => {
      const response = await fetch(`/__tts/launch/${engine}`, { method: "POST", cache: "no-store" });
      const result = await response.json().catch(() => ({ ok: false, message: "起動結果を読み取れませんでした" }));
      return result;
    },
    ttsTest: async (settings: TtsSettings & { testText?: string }) => {
      if (!await ttsCheck(settings.engine)) {
        return { ok: false, message: `${settings.engine === "voicevox" ? "VOICEVOX" : "AivisSpeech"} が起動していません` };
      }
      const list = await win.mygamepack!.ttsGetSpeakers(settings.engine);
      if (!list.some((speaker) => speaker.id === settings.speakerId)) {
        return { ok: false, message: "選択中のボイスがこのエンジンの一覧にありません" };
      }
      const text = encodeURIComponent((settings.testText || "テスト再生。こんにちは！").trim());
      const audioQueryResponse = await ttsFetch(settings.engine, `/audio_query?speaker=${settings.speakerId}&text=${text}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "",
      });
      if (!audioQueryResponse.ok) {
        return { ok: false, message: `audio_query失敗: ${audioQueryResponse.status}` };
      }
      const query = await audioQueryResponse.json();
      query.speedScale = settings.speedScale;
      query.pitchScale = settings.pitchScale;
      query.intonationScale = settings.intonationScale;
      // 音量もエンジンに入れる（画面の再生では掛けない。アプリの bridge/tts_settings.cjs の applyVoiceSettings と同じ。PR9 の最後のレビュー）。
      query.volumeScale = settings.volume;
      const synthesisResponse = await ttsFetch(settings.engine, `/synthesis?speaker=${settings.speakerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });
      if (!synthesisResponse.ok) {
        return { ok: false, message: `synthesis失敗: ${synthesisResponse.status}` };
      }
      return { ok: true, base64: arrayBufferToBase64(await synthesisResponse.arrayBuffer()) };
    },
    modStatus: async () => ({ online: false, gift: 0, like: 0, other: 0, executed: 0, failed: 1, protectedSkips: 0 }),
    operationsHistory: async () => [...devHistoryRows],
    operationsStats: async () => ({ total: 0, succeeded: 0, failed: 0, topCommands: [], topSenders: [] }),
    operationsHistoryClear: ok,
    operationsEarningsSave: async () => ({ ok: true }),
    operationsStreamStats: async (gapMinutes: number) => ({ ...streamStats, gapMinutes }),
    testEvent: async () => ({ ok: false, message: '実際のイベントテストはインストール版で利用してください。' }),
    minecraftGrantOp: async () => ({ ok: true, name: "dev_player" }),
    // 認証: devプレビューではログイン済み扱い。authLogout→authLoginでログイン画面の動作確認可
    authStatus: async () => ({ authenticated: devAuthState, email: devAuthState ? "dev@example.com" : "" }),
    authLogin: async (payload: { email: string; password: string }) => {
      if (!payload?.email || !payload?.password) return { ok: false, message: "メールアドレスとパスワードを入力してください" };
      devAuthState = true;
      return { ok: true, email: payload.email };
    },
    authLogout: async () => {
      devAuthState = false;
      return { ok: true as const };
    },
    worldBackup: ok,
    worldSavesList: async () => ({ world: 'haihu_world/world', busy: false, recoveryPending: false, saves: [] }),
    worldSavesSave: async () => { throw new Error('MAPの保存はインストール版で利用できます。'); },
    worldSavesLoad: async () => { throw new Error('MAPの読込はインストール版で利用できます。'); },
    operationsStatsExport: async () => { throw new Error('配信統計の書き出しはインストール版で利用できます。'); },
    presetsList: async () => ["配信用"],
    presetsSave: ok,
    presetsLoad: async () => ({ ok: true }),
    updaterStatus: async () => ({ state: "manual", version: pkg.version }),
    updaterCheck: async () => ({ state: "manual", version: pkg.version }),
    updaterInstall: async () => ({ ok: false, state: "manual" }),
    bridgeProcessStatus: async () => ({
      running: devBridgeRunning,
      state: devBridgeRunning ? "running" : "stopped",
      pid: devBridgeRunning ? 5175 : null,
      restartCount: 0,
      cpuPercent: devBridgeRunning ? 2 + (Date.now() % 7) : 0,
      memMb: devBridgeRunning ? 38 + (Date.now() % 11) : 0,
      serverRunning: devServerRunning,
    }),
    bridgeLogs: async () => ({ ok: true, lines: [...devBridgeLogs] }),
    bridgeSyncStatus: async () => ({ state: "complete", phase: "ready" }),
    appVersion: async () => String((pkg as { version?: string }).version || "0.0.0"),
    setupInspectEnvironment: async () => ({
      forge: { detected: true, version: "開発モード: 未実測" },
      minecraft: { detected: true, version: "開発モード: 未実測" },
      java: { detected: true, version: "開発モード: 未実測" },
      bridge: { detected: true, version: String((pkg as { version?: string }).version || "0.0.0") },
      bridgeMod: { detected: true, version: "開発モード: 未実測" },
      tiktokApi: { detected: false, version: "開発モード: 未実測" },
    }),
  };
}

export {};
