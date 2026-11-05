// 「登録済みギフト」の1ページを PNG（1080 × 1920）に描く（2026-11-05 ユーザーの決定）。
// 画面の一覧と同じ紺の地・水色の枠。BRIDGE のアイコンと「<ゲーム名> ギフト一覧」、6 × 9 のマス（ギフトの画像・コマンドの名前・×回数）。
// 消す ✖・無効の印・ページを替える ◀▶ は画面だけのもので、ここでは描かない。
// canvas の文字は CSS ではないので、文字を大きくする +3px（src/lib/fontSizeOffset.json）は効かない。1080 × 1920 で読める大きさをここで決める。
import { BOARD_CELL_TEXT, BOARD_CELLS, BOARD_COLUMNS, BOARD_FONT, BOARD_ROWS, boardCellRect, boardLayout, fitBoardText, type BoardItem } from "./giftBoard";

export type BoardImages = Map<string, CanvasImageSource>;
export type BoardPage = { title: string; page: number; pageCount: number; items: readonly BoardItem[]; icon?: CanvasImageSource | null };

function sizeOf(image: CanvasImageSource): { width: number; height: number } {
  const value = image as HTMLImageElement;
  return { width: value.naturalWidth || Number(value.width) || 0, height: value.naturalHeight || Number(value.height) || 0 };
}

