// アプリの文字だけを全体で N px 大きくする（2026-11-04 ユーザーの決定「+2px」。箱の大きさはそのまま）。
// 組み立てのときに PostCSS で CSS の文字の大きさを書き換える（scripts/postcss-font-size-offset.cjs）。N は src/lib/fontSizeOffset.json の1か所。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const root = path.resolve(__dirname, '../..');
const fontSizeOffset = require('../../scripts/postcss-font-size-offset.cjs');
const { offsetDeclaration } = fontSizeOffset;
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('文字の大きさ: N はユーザーの決定どおり +2px で、組み立ての PostCSS が Tailwind のあとに使う', () => {
  assert.equal(JSON.parse(read('src/lib/fontSizeOffset.json')).px, 2);
  const config = read('postcss.config.js');
  assert.match(config, /plugins: \[tailwindcss\(\), fontSizeOffset\(FONT_SIZE_OFFSET\), autoprefixer\(\)\]/, 'Tailwind が text-* を作ったあとに足す');
  assert.match(config, /src\/lib\/fontSizeOffset\.json/);
});

test('文字の大きさ: px・rem・式・font・Tailwind の text-* に足し、em・%・var()・0 は変えない', () => {
  const cases = [
    ['font-size', '12px', '14px'],
    ['font-size', '7.5px', '9.5px'],
    ['font-size', '0.875rem', 'calc(0.875rem + 2px)'],
    ['font-size', 'clamp(30px, 4vw, 48px)', 'calc(clamp(30px, 4vw, 48px) + 2px)'],
    ['font', '800 12px/1 monospace', '800 14px/1 monospace'],
    ['--text-xs', '.75rem', 'calc(.75rem + 2px)'],
    ['--text-2xl', '1.5rem', 'calc(1.5rem + 2px)'],
    // 変えないもの：親や変数の大きさを受け継ぐので、変えると二重に大きくなる。
    ['font-size', '1.2em', '1.2em'],
    ['font-size', '90%', '90%'],
    ['font-size', 'var(--text-xs)', 'var(--text-xs)'],
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

// 画面のコードに直接書いた大きさ（style の fontSize）には CSS が届かないので、同じ N を足す。
// 配信画像の PNG（canvas）と、アイコンの絵の中の SVG の文字（fontSize="7"）は、画面の文字ではないので足さない。
test('文字の大きさ: style に数で書いた fontSize には同じ N を足す', () => {
  const dir = path.join(root, 'src/components');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.tsx'))) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const match of source.matchAll(/fontSize:\s*(\d+)([^,}\n]*)/g)) {
      assert.match(match[2], /^\s*\+\s*FONT_SIZE_OFFSET\.px/, `${file}: fontSize: ${match[1]} に FONT_SIZE_OFFSET.px を足していない`);
    }
  }
});
