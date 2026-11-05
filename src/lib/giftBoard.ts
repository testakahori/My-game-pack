// ギフト設定の右の列「登録済みギフト」の一覧と、その PNG の決まり（2026-11-05 ユーザーの決定）。
// 1ページは 6列 × 9段 = 54 マス。入りきらない分は次のページへ。画面の一覧と PNG は同じ形（縦 9:16、四方の余白は同じ幅）。
// 並び順は設定の mappings の順（GiftSettingsPage の commitMappings で保存するので、アプリを閉じても残る）。
import type { GiftMapping } from "../types";
import { commandFileStem, findCommandFile } from "./commandFiles";
import { isDisabledMapping, mappingGiftName } from "./giftMappingRows";

export const BOARD_COLUMNS = 6;
export const BOARD_ROWS = 9;
export const BOARD_CELLS = BOARD_COLUMNS * BOARD_ROWS;

export type CatalogGift = { id: number | string; name: string; diamond_count?: number; image?: string | null };
export type BoardCommand = { name: string; title?: string };
export type BoardItem = {
  id: string; giftId: string; giftName: string; image: string | null; diamonds?: number;
  title: string; repeat: number; disabled: boolean;
};

/** 割り当ての行を、一覧のマスに出す形へ（ギフトの画像・名前はカタログ、コマンドの名前はコマンドの一覧から）。 */
export function boardItems(mappings: readonly GiftMapping[], gifts: readonly CatalogGift[], commands: readonly BoardCommand[]): BoardItem[] {
  const byId = new Map(gifts.map(gift => [String(gift.id), gift]));
  return mappings.map(mapping => {
    const giftId = String(mapping.giftId ?? "").trim();
    const gift = byId.get(giftId);
    const title = findCommandFile(commands, mapping.commandFile)?.title || commandFileStem(mapping.commandFile) || "未設定";
    return {
      id: mapping.id, giftId, giftName: mappingGiftName(mapping, gift?.name), image: gift?.image || null,
      diamonds: Number.isFinite(gift?.diamond_count) ? gift?.diamond_count : undefined,
      title, repeat: mapping.repeat ?? 1, disabled: isDisabledMapping(mapping),
    };
  });
}

export function boardPageCount(count: number): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / BOARD_CELLS));
}

/** ページは 1 から。範囲の外（消して減った・数でない）は近いページへ。 */
export function clampBoardPage(page: number, count: number): number {
  const value = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, value), boardPageCount(count));
}

export function boardPageItems<T>(list: readonly T[], page: number): T[] {
  const current = clampBoardPage(page, list.length);
  return list.slice((current - 1) * BOARD_CELLS, current * BOARD_CELLS);
}

/** 並びの何番目（0 から）が何ページ目か。 */
export function boardPageOf(index: number): number {
  return Math.floor(Math.max(0, index) / BOARD_CELLS) + 1;
}

/**
 * マスへ落としたときの並び。ギフトのあるマスへ落とすと入れ替え、空いたマス（toId が null。最後の後ろ）へ落とすと最後へ動かす。
 * 変わらないときは、渡した配列をそのまま返す（保存しないで済むように）。
 */
export function dropOnBoard<T extends { id: string }>(list: readonly T[], fromId: string, toId: string | null): readonly T[] {
  const from = list.findIndex(item => item.id === fromId);
  if (from < 0) return list;
  if (toId === null) {
    if (from === list.length - 1) return list;
    return [...list.slice(0, from), ...list.slice(from + 1), list[from]];
  }
  const to = list.findIndex(item => item.id === toId);
  if (to < 0 || to === from) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** 一覧の見出し。ゲームの名前が分からないときは「ギフト一覧」だけ。 */
export function boardTitle(gameName?: string | null): string {
  const name = String(gameName ?? "").trim();
  return name ? `${name} ギフト一覧` : "ギフト一覧";
}

/** PNG の名前（例：「採掘 ギフト一覧_1.png」）。Windows で使えない文字は _ にする（main でも同じように確かめる）。 */
export function boardFilename(gameName: string | null | undefined, page: number): string {
  const base = boardTitle(gameName).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[. ]+$/, "").slice(0, 60) || "ギフト一覧";
  return `${base}_${Math.max(1, Math.floor(page) || 1)}.png`;
}

