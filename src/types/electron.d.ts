// src/types/electron.d.ts
export {};

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
      windowMinimize: () => void;
      windowMaximizeToggle: () => void;
      windowClose: () => void;
      // --------------------
      // config
      // --------------------
      configRead: () => Promise<BridgeConfig>;
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
      giftsUpdate: (username: string) => Promise<{ ok: true } | any>;
      giftsOpenFolder: () => Promise<{ ok: true } | any>;
      giftsOpenHtml: () => Promise<{ ok: true } | any>;

      // --------------------
      // サーバー管理（統合UI）
      // --------------------
      serverStart: () => Promise<{ ok: true; alreadyRunning?: boolean; backup?: { ok: boolean; message: string } | null }>;
      serverStop: () => Promise<{ ok: true; graceful?: boolean }>;
      serverLogs: () => Promise<{ ok: true; lines: string[] }>;
      serverProcessStatus: () => Promise<{ running: boolean; pid: number | null }>;
      minecraftStatus: () => Promise<{ running: boolean; processes: string[] }>;
      bridgeLaunch: () => Promise<{ ok: true }>;
      bridgeStop: () => Promise<{ ok: true }>;
      bridgeRestart: () => Promise<{ ok: true }>;
      bridgeProcessStatus: () => Promise<any>;
      bridgeLogs: () => Promise<{ ok: true; lines: string[] }>;
      minecraftLaunch: () => Promise<{ ok: true }>;
      minecraftGrantOp: () => Promise<{ ok: true; name: string }>;
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
