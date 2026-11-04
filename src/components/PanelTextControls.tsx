import React from 'react';
import { cardFontSize, clamp, FONT_SCALE_MAX, FONT_SCALE_MIN, OUTLINE_WIDTH, TEXT_SWATCHES, type PanelCard, type PanelDesign, type PanelOutline } from '../lib/giftPanel';
import { panelFont, panelFontFace, type PanelFont } from '../lib/panelFonts';

// 配信画像の文字の設定（文字の形・色・縁取り・大きさ。2026-11-05 ユーザーの決定）。

/** 色の見本と自由な色。auto を渡すと「自動」も選べる（value が無いとき自動）。 */
function Swatches({ label, value, auto, onChange }: { label: string; value: string | undefined; auto?: string; onChange: (color: string | undefined) => void }) {
  const chosen = value?.toUpperCase();
  const custom = Boolean(chosen) && !TEXT_SWATCHES.some(s => s.color === chosen);
  return <div className="panel-swatch-row" role="group" aria-label={label}>
    {auto && <button className="panel-auto-chip" aria-pressed={!value} onClick={() => onChange(undefined)}>{auto}</button>}
    {TEXT_SWATCHES.map(s => <button key={s.color} className="panel-swatch" style={{ background: s.color }} title={s.label} aria-label={label + 'を' + s.label + 'にする'} aria-pressed={chosen === s.color} onClick={() => onChange(s.color)} />)}
    <input type="color" className={custom ? 'is-chosen' : ''} title="自由な色" aria-label={label + 'を自由に選ぶ'} value={value || '#FFFFFF'} onChange={e => onChange(e.target.value.toUpperCase())} />
  </div>;
}

const OUTLINES: { id: PanelOutline; label: string }[] = [{ id: 'auto', label: '自動' }, { id: 'none', label: 'なし' }, { id: 'color', label: '色を指定' }];

/** 画像全体の文字。文字の形は、この PC にあるもの（fonts）だけを出す。 */
export function PanelTextSettings({ design, fonts, patch }: { design: PanelDesign; fonts: PanelFont[]; patch: (value: Partial<PanelDesign>) => void }) {
  // 前に選んだ文字の形がこの PC に無いときは、それと分かる形で一覧の先頭に残す（黙って変えない）。
  const listed = fonts.some(f => f.id === design.font) ? fonts : [panelFont(design.font), ...fonts];
  return <>
    <div className="panel-section-label"><span>04</span><h2>文字</h2></div>
    <div className="panel-field"><span>文字の形 <small>このPCにあるものだけ</small></span>
      <div className="panel-font-list" role="group" aria-label="文字の形">{listed.map(f => {
        const missing = !fonts.includes(f), face = panelFontFace(f.id);
        return <button key={f.id} aria-pressed={design.font === f.id} disabled={missing} onClick={() => patch({ font: f.id })}>
          <span style={{ fontFamily: face.stack, fontWeight: face.weight }}>{f.label}</span>{(missing || f.note) && <small>{missing ? 'このPCにありません' : f.note}</small>}
        </button>;
      })}</div>
    </div>
    <label className="panel-field"><span>全体の文字サイズ <b>{design.fontSize}px</b></span><input type="range" min={10} max={96} value={design.fontSize} onChange={e => patch({ fontSize: Number(e.target.value) })} /></label>
    <div className="panel-field"><span>文字の色</span><Swatches label="文字の色" value={design.textColor} auto="自動" onChange={textColor => patch({ textColor })} /></div>
    <div className="panel-field"><span>縁取り</span>
      <div className="panel-segments" role="group" aria-label="縁取り">{OUTLINES.map(o => <button key={o.id} aria-pressed={design.outline === o.id} onClick={() => patch({ outline: o.id })}>{o.label}</button>)}</div>
      {design.outline === 'auto' && <p className="panel-hint">白い文字と見出しを黒く縁取ります。</p>}
      {design.outline === 'color' && <Swatches label="縁取りの色" value={design.outlineColor} onChange={outlineColor => patch({ outlineColor: outlineColor || '#FFFFFF' })} />}
    </div>
    {design.outline !== 'none' && <label className="panel-field"><span>縁取りの太さ <b>{design.outlineWidth === OUTLINE_WIDTH ? '標準' : design.outlineWidth}</b></span><input type="range" min={2} max={40} value={design.outlineWidth} onChange={e => patch({ outlineWidth: Number(e.target.value) })} /></label>}
  </>;
}

/** 選んだカードだけの文字の大きさ（全体の何%か）と縁取りの色。 */
export function CardTextSettings({ design, card, update }: { design: PanelDesign; card: PanelCard; update: (value: Partial<PanelCard>) => void }) {
  const scale = card.fontScale || 100;
  const step = (delta: number) => { const next = clamp(scale + delta, FONT_SCALE_MIN, FONT_SCALE_MAX, 100); update({ fontScale: next === 100 ? undefined : next }); };
  return <div className="panel-card-text">
    <span>このカードの文字サイズ</span>
    <div className="panel-size-stepper">
      <button className="studio-icon-button" aria-label="このカードの文字を小さくする" disabled={scale <= FONT_SCALE_MIN} onClick={() => step(-10)}><i className="fa-solid fa-minus" /></button>
      <b>{card.fontScale ? scale + '%' : '自動'}<small>{Math.round(cardFontSize(design, card))}px</small></b>
      <button className="studio-icon-button" aria-label="このカードの文字を大きくする" disabled={scale >= FONT_SCALE_MAX} onClick={() => step(10)}><i className="fa-solid fa-plus" /></button>
      <button className="studio-quiet" disabled={!card.fontScale} onClick={() => update({ fontScale: undefined })}>全体と同じ</button>
    </div>
    <p className="panel-hint">カードに収まらないときは、収まる大きさまで小さくなります。</p>
    <label className="panel-check"><input type="checkbox" checked={Boolean(card.outlineColor)} onChange={e => update({ outlineColor: e.target.checked ? (design.outline === 'color' ? design.outlineColor : '#FFFFFF') : undefined })} />このカードの縁取りの色を指定</label>
    {card.outlineColor && <Swatches label="このカードの縁取りの色" value={card.outlineColor} onChange={outlineColor => update({ outlineColor: outlineColor || '#FFFFFF' })} />}
  </div>;
}
