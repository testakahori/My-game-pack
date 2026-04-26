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
      // --------------------
      // config
      // --------------------
      configRead: () => Promise<BridgeConfig>;
      configWrite: (cfg: BridgeConfig) => Promise<{ ok: true }>;
      configPath: () => Promise<string>;

      // --------------------
      // bridge (optional)
      // --------------------
      bridgeStart?: () => Promise<any>;
      bridgeRoot?: () => Promise<string>;

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
      serverStart: () => Promise<{ ok: true }>;
      bridgeLaunch: () => Promise<{ ok: true }>;
      serverPropsRead: () => Promise<Record<string, string>>;
      serverPropsWrite: (updates: Record<string, string>) => Promise<{ ok: true }>;
      serverSetup: () => Promise<{ ok: true }>;
      serverRconPasswordRead: () => Promise<{ found: boolean; password: string }>;
      dialogPickFolder: (title?: string) => Promise<{ canceled: boolean; path: string }>;
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
      // App config
      // --------------------
      appConfigRead: () => Promise<{ serverFolder: string; setupComplete: boolean }>;
      appConfigWrite: (data: Partial<{ serverFolder: string; setupComplete: boolean }>) => Promise<{ ok: true }>;

      // --------------------
      // セットアップ支援
      // --------------------
      serverCopyTemplate: (targetFolder: string) => Promise<{ ok: true }>;
      serverCheckSetupComplete: () => Promise<{ complete: boolean; dir: string }>;
    };
  }
}