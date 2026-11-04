'use strict';
// アプリの文字だけを全体で N px 大きくする（2026-11-04 ユーザーの決定「+3px」。+2px・+3px・+4px の写真を見て選んだ。10-30 の決定「文字だけ大きく」で、箱の大きさはそのまま）。
// 組み立てのとき（vite の PostCSS）に、CSS の文字の大きさの指定を「元＋N px」に書き換える。N は src/lib/fontSizeOffset.json の1か所。
// 画面のコードに直接書いた大きさ（style の fontSize）も同じ N を足す。配信画像の PNG（canvas）の文字は CSS ではないので変わらない。
// 書き換えるもの：font-size の px・rem・calc/clamp/min/max、font の大きさ、Tailwind の text-xs などの大きさ（--text-* の値）。
// 書き換えないもの：em・%・inherit・var()・0。親や変数の大きさを受け継ぐので、書き換えると二重に大きくなる（式の中にあるときも）。
// 大きさを一度も決めていない文字のために、src/index.css の body に font-size: 16px（ブラウザの初期値）を書いてある。これも N を足す。

const LENGTH = /^(\d*\.?\d+)(px|rem)$/i;
const MATH = /^(calc|clamp|min|max)\(/i;
// 式の中に親や変数の大きさが入っていれば、もう N が入っているので足さない。
const INHERITED = /\d(em|ex|ch|lh|%)|var\(/i;
// Tailwind の文字の大きさの変数（--text-xs--line-height などは行の高さなので除く）。
const TAILWIND_TEXT_SIZE = /^--text-(xs|sm|base|lg|xl|\d+xl)$/;
// font: 800 12px/1 monospace の 12px（前後の空白はそのまま残す）。
const FONT_SIZE_TOKEN = /(^|\s)(\d*\.?\d+(?:px|rem))(?=\/|\s|$)/i;

const round = n => Math.round(n * 1000) / 1000;

function offsetSize(value, px) {
  const v = String(value).trim();
  const length = LENGTH.exec(v);
  if (length) {
    if (Number(length[1]) === 0) return value;
    return length[2].toLowerCase() === 'px' ? round(Number(length[1]) + px) + 'px' : `calc(${v} + ${px}px)`;
  }
  return MATH.test(v) && !INHERITED.test(v) ? `calc(${v} + ${px}px)` : value;
}

function offsetDeclaration(prop, value, px) {
  const name = String(prop).toLowerCase();
  if (name === 'font-size' || TAILWIND_TEXT_SIZE.test(prop)) return offsetSize(value, px);
  if (name === 'font') return String(value).replace(FONT_SIZE_TOKEN, (_, space, size) => space + offsetSize(size, px));
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
