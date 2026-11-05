// ギフトの画像を PNG（canvas）に描くために読み込んでおく所（2026-11-05）。
// https の画像をそのまま canvas に描くと、PNG に書き出せなくなる（汚れた canvas）。main（gvGiftsFetchImageBase64）から data URL でもらって読む。
// いまはギフト設定の「登録済みギフト」の PNG だけが使う。配信画像（ImageEditorPage）にも同じ仕組みがあり、あとでこちらにまとめる。

export type GiftImageStatus = "loading" | "ready" | "error";
type Entry<I> = { status: GiftImageStatus; image?: I };

export type GiftImageCacheOptions<I> = {
  /** 画像の URL から data URL（または base64）をもらう。 */
  fetchDataUrl: (url: string) => Promise<string | null | undefined>;
  /** data URL を描ける画像にする（画面では loadImage）。 */
  decode: (dataUrl: string) => Promise<I>;
  /** 1枚を待つ長さ。配信画像と同じ 20 秒。 */
  timeoutMs?: number;
  /** 同時に読む枚数。 */
  workers?: number;
};

/** base64 だけが返ったときは PNG の data URL にする。 */
export function toImageDataUrl(value: string): string {
  return value.startsWith("data:") ? value : "data:image/png;base64," + value;
}

/** 画面で使う読み方（HTMLImageElement）。 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("画像を開けません"));
    image.src = src;
  });
}

export function createGiftImageCache<I>({ fetchDataUrl, decode, timeoutMs = 20000, workers = 4 }: GiftImageCacheOptions<I>) {
  const entries = new Map<string, Entry<I>>();
  const queue: string[] = [];
  const listeners = new Set<() => void>();
  let active = 0;
  const notify = () => listeners.forEach(listener => listener());

  const loadOne = async (url: string): Promise<I> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const value = await fetchDataUrl(url);
          if (!value) throw new Error("画像なし");
          return decode(toImageDataUrl(value));
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("画像の読み込みがタイムアウトしました")), timeoutMs); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
  };

  const pump = () => {
    while (active < workers && queue.length) {
      const url = queue.shift()!;
      active++;
      loadOne(url)
        .then(image => { entries.set(url, { status: "ready", image }); }, () => { entries.set(url, { status: "error" }); })
        .finally(() => { active--; notify(); pump(); });
    }
  };

  /** まだ読んでいない URL を読む（空の URL は飛ばす）。 */
  const request = (urls: Iterable<string | null | undefined>) => {
    for (const url of new Set(urls)) {
      if (!url || entries.has(url)) continue;
      entries.set(url, { status: "loading" });
      queue.push(url);
    }
    pump();
  };

  return {
    request,
    /** 読めなかった画像を読み直す。 */
    retryFailed(urls: Iterable<string | null | undefined>) {
      const failed = [...new Set(urls)].filter((url): url is string => Boolean(url) && entries.get(url as string)?.status === "error");
      failed.forEach(url => entries.delete(url));
      request(failed);
    },
    /** 読み終えた画像（URL → 画像）と、待っている枚数・読めなかった URL。 */
    summary(urls: Iterable<string | null | undefined>) {
      const images = new Map<string, I>();
      let pending = 0;
      const failed: string[] = [];
      for (const url of new Set(urls)) {
        if (!url) continue;
        const entry = entries.get(url);
        if (!entry || entry.status === "loading") pending++;
        else if (entry.status === "error") failed.push(url);
        else if (entry.image !== undefined) images.set(url, entry.image);
      }
      return { images, pending, failed };
    },
    /** 読み終えるたびに呼ぶ。誰も見ていなくなったら、まだ始めていない読み込みはやめる（あとで request すれば読む）。 */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        for (const url of queue) entries.delete(url);
        queue.length = 0;
      };
    },
  };
}

export type GiftImageCache<I> = ReturnType<typeof createGiftImageCache<I>>;
