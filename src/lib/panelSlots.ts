/** 枠の中のカードの位置。slot は左上から右へ数えた枠の番号（0 から）。空いた枠があってよい（2026-11-05 ユーザーの決定）。 */
import type { PanelCard, PanelDesign } from './giftPanel';

/** 12列 × 8段。これより後ろの番号は使わない。 */
export const MAX_SLOTS = 96;
const isSlot = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAX_SLOTS;
/** 番号の無いカード（前の版で保存したもの）は並び順の番号として扱う。 */
export function slotOf(card: { slot?: unknown }, index: number): number {
  return isSlot(card.slot) ? card.slot : index;
}
export function sortBySlot<T extends { slot: number }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => a.slot - b.slot);
}
/** 保存データの番号を整える。前の版のデータは並び順どおり 0,1,2…。重なり・範囲外のカードは空いている最初の枠へ。 */
export function normalizeSlots<T extends { slot: number }>(cards: T[]): T[] {
  const used = new Set<number>();
  const kept = cards.map(c => { if (!isSlot(c.slot) || used.has(c.slot)) return -1; used.add(c.slot); return c.slot; });
  let next = 0;
  return sortBySlot(cards.map((c, i) => {
    let slot = kept[i];
    if (slot < 0) { while (used.has(next)) next++; slot = next; used.add(slot); }
    return c.slot === slot ? c : { ...c, slot };
  }));
}
/** 空いている枠の番号を前から count 個。 */
export function emptySlots(cards: { slot?: unknown }[], count: number): number[] {
  const used = new Set(cards.map(slotOf));
  const free: number[] = [];
  for (let slot = 0; slot < MAX_SLOTS && free.length < count; slot++) if (!used.has(slot)) free.push(slot);
  return free;
}
/** すべてのカードが入るのに要る枠の数（いちばん後ろの番号 + 1）。 */
export function neededSlots(cards: { slot?: unknown }[]): number {
  return cards.reduce((max: number, c, i) => Math.max(max, slotOf(c, i) + 1), 0);
}
/** 枠が足りなければ列・段を増やす（増やし方はいままでの「すべて収まるように調整」と同じ）。 */
export function growPanel(design: PanelDesign, needed = neededSlots(design.cards)): PanelDesign {
  const columns = Math.max(design.columns, Math.ceil(needed / 8));
  const rows = Math.max(design.rows, Math.ceil(needed / columns));
  return { ...design, columns, rows, height: Math.min(2160, Math.round(design.height / design.rows * rows)) };
}
/** 追加したカードは空いている最初の枠から入れる。96 枚を超える分は入れない。 */
export function placeCards(design: PanelDesign, cards: Omit<PanelCard, 'slot'>[]): PanelDesign {
  const free = emptySlots(design.cards, Math.min(cards.length, MAX_SLOTS - design.cards.length));
  const placed = free.map((slot, i) => ({ ...cards[i], slot }) as PanelCard);
  return placed.length ? growPanel({ ...design, cards: sortBySlot([...design.cards, ...placed]) }) : design;
}
/** 「すべて収まるように調整」：空いた枠を詰めて、足りなければ列・段を増やす。 */
export function fitPanel(design: PanelDesign): PanelDesign {
  const cards = sortBySlot(design.cards).map((c, i) => c.slot === i ? c : { ...c, slot: i });
  return growPanel({ ...design, cards }, cards.length);
}
/** カードを枠へ落とす。そこにカードがあれば入れ替え、空いていれば移す（元の枠は空く）。 */
export function dropCard(design: PanelDesign, id: string, target: number): PanelDesign {
  const moving = design.cards.find(c => c.id === id);
  if (!moving || moving.slot === target || !isSlot(target)) return design;
  const other = design.cards.find(c => c.slot === target);
  return { ...design, cards: sortBySlot(design.cards.map(c => c === moving ? { ...c, slot: target } : c === other ? { ...c, slot: moving.slot } : c)) };
}
type Grid = { width: number; height: number; headingHeight: number; padding: number; gap: number; cardWidth: number; cardHeight: number };
/** 枠の位置（画像の px）。 */
export function slotRect(layout: Grid, columns: number, slot: number) {
  return { x: layout.padding + slot % columns * (layout.cardWidth + layout.gap),
    y: layout.headingHeight + layout.padding + Math.floor(slot / columns) * (layout.cardHeight + layout.gap),
    width: layout.cardWidth, height: layout.cardHeight };
}
/** 画像の点（px）の下にある枠。見出しや画像の外なら null。外側の余白・間隔は近い枠に含める。 */
export function slotAtPoint(layout: Grid, columns: number, rows: number, x: number, y: number): number | null {
  if (!(x >= 0 && x <= layout.width && y >= layout.headingHeight && y <= layout.height)) return null;
  const col = Math.floor((x - layout.padding + layout.gap / 2) / (layout.cardWidth + layout.gap));
  const row = Math.floor((y - layout.headingHeight - layout.padding + layout.gap / 2) / (layout.cardHeight + layout.gap));
  return Math.max(0, Math.min(rows - 1, row)) * columns + Math.max(0, Math.min(columns - 1, col));
}
