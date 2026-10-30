// src/types/electron.d.ts
export {};
// アプリの設定（app-config.json）の既定値と項目の型の表（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.1）。
// fields の値は型の見本（文字列は ""、真偽は false）。画面が書ける項目の名前は、表の rendererWritable と同じ
// （JSON の配列からは型の名前を取り出せないので、ここにも並べる。食い違えば electron/test/app-config-module.test.cjs が落ちる）。
type AppConfigTable = typeof import("../../electron/app_config_fields.json");
export type AppConfigFields = AppConfigTable["fields"];
type AppConfigWritableKey = "serverFolder" | "setupComplete" | "setupRequiredByInstall" | "minecraftPlayerName" | "minecraftLauncherPath" | "autoBackupOnServerStart";
export type GameStatus = {
  saikutuMigrationNeeded?: boolean; active: string; applied: boolean; displayBundled: boolean;
  // アプリの更新に合わせて MOD を入れ替えられず、古いままのとき（2026-10-13）。
  modsOutdatedAfterUpdate?: boolean; modsRefreshError?: string;
  serverMods: string; clientMods: string; recoveryRequired: boolean;
  // 「マップを初期化」を出せるか（専用マップだけを使うゲームか、今のワールドがそのゲームの専用マップのとき。2026-10-30）。
  mapResettable?: boolean;
  // maps：初期マップ（あれば TOP に「マップを初期化」を出す）。resetMapOnSwitch：ほかのゲームから切り替えたときにマップを初期に戻す（埋め立て）。
  // selectable：false なら配信ホームの選択肢に出さない（サバイバル。2026-10-29）。bridge/games.json のまま届く。
  games: { id: string; name: string; modName: string; installed: boolean; maps?: string[]; resetMapOnSwitch?: boolean; selectable?: boolean; preparing?: boolean }[];
};
export type MinecraftLocationCandidate = {
  path: string; modsPath: string; sources: string[]; profiles: { name: string; version: string }[];
  exists: boolean; selectable: boolean; reason?: string; current: boolean; recommended: boolean;
};
export type MinecraftLocationDiscovery = { candidates: MinecraftLocationCandidate[]; warnings: string[] };

export type EulerSettingsStatus = { configured: boolean; storageAvailable: boolean; restartRequired: boolean; error?: string };
// OBS 連携（標準装備の OBSMOD が OBS ツールへ送るか。electron/obs_ipc.cjs）。endpoint が空なら defaultEndpoint へ送る。serverRunning は確かめられないとき null。
export type ObsSendStatus = { enabled: boolean; endpoint: string; defaultEndpoint: string; serverRunning: boolean | null };
export type ObsSendSaveResult = { ok: true; serverRunning: boolean | null; wroteServer: boolean; serverWriteError?: string };
export type MapSave = { id: string; name: string; createdAt: string; level: string; reason: string; bytes: number; files: number };
export type MapOperationResult = { ok: boolean; saved?: MapSave; loaded?: MapSave; restarted?: boolean; restartError?: string };
export type StreamSession = { id: string; title: string; startedAt: string; endedAt: string | null };

export type PreflightCheck = { id: string; title: string; status: "ok" | "warn" | "error" | "skip"; detail: string; page: string };
export type PreflightResult = { checkedAt: string; checks: PreflightCheck[] };
// 停止の出どころ。main がログ欄と logs/stop-requests.log に残す（名前は electron/stop_requests.cjs の STOP_ORIGINS と同じ）。
export type StopOrigin = "stop-panel:all" | "stop-panel:bridge" | "stop-panel:server" | "home:all" | "home:bridge" | "home:server" | "home:bridge-restart" | "euler:bridge-restart";
// 妨害の一時停止・再開の出どころ（同じく STOP_ORIGINS と同じ名前。2026-10-16）。
export type PauseOrigin = "home:pause" | "home:resume" | "banner:resume";
export type SettingsBackup = { id: string; createdAt: string; reason: string; version: string; username: string; mappings: number; commands: number; ttsEnabled: boolean; issues: number };

