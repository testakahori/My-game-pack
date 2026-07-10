import React from "react";

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;
type ViewMode = "grid" | "list" | "compact";

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP");
}

function fmtShortDate(iso?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).mygamepack ?? null;
}

function DiamondIcon({ tone = "green" }: { tone?: "green" | "purple" | "blue" }) {
  return (
    <svg className={`gift-diamond-icon gift-diamond-icon--${tone}`} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`giftDiamond-${tone}`} x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor={tone === "purple" ? "#d78bff" : tone === "blue" ? "#5fe7ff" : "#4cffb6"} />
          <stop offset=".55" stopColor={tone === "purple" ? "#884fff" : tone === "blue" ? "#158cff" : "#0ccf82"} />
          <stop offset="1" stopColor={tone === "purple" ? "#4c20a7" : tone === "blue" ? "#073f92" : "#056848"} />
        </linearGradient>
      </defs>
      <path d="M18 9h28l12 15-26 32L6 24 18 9Z" fill={`url(#giftDiamond-${tone})`} />
      <path d="M18 9 32 56 46 9M6 24h52M18 9l-4 15 18 32 18-32-4-15" fill="none" stroke="rgba(255,255,255,.42)" strokeWidth="2" />
      <path d="M18 9h28l12 15-26 32L6 24 18 9Z" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2" />
    </svg>
  );
}

function ServerLinkIcon() {
  return (
    <svg className="gift-server-link-icon" viewBox="0 0 72 72" aria-hidden="true">
      <defs>
        <linearGradient id="giftChestTop" x1="0" x2="1">
          <stop stopColor="#ffd66a" />
          <stop offset="1" stopColor="#b66b24" />
        </linearGradient>
      </defs>
      <path d="M13 28h46v30H13z" fill="#8a5325" stroke="#ffd37b" strokeWidth="2" />
      <path d="M13 20h46v13H13z" fill="url(#giftChestTop)" stroke="#ffd37b" strokeWidth="2" />
      <path d="M17 33h38M36 20v38" stroke="#563317" strokeWidth="3" opacity=".7" />
      <rect x="30" y="32" width="12" height="12" rx="2" fill="#d7e8ff" stroke="#12243f" strokeWidth="2" />
      <path d="M48 15c8 2 12 7 12 15m-6-11c4 2 6 5 6 9" fill="none" stroke="#54e8ff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="18" cy="16" r="4" fill="#2df29c" />
      <path d="M17 43h10m18 0h10" stroke="#ffd37b" strokeWidth="2" />
    </svg>
  );
}

