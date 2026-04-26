// src/App.tsx
import React from "react";

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;

type GiftsReadResult = {
  gifts: Gift[];
  meta: GiftsMeta;
  exists: boolean;
  minPath?: string;
  metaPath?: string;
};

type Settings = { username: string };

// window.giftsviewer の型（preload が expose する想定）
type GiftsViewerApi = {
  settingsRead: () => Promise<Settings | null>;
  settingsWrite: (s: Settings) => Promise<{ ok: true } | any>;

  giftsRead: () => Promise<GiftsReadResult>;
  giftsUpdate: (username: string) => Promise<any>;
  giftsOpenFolder: () => Promise<any>;
  giftsOpenHtml: () => Promise<any>;
  giftsFetchImageBase64: (url: string) => Promise<string>;
  giftsCopyPngDataUrl: (dataUrl: string) => Promise<any>;
};

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function getApi(): GiftsViewerApi | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w: any = window as any;
  return w?.giftsviewer ?? null;
}

export default function App() {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [username, setUsername] = React.useState("akahoridouma");

  const [gifts, setGifts] = React.useState<Gift[]>([]);
  const [meta, setMeta] = React.useState<GiftsMeta>(null);
  const [exists, setExists] = React.useState(false);

  const [toast, setToast] = React.useState<{ id: number; msg: string } | null>(null);

  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<"costAsc" | "costDesc" | "nameAsc">("costAsc");

  // API接続状況（Electronで起動できてるか）
  const [apiReady, setApiReady] = React.useState<boolean>(() => !!getApi());

  // giftsviewer が後から生えるケース（起動直後など）でも追随
  React.useEffect(() => {
    const t = window.setInterval(() => {
      const ok = !!getApi();
      setApiReady(ok);
    }, 300);
    return () => window.clearInterval(t);
  }, []);

  const reload = React.useCallback(async () => {
    setErr(null);

    const api = getApi();
    if (!api) {
      setGifts([]);
      setMeta(null);
      setExists(false);
      setErr("Electron API (window.giftsviewer) が見つかりません。preload が読み込まれていない可能性があります。");
      return;
    }

    try {
      const res = await api.giftsRead();
      setGifts(res.gifts || []);
      setMeta(res.meta ?? null);
      setExists(!!res.exists);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      setErr(null);

      const api = getApi();
      if (!api) {
        // ここで落とさず「接続待ち」にする
        return;
      }

      try {
        const st = await api.settingsRead();
        const u = st?.username;
        if (typeof u === "string" && u.trim()) setUsername(u.trim().replace(/^@/, ""));
      } catch {
        // ignore
      }

      await reload();
    })();
  }, [reload, apiReady]);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = gifts.filter((g) => (!s ? true : `${g.id} ${g.name}`.toLowerCase().includes(s)));

    if (sort === "nameAsc") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      arr.sort((a, b) => (a.diamond_count ?? 0) - (b.diamond_count ?? 0));
      if (sort === "costDesc") arr.reverse();
    }
    return arr;
  }, [gifts, q, sort]);

  const onUpdate = async () => {
    setLoading(true);
    setErr(null);

    const api = getApi();
    if (!api) {
      setErr("Electron API (window.giftsviewer) が見つかりません。electron で起動できているか確認してね。");
      setLoading(false);
      return;
    }

    try {
      const u = username.trim().replace(/^@/, "");
      if (!u) throw new Error("username is empty");

      // 先に保存（次回起動で復元できるように）
      await api.settingsWrite({ username: u });

      // gifts を更新
      await api.giftsUpdate(u);

      // 読み直し
      await reload();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onOpenFolder = async () => {
    setErr(null);
    const api = getApi();
    if (!api) return setErr("Electron API が見つかりません。");
    try {
      await api.giftsOpenFolder();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const onOpenHtml = async () => {
    setErr(null);
    const api = getApi();
    if (!api) return setErr("Electron API が見つかりません。");
    try {
      await api.giftsOpenHtml();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };

  const showToast = (msg: string) => {
    setToast({ id: Date.now(), msg });
    setTimeout(() => setToast(null), 2500);
  };

  const onCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied ID: ${text}`);
    } catch { }
  };

  const onCopyImage = async (url: string) => {
    try {
      showToast("Downloading image...");
      const api = getApi();
      if (!api) throw new Error("API not found");

      // 1. Fetch WebP as base64 data URL
      const dataUrl = await api.giftsFetchImageBase64(url);

      // 2. Load into HTMLImageElement
      const img = new Image();
      img.src = dataUrl;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Image Load Error"));
      });

      // 3. Draw to canvas to get PNG
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context");
      ctx.drawImage(img, 0, 0);

      const pngDataUrl = canvas.toDataURL("image/png");

      // 4. Send PNG to system clipboard
      await api.giftsCopyPngDataUrl(pngDataUrl);
      showToast("Copied Image (Transparent)!");
    } catch (e: any) {
      setErr("Image Copy Failed: " + (e?.message || String(e)));
    }
  };

  const canUpdate = apiReady && !loading;
  const canOpen = apiReady;
  const canOpenHtml = apiReady && exists;

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Gifts Viewer</h1>
          <span style={{ fontSize: 12, color: "#666" }}>TikTok ギフト一覧を “更新ボタン1発” で取得</span>
          {!apiReady && (
            <span style={{ fontSize: 11, color: "#b42318" }}>（Electron API 接続待ち…）</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#666" }}>TikTok:</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="akahoridouma"
            style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 10, minWidth: 220 }}
          />
          <button
            onClick={onUpdate}
            disabled={!canUpdate}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: canUpdate ? "pointer" : "not-allowed",
              opacity: canUpdate ? 1 : 0.6,
            }}
            title="fetch_gifts.js + gifts_to_html.js を実行して data/gifts を更新します"
          >
            {loading ? "Updating..." : "Update"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={onOpenFolder}
            disabled={!canOpen}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: canOpen ? "pointer" : "not-allowed",
              opacity: canOpen ? 1 : 0.6,
            }}
          >
            Open Folder
          </button>
          <button
            onClick={onOpenHtml}
            disabled={!canOpenHtml}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              cursor: canOpenHtml ? "pointer" : "not-allowed",
              opacity: canOpenHtml ? 1 : 0.6,
            }}
          >
            Open HTML
          </button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search id/name"
            style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 10, minWidth: 220 }}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as any)}
            style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 10 }}
          >
            <option value="costAsc">Cost ↑</option>
            <option value="costDesc">Cost ↓</option>
            <option value="nameAsc">Name A→Z</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>
        {meta ? (
          <span>
            Updated: {fmtDate(meta.generatedAt)} / @{meta.username} / {meta.count} gifts
          </span>
        ) : exists ? (
          <span>Loaded gifts.json</span>
        ) : apiReady ? (
          <span>No gifts yet. Click “Update”.</span>
        ) : (
          <span>Electron API が来るまで待機中…（preload 未接続の可能性）</span>
        )}
      </div>

      {err && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            border: "1px solid #f2b8b8",
            background: "#fff5f5",
            borderRadius: 10,
          }}
        >
          <b style={{ color: "#b42318" }}>Error:</b> <span style={{ color: "#b42318" }}>{err}</span>
        </div>
      )}

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 10,
        }}
      >
        {filtered.map((g) => (
          <div
            key={g.id}
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: 14,
              padding: 12,
              display: "flex",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: "#f4f4f4",
                overflow: "hidden",
                display: "grid",
                placeItems: "center",
                flex: "0 0 auto",
                cursor: g.image ? "pointer" : "default",
              }}
              title={g.image ? "クリックで透過画像をコピー" : undefined}
              onClick={() => {
                if (g.image) onCopyImage(g.image);
              }}
            >
              {g.image ? (
                <img src={g.image} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <span style={{ fontSize: 10, color: "#999" }}>no img</span>
              )}
            </div>

            <div
              style={{ minWidth: 0, cursor: "pointer", flex: 1 }}
              title="クリックでIDコピー"
              onClick={() => onCopyText(String(g.id))}
            >
              <div style={{ fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {g.name}
              </div>
              <div style={{ fontSize: 12, color: "#666" }}>
                ID: <b>{g.id}</b> / Cost: <b>{g.diamond_count}</b>
              </div>
              <div style={{ fontSize: 11, color: "#999" }}>[Copy ID]</div>
            </div>
          </div>
        ))}
      </div>

      {toast && (
        <div
          key={toast.id}
          style={{
            position: "fixed",
            bottom: 30,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#333",
            color: "#fff",
            padding: "10px 20px",
            borderRadius: 30,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 9999,
            animation: "fadeInOut 2.5s ease-in-out forwards",
          }}
        >
          {toast.msg}
          <style>
            {`
              @keyframes fadeInOut {
                0% { opacity: 0; transform: translate(-50%, 20px); }
                10% { opacity: 1; transform: translate(-50%, 0); }
                90% { opacity: 1; transform: translate(-50%, 0); }
                100% { opacity: 0; transform: translate(-50%, 20px); }
              }
            `}
          </style>
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: "#999" }}>
        ※ Update が失敗する場合：配布先PCに Node が入っていない可能性があります（その場合は “node同梱版” にできます）
      </div>
    </div>
  );
}