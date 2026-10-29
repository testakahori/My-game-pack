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
// 括弧の外のカンマだけで分ける（:is(a, :not(b), c) のように括弧が入れ子でも、中のカンマでは分けない）。
function splitTop(text) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}
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
      else out.push({ selectors: splitTop(head).map(s => s.replace(/\s+/g, ' ').trim()), body });
      pos = end;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}
// セレクタの強さ [id, class, 要素]。:is(…)・:not(…) は中でいちばん強いもの、:where(…) は 0。
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
function specificity(selector) {
  let a = 0, b = 0, c = 0;
  let sel = selector.replace(/:(is|not|where)\(((?:[^()]|\([^()]*\))*)\)/g, (m, fn, inner) => {
    if (fn === 'where') return ' ';
    const best = splitTop(inner).map(specificity).sort(cmp).pop();
    a += best[0]; b += best[1]; c += best[2];
    return ' ';
  });
  sel = sel.replace(/\[[^\]]*\]/g, () => { b++; return ' '; }).replace(/::[\w-]+/g, () => { c++; return ' '; })
    .replace(/#[\w-]+/g, () => { a++; return ' '; }).replace(/\.[\w-]+/g, () => { b++; return ' '; }).replace(/:[\w-]+/g, () => { b++; return ' '; });
  for (const part of sel.split(/[\s>+~]+/)) if (/^[a-zA-Z][\w-]*$/.test(part)) c++;
  return [a, b, c];
}
const PAGE_BOXES = 'html body .app-shell.ui-refresh :is(';
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
  // 小さすぎる文字は 11〜12px。BRIDGE と妨害のボタンだけは、一括起動と同じ大きさ（下のテスト）。
  const sizes = list.filter(r => !r.selectors.includes('.ui-refresh .cockpit-bridge-actions > button')).flatMap(r => [...r.body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1])));
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
    '.events-summary', '.events-like-panel', '.events2-section', '.tts-read-target-section', '.tts-tuning-section', '.tts-test-section',
    '.panel-settings', '.panel-preview-shell', '.panel-library', '.gift-catalog-panel-v2', '.cmd-usage-banner', '.ops-panel', '.map-saves-panel',
    '.setup-info-panel-v2', '.setup-verify-panel-v2', '.setup-folder-panel-v2'];
  const bigRule = list.find(r => r.selectors.some(s => s.startsWith(PAGE_BOXES)) && /clip-path: polygon\(16px/.test(r.body));
  assert.ok(bigRule, '大きな箱の決まりがある');
  const bigList = bigRule.selectors.find(s => s.startsWith(PAGE_BOXES));
  for (const cls of big) assert.ok(bigList.includes(cls), `${cls} を大きな箱にそろえる`);
  // 読み上げの「▲ VOICEVOX が停止しています」の箱は、もとの赤っぽい背景を残す（方眼の紺にすると赤が薄くなった。2回目のレビューの軽い指摘）。
  assert.ok(!bigList.includes('.tts-engine-alert'), '.tts-engine-alert は大きな箱にしない（赤っぽい背景を残す）');
  // はじめての画面の手順のカードは、番号の丸をカードの外に出す作りなので角を切らない（下のテスト）。
  assert.ok(!bigList.includes('.setup-step-card-v2'), '.setup-step-card-v2 の角は切らない');
  // ルーレット・コメントの箱は、タグ（> section）ではなく名前（.events2-section）で狙う。
  assert.doesNotMatch(theme(), /events2-page > section/);
  insetOnly(bigRule.body, '大きな箱');
  assert.doesNotMatch(bigRule.body, /border(-color)?:/, '大きな箱の決まりでは枠の色を変えない（紫・赤・緑などの色を残す）');
  // 色の付いていない（灰色の）箱だけ青い枠。紫（ギフトの流れ・実行内容）、赤（つながっていない）などは入れない。
  const blue = list.find(r => r.selectors.some(s => s.startsWith(PAGE_BOXES)) && /border: 1px solid rgba\(44, 137, 232/.test(r.body) && !/clip-path/.test(r.body));
  assert.ok(blue, '灰色の箱を青い枠にする決まりがある');
  const blueList = blue.selectors.find(s => s.startsWith(PAGE_BOXES));
  for (const cls of ['.gift-flow-panel', '.gift-command-stage', '.tts-test-section', '.tts-engine-alert']) assert.ok(!blueList.includes(cls), `${cls} は色を残す`);
  // 運用センターは、接続状況（赤・緑で状態を出す）だけ色を残し、ほかの箱は「MAPセーブ・ロード」と同じ青い枠（2回目のレビューの軽い指摘）。
  assert.ok(blueList.includes('.ops-panel:not(.ops-monitor)'), '運用センターの灰色の箱も青い枠に');
  for (const cls of ['.events2-section', '.setup-step-card-v2']) assert.ok(blueList.includes(cls), `${cls} も青い枠`);
  const small = list.find(r => r.selectors.some(s => s.startsWith('.ui-refresh :is(') && s.includes('.gift-catalog-card')) && /clip-path: polygon\(10px/.test(r.body));
  assert.ok(small, '小さなカードは角を小さく切る');
  const h1 = find(list, '.ui-refresh .app-content h1::before', /background: #27d8ff/);
  assert.ok(h1, 'ページの見出しの前に水色の線');
  // 見出しの字の間隔は、もとのまま（文字の見た目は変えない。2回目のレビューの軽い指摘）。
  assert.doesNotMatch(find(list, '.ui-refresh .app-content h1').body, /letter-spacing/, 'ページの見出しの字の間隔は変えない');
  assert.match(read('src/components/EventSettings2Page.tsx'), /<section className=\{`events2-section /, 'ルーレット・コメントの箱に名前を付ける');
});

// studio.css は、いくつかの大きな箱を !important で灰色の平らな箱にしている（321行目の強さは (0,3,1)）。
// 同じ強さ以下だと負けて、ギフト設定・いいね・フォロー・ルーレット・コメント・読み上げの箱が灰色のままだった（2回目のレビュー 重要1）。
test('全ページ：大きな箱の決まりは、studio.css で同じ箱を !important で塗る決まりのどれよりも強い', () => {
  const list = rules(theme());
  const ours = list.filter(r => r.selectors.some(s => s.startsWith('html body .app-shell.ui-refresh ')));
  assert.ok(ours.length >= 3, '大きな箱・青い枠・手順のカードの決まり');
  const classes = new Set(ours.flatMap(r => r.selectors.flatMap(s => [...s.matchAll(/\.([\w-]+)/g)].map(m => m[1])))
    .filter(name => !['app-shell', 'ui-refresh', 'ops-monitor'].includes(name)));
  // ルーレット・コメントの箱（.events2-section）は、studio.css では .events-page > section で狙われている。
  classes.add('events-page');
  const studio = rules(read('src/studio.css')).filter(r => /(background|border|box-shadow|clip-path)[^;]*!important/.test(r.body));
  const rivals = studio.flatMap(r => r.selectors).filter(s => [...s.matchAll(/\.([\w-]+)/g)].some(m => classes.has(m[1])));
  assert.ok(rivals.some(s => s.includes('.events-page>section')), 'studio.css 321行目の決まりを相手にしている');
  for (const rule of ours) {
    const mine = specificity(rule.selectors.find(s => s.startsWith('html body .app-shell.ui-refresh ')));
    for (const rival of rivals) assert.ok(cmp(mine, specificity(rival)) > 0, `(${mine}) は studio.css の ${rival.slice(0, 60)}…（${specificity(rival)}）より強い`);
  }
});

// 手順のカード（.setup-step-card-v2）は、番号の丸（1・2）をカードの左の外へ出す作り。角を切ると丸の左半分が欠けた（2回目のレビュー 重要2）。
test('初期セットアップ：はじめての画面の手順のカードは角を切らず、方眼・内側の光・青い枠はそろえる', () => {
  const list = rules(theme());
  const clipped = list.filter(r => /clip-path:/.test(r.body)).flatMap(r => r.selectors);
  assert.ok(!clipped.some(s => s.includes('.setup-step-card-v2')), '手順のカードに clip-path を付けない');
  const card = find(list, 'html body .app-shell.ui-refresh .setup-step-card-v2', /background:/);
  assert.ok(card, '手順のカードの決まりがある');
  assert.match(card.body, /rgba\(4, 20, 43, 0\.92\)/, '大きな箱と同じ方眼');
  insetOnly(card.body, '手順のカード');
});

// 小さなカードは角を切るので、外に光る影は切れて見えない。カーソルを乗せたときの光は内側に（2回目のレビュー 重要3。2026-10-29 ユーザーの決定「案A」）。
test('小さなカード：ギフト一覧・コマンド一覧のカードにカーソルを乗せたときは、角を切ったまま内側が光る', () => {
  const list = rules(theme());
  for (const card of ['.gift-catalog-card', '.cmd-card']) {
    const hover = find(list, `.ui-refresh ${card}:hover`, /box-shadow:/);
    assert.ok(hover, `${card} にカーソルを乗せたときの光`);
    assert.match(hover.body, /rgba\(24, 217, 255/, '水色に光る');
    insetOnly(hover.body, `${card}:hover`);
    // index.css の .gift-catalog-card:hover・.cmd-card:hover（外に光る影）より強い。
    assert.ok(cmp(specificity(`.ui-refresh ${card}:hover`), specificity(`${card}:hover`)) > 0);
  }
});

// 「BRIDGE起動・停止・再起動」「妨害を一時停止」の文字が小さすぎる（11px）ので、一括起動と同じ大きさに（2026-10-29 ユーザーの決定）。
test('配信ホーム：BRIDGE と妨害のボタンの文字は、一括起動と同じ大きさ', () => {
  const allStart = read('src/studio.css').match(/\.ui-refresh \.cockpit-all-start \{[^}]*font-size:(\d+)px/)[1];
  const rule = find(rules(theme()), '.ui-refresh .cockpit-bridge-actions > button', /font-size:/);
  assert.ok(rule, 'BRIDGE と妨害のボタンの決まりがある');
  assert.match(rule.body, new RegExp(`font-size: ${allStart}px`), `一括起動と同じ ${allStart}px`);
  // 妨害を一時停止のボタンも同じ並び（.cockpit-bridge-actions）の中にある。
  const dash = read('src/components/DashboardPage.tsx');
  assert.ok((dash.match(/<div className="cockpit-bridge-actions">/g) || []).length >= 2, 'BRIDGE と妨害のボタンは、どちらも .cockpit-bridge-actions の中');
});
