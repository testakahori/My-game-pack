// src/components/GiftsViewerPage.tsx
// GiftsViewer を統合UI のページとして再実装（ダークテーマ・Tailwind）
import React from "react";

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ja-JP");
}

function getApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).mygamepack ?? null;
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

  const showToast = (msg: string) => {
    setToast({ id: Date.now(), msg });
    setTimeout(() => setToast(null), 2500);
  };

  const reload = React.useCallback(async () => {
    setErr(null);
    const api = getApi();
    if (!api?.gvGiftsRead) {
      setGifts([]); setMeta(null); setExists(false);
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
      setErr("Electron API が見つかりません。"); setLoading(false); return;
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

  const onOpenFolder = async () => {
    const api = getApi();
    if (!api?.gvGiftsOpenFolder) return;
    try { await api.gvGiftsOpenFolder(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };

  const onOpenHtml = async () => {
    const api = getApi();
    if (!api?.gvGiftsOpenHtml) return;
    try { await api.gvGiftsOpenHtml(); }
    catch (e: any) { setErr(e?.message || String(e)); }
  };

  const onCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`ID コピー: ${text}`);
    } catch { /* ignore */ }
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
      const pngDataUrl = canvas.toDataURL("image/png");

      await api.gvGiftsCopyPngDataUrl(pngDataUrl);
      showToast("画像をクリップボードにコピーしました！");
    } catch (e: any) {
      setErr("画像コピー失敗: " + (e?.message || String(e)));
    }
  };

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

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダーバー */}
      <div className="shrink-0 border-b border-gray-700 bg-gray-800/50 px-5 py-3 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* タイトル */}
          <div>
            <span className="text-white font-black text-base">ギフト一覧</span>
            <span className="ml-2 text-gray-500 text-xs">TikTok ギフトを取得・一覧表示</span>
          </div>

          {/* ユーザー名 + 更新 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 shrink-0">TikTok:</span>
            <span className="text-gray-400 text-xs shrink-0">@</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onUpdate()}
              placeholder="akahoridouma"
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 w-48 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
            <button
              type="button"
              onClick={onUpdate}
              disabled={loading}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition ${
                loading
                  ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white"
              }`}
            >
              {loading ? "更新中…" : "🔄 更新"}
            </button>
          </div>

          {/* フォルダ / HTML */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenFolder}
              className="px-3 py-1.5 rounded-lg text-xs text-gray-300 border border-gray-600 hover:border-gray-400 hover:text-white transition"
            >
              📁 フォルダを開く
            </button>
            <button
              type="button"
              onClick={onOpenHtml}
              disabled={!exists}
              className={`px-3 py-1.5 rounded-lg text-xs border transition ${
                exists
                  ? "text-gray-300 border-gray-600 hover:border-gray-400 hover:text-white"
                  : "text-gray-600 border-gray-700 cursor-not-allowed"
              }`}
            >
              🌐 HTML を開く
            </button>
          </div>

          {/* 検索 + ソート */}
          <div className="flex items-center gap-2 ml-auto">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ID・名前で検索"
              className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-100 w-44 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              className="bg-gray-900 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-gray-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            >
              <option value="costAsc">コスト 低→高</option>
              <option value="costDesc">コスト 高→低</option>
              <option value="nameAsc">名前 A→Z</option>
            </select>
          </div>
        </div>

        {/* メタ情報 */}
        <div className="text-xs text-gray-500">
          {meta ? (
            <span>
              更新日時: {fmtDate(meta.generatedAt)} &nbsp;/&nbsp; @{meta.username} &nbsp;/&nbsp;{" "}
              <span className="text-cyan-400 font-bold">{filtered.length}</span> / {meta.count} 件
              {q && <span className="text-amber-400 ml-1">（絞り込み中）</span>}
            </span>
          ) : exists ? (
            <span>gifts.min.json を読み込みました</span>
          ) : (
            <span>「更新」ボタンでギフト一覧を取得してください。</span>
          )}
        </div>

        {/* エラー */}
        {err && (
          <div className="px-3 py-2 bg-red-900/40 border border-red-500/40 rounded-lg text-xs text-red-300">
            ❌ {err}
          </div>
        )}
      </div>

      {/* ギフトグリッド */}
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
            {loading ? "取得中…" : gifts.length === 0 ? "ギフトがありません" : "検索結果が0件です"}
          </div>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {filtered.map((g) => (
              <div
                key={g.id}
                className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex items-center gap-3 hover:border-gray-500 transition"
              >
                {/* 画像 */}
                <div
                  className={`w-14 h-14 rounded-xl bg-gray-700 flex items-center justify-center shrink-0 overflow-hidden ${
                    g.image ? "cursor-pointer hover:ring-2 hover:ring-cyan-500/60" : ""
                  }`}
                  title={g.image ? "クリックで透過画像をコピー" : undefined}
                  onClick={() => { if (g.image) onCopyImage(g.image); }}
                >
                  {g.image ? (
                    <img src={g.image} alt="" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-600 text-[10px]">no img</span>
                  )}
                </div>

                {/* テキスト */}
                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  title="クリックで ID をコピー"
                  onClick={() => onCopyText(String(g.id))}
                >
                  <div className="text-sm font-bold text-gray-100 truncate">{g.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    ID: <span className="text-cyan-400 font-bold">{g.id}</span>
                    &ensp;/&ensp;
                    💎 <span className="text-yellow-400 font-bold">{g.diamond_count}</span>
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">[ID コピー]</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* トースト通知 */}
      {toast && (
        <div
          key={toast.id}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-600 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-xl z-50 pointer-events-none"
          style={{ animation: "gvToastFade 2.5s ease-in-out forwards" }}
        >
          {toast.msg}
          <style>{`
            @keyframes gvToastFade {
              0%   { opacity: 0; transform: translate(-50%, 12px); }
              12%  { opacity: 1; transform: translate(-50%, 0); }
              88%  { opacity: 1; transform: translate(-50%, 0); }
              100% { opacity: 0; transform: translate(-50%, 12px); }
            }
          `}</style>
        </div>
      )}
    </div>
  );
};

export default GiftsViewerPage;