/** 幅と高さに収まる大きさまで縮めて、中央にそろえて書く（画面の一覧と同じ決め方。src/lib/giftBoard.ts の fitBoardText）。 */
function fitText(ctx: CanvasRenderingContext2D, value: string, centerX: number, top: number, width: number, height: number, preferred: number, weight: number, fill: string) {
  const measure = (text: string, size: number) => { ctx.font = `${weight} ${size}px ${BOARD_FONT}`; return ctx.measureText(text).width; };
  const { size, lines } = fitBoardText(value, width, height, preferred, measure);
  ctx.font = `${weight} ${size}px ${BOARD_FONT}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lineHeight = size * 1.15;
  const first = top + (height - lines.length * lineHeight) / 2 + lineHeight / 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(centerX - width / 2, top, width, height); ctx.clip();
  ctx.fillStyle = fill;
  lines.forEach((line, i) => ctx.fillText(line, centerX, first + i * lineHeight));
  ctx.restore();
}

function drawContained(ctx: CanvasRenderingContext2D, image: CanvasImageSource, x: number, y: number, box: number): boolean {
  const { width, height } = sizeOf(image);
  if (!(width > 0 && height > 0)) return false;
  const scale = Math.min(box / width, box / height);
  ctx.drawImage(image, x + (box - width * scale) / 2, y + (box - height * scale) / 2, width * scale, height * scale);
  return true;
}

export function drawGiftBoard(canvas: HTMLCanvasElement, page: BoardPage, images: BoardImages) {
  const layout = boardLayout();
  const { width, height, margin, header, gridLeft, gridTop, gridWidth, gridHeight, cellWidth, cellHeight } = layout;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画像を描画できません。");

  // 地：画面の一覧と同じ紺（透明にしない。2026-11-05 ユーザーの決定）。
  const ground = ctx.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, "#0b2042"); ground.addColorStop(1, "#040d1e");
  ctx.fillStyle = ground; ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, margin + header / 2, 0, width / 2, margin + header / 2, width * 0.7);
  glow.addColorStop(0, "rgba(39, 216, 255, 0.16)"); glow.addColorStop(1, "rgba(39, 216, 255, 0)");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);

  // 外の枠（余白の真ん中を通す）。
  ctx.save();
  ctx.shadowColor = "rgba(39, 216, 255, 0.7)"; ctx.shadowBlur = 22;
  ctx.strokeStyle = "rgba(39, 216, 255, 0.8)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(margin / 2, margin / 2, width - margin, height - margin, 26); ctx.stroke();
  ctx.restore();

  // 見出し：BRIDGE のアイコンを「<ゲーム名> ギフト一覧」の左に置き、2つをまとめて真ん中にそろえる。
  const icon = page.icon && sizeOf(page.icon).width > 0 ? page.icon : null;
  const iconSize = 100, gap = 26, centerY = margin + header / 2;
  const maxTitle = gridWidth - (icon ? iconSize + gap : 0) - 120;
  let titleSize = 72;
  for (; titleSize > 36; titleSize -= 2) {
    ctx.font = `900 ${titleSize}px ${BOARD_FONT}`;
    if (ctx.measureText(page.title).width <= maxTitle) break;
  }
  ctx.font = `900 ${titleSize}px ${BOARD_FONT}`;
  const titleWidth = Math.min(maxTitle, ctx.measureText(page.title).width);
  const startX = (width - (icon ? iconSize + gap : 0) - titleWidth) / 2;
  if (icon) {
    ctx.save();
    ctx.beginPath(); ctx.roundRect(startX, centerY - iconSize / 2, iconSize, iconSize, 22); ctx.clip();
    drawContained(ctx, icon, startX, centerY - iconSize / 2, iconSize);
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = "rgba(39, 216, 255, 0.65)"; ctx.shadowBlur = 20;
  ctx.fillStyle = "#ffffff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(page.title, startX + (icon ? iconSize + gap : 0), centerY, maxTitle);
  ctx.restore();
  // ページが2つ以上のときだけ、右上に「1 / 2」（画面の ◀▶ と同じ場所）。
  if (page.pageCount > 1) {
    ctx.font = `800 30px ${BOARD_FONT}`; ctx.fillStyle = "rgba(127, 233, 255, 0.9)";
    ctx.textAlign = "right"; ctx.textBaseline = "top";
    ctx.fillText(`${page.page} / ${page.pageCount}`, gridLeft + gridWidth - 4, margin + 4);
  }

  // マス：地・中身・線。
  ctx.fillStyle = "rgba(6, 26, 54, 0.72)";
  ctx.fillRect(gridLeft, gridTop, gridWidth, gridHeight);
  const t = BOARD_CELL_TEXT;
  page.items.slice(0, BOARD_CELLS).forEach((item, index) => {
    const cell = boardCellRect(index, layout);
    const centerX = cell.x + cell.width / 2, textWidth = cell.width - t.inset;
    const image = item.image ? images.get(item.image) : undefined;
    if (!image || !drawContained(ctx, image, centerX - t.imageSize / 2, cell.y + t.imageTop, t.imageSize)) {
      // 画像の無いギフトは、画像の場所にギフトの名前を出す。
      fitText(ctx, item.giftName, centerX, cell.y + t.imageTop, textWidth, t.imageSize, 24, 800, "rgba(190, 214, 240, 0.85)");
    }
    fitText(ctx, item.title, centerX, cell.y + t.titleTop, textWidth, t.titleHeight, t.titleSize, 900, "#ffffff");
    fitText(ctx, `×${item.repeat}`, centerX, cell.y + t.repeatTop, textWidth, t.repeatHeight, t.repeatSize, 800, "#62e6ff");
  });
  ctx.strokeStyle = "rgba(39, 216, 255, 0.4)"; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let column = 1; column < BOARD_COLUMNS; column++) { const x = gridLeft + column * cellWidth; ctx.moveTo(x, gridTop); ctx.lineTo(x, gridTop + gridHeight); }
  for (let row = 1; row < BOARD_ROWS; row++) { const y = gridTop + row * cellHeight; ctx.moveTo(gridLeft, y); ctx.lineTo(gridLeft + gridWidth, y); }
  ctx.stroke();
  ctx.strokeStyle = "#27d8ff"; ctx.lineWidth = 3;
  ctx.strokeRect(gridLeft, gridTop, gridWidth, gridHeight);
  return layout;
}