export type Gift = {
  id: number;
  name: string;
  diamond_count: number;
  image?: string | null;
};

export type GiftsMeta = {
  generatedAt: string;
  username: string;
  count: number;
} | null;

export type GiftsReadResult = {
  gifts: Gift[];
  meta: GiftsMeta;
  exists: boolean;
  minPath?: string;
  metaPath?: string;
};

// enabled: false は設定ファイルで無効にした割り当て（ギフトは数えるが、コマンドは動かさない。画面は印を出す。処理のコピー PR5・PR8）。
export type GiftAssignment = { giftId: string | number; name?: string; commandFile?: string; repeat?: number; enabled?: boolean };
export type GiftTemplatePreview = { token: string; name: string; appVersion: string; currentCount: number; missingCommands: string[]; mappings: Array<{ giftId: string; name: string; commandFile: string; repeat: number; title: string }> };
export type GiftMappingSaveRequest = { giftId: string; name: string; commandFile: string; repeat: number; expected: GiftAssignment[] };

export type BridgeConfig = {
  rcon?: { host?: string; port?: number; password?: string };
  tiktok?: { username?: string };
  mappings?: Array<{
    giftId: string | number;
    name?: string;
    commandFile?: string;
    repeat?: number;
    enabled?: boolean;
  }>;
  [k: string]: any; // 互換のため許容
};

