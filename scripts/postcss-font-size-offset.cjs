'use strict';
// アプリの文字だけを全体で N px 大きくする（2026-11-04 ユーザーの決定「+2px」。10-30 の決定「文字だけ大きく」で、箱の大きさはそのまま）。
// 組み立てのとき（vite の PostCSS）に、CSS の文字の大きさの指定を「元＋N px」に書き換える。N は src/lib/fontSizeOffset.json の1か所。
// 画面のコードに直接書いた大きさ（style の fontSize）も同じ N を足す。配信画像の PNG（canvas）の文字は CSS ではないので変わらない。
// 書き換えるもの：font-size の px・rem・calc/clamp/min/max、font の大きさ、Tailwind の text-xs などの大きさ（--text-* の値）。
// 書き換えないもの：em・%・inherit・var()・0。親や変数の大きさを受け継ぐので、書き換えると二重に大きくなる。

const LENGTH = /^(\d*\.?\d+)(px|rem)$/i;
const MATH = /^(calc|clamp|min|max)\(/i;
// Tailwind の文字の大きさの変数（--text-xs--line-height などは行の高さなので除く）。
const TAILWIND_TEXT_SIZE = /^--text-(xs|sm|base|lg|xl|\d+xl)$/;
const FONT_SIZE_TOKEN = /^(\d*\.?\d+(?:px|rem))(\/.+)?$/i;

const round = n => Math.round(n * 1000) / 1000;

function offsetSize(value, px) {
  const v = String(value).trim();
  const length = LENGTH.exec(v);
  if (length) {
    if (Number(length[1]) === 0) return value;
    return length[2].toLowerCase() === 'px' ? round(Number(length[1]) + px) + 'px' : `calc(${v} + ${px}px)`;
  }
  return MATH.test(v) ? `calc(${v} + ${px}px)` : value;
}

// font: 800 12px/1 monospace の 12px だけを書き換える。
function offsetFontShorthand(value, px) {
  const tokens = String(value).trim().split(/\s+/);
  const index = tokens.findIndex(token => FONT_SIZE_TOKEN.test(token));
  if (index < 0) return value;
  const [, size, lineHeight = ''] = FONT_SIZE_TOKEN.exec(tokens[index]);
  const next = offsetSize(size, px);
  if (next === size) return value;
  tokens[index] = next + lineHeight;
  return tokens.join(' ');
}

function offsetDeclaration(prop, value, px) {
  if (prop === 'font-size' || TAILWIND_TEXT_SIZE.test(prop)) return offsetSize(value, px);
  if (prop === 'font') return offsetFontShorthand(value, px);
  return value;
}

function fontSizeOffset({ px }) {
  if (!Number.isFinite(px)) throw new Error('fontSizeOffset: px を数で指定してください');
  return {
    postcssPlugin: 'font-size-offset',
    // Tailwind が text-* を作り終えたあとに1回だけ書き換える（Declaration で書き換えると、変えた宣言をもう一度通して二重に足す）。
    OnceExit(root) {
      if (!px) return;
      root.walkDecls(decl => { decl.value = offsetDeclaration(decl.prop, decl.value, px); });
    },
  };
}
fontSizeOffset.postcss = true;

module.exports = fontSizeOffset;
module.exports.offsetDeclaration = offsetDeclaration;
