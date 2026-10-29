// 見た目「コックピット強め」と、小さすぎる文字を少しだけ大きくする（2026-10-29 ユーザーの決定。見本を見て「コックピット＋文字も大きく」を選んだ）。
// 今の「配信の準備」の枠（角を切った形・方眼・青く光る枠）を、配信ホームのほかのカードにもそろえる。
// 10-17 の決めごと：色・画像・書体は変えない、光り方を抑えない。文字は 9〜10px の小さなものだけを 11〜12px にする（ユーザーが選んだ提案）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const theme = () => read('src/components/CockpitTheme.css');
// コメントを除いた決まり（「セレクタ { 中身 }」）の一覧。
const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ selectors: m[1].split(',').map(s => s.trim()), body: m[2] }));

test('コックピット強め：配信ホームの並びの後に読み、同じ強さの決まりに勝つ', () => {
  const main = read('src/main.tsx');
  const layout = main.indexOf('import "./components/DashboardLayout.css";');
  const cockpit = main.indexOf('import "./components/CockpitTheme.css";');
  assert.ok(layout >= 0 && cockpit > layout, 'main.tsx で DashboardLayout.css の後に読む');
  assert.doesNotMatch(read('src/index.css'), /CockpitTheme|clip-path: polygon\(16px/, '巨大な index.css には足さない（AGENTS.md）');
});

test('コックピット強め：5つのカードを、角を切った形・方眼・青く光る枠にそろえ、見出しに水色の光る線を付ける', () => {
  const list = rules(theme());
  for (const card of ['.ui-refresh .cockpit-main', '.ui-refresh .game-selector', '.ui-refresh .cockpit-preflight .safety-panel', '.ui-refresh .cockpit-info-card', '.ui-refresh .cockpit-activity', '.ui-refresh .cockpit-flow-panel']) {
    const rule = list.find(r => r.selectors.includes(card) && /clip-path:/.test(r.body));
    assert.ok(rule, `${card} の角を切る`);
    // studio.css の .ui-refresh :is(.cockpit-main, …) が !important で平らにしているので、同じく !important で勝つ（文字だけ見て、効いていないのに通った。見本の写真で気づいた）。
    for (const prop of ['border', 'border-radius', 'background', 'box-shadow', 'clip-path']) assert.match(rule.body, new RegExp(`(^|;)\\s*${prop}:[^;]*!important`), `${card} の ${prop} は !important`);
    assert.match(rule.body, /border: 1px solid rgba\(44, 137, 232/, `${card} は「配信の準備」と同じ青い枠`);
    assert.match(rule.body, /box-shadow:[^;]*rgba\(38, 118, 255/, `${card} は外に光る`);
  }
  // 「配信の準備」のもとのマイクラ風の飾り（studio.css が隠していた）を見せる。
  assert.ok(list.some(r => r.selectors.includes('.ui-refresh .cockpit-main::before') && /display: block !important/.test(r.body) && /z-index: 0/.test(r.body)));
  // 飾りは文字やボタンの後ろ（狭い窓で「ランチャー設定」の上に重なっていた）。
  assert.ok(list.some(r => r.selectors.includes('.ui-refresh .cockpit-main > *') && /z-index: 1/.test(r.body)));
  const bar = list.find(r => r.selectors.some(s => s.endsWith('h2::before')) && /background: #27d8ff/.test(r.body));
  assert.ok(bar, '見出しの前に水色の線');
  assert.match(bar.body, /box-shadow: 0 0 10px rgba\(39, 216, 255/, '線は光る');
});

test('文字：小さすぎる文字だけを 11〜12px にし、書体は変えず、光り方も画像も消さない（10-17 の決めごと）', () => {
  const css = theme();
  const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  assert.ok(sizes.length >= 5, '小さな文字の決まりがある');
  for (const size of sizes) assert.ok(size >= 11 && size <= 12, `font-size ${size}px は 11〜12px`);
  const list = rules(css);
  for (const selector of ['.ui-refresh .cockpit-log p', '.ui-refresh .cockpit-flow-step small', '.ui-refresh .cockpit-node em']) {
    assert.ok(list.some(r => r.selectors.includes(selector) && /font-size: 1[12]px/.test(r.body)), `${selector} を大きくする`);
  }
  assert.doesNotMatch(css, /font-family/, '書体は変えない');
  assert.doesNotMatch(css, /box-shadow:\s*none|text-shadow:\s*none|filter:\s*none/, '光り方を抑えない');
  assert.doesNotMatch(css, /img[^{]*\{[^}]*display:\s*none/, '画像を消さない');
});