/**
 * PNG の形（1080 × 1920、縦 9:16）。外の余白は四方とも同じ幅（margin）。上の余白の下に見出しの帯（header）、その下に 6 × 9 のマス。
 * 画面の一覧も同じ数を割合で使う（RegisteredGiftBoard）。
 */
export function boardLayout() {
  const width = 1080, height = 1920, margin = 54, header = 192;
  const gridLeft = margin, gridTop = margin + header;
  const gridWidth = width - margin * 2, gridHeight = height - margin * 2 - header;
  return {
    width, height, margin, header, gridLeft, gridTop, gridWidth, gridHeight,
    cellWidth: gridWidth / BOARD_COLUMNS, cellHeight: gridHeight / BOARD_ROWS,
  };
}

/** PNG と画面の一覧の書体（画面の一覧も同じ書体にして、同じ大きさで収まるようにする）。 */
export const BOARD_FONT = '"Yu Gothic", "Meiryo", sans-serif';
/** マスの中の文字の場所（PNG の px。マスは 162 × 180）。画像は上 12px から 88px 四方、その下に名前、いちばん下に ×回数。 */
export const BOARD_CELL_TEXT = { imageTop: 12, imageSize: 88, titleTop: 104, titleHeight: 46, titleSize: 32, repeatTop: 150, repeatHeight: 26, repeatSize: 25, inset: 14 };

// 行の頭に来ないようにする文字（「！」だけが次の行に落ちないように）。
const NO_LINE_START = "！？!?。、，,.」』）)ー〜…";

/**
 * 幅と高さに収まる文字の大きさと行（1文字ずつ折り返す）。大きい方から試し、min まで縮めても入らなければ min で切る。
 * 1行で入る大きさが、折り返したときの大きさとあまり変わらない（85% 以上）なら1行にする。
 * measure は「その大きさで書いたときの幅」（canvas の measureText）。PNG と画面の一覧が同じ決め方をする。
 */
export function fitBoardText(text: string, width: number, height: number, preferred: number, measure: (text: string, size: number) => number, min = 12) {
  const wrap = (size: number) => {
    const lines: string[] = [];
    let current = "";
    for (const letter of text) {
      if (current && measure(current + letter, size) > width) {
        // 行の頭が「！」などになるときは、前の行の最後の1文字も次の行へ送る。
        // 1文字ずつに分けてから送る（絵文字を2つに割らないように。2026-11-05 レビュー）。
        const letters = [...current];
        const carry = NO_LINE_START.includes(letter) && letters.length > 1 ? letters[letters.length - 1] : "";
        lines.push(carry ? letters.slice(0, -1).join("") : current);
        current = carry;
      }
      current += letter;
    }
    lines.push(current);
    return lines;
  };
  const top = Math.floor(Math.min(preferred, height / 1.15));
  let wrapped: { size: number; lines: string[] } | null = null;
  for (let size = top; size >= min; size--) {
    const lines = wrap(size);
    if (lines.length * size * 1.15 <= height && lines.every(line => measure(line, size) <= width)) { wrapped = { size, lines }; break; }
  }
  if (wrapped && wrapped.lines.length === 1) return wrapped;
  for (let size = top; size >= min; size--) {
    if (measure(text, size) <= width) {
      if (!wrapped || size >= wrapped.size * 0.85) return { size, lines: [text] };
      break;
    }
  }
  return wrapped ?? { size: min, lines: wrap(min) };
}

/**
 * PNG に描くマス。無効の割り当て（設定ファイルで enabled: false）は載せず、そのページの中で詰める
 * （2026-11-05 ユーザーの決定。動かないギフトを視聴者に見せない。配信画像の 10-23 の決定と同じ）。画面の一覧には印付きで残す。
 */
export function boardPngItems<T extends { disabled: boolean }>(pageItems: readonly T[]): T[] {
  return pageItems.filter(item => !item.disabled);
}

/** ページの中の index 番目（0〜53）のマスの位置。 */
export function boardCellRect(index: number, layout = boardLayout()) {
  const column = index % BOARD_COLUMNS, row = Math.floor(index / BOARD_COLUMNS);
  return { x: layout.gridLeft + column * layout.cellWidth, y: layout.gridTop + row * layout.cellHeight, width: layout.cellWidth, height: layout.cellHeight };
}
