/** 配信画像の文字の形。ふつうの Windows に入っているものから選び、この PC に無いものは出さない（2026-11-05 ユーザーの決定）。 */
// weight は描く太さ。太字の書体が別にある形は 900（いままでと同じ太字）。1つの太さしか無い形は 400 にして、
// ブラウザーが作る「にせの太字」で字がつぶれないようにする（2026-11-05 写真で確かめた）。
export type PanelFont = { id: string; label: string; families: string[]; weight?: 400 | 900; note?: string };
export const DEFAULT_PANEL_FONT = 'yu-gothic';
// families は CSS の名前（英語名）。前にあるものから使う。P の付く方（文字の幅が詰まる）を先にして、狭いカードに収まりやすくする。
// 名前は 2026-11-05 にこの PC の Chrome で1つずつ確かめた（UD デジタル教科書体は「N-B」では見つからず「N」「NP」で見つかる）。
export const PANEL_FONTS: PanelFont[] = [
  { id: 'yu-gothic', label: '游ゴシック', families: ['Yu Gothic'], note: '標準' },
  { id: 'meiryo', label: 'メイリオ', families: ['Meiryo'] },
  { id: 'biz-ud-gothic', label: 'BIZ UDゴシック', families: ['BIZ UDPGothic', 'BIZ UDGothic'] },
  { id: 'hg-kakugothic-ub', label: 'HG創英角ゴシックUB', families: ['HGPSoeiKakugothicUB', 'HGSoeiKakugothicUB'], weight: 400 },
  { id: 'hg-maru-gothic', label: 'HG丸ゴシックM-PRO', families: ['HGMaruGothicMPRO'], weight: 400 },
  { id: 'hg-soei-pop', label: '創英角ポップ体', families: ['HGPSoeiKakupoptai', 'HGSoeiKakupoptai'], weight: 400 },
  { id: 'ms-gothic', label: 'ＭＳ ゴシック', families: ['MS PGothic', 'MS Gothic'], weight: 400 },
  { id: 'yu-mincho', label: '游明朝', families: ['Yu Mincho'] },
  { id: 'hg-mincho-e', label: 'HG明朝E', families: ['HGPMinchoE', 'HGMinchoE'], weight: 400 },
  { id: 'biz-ud-mincho', label: 'BIZ UD明朝', families: ['BIZ UDPMincho', 'BIZ UDMincho'], weight: 400 },
  { id: 'ms-mincho', label: 'ＭＳ 明朝', families: ['MS PMincho', 'MS Mincho'], weight: 400 },
  { id: 'hg-gyosho', label: 'HG行書体', families: ['HGPGyoshotai', 'HGGyoshotai'], weight: 400 },
  { id: 'hg-kaisho', label: 'HG正楷書体-PRO', families: ['HGSeikaishotaiPRO'], weight: 400 },
  { id: 'ud-kyokasho', label: 'UDデジタル教科書体', families: ['UD Digi Kyokasho NP', 'UD Digi Kyokasho N'] },
  // 英字だけの形。かな・漢字は游ゴシックで描く。
  { id: 'arial-black', label: 'Arial Black', families: ['Arial Black'], note: '英字用' },
  { id: 'impact', label: 'Impact', families: ['Impact'], weight: 400, note: '英字用' },
];
// どの文字の形でも、無い文字は游ゴシック・メイリオで出す（いままでの見た目）。
const FALLBACK = ['Yu Gothic', 'Meiryo'];
export function panelFont(id: unknown): PanelFont {
  return PANEL_FONTS.find(f => f.id === id) || PANEL_FONTS[0];
}
/** canvas と画面の font-family に入れる並び。標準は前と同じ '"Yu Gothic", "Meiryo", sans-serif'。 */
export function panelFontStack(id: unknown): string {
  return [...new Set([...panelFont(id).families, ...FALLBACK])].map(f => `"${f}"`).join(', ') + ', sans-serif';
}
/** 描く太さと並び。標準は前と同じ 900。 */
export function panelFontFace(id: unknown): { weight: number; stack: string } {
  return { weight: panelFont(id).weight || 900, stack: panelFontStack(id) };
}
// 入っているかの確かめ方：Chromium の document.fonts.check() は知らない文字の形にも true を返すので使えない。
// 「その名前, 総称」と「総称だけ」で同じ文字列の幅を比べ、1つでも違えば入っている（無ければ総称で描くので幅が同じ）。
export const FONT_PROBE_TEXT = 'mmmmmmmmmmlli WwQq@#あア漢字ギフト';
const GENERICS = ['monospace', 'sans-serif', 'serif'];
export type MeasureFont = (font: string) => number;
export function isFontInstalled(families: string[], measure: MeasureFont): boolean {
  return families.some(family => GENERICS.some(generic => Math.abs(measure(`900 72px "${family}", ${generic}`) - measure(`900 72px ${generic}`)) > .5));
}
/** この PC で選べる文字の形。標準（游ゴシック）は、見つからなくてもメイリオなどで描けるので必ず出す。 */
export function installedPanelFonts(measure: MeasureFont): PanelFont[] {
  return PANEL_FONTS.filter(font => font.id === DEFAULT_PANEL_FONT || isFontInstalled(font.families, measure));
}
/** 画面（ブラウザー）で幅を測る。canvas を作れないときは null。 */
export function canvasFontMeasure(): MeasureFont | null {
  const ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  return font => { ctx.font = font; return ctx.measureText(FONT_PROBE_TEXT).width; };
}
