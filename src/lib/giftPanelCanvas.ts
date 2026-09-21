import { cardColors, panelLayout, type PanelDesign } from './giftPanel';

export type PanelImages = Map<string, CanvasImageSource>;
const FONT = '"Yu Gothic", "Meiryo", sans-serif';

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath(); ctx.roundRect(x, y, Math.max(.1, w), Math.max(.1, h), Math.max(0, Math.min(radius, w / 2, h / 2)));
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  return text.split('\n').flatMap(segment => {
    const lines: string[] = []; let current = '';
    for (const letter of segment) {
      if (current && ctx.measureText(current + letter).width > width) { lines.push(current); current = ''; }
      current += letter;
    }
    lines.push(current); return lines;
  });
}
/** Fit both dimensions; selected-card outlines are DOM-only and never enter the PNG. */
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, width: number, height: number, preferred: number, fill: string, outline = false) {
  let size = Math.min(preferred, height / 1.18), lines: string[] = [];
  for (; size >= 5; size--) {
    ctx.font = `900 ${size}px ${FONT}`; lines = wrap(ctx, value, width);
    if (lines.length * size * 1.18 <= height && lines.every(line => ctx.measureText(line).width <= width)) break;
  }
  ctx.font = `900 ${Math.max(5, size)}px ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  const lineHeight = Math.max(5, size) * 1.18;
  const top = y + (height - lines.length * lineHeight) / 2 + lineHeight / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(x - width / 2, y, width, height); ctx.clip();
  lines.forEach((line, i) => {
    if (outline) { ctx.strokeStyle = '#08090D'; ctx.lineWidth = Math.max(2, size * .08); ctx.strokeText(line, x, top + i * lineHeight); }
    ctx.fillStyle = fill; ctx.fillText(line, x, top + i * lineHeight);
  });
  ctx.restore();
}
export function drawGiftPanel(canvas: HTMLCanvasElement, design: PanelDesign, images: PanelImages) {
  const layout = panelLayout(design);
  if (canvas.width !== layout.width) canvas.width = layout.width;
  if (canvas.height !== layout.height) canvas.height = layout.height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('画像を描画できません。');
  ctx.clearRect(0, 0, layout.width, layout.height);
  if (layout.headingHeight) text(ctx, layout.titleLines.join('\n'), layout.width / 2, 4, layout.width - 24, layout.headingHeight - 16, design.headlineSize, design.headlineColor, true);
  if (design.outerFrame) {
    ctx.strokeStyle = design.accent; ctx.lineWidth = 4;
    rect(ctx, 2, layout.headingHeight + 2, layout.width - 4, design.height - 4, design.radius + 4); ctx.stroke();
  }
  design.cards.slice(0, layout.slots).forEach((card, i) => {
    const x = layout.padding + i % design.columns * (layout.cardWidth + layout.gap);
    const y = layout.headingHeight + layout.padding + Math.floor(i / design.columns) * (layout.cardHeight + layout.gap);
    const w = layout.cardWidth, h = layout.cardHeight, colors = cardColors(design, card);
    const stroke = Math.min(3, w / 12, h / 12), inner = Math.min(10, w * .07, h * .06);
    ctx.save(); rect(ctx, x + stroke / 2, y + stroke / 2, w - stroke, h - stroke, design.radius);
    ctx.fillStyle = colors.background; ctx.fill(); ctx.strokeStyle = colors.accent; ctx.lineWidth = stroke; ctx.stroke(); ctx.clip();
    const imageHeight = h * .62;
    const image = card.image ? images.get(card.image) : undefined;
    if (image) {
      const img = image as HTMLImageElement;
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      if (iw > 0 && ih > 0) {
        const scale = Math.min((w - inner * 2) / iw, (imageHeight - inner * 2) / ih);
        ctx.drawImage(image, x + (w - iw * scale) / 2, y + inner + (imageHeight - inner * 2 - ih * scale) / 2, iw * scale, ih * scale);
      }
    } else {
      text(ctx, card.giftName, x + w / 2, y + inner, w - inner * 2, imageHeight - inner * 2, design.fontSize * .7, colors.text);
    }
    const title = card.title.trim() || card.giftName;
    const label = design.showRepeat && card.repeat > 1 ? `${title}\n×${card.repeat}` : title;
    text(ctx, label, x + w / 2, y + imageHeight, w - inner * 2, h - imageHeight - inner, design.fontSize, colors.text, colors.text === '#FFFFFF');
    ctx.restore();
  });
  return layout;
}
