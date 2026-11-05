/** Serializable editing state. It never writes Minecraft gift assignments. */
import { DEFAULT_PANEL_FONT, PANEL_FONTS } from './panelFonts';
import { neededSlots, normalizeSlots, slotOf } from './panelSlots';

export type PanelTone = 'attack' | 'help' | 'trick' | 'other';
export type PanelTemplate = 'compact' | 'light' | 'neon';
// slot は枠の番号、fontScale は全体の文字サイズに対する % （無ければ全体と同じ）、outlineColor はこのカードだけの縁取りの色（2026-11-05）。
export type PanelCard = {
  id: string; giftId: string; giftName: string; image: string | null;
  title: string; repeat: number; category: string; tone: PanelTone; slot: number;
  color?: string; textColor?: string; fontScale?: number; outlineColor?: string;
};
// font は文字の形（src/lib/panelFonts.ts の id）。textColor は全体の文字色（無ければ自動）。
// outline は縁取り：auto はいままでどおり（白い文字と見出しだけ暗く縁取る）、none は縁取らない、color は outlineColor で縁取る。outlineWidth は文字の大きさの %（2026-11-05）。
export type PanelOutline = 'auto' | 'none' | 'color';
export type PanelDesign = {
  id: string; name: string; template: PanelTemplate; cards: PanelCard[];
  columns: number; rows: number; width: number; height: number;
  fontSize: number; gap: number; padding: number; radius: number;
  headline: string; headlineColor: string; headlineSize: number;
  colorMode: 'uniform' | 'category'; colorTarget: 'border' | 'background';
  accent: string; background: string; palette: Record<PanelTone, string>;
  showRepeat: boolean; outerFrame: boolean;
  font: string; textColor?: string; outline: PanelOutline; outlineColor: string; outlineWidth: number;
};
export const OUTLINE_WIDTH = 8;
export const AUTO_OUTLINE_COLOR = '#08090D';
export const FONT_SCALE_MIN = 30, FONT_SCALE_MAX = 300;
export const TEXT_SWATCHES = [
  { label: '白', color: '#FFFFFF' }, { label: '黒', color: '#000000' }, { label: '黄', color: '#FFEB3B' },
  { label: '赤', color: '#FF3B5C' }, { label: '青', color: '#2F80ED' }, { label: '緑', color: '#22C55E' }, { label: '紫', color: '#9B59F6' },
];
export type PanelLibrary = { version: 1; activeId: string; designs: PanelDesign[] };
export const PANEL_STORAGE_KEY = 'mygamepack_obs_panels_v1';
export const TONES: { id: PanelTone; label: string; color: string }[] = [
  { id: 'attack', label: '妨害・攻撃', color: '#FB7185' },
  { id: 'help', label: '応援・回復', color: '#5BBDFC' },
  { id: 'trick', label: 'トラップ', color: '#B59AFA' },
  { id: 'other', label: 'その他', color: '#F6C76A' },
];
export const TEMPLATES = [
  { id: 'compact' as const, name: 'ライブグリッド', sub: '黒地でギフトが引き立つ一覧', badge: '6列 × 2段', color: '#F6C76A' },
  { id: 'light' as const, name: 'クリアカード', sub: '白地で文字をくっきり見せる', badge: '6列 × 1段', color: '#5BBDFC' },
  { id: 'neon' as const, name: 'ナイトステージ', sub: '暗い画面に映えるカラーの枠', badge: '6列 × 2段', color: '#B59AFA' },
];
export function panelId() { return crypto.randomUUID(); }
export function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value); return Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
}
const color = (v: unknown, fallback: string) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v) ? v : fallback;
const str = (v: unknown, max: number, fallback = '') => typeof v === 'string' ? v.slice(0, max) : fallback;
export function toneForCategory(category: string): PanelTone {
  if (/お助け|友好|回復|支援|応援|アイテム|装備/.test(category)) return 'help';
  if (/トラップ|悪戯|いたずら/.test(category)) return 'trick';
  if (/妨害|敵対|襲撃|天変|攻撃|破壊/.test(category)) return 'attack';
  return 'other';
}
export function createPanel(template: PanelTemplate = 'compact'): PanelDesign {
  const light = template === 'light', neon = template === 'neon';
  return {
    id: panelId(), name: light ? '配信ルール' : 'ギフト案内', template, cards: [],
    columns: 6, rows: light ? 1 : 2, width: 1080, height: light ? 230 : 420,
    fontSize: 30, gap: light ? 8 : 2, padding: 12, radius: light ? 12 : neon ? 10 : 0,
    headline: '', headlineColor: '#FFEB3B', headlineSize: 100,
    colorMode: 'uniform', colorTarget: 'border', accent: light ? '#5BBDFC' : neon ? '#B59AFA' : '#F6C76A',
    background: light ? '#F8FAFC' : neon ? '#211D31' : '#252830',
    palette: Object.fromEntries(TONES.map(t => [t.id, t.color])) as Record<PanelTone, string>,
    showRepeat: true, outerFrame: true,
    font: DEFAULT_PANEL_FONT, outline: 'auto', outlineColor: '#FFFFFF', outlineWidth: OUTLINE_WIDTH,
  };
}
// 見た目を切り替えても文字の形は保つ。文字色・縁取りはテンプレートの地の色に合わせて自動に戻す（2026-11-05）。
// 空いた枠があっても、いちばん後ろのカードまで入る列・段にする。
export function applyPanelTemplate(design: PanelDesign, template: PanelTemplate): PanelDesign {
  const next = createPanel(template);
  const needed = neededSlots(design.cards);
  const columns = Math.max(next.columns, Math.ceil(needed / 8));
  const rows = Math.max(next.rows, Math.ceil(needed / columns));
  return { ...next, id: design.id, name: design.name, cards: design.cards, headline: design.headline,
    columns, rows, height: Math.min(2160, next.height / next.rows * rows), palette: design.palette,
    colorMode: design.colorMode, colorTarget: design.colorTarget, font: design.font };
}
export function normalizePanel(input: unknown): PanelDesign {
  const v = input && typeof input === 'object' ? input as Partial<PanelDesign> : {};
  const template = TEMPLATES.some(t => t.id === v.template) ? v.template! : 'compact';
  const base = createPanel(template);
  const ids = new Set<string>();
  // 枠の番号が無い前の版のデータは、並び順どおりの枠に入る（見た目は前と同じ）。
  const cards = normalizeSlots((Array.isArray(v.cards) ? v.cards : []).slice(0, 96).filter(c => c && typeof c === 'object').map(c => {
    let id = str(c.id, 100) || panelId(); if (ids.has(id)) id = panelId(); ids.add(id);
    const tone = TONES.some(t => t.id === c.tone) ? c.tone : toneForCategory(str(c.category, 80));
    const fontScale = c.fontScale == null ? 100 : clamp(c.fontScale, FONT_SCALE_MIN, FONT_SCALE_MAX, 100);
    return { id, giftId: str(c.giftId, 100), giftName: str(c.giftName, 100, 'ギフト'),
      image: typeof c.image === 'string' && /^https?:\/\//i.test(c.image) ? c.image.slice(0, 4096) : null,
      title: str(c.title, 120), repeat: clamp(c.repeat, 1, 9999, 1), category: str(c.category, 80), tone, slot: c.slot,
      ...(c.color ? { color: color(c.color, base.accent) } : {}),
      ...(c.textColor ? { textColor: color(c.textColor, '#FFFFFF') } : {}),
      ...(fontScale !== 100 ? { fontScale } : {}),
      ...(c.outlineColor ? { outlineColor: color(c.outlineColor, '#FFFFFF') } : {}),
    };
  }));
  return { ...base, id: str(v.id, 100) || base.id, name: str(v.name, 60, base.name), cards,
    columns: template === 'neon' && v.columns === 4 && v.rows === 2 ? 6 : clamp(v.columns, 1, 12, base.columns), rows: clamp(v.rows, 1, 8, base.rows),
    width: clamp(v.width, 360, 3840, base.width), height: template === 'neon' && v.columns === 4 && v.rows === 2 && v.height === 560 ? 420 : clamp(v.height, 120, 2160, base.height),
    fontSize: clamp(v.fontSize, 10, 96, base.fontSize), gap: clamp(v.gap, 0, 32, base.gap),
    padding: clamp(v.padding, 4, 80, base.padding), radius: clamp(v.radius, 0, 32, base.radius),
    headline: str(v.headline, 80), headlineColor: color(v.headlineColor, base.headlineColor), headlineSize: clamp(v.headlineSize, 24, 120, base.headlineSize),
    colorMode: v.colorMode === 'category' ? 'category' : 'uniform', colorTarget: v.colorTarget === 'background' ? 'background' : 'border',
    accent: color(v.accent, base.accent), background: template === 'compact' && ['#000000', '#141414'].includes(String(v.background).toLowerCase()) ? base.background : color(v.background, base.background),
    palette: Object.fromEntries(TONES.map(t => [t.id, color(v.palette?.[t.id], t.color)])) as Record<PanelTone, string>,
    showRepeat: v.showRepeat !== false, outerFrame: v.outerFrame !== false,
    // 文字の設定が無い前の版のデータは、標準の文字の形・自動の文字色・自動の縁取り（いままでの見た目）になる。
    font: PANEL_FONTS.some(f => f.id === v.font) ? v.font! : DEFAULT_PANEL_FONT,
    ...(v.textColor ? { textColor: color(v.textColor, '#FFFFFF') } : {}),
    outline: v.outline === 'none' || v.outline === 'color' ? v.outline : 'auto',
    outlineColor: color(v.outlineColor, base.outlineColor), outlineWidth: clamp(v.outlineWidth, 2, 40, OUTLINE_WIDTH),
  };
}
export function readPanelLibrary(raw: string | null): PanelLibrary {
  if (!raw) { const doc = createPanel(); return { version: 1, activeId: doc.id, designs: [doc] }; }
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.designs) || !data.designs.length) throw new Error('保存したデザインの形式を読み取れません。');
  const used = new Set<string>();
  const designs = data.designs.slice(0, 20).map((d: unknown) => {
    const doc = normalizePanel(d); if (used.has(doc.id)) doc.id = panelId(); used.add(doc.id); return doc;
  });
  return { version: 1, activeId: designs.some((d: PanelDesign) => d.id === data.activeId) ? data.activeId : designs[0].id, designs };
}
export function cardColors(design: PanelDesign, card: PanelCard) {
  const accent = card.color || (design.colorMode === 'category' ? design.palette[card.tone] : design.accent);
  const background = design.colorTarget === 'background' ? accent : design.background;
  const rgb = background.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const luminance = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return { accent, background, text: card.textColor || design.textColor || (luminance > .179 ? '#101522' : '#FFFFFF') };
}
/** カードの文字の大きさ（枠に収まらなければ描くときにさらに小さくなる）。 */
export function cardFontSize(design: PanelDesign, card: PanelCard): number {
  return card.fontScale ? design.fontSize * card.fontScale / 100 : design.fontSize;
}
export type TextOutline = { color: string; width: number } | null;
/** 文字の縁取り。カードの指定 → 全体の指定の順。自動はいままでどおり、白い効果名（#FFFFFF）と見出しだけ暗く縁取る（ギフト名は縁取らない）。 */
export function textOutline(design: PanelDesign, kind: 'label' | 'name' | 'headline', fill: string, card?: PanelCard): TextOutline {
  const width = design.outlineWidth;
  if (card?.outlineColor) return { color: card.outlineColor, width };
  if (design.outline === 'none') return null;
  if (design.outline === 'color') return { color: design.outlineColor, width };
  return kind === 'headline' || (kind === 'label' && fill === '#FFFFFF') ? { color: AUTO_OUTLINE_COLOR, width } : null;
}
export function panelLayout(design: PanelDesign) {
  const titleLines = design.headline.trim() ? design.headline.split('\n').slice(0, 3) : [];
  const headingHeight = titleLines.length ? Math.ceil(titleLines.length * design.headlineSize * 1.18 + 24) : 0;
  // Even a narrow canvas with many columns must never produce negative rectangles.
  const padding = Math.min(design.padding, design.width / 12, design.height / 8);
  const gap = Math.min(design.gap, (design.width - padding * 2) / (design.columns * 3), (design.height - padding * 2) / (design.rows * 3));
  const cardWidth = (design.width - padding * 2 - gap * (design.columns - 1)) / design.columns;
  const cardHeight = (design.height - padding * 2 - gap * (design.rows - 1)) / design.rows;
  // 入らないカードは、枠の番号が列 × 段より後ろのもの（空いた枠があってよい。2026-11-05）。
  const slots = design.columns * design.rows;
  return { width: design.width, height: design.height + headingHeight, headingHeight, titleLines, padding, gap, cardWidth, cardHeight,
    slots, overflow: design.cards.filter((c, i) => slotOf(c, i) >= slots).length };
}
export function panelFilename(design: PanelDesign) {
  const name = design.name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '').slice(0, 60) || 'ギフト案内';
  const layout = panelLayout(design); return `${name}_${layout.width}x${layout.height}.png`;
}

/** Explicitly copy a saved assignment into this image, preserving presentation. */
export function syncPanelGift(design: PanelDesign, giftId: string, title: string, repeat: number, category: string): PanelDesign {
  return { ...design, cards: design.cards.map(card => card.giftId === giftId ? { ...card, title, repeat, category } : card) };
}
