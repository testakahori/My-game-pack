/** Serializable editing state. It never writes Minecraft gift assignments. */
export type PanelTone = 'attack' | 'help' | 'trick' | 'other';
export type PanelTemplate = 'compact' | 'light' | 'neon';
export type PanelCard = {
  id: string; giftId: string; giftName: string; image: string | null;
  title: string; repeat: number; category: string; tone: PanelTone;
  color?: string; textColor?: string;
};
export type PanelDesign = {
  id: string; name: string; template: PanelTemplate; cards: PanelCard[];
  columns: number; rows: number; width: number; height: number;
  fontSize: number; gap: number; padding: number; radius: number;
  headline: string; headlineColor: string; headlineSize: number;
  colorMode: 'uniform' | 'category'; colorTarget: 'border' | 'background';
  accent: string; background: string; palette: Record<PanelTone, string>;
  showRepeat: boolean; outerFrame: boolean;
};
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
  { id: 'neon' as const, name: 'ナイトステージ', sub: '暗い画面に映えるカラーの枠', badge: '4列 × 2段', color: '#B59AFA' },
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
    columns: neon ? 4 : 6, rows: light ? 1 : 2, width: 1080, height: light ? 230 : neon ? 560 : 420,
    fontSize: neon ? 36 : 30, gap: light ? 8 : 2, padding: 12, radius: light ? 12 : neon ? 10 : 0,
    headline: '', headlineColor: '#FFEB3B', headlineSize: 100,
    colorMode: 'uniform', colorTarget: 'border', accent: light ? '#5BBDFC' : neon ? '#B59AFA' : '#F6C76A',
    background: light ? '#F8FAFC' : neon ? '#171329' : '#141414',
    palette: Object.fromEntries(TONES.map(t => [t.id, t.color])) as Record<PanelTone, string>,
    showRepeat: true, outerFrame: true,
  };
}
export function applyPanelTemplate(design: PanelDesign, template: PanelTemplate): PanelDesign {
  const next = createPanel(template);
  const columns = Math.max(next.columns, Math.ceil(design.cards.length / 8));
  const rows = Math.max(next.rows, Math.ceil(design.cards.length / columns));
  return { ...next, id: design.id, name: design.name, cards: design.cards, headline: design.headline,
    columns, rows, height: Math.min(2160, next.height / next.rows * rows), palette: design.palette,
    colorMode: design.colorMode, colorTarget: design.colorTarget };
}
export function normalizePanel(input: unknown): PanelDesign {
  const v = input && typeof input === 'object' ? input as Partial<PanelDesign> : {};
  const template = TEMPLATES.some(t => t.id === v.template) ? v.template! : 'compact';
  const base = createPanel(template);
  const ids = new Set<string>();
  const cards = (Array.isArray(v.cards) ? v.cards : []).slice(0, 96).filter(c => c && typeof c === 'object').map(c => {
    let id = str(c.id, 100) || panelId(); if (ids.has(id)) id = panelId(); ids.add(id);
    const tone = TONES.some(t => t.id === c.tone) ? c.tone : toneForCategory(str(c.category, 80));
    return { id, giftId: str(c.giftId, 100), giftName: str(c.giftName, 100, 'ギフト'),
      image: typeof c.image === 'string' && /^https?:\/\//i.test(c.image) ? c.image.slice(0, 4096) : null,
      title: str(c.title, 120), repeat: clamp(c.repeat, 1, 9999, 1), category: str(c.category, 80), tone,
      ...(c.color ? { color: color(c.color, base.accent) } : {}),
      ...(c.textColor ? { textColor: color(c.textColor, '#FFFFFF') } : {}),
    };
  });
  return { ...base, id: str(v.id, 100) || base.id, name: str(v.name, 60, base.name), cards,
    columns: clamp(v.columns, 1, 12, base.columns), rows: clamp(v.rows, 1, 8, base.rows),
    width: clamp(v.width, 360, 3840, base.width), height: clamp(v.height, 120, 2160, base.height),
    fontSize: clamp(v.fontSize, 10, 96, base.fontSize), gap: clamp(v.gap, 0, 32, base.gap),
    padding: clamp(v.padding, 4, 80, base.padding), radius: clamp(v.radius, 0, 32, base.radius),
    headline: str(v.headline, 80), headlineColor: color(v.headlineColor, base.headlineColor), headlineSize: clamp(v.headlineSize, 24, 120, base.headlineSize),
    colorMode: v.colorMode === 'category' ? 'category' : 'uniform', colorTarget: v.colorTarget === 'background' ? 'background' : 'border',
    accent: color(v.accent, base.accent), background: color(v.background, base.background),
    palette: Object.fromEntries(TONES.map(t => [t.id, color(v.palette?.[t.id], t.color)])) as Record<PanelTone, string>,
    showRepeat: v.showRepeat !== false, outerFrame: v.outerFrame !== false,
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
  return { accent, background, text: card.textColor || (luminance > .179 ? '#101522' : '#FFFFFF') };
}
export function panelLayout(design: PanelDesign) {
  const titleLines = design.headline.trim() ? design.headline.split('\n').slice(0, 3) : [];
  const headingHeight = titleLines.length ? Math.ceil(titleLines.length * design.headlineSize * 1.18 + 24) : 0;
  // Even a narrow canvas with many columns must never produce negative rectangles.
  const padding = Math.min(design.padding, design.width / 12, design.height / 8);
  const gap = Math.min(design.gap, (design.width - padding * 2) / (design.columns * 3), (design.height - padding * 2) / (design.rows * 3));
  const cardWidth = (design.width - padding * 2 - gap * (design.columns - 1)) / design.columns;
  const cardHeight = (design.height - padding * 2 - gap * (design.rows - 1)) / design.rows;
  return { width: design.width, height: design.height + headingHeight, headingHeight, titleLines, padding, gap, cardWidth, cardHeight,
    slots: design.columns * design.rows, overflow: Math.max(0, design.cards.length - design.columns * design.rows) };
}
export function panelFilename(design: PanelDesign) {
  const name = design.name.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/, '').slice(0, 60) || 'ギフト案内';
  const layout = panelLayout(design); return `${name}_${layout.width}x${layout.height}.png`;
}