declare global {
  interface Window {
    mygamepack: {
      gamesList: () => Promise<GameStatus>;
      gamesActivate: (id: string) => Promise<GameStatus>;
      gamesInstall: () => Promise<GameStatus | { canceled: true }>;
      gamesRecover: () => Promise<GameStatus>;
      gamesRefreshMods: () => Promise<GameStatus>;
      gamesResetMap: () => Promise<GameStatus>;
      gamesClientFolder: () => Promise<GameStatus | { canceled: true }>;
      gamesClientFolders: () => Promise<MinecraftLocationDiscovery>;
      gamesSelectClientFolder: (folder: string) => Promise<GameStatus>;

      // invalidName: BridgeMOD が拒否する名前（日本語・空白・.txt が2つなど）。割り当てて保存すると理由付きで止まる。invalidReason はその直し方の文。
      // roulette: ルーレットを回すコマンド（roulette.txt。大文字小文字を問わない）。一覧や項目の候補からは除く。
      bridgeCommandsReadMeta: () => Promise<Array<{ name: string; title: string; category: string; description?: string; chatKey?: string; invalidName?: boolean; invalidReason?: string; roulette?: boolean }>>;
      bridgeCommandsList: () => Promise<Array<{ name: string; title: string; category?: string; invalidName?: boolean; invalidReason?: string; roulette?: boolean }>>;
      // TXT 作成の確かめ。filename は .txt を付けた保存の名前、commands はコマンドの行、exists は同じ名前のファイルがあるか（保存は上書き）。
      bridgeCommandsCheck: (draft: { filename: string; content: string }) => Promise<{ filename: string; commands: string[]; problems: string[]; exists: boolean }>;
      testEvent: (event: { type: string; preview?: boolean; listenerName?: string; commandFile?: string; giftId?: string; count?: number; previousLikes?: number; likeCount?: number; deaths?: number; followCount?: number; comment?: string; pollOption?: string }) => Promise<{ ok: boolean; message: string; preview?: boolean; matched?: boolean; bridgeStopped?: boolean; notes?: string[]; steps?: Array<{ label: string; commandFile: string; count: number; type?: string; roulette?: boolean }>; fired?: Array<{ stepIndex?: number; commandFile?: string; count?: number; state?: 'delivered' | 'pending' | 'failed' | 'discarded'; message: string }> }>;
      worldSavesList: () => Promise<{ world: string; busy: boolean; recoveryPending: boolean; saves: MapSave[] }>;
      worldSavesSave: (name: string) => Promise<MapOperationResult>;
      worldSavesLoad: (id: string) => Promise<MapOperationResult>;
      operationsStreamStats: (gapMinutes?: number) => Promise<import("./streamStats").Stats>;
      operationsEarningsSave: (id: string, amount: number | null) => Promise<{ ok: boolean }>;
      operationsStatsExport: (streamId?: string) => Promise<{ ok: boolean; canceled?: boolean; path?: string; streams?: number }>;
      streamSessionStatus: () => Promise<{ active: StreamSession | null; monitoring?: boolean; error?: string }>;
      streamSessionStart: (title?: string) => Promise<StreamSession>;
      streamSessionEnd: (id: string, endedAt?: string) => Promise<StreamSession>;
      giftPanelSavePng: (dataUrl: string, filename: string) => Promise<{ canceled: boolean; path?: string }>;
      windowMinimize: () => void;
      windowMaximizeToggle: () => void;
      windowClose: () => void;
      clipboardWriteText: (text: string) => Promise<{ ok: true }>;
      preflightRun: () => Promise<PreflightResult>;
      settingsBackupsList: () => Promise<SettingsBackup[]>;
      settingsBackupCreate: () => Promise<SettingsBackup>;
      settingsBackupRestore: (id: string) => Promise<{ ok: true; safetyBackup: string; restored: SettingsBackup }>;
      // --------------------
      // config
      // --------------------
      giftTemplateSave: () => Promise<{ canceled: true } | { canceled: false; path?: string; name: string; count: number }>;
      giftTemplateOpen: () => Promise<{ canceled: true } | { canceled: false; preview: GiftTemplatePreview }>;
      giftTemplateApply: (token: string) => Promise<{ ok: true; mappings: GiftAssignment[] }>;
      giftTemplateCancel: (token: string) => Promise<void>;
      configRead: () => Promise<BridgeConfig>;
      obsGet: () => Promise<ObsSendStatus>;
      obsSet: (settings: { enabled: boolean; endpoint: string }) => Promise<ObsSendSaveResult>;
      eulerStatus: () => Promise<EulerSettingsStatus>;
      eulerSave: (key: string) => Promise<EulerSettingsStatus>;
      eulerClear: () => Promise<EulerSettingsStatus>;
      eulerOpenPortal: () => Promise<void>;
      configGiftMappingSave: (request: GiftMappingSaveRequest) => Promise<{ ok: true; mappings: GiftAssignment[] }>;
      configMappingsWrite?: (mappings: BridgeConfig["mappings"]) => Promise<{ ok: true }>;
      configWrite: (cfg: BridgeConfig) => Promise<{ ok: true }>;
      configPath: () => Promise<string>;

      // --------------------
      // bridge (optional)
      // --------------------
      bridgeRoot?: () => Promise<string>;
      bridgeSyncStatus?: () => Promise<any>;
      appVersion?: () => Promise<string>;
      setupInspectEnvironment?: () => Promise<{
        forge: { detected: boolean; version: string };
        minecraft: { detected: boolean; version: string };
        java: { detected: boolean; version: string };
        bridge: { detected: boolean; version: string };
        bridgeMod: { detected: boolean; version: string };
        tiktokApi: { detected: boolean; version: string };
      }>;

      // --------------------
      // gifts
      // --------------------
      giftsRead: () => Promise<GiftsReadResult>;
      onGiftsUpdated?: (callback: (meta: GiftsMeta) => void) => () => void;
      onGamesChanged?: (callback: (result?: { state: 'done' | 'failed'; changed: boolean }) => void) => () => void;
      giftsUpdate: (username: string) => Promise<{ ok: true } | any>;
      giftsOpenFolder: () => Promise<{ ok: true } | any>;
      giftsOpenHtml: () => Promise<{ ok: true } | any>;

      // --------------------
      // サーバー管理（統合UI）
      // --------------------
      serverStart: () => Promise<{ ok: true; alreadyRunning?: boolean; backup?: { ok: boolean; message: string } | null }>;
      serverStop: (origin: StopOrigin) => Promise<{ ok: true; graceful?: boolean }>;
      serverLogs: () => Promise<{ ok: true; lines: string[] }>;
      serverCommand: (command: string) => Promise<{ ok: true }>;
      // managed=false はこのアプリを開く前から動いているサーバー（アプリからは停止できない）。
      serverProcessStatus: () => Promise<{ running: boolean; pid: number | null; managed?: boolean }>;
      minecraftStatus: () => Promise<{ running: boolean; processes: string[] }>;
      bridgeLaunch: () => Promise<{ ok: true }>;
      bridgeStop: (origin: StopOrigin) => Promise<{ ok: true }>;
      bridgeRestart: (origin: StopOrigin) => Promise<{ ok: true }>;
      bridgeProcessStatus: () => Promise<any>;
      bridgeLogs: () => Promise<{ ok: true; lines: string[] }>;
      minecraftLaunch: () => Promise<{ ok: true }>;
      minecraftGrantOp: () => Promise<{ ok: true; name: string; offline?: boolean; message?: string }>;
      serverGamerulesApply: () => Promise<{ ok: true }>;
      serverDatapackDeployNightVision: () => Promise<{ ok: true }>;
      serverPropsRead: () => Promise<Record<string, string>>;
      serverPropsWrite: (updates: Record<string, string>) => Promise<{ ok: true }>;
      serverSetup: () => Promise<{ ok: boolean; canceled?: boolean }>;
      serverForgeClientStatus: () => Promise<{ installed: boolean; version: string; launcherReady: boolean }>;
      serverSetupStatus: () => Promise<{ state: string; message: string }>;
      serverForgeInstallAtPath: (folderPath: string) => Promise<{ ok: true }>;
      serverRconPasswordRead: () => Promise<{ found: boolean; password: string }>;
      dialogPickFolder: (title?: string) => Promise<{ canceled: boolean; path: string }>;
      dialogPickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled: boolean; path: string }>;
      folderOpen: (folderPath: string) => Promise<{ ok: true; path: string }>;
      serverSetupAtPath: (folderPath: string) => Promise<{ ok: boolean; canceled?: boolean }>;

      // --------------------
      // GiftsViewer 統合
      // --------------------
      gvGiftsRead: () => Promise<GiftsReadResult>;
      gvGiftsUpdate: (username: string) => Promise<{ ok: true }>;
      gvGiftsOpenFolder: () => Promise<{ ok: true }>;
      gvGiftsOpenHtml: () => Promise<{ ok: true }>;
      gvGiftsFetchImageBase64: (url: string) => Promise<string>;
      gvGiftsCopyPngDataUrl: (dataUrl: string) => Promise<{ ok: true }>;
      gvSettingsRead: () => Promise<{ username: string }>;
      gvSettingsWrite: (v: { username: string }) => Promise<{ ok: true }>;

      // --------------------
      // App config
      // --------------------
      // 項目と型は main と同じ表（electron/app_config_fields.json）から取る。読むと既定値の項目は必ずあり、使わなくなった項目（retired）は渡さない。
      appConfigRead: () => Promise<AppConfigTable["defaults"] & Partial<AppConfigFields>>;
      appConfigWrite: (data: Partial<Pick<AppConfigFields, AppConfigWritableKey>>) => Promise<{ ok: true }>;

      // --------------------
      // セットアップ支援
      // --------------------
      serverCopyTemplate: (targetFolder: string) => Promise<{ ok: true }>;
      serverCopyTemplateStatus?: () => Promise<{ state: string; copied: number; total: number; error: string }>;
      serverCheckSetupComplete: () => Promise<{ complete: boolean; dir: string; missing?: string[] }>;
    };
  }
}
