// 画面の見直し（2026-10-29 ユーザーの決定）：配信ホームのゲームの欄を右の列（ライブ手順の上）へ移し、説明は「くわしく」を押したときだけ出す。
// 英語の飾りの見出しをなくし、言葉をそろえる。表示のくずれを直す。大きな枠・説明を小さくする。
// 10-17 の決めごと（画像を消さない・発光や文字サイズを一括で変えない・保存バーを足さない）は守る（初期セットアップの完了の絵は ui-visual-regressions.test.cjs が見張る）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// コメント（// と /* */）を除いた中身（画面に出る文字だけを見る）。
const code = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const components = () => fs.readdirSync(path.join(root, 'src/components')).filter(n => n.endsWith('.tsx')).map(n => [n, code(read('src/components/' + n))]);

test('画面: 英語の飾りの見出しを出さない', () => {
  for (const [file, src] of components()) {
    for (const word of ['WORKSPACE', 'GIFT ACTIONS', 'GIFT SETTINGS', 'LIVE JOURNAL', 'CREATOR STUDIO', 'WORLD CHECKPOINTS', 'SELECTED LIVE', 'TikTok Gifts', 'MyGamePack Manager']) {
      assert.ok(!src.includes(word), `${file} に ${word} がある`);
    }
  }
});

test('画面: 言葉をそろえる（「再読込」は「再読み込み」、「ダッシュボード」「TOP」は「配信ホーム」）', () => {
  for (const [file, src] of components()) {
    assert.ok(!src.includes('再読込'), `${file} に「再読込」がある`);
    assert.doesNotMatch(src, /ダッシュボード(へ|から|で|の)/, `${file} に「ダッシュボード」がある`);
  }
  const app = code(read('src/App.tsx'));
  assert.ok(!app.includes('TOPから'));
  assert.match(app, /変更は配信ホームから/);
});

test('画面: 左上のアプリの名前は BRIDGE（MyGamePack を出さない。2026-10-29 ユーザーの決定）', () => {
  const app = code(read('src/App.tsx'));
  assert.match(app, /<b>BRIDGE<\/b>/);
  assert.doesNotMatch(app, /<b>MyGamePack/);
});

test('配信ホーム: ゲームの欄は右の列（ライブ手順の上）。狭い窓では起動ボタンの下に回り、隠れない', () => {
  const app = read('src/App.tsx'), dash = read('src/components/DashboardPage.tsx'), css = read('src/components/DashboardLayout.css');
  assert.doesNotMatch(app, /activePage === AppPage\.DASHBOARD && <GameSelector/, 'ゲームの欄をページの上に出さない');
  assert.match(app, /gameSelector=\{setupComplete \? <GameSelector /);
  assert.match(dash, /import "\.\/DashboardLayout\.css";/);
  assert.doesNotMatch(read('src/index.css'), /\.cockpit-side/, '巨大な index.css には足さない（AGENTS.md）');
  assert.match(dash, /<div className="cockpit-side">\s*\{gameSelector\}\s*<LaunchGuide /);
  const side = css.match(/\n\.cockpit-side \{[^}]*\}/)?.[0];
  assert.ok(side, '.cockpit-side の決まりがある');
  assert.match(side, /grid-column: 2;/);
  assert.match(side, /align-self: start;/, '右の列を下まで伸ばさない（空の縦長の枠を作らない）');
  const narrow = css.slice(css.indexOf('@media (max-width: 1180px)'));
  const narrowSide = narrow.match(/\.cockpit-side \{[^}]*\}/)?.[0];
  assert.ok(narrowSide, '狭い窓の .cockpit-side の決まりがある');
  assert.match(narrowSide, /grid-column: 1;/);
  assert.doesNotMatch(narrowSide, /display: none/, '狭い窓でもゲームの欄は隠さない');
});

test('配信ホーム: ゲームの欄の説明は「くわしく」を押したときだけ出し、状態の知らせ（未保存・MOD が古い・復旧・エラー）はいつも出す', () => {
  const ui = read('src/components/GameSelector.tsx');
  const details = ui.indexOf('<summary>くわしく</summary>');
  assert.ok(details > 0, '「くわしく」がある');
  for (const text of ['使用するMOD', '① ゲームを選んで保存', '暗視・アイテムロストなし', 'コマンドの実行通知は非表示', 'ゲーム切替では現在のMODを削除せず退避します']) {
    assert.ok(ui.indexOf(text) > details, `${text} は「くわしく」の中`);
  }
  for (const text of ['ゲームの変更は未保存です', 'アプリの更新でMODが古いままです', '前回の切替が途中で止まっています', 'game-selector-error', 'マップを初期化']) {
    const at = ui.indexOf(text);
    assert.ok(at >= 0 && at < details, `${text} は「くわしく」の外（いつも出す）`);
  }
});

test('配信ホーム: 表示のくずれ（ログが空のときの文・マイクラIDの入力欄）', () => {
  const css = read('src/components/DashboardLayout.css'), dash = read('src/components/DashboardPage.tsx');
  assert.match(css, /\.cockpit-log-empty b \{[^}]*grid-column: 2 \/ -1;/, '空のときの文は時刻の列も使って横に広げる');
  assert.match(dash, /className="cockpit-account-row cockpit-account-row--wrap"/);
  assert.match(css, /\.cockpit-account-row--wrap \{[^}]*grid-template-columns: 20px 1fr;/, 'マイクラIDの入力欄を広げ、ボタンは下の行へ');
});

test('大きな枠・説明を小さく：ギフト設定のファイルの欄は1行、配信統計の説明は「記録について」を押したときだけ', () => {
  const bar = read('src/components/GiftTemplateToolbar.tsx');
  const barDetails = bar.indexOf('<summary>くわしく</summary>');
  assert.ok(barDetails > 0);
  for (const text of ['保存済みの割り当てを、ゲーム別に使い分け・配布できます。', 'アカウントやパスワード、コマンドのファイル本体は保存しません。']) assert.ok(bar.indexOf(text) > barDetails, `${text} は「くわしく」の中`);
  const rec = read('src/components/StreamRecordingPanel.tsx');
  const recDetails = rec.indexOf('<summary>記録について</summary>');
  assert.ok(recDetails > 0);
  assert.ok(rec.indexOf('TikTokへ接続すると配信ごとに記録を開始') > recDetails);
  assert.ok(rec.indexOf('role="status"') < recDetails, '記録しているかどうかは、いつも出す');
});