const GiftsViewerPage: React.FC = () => {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [username, setUsername] = React.useState("akahoridouma");
  const [gifts, setGifts] = React.useState<Gift[]>([]);
  const [meta, setMeta] = React.useState<GiftsMeta>(null);
  const [exists, setExists] = React.useState(false);
  const [toast, setToast] = React.useState<{ id: number; msg: string } | null>(null);
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState<"costAsc" | "costDesc" | "nameAsc">("costAsc");
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");

  const showToast = (msg: string) => {
    setToast({ id: Date.now(), msg });
    setTimeout(() => setToast(null), 2500);
  };

  const reload = React.useCallback(async () => {
    setErr(null);
    const api = getApi();
    if (!api?.gvGiftsRead) {
      setGifts([]);
      setMeta(null);
      setExists(false);
      setErr("Electron API (gvGiftsRead) が見つかりません。");
      return;
    }
    try {
      const res = await api.gvGiftsRead();
      setGifts(res.gifts || []);
      setMeta(res.meta ?? null);
      setExists(!!res.exists);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      const api = getApi();
      if (!api?.gvSettingsRead) return;
      try {
        const st = await api.gvSettingsRead();
        if (typeof st?.username === "string" && st.username.trim()) {
          setUsername(st.username.trim().replace(/^@/, ""));
        }
      } catch { /* ignore */ }
      await reload();
    })();
  }, [reload]);

  const onUpdate = async () => {
    setLoading(true);
    setErr(null);
    const api = getApi();
    if (!api?.gvGiftsUpdate) {
      setErr("Electron API が見つかりません。");
      setLoading(false);
      return;
    }
    try {
      const u = username.trim().replace(/^@/, "");
      if (!u) throw new Error("username is empty");
      await api.gvSettingsWrite({ username: u });
      await api.gvGiftsUpdate(u);
      await reload();
      showToast("ギフト一覧を更新しました！");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`ID コピー: ${text}`);
    } catch {
      showToast("IDコピーに失敗しました");
    }
  };

  const onCopyImage = async (url: string) => {
    const api = getApi();
    if (!api?.gvGiftsFetchImageBase64) return;
    try {
      showToast("画像をダウンロード中…");
      const dataUrl: string = await api.gvGiftsFetchImageBase64(url);
      const img = new Image();
      img.src = dataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Image Load Error"));
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Failed to get 2d context");
      ctx.drawImage(img, 0, 0);

      await api.gvGiftsCopyPngDataUrl(canvas.toDataURL("image/png"));
      showToast("画像をクリップボードにコピーしました！");
    } catch (e: any) {
      setErr("画像コピー失敗: " + (e?.message || String(e)));
    }
  };

  const uniqueGifts = React.useMemo(() => {
    const map = new Map<string, Gift>();
    for (const gift of gifts) {
      const key = Number.isFinite(Number(gift.id))
        ? `id:${gift.id}`
        : `name:${gift.name}:${gift.diamond_count}`;
      const current = map.get(key);
      if (!current || (!current.image && gift.image)) map.set(key, gift);
    }
    return [...map.values()];
  }, [gifts]);

  const filtered = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    const arr = uniqueGifts.filter((g) => (!s ? true : `${g.id} ${g.name}`.toLowerCase().includes(s)));
    const sorted = [...arr];
    if (sort === "nameAsc") {
      sorted.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ja"));
    } else {
      sorted.sort((a, b) => {
        const byCost = (a.diamond_count ?? 0) - (b.diamond_count ?? 0);
        if (byCost !== 0) return byCost;
        return (a.name || "").localeCompare(b.name || "", "ja");
      });
      if (sort === "costDesc") sorted.reverse();
    }
    return sorted;
  }, [uniqueGifts, q, sort]);

  const minDiamond = uniqueGifts.length ? Math.min(...uniqueGifts.map((gift) => gift.diamond_count || 0)) : 0;
  const maxDiamond = uniqueGifts.length ? Math.max(...uniqueGifts.map((gift) => gift.diamond_count || 0)) : 0;
  const minGift = uniqueGifts.find((gift) => gift.diamond_count === minDiamond);
  const maxGift = uniqueGifts.find((gift) => gift.diamond_count === maxDiamond);

  return (
    <div className="gifts-viewer-page gift-catalog-v2 page-surface">
      <header className="gift-catalog-v2__header">
        <div>
          <h1>ギフト一覧</h1>
          <p>TikTok Gifts</p>
        </div>
        <span>MyGamePack Manager</span>
      </header>

      <section className="gift-catalog-v2__toolbar">
        <label>
          <span>TikTok ユーザー名</span>
          <div>
            <b>@</b>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onUpdate()}
              placeholder="akahoridouma"
            />
          </div>
        </label>
        <button type="button" onClick={onUpdate} disabled={loading} className="gift-catalog-action gift-catalog-action--cyan">
          {loading ? "更新中…" : "↻ 更新"}
        </button>
        <div className="gift-catalog-search">
          <span>⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ギフト名・IDを検索..." />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="costAsc">コスト 低→高</option>
          <option value="costDesc">コスト 高→低</option>
          <option value="nameAsc">名前 A→Z</option>
        </select>
      </section>

      <p className="gift-catalog-v2__meta">
        更新日時: {meta ? fmtDate(meta.generatedAt) : "未取得"}　/　@{meta?.username || username || "—"}　/　
        <b>{filtered.length}</b> / {uniqueGifts.length} 件
      </p>

      {err && <div className="gift-catalog-error">❌ {err}</div>}

      <section className="gift-catalog-stats-v2" aria-label="ギフト一覧サマリー">
        <div className="gift-stat-card gift-stat-card--cyan">
          <span className="gift-stat-card__icon">🎁</span>
          <div><small>総ギフト数</small><b>{uniqueGifts.length}<em>件</em></b><p>TikTok ギフト取得完了</p></div>
        </div>
        <div className="gift-stat-card gift-stat-card--blue">
          <span className="gift-stat-card__icon">◷</span>
          <div><small>最終更新</small><b>{fmtShortDate(meta?.generatedAt)}</b><p>自動更新: 有効</p></div>
        </div>
        <div className="gift-stat-card gift-stat-card--green">
          <span className="gift-stat-card__icon"><DiamondIcon tone="green" /></span>
          <div><small>最安ギフト</small><b>{minDiamond}<em>💎</em></b><p>{minGift ? `${minGift.name}（ID: ${minGift.id}）` : "—"}</p></div>
        </div>
        <div className="gift-stat-card gift-stat-card--purple">
          <span className="gift-stat-card__icon"><DiamondIcon tone="purple" /></span>
          <div><small>最高額ギフト</small><b>{maxDiamond.toLocaleString()}<em>💎</em></b><p>{maxGift ? `${maxGift.name}（ID: ${maxGift.id}）` : "—"}</p></div>
        </div>
        <div className="gift-stat-card gift-stat-card--server">
          <span className="gift-stat-card__icon"><ServerLinkIcon /></span>
          <div><small>サーバー連携</small><b><i />正常</b><p>Bridge: 接続中</p></div>
        </div>
      </section>

      <section className="gift-catalog-panel-v2">
        <div className="gift-catalog-filters">
          <div className="gift-catalog-result-count">
            表示中 <b>{filtered.length}</b> 件
            {q.trim() ? <button type="button" onClick={() => setQ("")}>検索をクリア</button> : null}
          </div>
          <div className="gift-view-mode">
            {(["grid", "list", "compact"] as const).map((mode) => (
              <button key={mode} type="button" className={viewMode === mode ? "is-active" : ""} onClick={() => setViewMode(mode)}>
                {mode === "grid" ? "▦ グリッド" : mode === "list" ? "☰ リスト" : "▥ コンパクト"}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="gift-catalog-empty">
            {loading ? "取得中…" : uniqueGifts.length === 0 ? "ギフトがありません" : "検索結果が0件です"}
          </div>
        ) : (
          <div className={`gift-catalog-grid gift-catalog-grid--${viewMode}`}>
            {filtered.map((gift, index) => (
              <article className="gift-catalog-card" key={gift.id}>
                <button
                  type="button"
                  className="gift-catalog-card__image"
                  onClick={() => { if (gift.image) onCopyImage(gift.image); }}
                  title={gift.image ? "クリックで透過画像をコピー" : undefined}
                >
                  {gift.image ? <img src={gift.image} alt={gift.name} /> : <span>?</span>}
                </button>
                <div className="gift-catalog-card__body" onClick={() => onCopyText(String(gift.id))}>
                  <b title={gift.name}>{gift.name}</b>
                  <small>ID: <em>{gift.id}</em></small>
                  <p>💎 <strong>{gift.diamond_count}</strong></p>
                </div>
                <button type="button" className="gift-catalog-card__copy" onClick={() => onCopyText(String(gift.id))}>▣ コピー</button>
                <i className={`gift-card-glow gift-card-glow--${index % 6}`} />
              </article>
            ))}
          </div>
        )}
      </section>

      {toast && (
        <div key={toast.id} className="gift-catalog-toast">
          {toast.msg}
        </div>
      )}
    </div>
  );
};

export default GiftsViewerPage;
