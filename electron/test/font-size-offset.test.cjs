// アプリの文字だけを全体で N px 大きくする（2026-11-04 ユーザーの決定。箱の大きさはそのまま）。
// 組み立てのときに PostCSS で CSS の文字の大きさを書き換える（scripts/postcss-font-size-offset.cjs）。N は src/lib/fontSizeOffset.json の1か所。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const postcss = require('postcss');
const root = path.resolve(__dirname, '../..');
const fontSizeOffset = require('../../scripts/postcss-font-size-offset.cjs');
const { offsetDeclaration } = fontSizeOffset;
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const N = JSON.parse(read('src/lib/fontSizeOffset.json')).px;

test('文字の大きさ: N はユーザーの決定どおり +3px（1か所）で、組み立ての PostCSS が Tailwind のあとに使う', () => {
  // 2026-11-04、+2px・+3px・+4px の写真を見てユーザーが +3px を選んだ（+4px は崩れが23か所）。
  assert.equal(N, 3);
  const config = read('postcss.config.js');
  assert.match(config, /plugins: \[tailwindcss\(\), fontSizeOffset\(FONT_SIZE_OFFSET\), autoprefixer\(\)\]/, 'Tailwind が text-* を作ったあとに足す');
  assert.match(config, /src\/lib\/fontSizeOffset\.json/);
});

test('文字の大きさ: px・rem・式・font・Tailwind の text-* に足し、em・%・var()・0 は変えない', () => {
  const cases = [
    ['font-size', '12px', '14px'],
    ['font-size', '7.5px', '9.5px'],
    ['FONT-SIZE', '12PX', '14px'],
    ['font-size', '0.875rem', 'calc(0.875rem + 2px)'],
    ['font-size', 'clamp(30px, 4vw, 48px)', 'calc(clamp(30px, 4vw, 48px) + 2px)'],
    ['font', '800 12px/1 monospace', '800 14px/1 monospace'],
    ['font', 'italic 700 11px "A  B", serif', 'italic 700 13px "A  B", serif'],
    ['--text-xs', '.75rem', 'calc(.75rem + 2px)'],
    ['--text-2xl', '1.5rem', 'calc(1.5rem + 2px)'],
    // 変えないもの：親や変数の大きさを受け継ぐので、変えると二重に大きくなる（式の中にあるときも）。
    ['font-size', '1.2em', '1.2em'],
    ['font-size', '90%', '90%'],
    ['font-size', 'var(--text-xs)', 'var(--text-xs)'],
    ['font-size', 'calc(1em + 1px)', 'calc(1em + 1px)'],
    ['font-size', 'calc(var(--text-xs) * 1.2)', 'calc(var(--text-xs) * 1.2)'],
    ['font-size', 'inherit', 'inherit'],
    ['font-size', '0', '0'],
    ['font', 'inherit', 'inherit'],
    // 文字の大きさでない Tailwind の変数・ほかの指定は変えない。
    ['--text-xs--line-height', 'calc(1 / .75)', 'calc(1 / .75)'],
    ['line-height', '12px', '12px'],
    ['width', '12px', '12px'],
  ];
  for (const [prop, value, expected] of cases) assert.equal(offsetDeclaration(prop, value, 2), expected, `${prop}: ${value}`);
});

test('文字の大きさ: 組み立てで1回だけ足す（!important もそのまま）', async () => {
  const css = '.a{font-size:12px}.b{font-size:10px!important}.c{font:700 11px/1.2 sans-serif}:root{--text-sm:.875rem}';
  const { css: out } = await postcss([fontSizeOffset({ px: 2 })]).process(css, { from: undefined });
  assert.equal(out, '.a{font-size:14px}.b{font-size:12px!important}.c{font:700 13px/1.2 sans-serif}:root{--text-sm:calc(.875rem + 2px)}');
  const { css: zero } = await postcss([fontSizeOffset({ px: 0 })]).process(css, { from: undefined });
  assert.equal(zero, css, 'N が 0 なら何も変えない');
});

// 本物の postcss.config.js（Tailwind ＋ このプラグイン）を通して、Tailwind が作った text-* にも足されることを確かめる（PR #180 レビュー 軽い4）。
test('文字の大きさ: 本物の組み立てで、Tailwind の text-xs と text-[10px] にも足す', async () => {
  const config = (await import(pathToFileURL(path.join(root, 'postcss.config.js')).href)).default;
  const input = '@import "tailwindcss" source(none);\n@source inline("text-xs text-[10px]");\nbody{font-size:16px}\n';
  const { css } = await postcss(config.plugins).process(input, { from: path.join(root, 'src', '__font_size_fixture.css') });
  assert.match(css, new RegExp(`--text-xs: calc\\(0\\.75rem \\+ ${N}px\\)`));
  assert.match(css, new RegExp(`font-size: ${10 + N}px`), 'text-[10px]');
  assert.match(css, new RegExp(`body\\s*\\{\\s*font-size: ${16 + N}px`));
});

// 大きさを一度も決めていない文字は、ブラウザの初期値 16px のまま大きくならなかった（PR #180 レビュー 重要1）。body に書いて N を足す。
test('文字の大きさ: 大きさを決めていない文字のために body に 16px を書く（html や :root には書かない）', () => {
  const css = read('src/index.css');
  assert.match(css, /\r?\nbody \{\r?\n  font-size: 16px;\r?\n\}/);
  assert.doesNotMatch(css, /(^|\n)(html|:root)\s*\{[^}]*font-size/, 'rem の基準が変わり、箱の大きさまで変わる');
});

// 画面のコードに直接書いた大きさ（style の fontSize）には CSS が届かないので、同じ N を足す。
// 配信画像の PNG（canvas）と、アイコンの絵の中の SVG の文字（fontSize="7"）は、画面の文字ではないので足さない。
test('文字の大きさ: style に数で書いた fontSize には同じ N を足す', () => {
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.tsx')) files.push(full); } };
  walk(path.join(root, 'src'));
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/fontSize:\s*(["']?\d+(?:px)?["']?)([^,}\n]*)/g)) {
      assert.match(match[2], /^\s*\+\s*FONT_SIZE_OFFSET\.px/, `${path.relative(root, file)}: fontSize: ${match[1]} に FONT_SIZE_OFFSET.px を足していない`);
    }
  }
});
