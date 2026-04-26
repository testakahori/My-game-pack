// src/components/GiftsPanelInline.tsx
// ギフト設定画面の右パネル用ギフト一覧（インライン統合版）
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
  onPickGift: (giftId: string, giftName: string) => void;
};

const GiftsPanelInline: React.FC<Props> = ({ selectedGiftId, mappings, onPickGift }) => {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [meta, setMeta] = useState<GiftsMeta>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"costAsc" | "costDesc" | "nameAsc">("costAsc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2000);
  };

  // giftId → GiftMapping のマップ（設定済み判定・commandFile表示用）
  const mappingsByGiftId = useMemo(() => {
    const map: Record<string, GiftMapping> = {};
    for (const m of mappings) {
      map[String(m.giftId)] = m;
    }
    return map;
  }, [mappings]);

  const reload = useCallback(async () => {
    setErr(null);
    const api = getApi();
    if (!api?.giftsRead) {
      setErr("Electron API (giftsRead) が見つかりません。");
      return;
    }
    try {
      const res = await api.giftsRead();
      setGifts(res.gifts || []);
      setMeta(res.meta ?? null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const onUpdate = async () => {
    setLoading(true);
    setErr(null);
    const api = getApi();
    if (!api?.giftsUpdate) {
      setErr("Electron API が見つかりません。");
      setLoading(false);
      return;
    }
    try {
      let username = "";
      if (api.configRead) {
        try {
          const cfg = await api.configRead();
          username =
            cfg?.tiktokUsername ?? cfg?.tiktok?.username ?? cfg?.tiktok?.user ?? "";
        } catch {
          /* ignore */
        }
      }
      if (!username.trim()) username = "akahoridouma";
      username = username.trim().replace(/^@/, "");
      await api.giftsUpdate(username);
      await reload();
      showToast("ギフト一覧を更新しました");
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  // 同一IDの重複エントリーを除去（ギフトJSONに稀に重複が入ることへの対策）
  const uniqueGifts = useMemo(() => {
    const seen = new Set<string>();
    return gifts.filter((g) => {
      const id = String(g.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [gifts]);

  const setCount = useMemo(
    () => uniqueGifts.filter((g) => !!(mappingsByGiftId[String(g.id)]?.commandFile)).length,
    [uniqueGifts, mappingsByGiftId]
  );
  const unsetCount = useMemo(() => uniqueGifts.length - setCount, [uniqueGifts, setCount]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let arr = uniqueGifts.filter((g) => {
      if (s && !`${g.id} ${g.name}`.toLowerCase().includes(s)) return false;
      const isSet = !!(mappingsByGiftId[String(g.id)]?.commandFile);
      if (statusFilter === "set" && !isSet) return false;
      if (statusFilter === "unset" && isSet) return false;
      return true;
    });
    if (sort === "nameAsc") {
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      arr.sort((a, b) => (a.diamond_count ?? 0) - (b.diamond_count ?? 0));
      if (sort === "costDesc") arr.reverse();
    }
    return arr;
  }, [gifts, q, sort, statusFilter, mappingsByGiftId]);

  const handleGiftClick = (g: Gift) => {
    onPickGift(String(g.id), g.name || "");
    showToast(`「${g.name}」を選択`);
  };

  return (
    <div className="relative flex flex-col bg-gray-800 border border-gray-700 rounded-3xl overflow-hidden shadow-xl h-full">
      {/* ヘッダー */}
      <div className="shrink-0 p-4 border-b border-gray-700 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-black text-cyan-200">ギフト一覧</div>
            <div className="text-[10px] text-gray-500 mt-0.5">クリックで左フォームに反映</div>
          </div>
          <button
            type="button"
            onClick={onUpdate}
            disabled={loading}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              loading
                ? "bg-gray-700 text-gray-500 cursor-not-allowed"
                : "bg-cyan-700 hover:bg-cyan-600 text-white"
            }`}
            title="TikTokからギフト一覧を再取得"
          >
            {loading ? "更新中…" : "🔄 更新"}
          </button>
        </div>

        {/* 検索 */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 ID・名前で検索"
          className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2 text-sm text-gray-100 outline-none focus:ring-2 focus:ring-cyan-500/50"
        />

        {/* ソート */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-100 outline-none"
        >
          <option value="costAsc">コスト 低→高</option>
          <option value="costDesc">コスト 高→低</option>
          <option value="nameAsc">名前 A→Z</option>
        </select>

        {/* ステータスフィルター */}
        <div className="flex items-center gap-1">
          {(["all", "set", "unset"] as StatusFilter[]).map((f) => {
            const label =
              f === "all"
                ? `すべて (${uniqueGifts.length})`
                : f === "set"
                ? `設定済 (${setCount})`
                : `未設定 (${unsetCount})`;
            const activeClass =
              statusFilter === f
                ? f === "set"
                  ? "bg-green-700 border-green-600 text-white"
                  : f === "unset"
                  ? "bg-red-800 border-red-700 text-white"
                  : "bg-cyan-700 border-cyan-600 text-white"
                : "bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800";
            return (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition border ${activeClass}`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* メタ情報 */}
        {meta ? (
          <div className="text-[10px] text-gray-500 truncate">
            更新: {new Date(meta.generatedAt).toLocaleString("ja-JP")} / {filtered.length}件表示
          </div>
        ) : gifts.length === 0 ? (
          <div className="text-[10px] text-amber-400">
            「🔄 更新」を押してギフトを取得してください
          </div>
        ) : null}

        {err && (
          <div className="px-2 py-1.5 bg-red-900/40 border border-red-700/40 rounded-lg text-[10px] text-red-300 break-all">
            ❌ {err}
          </div>
        )}
      </div>

      {/* ギフトグリッド（2列） */}
      <div className="flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-xs text-center px-4">
            {loading
              ? "読み込み中…"
              : uniqueGifts.length === 0
              ? "「🔄 更新」でギフト一覧を取得してください"
              : "該当するギフトがありません"}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map((g) => {
              const id = String(g.id);
              const isSelected = id === selectedGiftId;
              const isSet = !!(mappingsByGiftId[id]?.commandFile);

              return (
                <div
                  key={g.id}
                  onClick={() => handleGiftClick(g)}
                  className={`relative flex flex-col items-center gap-1 p-2 rounded-xl cursor-pointer transition-all border ${
                    isSelected
                      ? "bg-cyan-900/60 border-cyan-500 ring-1 ring-cyan-500/40 shadow-md"
                      : isSet
                      ? "bg-gray-900/50 border-gray-700 hover:border-gray-500 hover:bg-gray-900/70"
                      : "bg-red-900/10 border-red-800/40 hover:border-red-700/60"
                  }`}
                  title={g.name}
                >
                  {/* 状態バッジ（右上） */}
                  <div className="absolute top-1 right-1">
                    <span
                      className={`text-[8px] px-1 py-0.5 rounded-full font-bold border leading-none ${
                        isSet
                          ? "bg-green-900/70 text-green-400 border-green-800/60"
                          : "bg-red-900/70 text-red-400 border-red-800/60"
                      }`}
                    >
                      {isSet ? "済" : "未"}
                    </span>
                  </div>

                  {/* ギフト画像 */}
                  <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center overflow-hidden">
                    {g.image ? (
                      <img src={g.image} alt="" className="w-full h-full object-contain" />
                    ) : (
                      <span className="text-gray-600 text-[7px]">no img</span>
                    )}
                  </div>

                  {/* ギフト名 + ID */}
                  <div className="text-center w-full">
                    <div className={`text-[10px] font-bold truncate leading-tight ${isSelected ? "text-cyan-200" : "text-gray-200"}`}>
                      {g.name}
                    </div>
                    <div className={`text-[9px] leading-tight ${isSelected ? "text-cyan-400" : "text-gray-600"}`}>
                      {g.id}
                    </div>
                  </div>

                  {/* 選択中インジケーター */}
                  {isSelected && (
                    <div className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* トースト */}
      {toastMsg && (
        <div className="absolute bottom-3 left-2 right-2 bg-gray-900 border border-gray-600 text-white px-3 py-1.5 rounded-full text-xs font-medium text-center shadow-xl pointer-events-none z-10">
          {toastMsg}
        </div>
      )}
    </div>
  );
};

export default GiftsPanelInline;
