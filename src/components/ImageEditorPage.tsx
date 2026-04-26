// src/components/ImageEditorPage.tsx
// 画像編集ページ: 登録済みギフトを6列×2段のグリッドに並べてPNG保存
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GiftMapping } from "../types";

// ─── 型定義 ──────────────────────────────────────────────────────────────────

type Gift = { id: number; name: string; diamond_count: number; image?: string | null };
type CommandMeta = { name: string; title: string; category: string };

type GiftCardData = {
  instanceId: string;
  giftId: string;
  giftName: string;
  giftImageUrl: string | null;
  title: string;       // \n で明示改行可
  category: string;
  repeat: number;
  bgColor: string;
};

type Props = { mappings: GiftMapping[] };

// ─── カテゴリ → 背景色 ───────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "妨害系": "#778FFF",
  "お助け系": "#FF8181",
  "友好MOB": "#FF8181",
};
const DEFAULT_BG = "#8FA8C8";

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category?.trim()] ?? DEFAULT_BG;
}

// ─── Electron API ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getApi(): any { return (window as any).mygamepack ?? null; }

// ─── Canvas ユーティリティ ────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y); ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius); ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** 1セグメント（改行なし）を maxWidth に収まるよう行分割 */
function wrapSegment(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (!text) return [""];
  if (ctx.measureText(text).width <= maxWidth) return [text];
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur.length > 0) { lines.push(cur); cur = ch; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** タイトル文字列（\n で明示改行）→ canvas 描画行配列 */
function getTextLines(ctx: CanvasRenderingContext2D, title: string, maxWidth: number): string[] {
  return title.split("\n").flatMap((seg) => wrapSegment(ctx, seg, maxWidth));
}

/** カード1枚を描画 */
function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  card: GiftCardData,
  img: HTMLImageElement | null,
  fontSize: number,
  highlight = false,
) {
  const bw = 3;
  const cr = Math.min(12, w * 0.08, h * 0.08);

  ctx.save();

  // 黒縁
  roundRect(ctx, x, y, w, h, cr);
  ctx.fillStyle = highlight ? "#00FFFF" : "#000000";
  ctx.fill();

  // 背景色
  roundRect(ctx, x + bw, y + bw, w - bw * 2, h - bw * 2, Math.max(1, cr - bw));
  ctx.fillStyle = card.bgColor;
  ctx.fill();

  // カード内クリップ
  roundRect(ctx, x + bw, y + bw, w - bw * 2, h - bw * 2, Math.max(1, cr - bw));
  ctx.clip();

  // ギフト画像（上58%）
  const imgAreaH = h * 0.58;
  const imgPad = 6;
  const imgAreaX = x + bw + imgPad;
  const imgAreaY = y + bw + imgPad;
  const imgAreaW = w - bw * 2 - imgPad * 2;
  const imgAreaHInner = imgAreaH - imgPad * 2;

  if (img && img.naturalWidth > 0) {
    const scale = Math.min(imgAreaW / img.naturalWidth, imgAreaHInner / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, imgAreaX + (imgAreaW - dw) / 2, imgAreaY + (imgAreaHInner - dh) / 2, dw, dh);
  }

  // テキストエリア（下42%）
  const textAreaY = y + h * 0.58;
  const textAreaH = h - h * 0.58 - bw;
  const maxTW = w - (bw + 5) * 2;
  const fs = Math.max(8, fontSize);

  ctx.font = `bold ${fs}px "Yu Gothic","Meiryo",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const titleLines = getTextLines(ctx, card.title || card.giftName, maxTW);
  const lineH = fs * 1.25;
  const repFs = Math.max(7, Math.round(fs * 0.82));
  const repText = card.repeat > 1 ? `×${card.repeat}` : "";
  const repH = repText ? repFs * 1.4 : 0;
  const totalH = titleLines.length * lineH + repH;
  let ty = textAreaY + Math.max(2, (textAreaH - totalH) / 2);

  ctx.font = `bold ${fs}px "Yu Gothic","Meiryo",sans-serif`;
  for (const line of titleLines) {
    ctx.strokeStyle = "rgba(0,0,0,0.95)"; ctx.lineWidth = 3.5; ctx.lineJoin = "round";
    ctx.strokeText(line, x + w / 2, ty);
    ctx.fillStyle = "#FFFFFF"; ctx.fillText(line, x + w / 2, ty);
    ty += lineH;
  }
  if (repText) {
    ctx.font = `bold ${repFs}px "Yu Gothic","Meiryo",sans-serif`;
    ctx.strokeStyle = "rgba(0,0,0,0.95)"; ctx.lineWidth = 2.5;
    ctx.strokeText(repText, x + w / 2, ty);
    ctx.fillStyle = "#FFFFFF"; ctx.fillText(repText, x + w / 2, ty);
  }

  ctx.restore();

  // ハイライト枠（編集中）
  if (highlight) {
    ctx.save();
    roundRect(ctx, x + 1, y + 1, w - 2, h - 2, cr);
    ctx.strokeStyle = "#00E5FF";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.restore();
  }
}

// ─── カウンター ───────────────────────────────────────────────────────────────

let _cnt = 0;
function newId() { return `ie_${Date.now()}_${++_cnt}`; }

// ─── コンポーネント ───────────────────────────────────────────────────────────

const ImageEditorPage: React.FC<Props> = ({ mappings }) => {
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [commandMeta, setCommandMeta] = useState<Record<string, CommandMeta>>({});
  const [selectedCards, setSelectedCards] = useState<GiftCardData[]>([]);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // 編集中スロット
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [origTitle, setOrigTitle] = useState("");

  // レイアウト設定
  const [cols, setCols] = useState(6);
  const [rows, setRows] = useState(2);
  const [canvasWidth, setCanvasWidth] = useState(1080);
  const [canvasHeight, setCanvasHeight] = useState(480);
  const [fontSize, setFontSize] = useState(14);
  const [gap, setGap] = useState(8);
  const [padding, setPadding] = useState(8);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const [imgLoadTick, setImgLoadTick] = useState(0);

  // ─ データ読み込み ─
  useEffect(() => {
    getApi()?.giftsRead?.()
      .then((res: { gifts: Gift[] }) => setGifts(res?.gifts ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getApi()?.bridgeCommandsReadMeta?.()
      .then((list: CommandMeta[]) => {
        const map: Record<string, CommandMeta> = {};
        for (const m of list) map[m.name] = m;
        setCommandMeta(map);
      })
      .catch(() => {});
  }, []);

  // ─ 利用可能ギフト ─
  const availableCards = useMemo<GiftCardData[]>(() =>
    mappings
      .filter((m) => m.commandFile)
      .map((m) => {
        const gift = gifts.find((g) => String(g.id) === String(m.giftId));
        const meta = commandMeta[m.commandFile] ?? null;
        const title = meta?.title ?? m.commandFile.replace(/\.txt$/i, "");
        const category = meta?.category ?? "";
        return {
          instanceId: `avail_${m.id}`,
          giftId: m.giftId,
          giftName: m.name || gift?.name || m.giftId,
          giftImageUrl: gift?.image ?? null,
          title,
          category,
          repeat: m.repeat ?? 1,
          bgColor: getCategoryColor(category),
        };
      }),
  [mappings, gifts, commandMeta]);

  // ─ 画像プリロード ─
  useEffect(() => {
    const api = getApi();
    if (!api?.gvGiftsFetchImageBase64) return;
    for (const card of selectedCards) {
      const url = card.giftImageUrl;
      if (!url || imageCache.current.has(url)) continue;
      imageCache.current.set(url, null);
      api.gvGiftsFetchImageBase64(url)
        .then((b64: string) => {
          if (!b64) return;
          const img = new Image();
          img.onload = () => { imageCache.current.set(url, img); setImgLoadTick((n) => n + 1); };
          img.src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
        })
        .catch(() => { imageCache.current.set(url, null); });
    }
  }, [selectedCards]);

  // ─ キャンバス描画 ─
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const cardW = (canvasWidth - padding * 2 - gap * Math.max(0, cols - 1)) / cols;
    const cardH = (canvasHeight - padding * 2 - gap * Math.max(0, rows - 1)) / rows;

    for (let i = 0; i < Math.min(selectedCards.length, cols * rows); i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (cardW + gap);
      const y = padding + row * (cardH + gap);
      const card = selectedCards[i];
      const img = card.giftImageUrl ? (imageCache.current.get(card.giftImageUrl) ?? null) : null;
      drawCard(ctx, x, y, cardW, cardH, card, img, fontSize, editingIdx === i);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCards, cols, rows, canvasWidth, canvasHeight, fontSize, gap, padding, imgLoadTick, editingIdx]);

  // ─ スロット操作 ─
  const maxSlots = cols * rows;

  const addCard = useCallback((card: GiftCardData) => {
    setSelectedCards((prev) => {
      if (prev.length >= maxSlots) return prev;
      return [...prev, { ...card, instanceId: newId() }];
    });
  }, [maxSlots]);

  const removeCard = useCallback((idx: number) => {
    setSelectedCards((prev) => prev.filter((_, i) => i !== idx));
    setEditingIdx((cur) => (cur === idx ? null : cur !== null && cur > idx ? cur - 1 : cur));
  }, []);

  const updateCard = useCallback((idx: number, patch: Partial<GiftCardData>) => {
    setSelectedCards((prev) => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  }, []);

  const clearCards = useCallback(() => {
    setSelectedCards([]);
    setEditingIdx(null);
  }, []);

  // ─ 編集開始 ─
  const startEdit = useCallback((idx: number, card: GiftCardData) => {
    setEditingIdx(idx);
    setOrigTitle(card.title);
  }, []);

  const closeEdit = useCallback(() => setEditingIdx(null), []);

  // ─ プレビュークリック → カード検出 ─
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const cardW = (canvasWidth - padding * 2 - gap * Math.max(0, cols - 1)) / cols;
    const cardH = (canvasHeight - padding * 2 - gap * Math.max(0, rows - 1)) / rows;

    for (let i = 0; i < Math.min(selectedCards.length, cols * rows); i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padding + col * (cardW + gap);
      const y = padding + row * (cardH + gap);
      if (cx >= x && cx <= x + cardW && cy >= y && cy <= y + cardH) {
        if (editingIdx === i) { setEditingIdx(null); }
        else { startEdit(i, selectedCards[i]); }
        return;
      }
    }
    setEditingIdx(null);
  }, [canvasWidth, canvasHeight, padding, gap, cols, rows, selectedCards, editingIdx, startEdit]);

  // ─ ドラッグ並び替え ─
  const handleDragStart = (idx: number) => setDragFromIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDrop = (toIdx: number) => {
    if (dragFromIdx !== null && dragFromIdx !== toIdx) {
      setSelectedCards((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragFromIdx, 1);
        next.splice(toIdx, 0, moved);
        return next;
      });
      setEditingIdx((cur) => {
        if (cur === null) return null;
        if (cur === dragFromIdx) return toIdx;
        if (dragFromIdx! < cur && toIdx >= cur) return cur - 1;
        if (dragFromIdx! > cur && toIdx <= cur) return cur + 1;
        return cur;
      });
    }
    setDragFromIdx(null); setDragOverIdx(null);
  };
  const handleDragEnd = () => { setDragFromIdx(null); setDragOverIdx(null); };

  // ─ PNG 書き出し ─
  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `gift_panel_${cols}x${rows}_${canvasWidth}x${canvasHeight}.png`;
    a.click();
  };

  // 現在編集中のカード
  const editingCard = editingIdx !== null ? selectedCards[editingIdx] ?? null : null;

  const legend = Object.entries(CATEGORY_COLORS).filter(
    ([k], i, arr) => arr.findIndex(([k2]) => k2 === k) === i,
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-10">

      {/* ─ 設定バー ─ */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4">
        <div className="text-sm font-bold text-gray-100 mb-3">キャンバス設定</div>
        <div className="flex flex-wrap gap-3 items-end">
          {([
            ["列数", cols, setCols, 1, 12],
            ["行数", rows, setRows, 1, 8],
          ] as [string, number, (v: number) => void, number, number][]).map(([lbl, val, set, mn, mx]) => (
            <label key={lbl} className="flex flex-col gap-1">
              <span className="text-xs text-gray-400">{lbl}</span>
              <input type="number" min={mn} max={mx} value={val}
                onChange={(e) => set(Math.max(mn, Math.min(mx, Number(e.target.value))))}
                className="w-16 bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5" />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">幅 (px)</span>
            <input type="number" min={400} max={3840} step={10} value={canvasWidth}
              onChange={(e) => setCanvasWidth(Math.max(400, Number(e.target.value)))}
              className="w-24 bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">高さ (px)</span>
            <input type="number" min={200} max={2160} step={10} value={canvasHeight}
              onChange={(e) => setCanvasHeight(Math.max(200, Number(e.target.value)))}
              className="w-24 bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">文字サイズ</span>
            <input type="number" min={8} max={48} value={fontSize}
              onChange={(e) => setFontSize(Math.max(8, Math.min(48, Number(e.target.value))))}
              className="w-20 bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">カード間隔</span>
            <input type="number" min={0} max={32} value={gap}
              onChange={(e) => setGap(Math.max(0, Math.min(32, Number(e.target.value))))}
              className="w-20 bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-400">外側余白</span>
            <input type="number" min={0} max={32} value={padding}
              onChange={(e) => setPadding(Math.max(0, Math.min(32, Number(e.target.value))))}
              className="w-20 bg-gray-900 border border-gray-700 text-white text-sm rounded-lg px-2 py-1.5" />
          </label>
          <div className="ml-auto">
            <button type="button" onClick={exportPng} disabled={selectedCards.length === 0}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold rounded-xl text-sm transition flex items-center gap-2">
              <i className="fa-solid fa-download" />PNG保存
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {legend.map(([cat, color]) => (
            <span key={cat} className="flex items-center gap-1.5 text-xs text-gray-300">
              <span className="inline-block w-3 h-3 rounded border border-black" style={{ background: color }} />
              {cat}
            </span>
          ))}
          <span className="flex items-center gap-1.5 text-xs text-gray-300">
            <span className="inline-block w-3 h-3 rounded border border-black" style={{ background: DEFAULT_BG }} />
            その他
          </span>
        </div>
      </div>

      {/* ─ 2カラム: 利用可能ギフト ｜ 選択済みスロット ─ */}
      <div className="grid grid-cols-2 gap-4">

        {/* 利用可能ギフト */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4">
          <div className="text-sm font-bold text-gray-100 mb-2">
            登録済みギフト
            <span className="text-xs text-gray-400 font-normal ml-2">クリックで追加</span>
          </div>
          {availableCards.length === 0 ? (
            <p className="text-xs text-gray-500 py-6 text-center">「ギフト設定」タブでギフトを登録してください</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto pr-1">
              {availableCards.map((card) => (
                <button key={card.instanceId} type="button" onClick={() => addCard(card)}
                  disabled={selectedCards.length >= maxSlots}
                  title={`${card.giftName} - ${card.title}`}
                  className="flex flex-col items-center gap-1 p-2 rounded-xl border border-gray-600 hover:border-cyan-500 hover:bg-gray-700 transition disabled:opacity-40 bg-gray-900"
                  style={{ width: 68 }}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-black/30 overflow-hidden"
                    style={{ background: card.bgColor }}>
                    {card.giftImageUrl
                      ? <img src={card.giftImageUrl} alt={card.giftName} className="w-full h-full object-contain" />
                      : <i className="fa-solid fa-gift text-white/70 text-lg" />}
                  </div>
                  <div className="text-[10px] text-gray-300 truncate w-full text-center">{card.title}</div>
                  {card.repeat > 1 && <div className="text-[9px] text-gray-400">×{card.repeat}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 選択済みスロット */}
        <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-bold text-gray-100">
              選択中
              <span className="text-xs text-gray-400 font-normal ml-2">
                {selectedCards.length}/{maxSlots} ｜ ドラッグで並び替え
              </span>
            </div>
            {selectedCards.length > 0 && (
              <button type="button" onClick={clearCards}
                className="text-xs text-gray-400 hover:text-red-400 transition px-2 py-1 rounded-lg hover:bg-gray-700">
                全クリア
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto pr-1">
            {Array.from({ length: maxSlots }).map((_, idx) => {
              const card = selectedCards[idx];
              const isEdit = editingIdx === idx;
              const isDragSrc = dragFromIdx === idx;
              const isDragOver = dragOverIdx === idx;
              return (
                <div key={idx}
                  draggable={!!card}
                  onDragStart={() => card && handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={() => handleDrop(idx)}
                  onDragEnd={handleDragEnd}
                  className={[
                    "relative flex flex-col items-center gap-1 p-2 rounded-xl border transition select-none",
                    card
                      ? isDragSrc ? "opacity-40 border-gray-600 bg-gray-900 cursor-grabbing"
                        : isEdit ? "border-cyan-400 bg-cyan-950/40 cursor-pointer"
                          : "cursor-grab bg-gray-900 border-gray-600 hover:border-gray-500"
                      : "border-dashed border-gray-700 bg-gray-900/20",
                    isDragOver && !isDragSrc ? "border-cyan-500 bg-cyan-950/30" : "",
                  ].join(" ")}
                  style={{ width: 68 }}
                  onClick={() => card && (isEdit ? closeEdit() : startEdit(idx, card))}
                >
                  <span className="absolute top-1 left-1.5 text-[9px] text-gray-600">{idx + 1}</span>
                  {card ? (
                    <>
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center border border-black/30 overflow-hidden"
                        style={{ background: card.bgColor }}>
                        {card.giftImageUrl
                          ? <img src={card.giftImageUrl} alt={card.giftName} className="w-full h-full object-contain" />
                          : <i className="fa-solid fa-gift text-white/70 text-lg" />}
                      </div>
                      <div className="text-[10px] text-gray-300 truncate w-full text-center">{card.title.replace(/\n/g, " ")}</div>
                      {isEdit && (
                        <span className="absolute top-0.5 right-0.5 text-[8px] text-cyan-400">
                          <i className="fa-solid fa-pen" />
                        </span>
                      )}
                      <button type="button"
                        onClick={(e) => { e.stopPropagation(); removeCard(idx); }}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 hover:bg-red-500 text-white rounded-full text-[9px] flex items-center justify-center leading-none shadow">
                        ×
                      </button>
                    </>
                  ) : (
                    <div className="w-10 h-10 rounded-lg border border-dashed border-gray-700" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ─ カード編集パネル（選択中のみ表示）─ */}
      {editingCard && editingIdx !== null && (
        <div className="bg-gray-800 border border-cyan-700/50 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-bold text-cyan-300 flex items-center gap-2">
              <i className="fa-solid fa-pen" />
              スロット #{editingIdx + 1} を編集中
              <span className="text-gray-400 font-normal text-xs">{editingCard.giftName}</span>
            </div>
            <button type="button" onClick={closeEdit}
              className="text-xs text-gray-400 hover:text-gray-200 px-2 py-1 rounded-lg hover:bg-gray-700 transition">
              閉じる
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* タイトルテキスト */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                タイトルテキスト
                <span className="text-gray-600 ml-2">（Enter で改行・自動折り返しも有効）</span>
              </label>
              <textarea
                value={editingCard.title}
                onChange={(e) => updateCard(editingIdx, { title: e.target.value })}
                rows={4}
                className="w-full bg-gray-900 border border-gray-600 focus:border-cyan-500 text-white text-sm rounded-xl px-3 py-2 resize-y outline-none"
                placeholder="タイトルを入力（Enterで改行）"
              />
              <div className="flex gap-2 mt-1.5">
                <button type="button"
                  onClick={() => updateCard(editingIdx, { title: origTitle })}
                  disabled={editingCard.title === origTitle}
                  className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40 px-2 py-1 rounded-lg hover:bg-gray-700 transition">
                  元に戻す
                </button>
                <button type="button"
                  onClick={() => updateCard(editingIdx, { title: editingCard.title + "\n" })}
                  className="text-xs text-gray-500 hover:text-gray-300 px-2 py-1 rounded-lg hover:bg-gray-700 transition">
                  + 改行を追加
                </button>
              </div>
            </div>

            {/* 数量 + 背景色 */}
            <div className="space-y-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-gray-400">数量（×N 表示、1 のとき非表示）</span>
                <input type="number" min={1} max={999} value={editingCard.repeat}
                  onChange={(e) => updateCard(editingIdx, { repeat: Math.max(1, Number(e.target.value)) })}
                  className="w-24 bg-gray-900 border border-gray-600 focus:border-cyan-500 text-white text-sm rounded-xl px-3 py-2 outline-none" />
              </label>

              <div>
                <span className="text-xs text-gray-400 block mb-1">背景色</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={editingCard.bgColor}
                    onChange={(e) => updateCard(editingIdx, { bgColor: e.target.value })}
                    className="w-10 h-9 rounded-lg border border-gray-600 cursor-pointer bg-transparent" />
                  <code className="text-xs text-gray-300">{editingCard.bgColor}</code>
                  <button type="button"
                    onClick={() => updateCard(editingIdx, { bgColor: getCategoryColor(editingCard.category) })}
                    disabled={editingCard.bgColor === getCategoryColor(editingCard.category)}
                    className="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40 px-2 py-1 rounded-lg hover:bg-gray-700 transition">
                    カテゴリ色に戻す
                  </button>
                </div>

                {/* カテゴリ色クイック選択 */}
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {Object.entries({
                    ...CATEGORY_COLORS,
                    "その他": DEFAULT_BG,
                  }).filter(([, v], i, a) => a.findIndex(([, v2]) => v2 === v) === i)
                    .map(([label, color]) => (
                      <button key={color} type="button"
                        onClick={() => updateCard(editingIdx, { bgColor: color })}
                        title={label}
                        className={[
                          "w-6 h-6 rounded-md border-2 transition",
                          editingCard.bgColor === color ? "border-white scale-110" : "border-transparent hover:border-gray-400",
                        ].join(" ")}
                        style={{ background: color }} />
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─ キャンバスプレビュー ─ */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-bold text-gray-100">
            プレビュー
            <span className="text-xs text-gray-400 font-normal ml-2">
              {canvasWidth}×{canvasHeight}px ｜ 透過PNG
            </span>
            {selectedCards.length > 0 && (
              <span className="text-xs text-gray-500 font-normal ml-2">
                （カードをクリックして編集）
              </span>
            )}
          </div>
          <button type="button" onClick={exportPng} disabled={selectedCards.length === 0}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5">
            <i className="fa-solid fa-download" />PNG保存
          </button>
        </div>

        <div className="rounded-xl overflow-auto"
          style={{ backgroundImage: "repeating-conic-gradient(#555 0% 25%, #333 0% 50%)", backgroundSize: "16px 16px" }}>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            style={{
              display: "block", width: "100%", imageRendering: "auto",
              cursor: selectedCards.length > 0 ? "pointer" : "default",
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default ImageEditorPage;
