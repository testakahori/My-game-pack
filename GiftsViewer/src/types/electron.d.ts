export {};

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;

type GiftsReadResult = {
  gifts: Gift[];
  meta: GiftsMeta;
  exists: boolean;
  minPath?: string;
  metaPath?: string;
};

declare global {
  interface Window {
    giftsviewer: {
      giftsRead: () => Promise<GiftsReadResult>;
      giftsUpdate: (username: string) => Promise<any>;
      giftsOpenFolder: () => Promise<any>;
      giftsOpenHtml: () => Promise<any>;

      settingsRead: () => Promise<{ username?: string }>;
      settingsWrite: (next: { username?: string }) => Promise<{ ok: true }>;
    };
  }
}