import type { MediaSettings, MediaState } from "../mediaEffects";
// src/types/electron.d.ts
export {};
export type StreamSession = { id: string; title: string; startedAt: string; endedAt: string | null };

export type PreflightCheck = { id: string; title: string; status: "ok" | "warn" | "error" | "skip"; detail: string; page: string };
export type PreflightResult = { checkedAt: string; checks: PreflightCheck[] };
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

export type BridgeConfig = {
  rcon?: { host?: string; port?: number; password?: string };
  tiktok?: { username?: string };
  mappings?: Array<{
    giftId: string | number;
    name?: string;
    commandFile?: string;
    repeat?: number;
  }>;
  [k: string]: any; // 互換のため許容
};

declare global {
  interface Window {
    mygamepack: {
      effectsConnect: (username: string) => Promise<MediaState>;
      effectsDisconnect: () => Promise<MediaState>;
      effectsState: () => Promise<MediaState>;
      effectsSave: (settings: MediaSettings, revision: number) => Promise<MediaState>;
      effectsControl: (action: string) => Promise<MediaState>;
      effectsImport: () => Promise<MediaState>;
      effectsPreview: () => Promise<MediaState>;
      effectsTest: (input: { assetId?: string; ruleId?: string; calibration?: boolean; event?: { type: string; previousLikes?: number; total?: number; giftId?: string; unitCoins?: number; delta?: number; previousCoins?: number; totalCoins?: number } }) => Promise<MediaState | { matched: string[] }>;
      effectsConfirm: (kind: 'visual' | 'audio') => Promise<MediaState>;
      effectsCopyUrl: () => Promise<{ ok: true }>;
      bridgeCommandsList: () => Promise<Array<{ name: string; title: string }>>;
      testEvent: (event: { type: string; preview?: boolean; listenerName?: string; commandFile?: string; giftId?: string; count?: number; previousLikes?: number; likeCount?: number; deaths?: number; followCount?: number; comment?: string; pollOption?: string }) => Promise<{ ok: boolean; message: string; preview?: boolean; notes?: string[]; steps?: Array<{ label: string; commandFile: string; count: number }>; fired?: Array<{ ok: boolean; message: string }> }>;
      streamSessionStatus: () => Promise<{ active: StreamSession | null }>;
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
      configRead: () => Promise<BridgeConfig>;
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
        doumaMod: { detected: boolean; version: string };
        tiktokApi: { detected: boolean; version: string };
      }>;

      // --------------------
      // gifts
      // --------------------
      giftsRead: () => Promise<GiftsReadResult>;
      onGiftsUpdated?: (callback: (meta: GiftsMeta) => void) => () => void;
      giftsUpdate: (username: string) => Promise<{ ok: true } | any>;
      giftsOpenFolder: () => Promise<{ ok: true } | any>;
      giftsOpenHtml: () => Promise<{ ok: true } | any>;

      // --------------------
      // サーバー管理（統合UI）
      // --------------------
      serverStart: () => Promise<{ ok: true; alreadyRunning?: boolean; backup?: { ok: boolean; message: string } | null }>;
      serverStop: () => Promise<{ ok: true; graceful?: boolean }>;
      serverLogs: () => Promise<{ ok: true; lines: string[] }>;
      serverCommand: (command: string) => Promise<{ ok: true }>;
      serverProcessStatus: () => Promise<{ running: boolean; pid: number | null }>;
      minecraftStatus: () => Promise<{ running: boolean; processes: string[] }>;
      bridgeLaunch: () => Promise<{ ok: true }>;
      bridgeStop: () => Promise<{ ok: true }>;
      bridgeRestart: () => Promise<{ ok: true }>;
      bridgeProcessStatus: () => Promise<any>;
      bridgeLogs: () => Promise<{ ok: true; lines: string[] }>;
      minecraftLaunch: () => Promise<{ ok: true }>;
      minecraftGrantOp: () => Promise<{ ok: true; name: string; offline?: boolean; message?: string }>;
      serverGamerulesApply: () => Promise<{ ok: true }>;
      serverDatapackDeployNightVision: () => Promise<{ ok: true }>;
      serverPropsRead: () => Promise<Record<string, string>>;
      serverPropsWrite: (updates: Record<string, string>) => Promise<{ ok: true }>;
      serverSetup: () => Promise<{ ok: true }>;
      serverForgeInstallAtPath: (folderPath: string) => Promise<{ ok: true }>;
      serverRconPasswordRead: () => Promise<{ found: boolean; password: string }>;
      dialogPickFolder: (title?: string) => Promise<{ canceled: boolean; path: string }>;
      dialogPickFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled: boolean; path: string }>;
      folderOpen: (folderPath: string) => Promise<{ ok: true; path: string }>;
      serverSetupAtPath: (folderPath: string) => Promise<{ ok: true }>;

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
      // 運営ログイン認証
      // --------------------
      authStatus: () => Promise<{ authenticated: boolean; email: string }>;
      authLogin: (payload: { email: string; password: string }) => Promise<{ ok: boolean; email?: string; message?: string }>;
      authLogout: () => Promise<{ ok: true }>;

      // --------------------
      // App config
      // --------------------
      appConfigRead: () => Promise<{
        serverFolder: string;
        setupComplete: boolean;
        setupRequiredByInstall?: boolean;
        setupRequiredAt?: string;
        minecraftLauncherPath?: string;
        minecraftPlayerName?: string;
        autoBackupOnServerStart?: boolean;
      }>;
      appConfigWrite: (data: Partial<{
        serverFolder: string;
        setupComplete: boolean;
        setupRequiredByInstall: boolean;
        setupRequiredAt: string;
        minecraftLauncherPath: string;
        minecraftPlayerName: string;
        autoBackupOnServerStart: boolean;
      }>) => Promise<{ ok: true }>;

      // --------------------
      // セットアップ支援
      // --------------------
      serverCopyTemplate: (targetFolder: string) => Promise<{ ok: true }>;
      serverCopyTemplateStatus?: () => Promise<{ state: string; copied: number; total: number; error: string }>;
      serverCheckSetupComplete: () => Promise<{ complete: boolean; dir: string }>;
    };
  }
}
