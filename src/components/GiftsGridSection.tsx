// src/components/GiftsGridSection.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { GiftMapping } from "../types";

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;
type StatusFilter = "all" | "set" | "unset";

function getApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).mygamepack ?? null;
}

type Props = {
  selectedGiftId?: string;
  mappings: GiftMapping[];
  onPickGift: (giftId: string, giftName: string, image?: string | null, diamonds?: number) => void;
};

const GiftsGridSection: React.FC<Props> = ({ selectedGiftId, mappings, onPickGift }) => {
  const [loading, setLoading]           = useState(false);
  const [err, setErr]                   = useState<string | null>(null);
  const [gifts, setGifts]               = useState<Gift[]>([]);
  const [meta, setMeta]                 = useState<GiftsMeta>(null);
  const [q, setQ]                       = useState("");
  const [sort, setSort]                 = useState<"costAsc" | "costDesc" | "nameAsc">("costAsc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [toastMsg, setToastMsg]         = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 1800);
  };

  const mappingsByGiftId = useMemo(() => {
    const map: Record<string, GiftMapping> = {};
    for (const m of mappings) map[String(m.giftId)] = m;
    return map;
  }, [mappings]);

  const reload = useCallback(async () => {
    setErr(null);
    const api = getApi();
    if (!api?.giftsRead) { setErr("Electron API (giftsRead) が見つかりません。"); return; }
    try {
      const res = await api.giftsRead();
      setGifts(res.gifts || []);
      setMeta(res.meta ?? null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const onUpdate = async () => {
    setLoading(true);
    setErr(null);
    const api = getApi();
    if (!api?.giftsUpdate) { setErr("Electron API が見つかりません。"); setLoading(false); return; }
    try {
      let username = "";
      if (api.configRead) {
        try {
          const cfg = await api.configRead();
          username = cfg?.tiktokUsername ?? cfg?.tiktok?.username ?? cfg?.tiktok?.user ?? "";
        } catch { /* ignore */ }
      }
      if (!username.trim()) username = "akahoridouma";
      await api.giftsUpdate(username.trim().replace(/^@/, ""));
      await reload();
      showToast("ギフト一覧を更新しました ✓");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const uniqueGifts = useMemo(() => {
    const seen = new Set<string>();
    return gifts.filter((g) => {
      const id = String(g.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [gifts]);

  const setCount   = useMemo(() => uniqueGifts.filter((g) => !!(mappingsByGiftId[String(g.id)]?.commandFile)).length, [uniqueGifts, mappingsByGiftId]);
  const unsetCount = useMemo(() => uniqueGifts.length - setCount, [uniqueGifts, setCount]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = uniqueGifts.filter((g) => {
      if (s && !`${g.id} ${g.name}`.toLowerCase().includes(s)) return false;
      const isSet = !!(mappingsByGiftId[String(g.id)]?.commandFile);
      if (statusFilter === "set"   && !isSet) return false;
      if (statusFilter === "unset" &&  isSet) return false;
      return true;
    });
    if (sort === "nameAsc") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      arr.sort((a, b) => (a.diamond_count ?? 0) - (b.diamond_count ?? 0));
      if (sort === "costDesc") arr.reverse();
    }
    return arr;
  }, [uniqueGifts, q, sort, statusFilter, mappingsByGiftId]);

  const handleGiftClick = (g: Gift) => {
    onPickGift(String(g.id), g.name || "", g.image, g.diamond_count);
    showToast(`「${g.name}」を選択中`);
  };

  return (
    <div className="relative bg-gray-800 border border-gray-700 rounded-3xl shadow-xl overflow-hidden">

      {/* ── ヘッダー ── */}
      <div className="px-5 pt-5 pb-4 space-y-3">
        {/* タイトル行 */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-base font-black text-white">❶ ギフトを選ぶ</div>
            <div className="text-[11px] text-gray-500 mt-0.5">クリックで選択 → 下の編集パネルに反映</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {meta && (
              <span className="text-[10px] text-gray-600 hidden sm:block">
                {new Date(meta.generatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 更新
              </span>
            )}
            <button
              type="button"
              onClick={onUpdate}
              disabled={loading}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                loading ? "bg-gray-700 text-gray-500 cursor-not-allowed" : "bg-cyan-700 hover:bg-cyan-600 text-white"
              }`}
            >
              {loading ? "更新中…" : "🔄 更新"}
            </button>
          </div>
        </div>

        {/* フィルタータブ + 検索 + ソート */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* フィルタータブ（主役） */}
          <div className="flex items-center bg-gray-900/60 rounded-xl p-1 gap-1">
            {([
              { key: "all",   label: "すべて",   count: uniqueGifts.length },
              { key: "set",   label: "設定済み", count: setCount },
              { key: "unset", label: "未設定",   count: unsetCount },
            ] as { key: StatusFilter; label: string; count: number }[]).map(({ key, label, count }) => {
              const isActive = statusFilter === key;
              const activeColor =
                key === "set"   ? "bg-emerald-700 text-white shadow-sm" :
                key === "unset" ? "bg-red-800 text-white shadow-sm" :
                                  "bg-cyan-700 text-white shadow-sm";
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    isActive ? activeColor : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {label}
                  <span className={`ml-1.5 text-[10px] font-black ${
                    isActive ? "opacity-80" : "text-gray-600"
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* 検索 */}
          <div className="relative flex-1 min-w-[140px] max-w-[200px]">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-[10px]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="検索"
              className="w-full bg-gray-900 border border-gray-700 rounded-xl pl-7 pr-3 py-2 text-xs text-gray-100 outline-none focus:ring-2 focus:ring-cyan-500/50"
            />
          </div>

          {/* ソート */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-xs text-gray-100 outline-none focus:ring-2 focus:ring-cyan-500/30"
          >
            <option value="costAsc">💎 低→高</option>
            <option value="costDesc">💎 高→低</option>
            <option value="nameAsc">名前 A→Z</option>
          </select>

          <div className="text-[10px] text-gray-600">
            {filtered.length} 件表示
          </div>
        </div>
      </div>

      {/* エラー */}
      {err && (
        <div className="mx-5 mb-3 px-3 py-2 bg-red-900/40 border border-red-700/40 rounded-xl text-[10px] text-red-300 break-all">
          ❌ {err}
        </div>
      )}

      {/* ── ギフトグリッド ── */}
      <div className="px-5 pb-5 overflow-y-auto" style={{ maxHeight: "340px" }}>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-xs text-center">
            {loading
              ? "読み込み中…"
              : uniqueGifts.length === 0
              ? "「🔄 更新」ボタンでギフト一覧を取得してください"
              : "該当するギフトがありません"}
          </div>
        ) : (
          <div className="grid grid-cols-10 gap-2">
            {filtered.map((g) => {
              const id = String(g.id);
              const isSelected = id === selectedGiftId;
              const isSet      = !!(mappingsByGiftId[id]?.commandFile);

              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleGiftClick(g)}
                  title={`${g.name} (💎${g.diamond_count})`}
                  className={`relative flex flex-col items-center gap-1 p-2 rounded-xl transition-all border group ${
                    isSelected
                      ? "bg-cyan-900/70 border-cyan-400 ring-2 ring-cyan-400/40 shadow-lg shadow-cyan-900/50 scale-105"
                      : isSet
                      ? "bg-emerald-950/20 border-emerald-800/40 hover:border-emerald-600/60 hover:scale-105 hover:bg-emerald-950/40"
                      : "bg-red-950/10 border-red-900/30 hover:border-red-700/50 hover:scale-105 hover:bg-red-950/20"
                  }`}
                >
                  {/* 状態バッジ */}
                  <div className="absolute -top-1 -right-1 z-10">
                    <span className={`text-[7px] px-1 py-0.5 rounded-full font-black border leading-none ${
                      isSet
                        ? "bg-emerald-700 text-white border-emerald-600"
                        : "bg-red-800 text-red-200 border-red-700"
                    }`}>
                      {isSet ? "済" : "未"}
                    </span>
                  </div>

                  {/* 画像 */}
                  <div className={`w-11 h-11 rounded-lg flex items-center justify-center overflow-hidden ${
                    isSelected ? "bg-cyan-800/40" : "bg-gray-700/60"
                  }`}>
                    {g.image
                      ? <img src={g.image} alt="" className="w-full h-full object-contain" />
                      : <span className="text-gray-600 text-[6px]">no img</span>
                    }
                  </div>

                  {/* 名前 + コスト */}
                  <div className="text-center w-full">
                    <div className={`text-[9px] font-bold truncate leading-tight ${
                      isSelected ? "text-cyan-200" : "text-gray-300"
                    }`}>
                      {g.name}
                    </div>
                    <div className={`text-[9px] leading-tight ${
                      isSelected ? "text-cyan-400" : "text-gray-500"
                    }`}>
                      💎{g.diamond_count ?? 0}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* トースト */}
      {toastMsg && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-600 text-white px-5 py-2 rounded-full text-xs font-bold shadow-xl pointer-events-none z-20 whitespace-nowrap">
          {toastMsg}
        </div>
      )}
    </div>
  );
};

export default GiftsGridSection;
