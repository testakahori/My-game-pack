// src/components/GiftsGridSection.tsx
// ギフト設定の左の列「① ギフトを選ぶ」（2026-11-05 ユーザーの決定で3列に組み直した）。クリックで選ぶと、真ん中の列の上に出る。
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { GiftMapping } from "../types";
import { isDisabledMapping } from "../lib/giftMappingRows";
import { normalizeTikTokId } from "../lib/tiktokId";
import { ipcErrorMessage } from "../lib/ipcError";
import type { CatalogGift } from "../lib/giftBoard";
import DisabledMappingMark from "./DisabledMappingMark";

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type GiftsMeta = { generatedAt: string; username: string; count: number } | null;
type StatusFilter = "all" | "set" | "unset";
const GIFTS_PER_PAGE = 60;

function getApi() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).mygamepack ?? null;
}

type Props = {
  selectedGiftId?: string;
  mappings: GiftMapping[];
  onPickGift: (giftId: string, giftName: string, image?: string | null, diamonds?: number) => void;
  // 読んだギフトの一覧を渡す（右の列のマスにギフトの画像を出すため）。
  onGiftsLoaded?: (gifts: CatalogGift[]) => void;
};

const GiftsGridSection: React.FC<Props> = ({ selectedGiftId, mappings, onPickGift, onGiftsLoaded }) => {
  const [loading, setLoading]           = useState(false);
  const [err, setErr]                   = useState<string | null>(null);
  const [gifts, setGifts]               = useState<Gift[]>([]);
  const [meta, setMeta]                 = useState<GiftsMeta>(null);
  const [q, setQ]                       = useState("");
  const [sort, setSort]                 = useState<"costAsc" | "costDesc" | "nameAsc">("costAsc");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [toastMsg, setToastMsg]         = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 1800);
  };

  const mappingsByGiftId = useMemo(() => {
    const map: Record<string, GiftMapping> = {};
    for (const m of mappings) map[String(m.giftId)] = m;
    return map;
  }, [mappings]);

  const reload = useCallback(async (throwOnError = false) => {
    setErr(null);
    const api = getApi();
    if (!api?.giftsRead) { setErr("Electron API (giftsRead) が見つかりません。"); return; }
    try {
      const res = await api.giftsRead();
      setGifts(res.gifts || []);
      setMeta(res.meta ?? null);
    } catch (e: any) {
      setErr(ipcErrorMessage(e));
      if (throwOnError) throw e;
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => getApi()?.onGiftsUpdated?.(() => { void reload(); }), [reload]);
  useEffect(() => { onGiftsLoaded?.(gifts); }, [gifts, onGiftsLoaded]);

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
          // 読むのは tiktokUsername だけ（BRIDGE と同じ。処理のコピー PR9）。整えと確かめは main。
          username = typeof cfg?.tiktokUsername === "string" ? cfg.tiktokUsername : "";
        } catch { /* ignore */ }
      }
      if (!normalizeTikTokId(username)) throw new Error("配信ホームで TikTok ID を承認してください");
      await api.giftsUpdate(username);
      await reload(true);
      showToast("ギフト一覧を更新しました ✓");
    } catch (e: any) {
      setErr(ipcErrorMessage(e));
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

  useEffect(() => {
    if (selectedGiftId || uniqueGifts.length === 0) return;
    const firstGift = uniqueGifts[0];
    onPickGift(String(firstGift.id), firstGift.name || "", firstGift.image, firstGift.diamond_count);
  }, [selectedGiftId, uniqueGifts, onPickGift]);

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

  const pageCount = Math.max(1, Math.ceil(filtered.length / GIFTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * GIFTS_PER_PAGE;
  const visibleGifts = filtered.slice(pageStart, pageStart + GIFTS_PER_PAGE);

  return (
    <section className="gift-step gift-pick" aria-labelledby="gift-pick-title">
      <header className="gift-step-heading">
        <h2 id="gift-pick-title"><span>1</span>ギフトを選ぶ</h2>
        <button type="button" className="gift-step-tool" onClick={onUpdate} disabled={loading}
          title={meta ? `${new Date(meta.generatedAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} に更新` : undefined}>
          {loading ? "更新中…" : "↻ 更新"}
        </button>
      </header>

      <label className="gift-pick-search">
        <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
        <input
          aria-label="ギフト名で検索"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="ギフト名で検索"
        />
      </label>

      <div className="gift-pick-filters" role="group" aria-label="設定の状態で絞る">
        {([
          { key: "all",   label: "すべて",   count: uniqueGifts.length },
          { key: "set",   label: "設定済み", count: setCount },
          { key: "unset", label: "未設定",   count: unsetCount },
        ] as { key: StatusFilter; label: string; count: number }[]).map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            aria-pressed={statusFilter === key}
            className={statusFilter === key ? "is-active" : ""}
            onClick={() => { setStatusFilter(key); setPage(1); }}
          >
            {label}<em>{count}</em>
          </button>
        ))}
      </div>

      <label className="gift-pick-sort">
        <span aria-hidden="true">⇅</span>
        <select
          aria-label="並べ方"
          value={sort}
          onChange={(e) => { setSort(e.target.value as typeof sort); setPage(1); }}
        >
          <option value="costAsc">価格の安い順</option>
          <option value="costDesc">価格の高い順</option>
          <option value="nameAsc">名前順</option>
        </select>
      </label>

      {err && <p className="gift-pick-error" role="alert">❌ {err}</p>}

      <div className="gift-pick-scroll">
        {filtered.length === 0 ? (
          <div className="gift-pick-empty">
            {loading
              ? "読み込み中…"
              : uniqueGifts.length === 0
              ? "「↻ 更新」ボタンでギフト一覧を取得してください"
              : "該当するギフトがありません"}
          </div>
        ) : (
          <div className="gift-pick-grid">
            {visibleGifts.map((g) => {
              const id = String(g.id);
              const isSelected = id === selectedGiftId;
              const isSet      = !!(mappingsByGiftId[id]?.commandFile);
              // 無効の割り当ても「設定済み」に数える（割り当てはある。動かないだけ）。札だけを無効の印にする（処理のコピー PR8）。
              const isDisabled = isDisabledMapping(mappingsByGiftId[id]);

              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => handleGiftClick(g)}
                  title={`${g.name} (💎${g.diamond_count})${isSet ? "・設定済み" : ""}`}
                  aria-pressed={isSelected}
                  className={`gift-pick-tile${isSelected ? " is-selected" : ""}${isSet ? " is-set" : ""}`}
                >
                  {/* 設定済みは右上に緑の ✓（無効の割り当ては「無効」の印）。 */}
                  {isDisabled ? <span className="gift-pick-badge"><DisabledMappingMark compact /></span>
                    : isSet ? <span className="gift-pick-badge gift-pick-check" role="img" aria-label="設定済み">✓</span> : null}
                  <span className="gift-pick-art">
                    {g.image ? <img src={g.image} alt="" loading="lazy" decoding="async" /> : null}
                  </span>
                  <b>{g.name}</b>
                  <small>💎 {g.diamond_count ?? 0}</small>
                </button>
              );
            })}
          </div>
        )}
        {pageCount > 1 && (
        <nav className="gift-catalog-pagination gift-pick-pagination" aria-label="ギフト選択のページ">
          <button type="button" className="gift-catalog-action" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>前の60件</button>
          <span>{currentPage} / {pageCount}</span>
          <button type="button" className="gift-catalog-action" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>次の60件</button>
        </nav>
        )}
      </div>

      {toastMsg && <div className="gift-pick-toast" role="status">{toastMsg}</div>}
    </section>
  );
};

export default GiftsGridSection;
