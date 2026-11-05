// ギフト設定の右の列「③ 登録済みギフト」（2026-11-05 ユーザーの決定）。
// 6列 × 9段で1ページ、入りきらない分は次のページ（右上の ◀▶ で替える）。マスはドラッグで並べ替え（ギフトのあるマスへ落とすと入れ替え、空いたマスへ落とすと最後へ）。
// ドラッグしたまま ◀▶ に載せると、ページがめくれる（ページをまたいで動かせる）。並び順は設定の mappings の順として保存する。
// 「このページを保存」「全ページを保存」は、見出し・BRIDGE のアイコンごと 1080 × 1920 の PNG にする（src/lib/giftBoardCanvas.ts）。
// ✖（マウスを載せたときだけ）・無効の印・◀▶ は画面だけで、PNG には描かない。
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GiftMapping } from "../types";
// アイコンは data URL で読む（file:// の画像を canvas に描くと、PNG に書き出せなくなることがあるため）。
import appIcon from "../../assets/app-icon.png?inline";
import DisabledMappingMark from "./DisabledMappingMark";
import { boardFilename, boardItems, boardLayout, boardPageCount, boardPageItems, boardPageOf, boardPngItems, boardTitle, clampBoardPage, fitBoardText, BOARD_CELL_TEXT, BOARD_CELLS, BOARD_FONT, type BoardCommand, type BoardItem, type CatalogGift } from "../lib/giftBoard";
import { drawGiftBoard } from "../lib/giftBoardCanvas";
import { createGiftImageCache, loadImage } from "../lib/giftImageCache";
import { ipcErrorMessage } from "../lib/ipcError";

type Props = {
  mappings: GiftMapping[];
  gifts: CatalogGift[];
  commandFiles: BoardCommand[];
  gameName?: string;
  selectedGiftId?: string;
  onPickGift: (giftId: string, giftName: string, image?: string | null, diamonds?: number) => void;
  onRemove: (id: string) => void;
  onMove: (fromId: string, toId: string | null) => void;
};
type Notice = { type: "ok" | "error"; text: string };

// ドラッグしたまま ◀▶ に載せて、ページをめくるまでの間。
const FLIP_DELAY_MS = 650;
type Fit = { size: number; lines: string[] };

// 画面の一覧の文字も、PNG と同じ決め方（fitBoardText）で縮めて折り返す。大きさは PNG の px を幅 1080 の割合（cqw）にして書く。
function createFitter() {
  const ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const cache = new Map<string, Fit>();
  return (text: string, width: number, height: number, preferred: number, weight: number): Fit => {
    if (!ctx) return { size: preferred, lines: [text] };
    const key = [weight, preferred, width, height, text].join("|");
    let fit = cache.get(key);
    if (!fit) {
      fit = fitBoardText(text, width, height, preferred, (value, size) => { ctx.font = `${weight} ${size}px ${BOARD_FONT}`; return ctx.measureText(value).width; });
      cache.set(key, fit);
    }
    return fit;
  };
}

