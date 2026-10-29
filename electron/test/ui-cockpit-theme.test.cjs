// 見た目「コックピット強め」と、小さすぎる文字を少しだけ大きくする（2026-10-29 ユーザーの決定。見本を見て「コックピット＋文字も大きく」を選び、
// そのあと「配信ホームとギフト設定以外もコックピット強めと同じ感じに」と全ページへ広げた）。
// index.css のもとの「配信の準備」の作り（角を切った形・方眼・青い枠・内側の光）を、全ページの大きな箱にそろえる。
// 10-17 の決めごと：色・画像・書体は変えない、光り方を抑えない。文字は 8〜10px の小さなものだけを 11〜12px にする（ユーザーが選んだ提案）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const theme = () => read('src/components/CockpitTheme.css');
// コメントを除き、@media の中も読み、「セレクタ { 中身 }」の一覧にする。:is(a, b) の中のカンマでは分けない。
function rules(css) {
  const out = [];
  const walk = text => {
    let pos = 0;
    while (pos < text.length) {
      const open = text.indexOf('{', pos);
      if (open < 0) break;
      let depth = 1, end = open + 1;
      while (end < text.length && depth) { if (text[end] === '{') depth++; else if (text[end] === '}') depth--; end++; }
      const head = text.slice(pos, open).trim(), body = text.slice(open + 1, end - 1);
      if (head.startsWith('@')) walk(body);
      else out.push({ selectors: head.split(/,(?![^()]*\))/).map(s => s.replace(/\s+/g, ' ').trim()), body });
      pos = end;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}
const find = (list, selector, pattern) => list.find(r => r.selectors.includes(selector) && (!pattern || pattern.test(r.body)));
const insetOnly = (body, label) => {
  // clip-path は外側の影も切るので、外に光る影は描かれない（最後のレビュー 重要3）。光は内側だけにして、見えない影を書かない。
  const shadow = body.match(/box-shadow:([^;]*)/)[1].replace('!important', '');
  for (const part of shadow.split(/,(?![^(]*\))/)) assert.match(part.trim(), /^inset /, `${label} の影は内側だけ（${part.trim()}）`);
};

test('コックピット強め：並びの後に読み、同じ強さの決まりに勝つ。studio.css 側にも上書きしている印', () => {
  const main = read('src/main.tsx');
  const layout = main.indexOf('import "./components/DashboardLayout.css";');
  const cockpit = main.indexOf('import "./components/CockpitTheme.css";');
  assert.ok(layout >= 0 && cockpit > layout, 'main.tsx で DashboardLayout.css の後に読む');
  assert.doesNotMatch(read('src/index.css'), /CockpitTheme|clip-path: polygon\(16px/, '巨大な index.css には足さない（AGENTS.md）');
  const studio = read('src/studio.css');
  assert.ok(studio.indexOf('CockpitTheme.css') >= 0 && studio.indexOf('CockpitTheme.css') < studio.indexOf('.ui-refresh :is(.ops-panel,.cockpit-main'), 'studio.css の平らにする決まりの前に、上書きしている印');
  assert.match(theme(), /z-index: 1[\s\S]*自分で作るドロップダウン|自分で作るドロップダウン[\s\S]*z-index: 1/, '直下の子の z-index の注意を書く');
});

test('配信ホーム：6つのカードを、角を切った形・方眼・青い枠・内側の光にそろえ、見出しに水色の光る線を付ける', () => {
  const list = rules(theme());
  for (const card of ['.ui-refresh .cockpit-main', '.ui-refresh .game-selector', '.ui-refresh .cockpit-preflight .safety-panel', '.ui-refresh .cockpit-info-card', '.ui-refresh .cockpit-activity', '.ui-refresh .cockpit-flow-panel']) {
    const rule = find(list, card, /clip-path:/);
    assert.ok(rule, `${card} の角を切る`);
    // studio.css の .ui-refresh :is(.cockpit-main, …) が !important で平らにしているので、同じく !important で勝つ（文字だけ見て、効いていないのに通った。見本の写真で気づいた）。
    for (const prop of ['border', 'border-radius', 'background', 'box-shadow', 'clip-path']) assert.match(rule.body, new RegExp(`(^|;)\\s*${prop}:[^;]*!important`), `${card} の ${prop} は !important`);
    assert.match(rule.body, /border: 1px solid rgba\(44, 137, 232/, `${card} は「配信の準備」と同じ青い枠`);
    insetOnly(rule.body, card);
  }
  // 「配信の準備」のもとのマイクラ風の飾り（studio.css が隠していた）を見せる。飾りは文字やボタンの後ろ。
  assert.ok(find(list, '.ui-refresh .cockpit-main::before', /display: block !important/));
  assert.ok(find(list, '.ui-refresh .cockpit-main > *', /z-index: 1/), '飾りは文字やボタンの後ろ（狭い窓で「ランチャー設定」の上に重なっていた）');
  const bar = list.find(r => r.selectors.some(s => s.endsWith('h2::before')) && /background: #27d8ff/.test(r.body));
  assert.ok(bar, 'カードの見出しの前に水色の線');
  assert.match(bar.body, /box-shadow: 0 0 10px rgba\(39, 216, 255/, '線は光る');
});

test('配信ホームの細かな所：上の帯の光る線・配信画像は紫・ボタンに触れたときの変化・一括チェックだけを狙う', () => {
  const list = rules(theme());
  assert.ok(!list.some(r => r.selectors.some(s => s.includes('.app-topbar'))), '.app-topbar は画面に出ない（もとから非表示）ので書かない');
  assert.ok(find(list, '.ui-refresh .global-app-header', /box-shadow:[^;]*39, 216, 255/), '本当のいちばん上の帯の下に光る線');
  assert.ok(find(list, '.ui-refresh .studio-nav button[aria-current="page"]:not(.is-creator)', /#27d8ff/), 'ふつうのページは水色');
  assert.ok(find(list, '.ui-refresh .studio-nav button.is-creator[aria-current="page"]', /#c5a2ff/), '配信画像（紫の配色）は紫');
  for (const selector of ['.ui-refresh .game-selector button.game-selector-apply:hover:not(:disabled)', '.ui-refresh .cockpit-preflight .safety-panel button.safety-primary:hover:not(:disabled)']) {
    assert.ok(find(list, selector), `${selector}：カーソルを乗せたときに変化する`);
  }
  assert.ok(!find(list, '.ui-refresh .safety-panel-heading p'), '運用センターの説明まで変えない（配信ホームの一括チェックだけ）');
  assert.ok(find(list, '.ui-refresh .cockpit-preflight .safety-panel-heading p', /font-size: 12px/));
});

test('文字：小さすぎる文字だけを 11〜12px にし、書体は変えず、光り方も画像も消さない（10-17 の決めごと）', () => {
  const css = theme(), list = rules(css);
  const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  for (const size of sizes) assert.ok(size >= 11 && size <= 12, `font-size ${size}px は 11〜12px`);
  // もとの大きさ（index.css・studio.css）→ 新しい大きさ。どれも前より大きい。
  const expected = {
    '.ui-refresh .cockpit-log p': 12, '.ui-refresh .cockpit-node em': 11, '.ui-refresh .cockpit-node small': 11, '.ui-refresh .cockpit-flow-step small': 11,
    '.ui-refresh .cockpit-info-card label': 11, '.ui-refresh .cockpit-apply small': 11, '.ui-refresh .cockpit-safety-state small': 11,
    '.ui-refresh .cockpit-world-card > small': 11, '.ui-refresh .euler-settings small': 11,
    '.ui-refresh .cockpit-activity button': 11, '.ui-refresh .cockpit-safety-card li': 11, '.ui-refresh .cockpit-flow-note': 11, '.ui-refresh .cockpit-flow-panel h2 small': 11,
  };
  for (const [selector, size] of Object.entries(expected)) assert.ok(find(list, selector, new RegExp(`font-size: ${size}px`)), `${selector} を ${size}px に`);
  // 大きくするのは小さすぎる文字だけ。カードの中の small を一括で狙うと、12.8px の知らせ（OP権限の結果）まで縮んだ（最後のレビュー 重要2）。
  assert.ok(!find(list, '.ui-refresh .cockpit-info-card small'), 'カードの中の small を一括で狙わない');
  // 文字を大きくして、よく使う幅（1181〜1440px）で言葉の途中で割れていた（最後のレビュー 重要1）。
  assert.ok(find(list, '.ui-refresh .cockpit-account-row em', /white-space: nowrap/), '「承認済み」を割らない');
  for (const selector of ['.ui-refresh .cockpit-apply small', '.ui-refresh .cockpit-safety-state b', '.ui-refresh .cockpit-safety-state small']) {
    assert.ok(find(list, selector, /word-break: auto-phrase/), `${selector} は言葉のまとまりで折り返す`);
  }
  assert.doesNotMatch(css, /font-family/, '書体は変えない');
  assert.doesNotMatch(css, /box-shadow:\s*none|text-shadow:\s*none|filter:\s*none/, '光り方を抑えない');
  assert.doesNotMatch(css, /img[^{]*\{[^}]*display:\s*none|setup-complete-hero/, '画像を消さない・初期セットアップの完了の絵に触らない');
});

test('全ページ：大きな箱を同じ作り（角を切った形・方眼・内側の光）に。色の付いた箱は色を残し、灰色の箱は青い枠。小さなカードは角を小さく切る。ページの見出しに水色の線', () => {
  const list = rules(theme());
  const big = ['.analytics-panel', '.stream-recording-panel', '.gift-design-top', '.gift-template-tools', '.gift-flow-panel', '.gift-registered-panel', '.gift-command-stage',
    '.events-summary', '.events-like-panel', '.events2-page > section', '.tts-read-target-section', '.tts-tuning-section', '.tts-test-section',
    '.panel-settings', '.panel-preview-shell', '.panel-library', '.gift-catalog-panel-v2', '.cmd-usage-banner', '.ops-panel', '.map-saves-panel',
    '.setup-info-panel-v2', '.setup-step-card-v2'];
  const bigRule = list.find(r => r.selectors.some(s => s.startsWith('.ui-refresh :is(')) && /clip-path: polygon\(16px/.test(r.body));
  assert.ok(bigRule, '大きな箱の決まりがある');
  const bigList = bigRule.selectors.find(s => s.startsWith('.ui-refresh :is('));
  for (const cls of big) assert.ok(bigList.includes(cls), `${cls} を大きな箱にそろえる`);
  insetOnly(bigRule.body, '大きな箱');
  assert.doesNotMatch(bigRule.body, /border(-color)?:/, '大きな箱の決まりでは枠の色を変えない（紫・赤・緑などの色を残す）');
  // 色の付いていない（灰色の）箱だけ青い枠。紫（ギフトの流れ・実行内容）、赤（つながっていない）などは入れない。
  const blue = list.find(r => r.selectors.some(s => s.startsWith('.ui-refresh :is(')) && /border: 1px solid rgba\(44, 137, 232/.test(r.body) && !/clip-path/.test(r.body));
  assert.ok(blue, '灰色の箱を青い枠にする決まりがある');
  const blueList = blue.selectors.find(s => s.startsWith('.ui-refresh :is('));
  for (const cls of ['.gift-flow-panel', '.gift-command-stage', '.tts-test-section', '.tts-engine-alert', '.ops-panel']) assert.ok(!blueList.includes(cls), `${cls} は色を残す`);
  const small = list.find(r => r.selectors.some(s => s.startsWith('.ui-refresh :is(') && s.includes('.gift-catalog-card')) && /clip-path: polygon\(10px/.test(r.body));
  assert.ok(small, '小さなカードは角を小さく切る');
  const h1 = find(list, '.ui-refresh .app-content h1::before', /background: #27d8ff/);
  assert.ok(h1, 'ページの見出しの前に水色の線');
});