export default function RegisteredGiftBoard({ mappings, gifts, commandFiles, gameName, selectedGiftId, onPickGift, onRemove, onMove }: Props) {
  const items = useMemo(() => boardItems(mappings, gifts, commandFiles), [mappings, gifts, commandFiles]);
  const pageCount = boardPageCount(items.length);
  const [page, setPage] = useState(1);
  const current = clampBoardPage(page, items.length);
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, i) => boardPageItems(items, i + 1)), [items, pageCount]);
  const title = boardTitle(gameName);
  const layout = boardLayout();
  const [fit] = useState(createFitter);
  const cqw = (px: number) => `${(px / layout.width * 100).toFixed(3)}cqw`;
  const textWidth = layout.cellWidth - BOARD_CELL_TEXT.inset;

  // 選んだギフト（と、登録して増えたギフト）のあるページを開く。並べ替えと ✖ で消したときは開き直さない
  // （前は ✖ のたびに編集中のギフトのページへ戻り、2ページ目でいくつも消すのに毎回 ▶ を押し直した。2026-11-05 レビュー）。
  const selectedIndex = items.findIndex(item => item.giftId === selectedGiftId);
  const shown = useRef<{ selected?: string; count: number }>({ count: 0 });
  useEffect(() => {
    const before = shown.current;
    shown.current = { selected: selectedGiftId, count: items.length };
    if (selectedIndex >= 0 && (before.selected !== selectedGiftId || items.length > before.count)) setPage(boardPageOf(selectedIndex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGiftId, items.length]);

  // ── 並べ替え ──
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopFlip = () => { if (flipTimer.current) clearTimeout(flipTimer.current); flipTimer.current = null; };
  const endDrag = () => { dragId.current = null; setDragging(null); setDropTarget(null); stopFlip(); };
  useEffect(() => stopFlip, []);
  const flipWhileDragging = (delta: number) => (event: React.DragEvent) => {
    if (!dragId.current) return;
    event.preventDefault();
    if (flipTimer.current) return;
    flipTimer.current = setTimeout(() => { flipTimer.current = null; setPage(value => clampBoardPage(clampBoardPage(value, items.length) + delta, items.length)); }, FLIP_DELAY_MS);
  };
  const dropOn = (targetId: string | null) => (event: React.DragEvent) => {
    event.preventDefault();
    const from = dragId.current;
    endDrag();
    if (from && from !== targetId) onMove(from, targetId);
  };
  const dragOver = (key: string) => (event: React.DragEvent) => {
    if (!dragId.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(key);
  };

  // ── PNG のためのギフトの画像 ──
  const [cache] = useState(() => createGiftImageCache<HTMLImageElement>({
    fetchDataUrl: url => window.mygamepack.gvGiftsFetchImageBase64(url),
    decode: loadImage,
  }));
  const [, setImageTick] = useState(0);
  useEffect(() => cache.subscribe(() => setImageTick(value => value + 1)), [cache]);
  // PNG に描くのは無効の割り当てを除いたマス（boardPngItems）。絵を取りに行くのもそれだけ。
  const pngPages = useMemo(() => pages.map(boardPngItems), [pages]);
  const allUrls = useMemo(() => [...new Set(pngPages.flat().map(item => item.image).filter((url): url is string => Boolean(url)))], [pngPages]);
  useEffect(() => { cache.request(allUrls); }, [cache, allUrls]);
  const all = cache.summary(allUrls);
  const pngPageItems = pngPages[current - 1] ?? [];
  const thisPage = cache.summary(pngPageItems.map(item => item.image));
  const disabledCount = items.length - pngPages.reduce((sum, list) => sum + list.length, 0);
  const [icon, setIcon] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let alive = true; loadImage(appIcon).then(image => { if (alive) setIcon(image); }, () => {}); return () => { alive = false; }; }, []);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const renderPage = (number: number) => {
    const canvas = document.createElement("canvas");
    drawGiftBoard(canvas, { title, page: number, pageCount, items: pngPages[number - 1] ?? [], icon }, all.images);
    return canvas.toDataURL("image/png");
  };
  // 絵が取れなかったギフト（ネットの不調・リンク切れ）は、絵の場所にギフトの名前を描いて保存する（2026-11-05 ユーザーの決定）。前は1枚でも取れないと保存できなかった。
  const missingText = (count: number) => count ? ` ${count}枚は絵が取れず、名前で描きました（「画像を再読み込み」で取り直せます）。` : "";
  const savePage = async () => {
    if (saving || !pngPageItems.length || thisPage.pending) return;
    setSaving(true); setNotice(null);
    try {
      await document.fonts.ready;
      const result = await window.mygamepack.giftPanelSavePng(renderPage(current), boardFilename(gameName, current));
      setNotice(result.canceled ? { type: "ok", text: "保存をやめました。" } : { type: "ok", text: `${current}ページ目をPNGに保存しました。${result.path ? " " + result.path : ""}${missingText(thisPage.failed.length)}` });
    } catch (error) { setNotice({ type: "error", text: "PNGを保存できませんでした: " + ipcErrorMessage(error) }); }
    finally { setSaving(false); }
  };
  const saveAll = async () => {
    if (saving || !pngPages.some(list => list.length) || all.pending) return;
    setSaving(true); setNotice(null);
    try {
      await document.fonts.ready;
      // 無効の割り当てだけのページ（描くマスが無い）は保存しない。ページの番号は画面と同じ。
      const files = pngPages.flatMap((list, i) => list.length ? [{ dataUrl: renderPage(i + 1), filename: boardFilename(gameName, i + 1) }] : []);
      const result = await window.mygamepack.giftPanelSavePngs(files);
      setNotice(result.canceled === false ? { type: "ok", text: `${result.paths.length}枚のPNGを保存しました。${result.folder}${missingText(all.failed.length)}` } : { type: "ok", text: "保存をやめました。" });
    } catch (error) { setNotice({ type: "error", text: "PNGを保存できませんでした: " + ipcErrorMessage(error) }); }
    finally { setSaving(false); }
  };
  const loadingCount = all.pending;
  const failedCount = all.failed.length;

  const cell = (item: BoardItem | undefined, index: number, pageNumber: number) => {
    const key = item ? item.id : `empty-${pageNumber}-${index}`;
    const over = dropTarget === key;
    if (!item) {
      return <div key={key} className={`gift-board-cell is-empty${over ? " is-drop" : ""}`}
        onDragOver={dragOver(key)} onDragLeave={() => setDropTarget(null)} onDrop={dropOn(null)} />;
    }
    const editing = item.giftId === selectedGiftId;
    const pick = () => onPickGift(item.giftId, item.giftName, item.image, item.diamonds);
    return (
      <div key={key} role="button" tabIndex={0} draggable
        className={`gift-board-cell is-filled${editing ? " is-editing" : ""}${dragging === item.id ? " is-dragging" : ""}${over ? " is-drop" : ""}`}
        title={`${item.giftName} → ${item.title} ×${item.repeat}（クリックで編集・ドラッグで並べ替え）`}
        aria-label={`${(pageNumber - 1) * BOARD_CELLS + index + 1}番 ${item.giftName} → ${item.title} ×${item.repeat}回を編集`}
        aria-pressed={editing}
        onClick={pick}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); pick(); } }}
        // 渡す種類はこの一覧だけのもの（text/plain だと、検索の欄に落としたときに ID が入った。2026-11-05 レビュー）。
        onDragStart={event => { dragId.current = item.id; setDragging(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-mygamepack-gift-board", item.id); }}
        onDragEnd={endDrag}
        onDragOver={dragOver(key)} onDragLeave={() => setDropTarget(value => value === key ? null : value)} onDrop={dropOn(item.id)}
      >
        <span className="gift-board-art">{item.image ? <img src={item.image} alt="" loading="lazy" decoding="async" draggable={false} /> : <FitText fit={fit(item.giftName, textWidth, BOARD_CELL_TEXT.imageSize, 24, 800)} size={cqw} as="i" />}</span>
        <FitText fit={fit(item.title, textWidth, BOARD_CELL_TEXT.titleHeight, BOARD_CELL_TEXT.titleSize, 900)} size={cqw} as="b" />
        <small>×{item.repeat}</small>
        {item.disabled ? <span className="gift-board-disabled"><DisabledMappingMark compact /></span> : null}
        <button type="button" className="gift-board-remove" draggable={false} aria-label={`${item.giftName}を削除`} title="この登録を消す"
          onClick={event => { event.stopPropagation(); onRemove(item.id); }}
          onKeyDown={event => event.stopPropagation()}>✖</button>
      </div>
    );
  };

  return (
    <section className="gift-step gift-board" aria-labelledby="gift-board-title">
      <header className="gift-step-heading gift-board-heading">
        <div>
          <h2 id="gift-board-title"><span>3</span>登録済みギフト<em>{items.length}件</em></h2>
          <p>一覧を画像として保存（PNG・1080 × 1920）</p>
        </div>
        <button type="button" className="gift-board-save" onClick={() => void savePage()}
          disabled={saving || !pngPageItems.length || thisPage.pending > 0}>
          <i className="fa-solid fa-download" aria-hidden="true" />{saving ? "保存中…" : "このページを保存"}
        </button>
      </header>

      {!items.length && <p className="gift-board-hint">まだ登録されていません。左でギフトを選び、②で「この内容で登録」を押すと、ここに並びます。</p>}

      <div className="gift-board-sheet">
        <div className="gift-board-page" style={{ padding: `${layout.margin / layout.width * 100}%`, gridTemplateRows: `${layout.header}fr ${layout.gridHeight}fr` }}>
          <div className="gift-board-title">
            <h3><img src={appIcon} alt="" />{title}</h3>
            <nav className="gift-board-pager" aria-label="登録済みギフトのページ">
              <button type="button" aria-label="前のページ" disabled={current <= 1} onClick={() => setPage(current - 1)}
                onDragOver={flipWhileDragging(-1)} onDragLeave={stopFlip} onDrop={event => { event.preventDefault(); stopFlip(); }}>◀</button>
              <span>{current} / {pageCount}</span>
              <button type="button" aria-label="次のページ" disabled={current >= pageCount} onClick={() => setPage(current + 1)}
                onDragOver={flipWhileDragging(1)} onDragLeave={stopFlip} onDrop={event => { event.preventDefault(); stopFlip(); }}>▶</button>
            </nav>
          </div>
          {/* ページは全部描いて、今のページだけを見せる（ドラッグの元のマスを消さないため。消すとドラッグの終わりが届かない）。 */}
          {pages.map((list, i) => (
            <div key={i} className="gift-board-grid" hidden={i + 1 !== current}>
              {Array.from({ length: BOARD_CELLS }, (_, index) => cell(list[index], index, i + 1))}
            </div>
          ))}
        </div>
      </div>

      <div className="gift-board-status" role="status">
        {loadingCount > 0 && <span>PNG用のギフト画像を読み込み中… 残り{loadingCount}枚</span>}
        {failedCount > 0 && <span className="is-error">{failedCount}枚の画像を読み込めませんでした（保存すると、絵の代わりに名前を描きます）。<button type="button" onClick={() => cache.retryFailed(allUrls)}>画像を再読み込み</button></span>}
        {disabledCount > 0 && <span>設定ファイルで無効にしたギフト（{disabledCount}件）は、PNGには載せません。</span>}
        {notice && <span className={notice.type === "error" ? "is-error" : "is-ok"}>{notice.text}</span>}
      </div>

      <button type="button" className="gift-board-save-all" onClick={() => void saveAll()}
        disabled={saving || !pngPages.some(list => list.length) || loadingCount > 0}>
        <i className="fa-solid fa-images" aria-hidden="true" />全{items.length}件（{pageCount}ページ）をPNGに保存
      </button>
      <small className="gift-board-note">フォルダーを選ぶと「{boardFilename(gameName, 1)}」「…_2.png」のようにページごとに保存します。マスはドラッグで並べ替え、マウスを載せると出る ✖ で消せます。</small>
    </section>
  );
}

function FitText({ fit, size, as: Tag }: { fit: Fit; size: (px: number) => string; as: "b" | "i" }) {
  return <Tag style={{ fontSize: size(fit.size) }}>{fit.lines.map((line, i) => <span key={i}>{line}</span>)}</Tag>;
}
