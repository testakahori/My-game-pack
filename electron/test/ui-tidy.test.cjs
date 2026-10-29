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

test('画面: 左上のロゴは、緑の顔ではなく BRIDGE のアプリのアイコンの画像（2026-10-29 ユーザーの決定）', () => {
  const app = code(read('src/App.tsx'));
  assert.match(app, /import appIcon from "\.\.\/assets\/app-icon\.png";/);
  assert.match(app, /<img className="global-app-icon" src=\{appIcon\}/);
  assert.doesNotMatch(app, /MinecraftBlockIcon/, '緑の顔の部品は使わない');
  // assets/app-icon.png は assets/icon.ico（アプリのアイコン）の 128px の画像。
  const png = fs.readFileSync(path.join(root, 'assets/app-icon.png'));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.ok(png.readUInt32BE(16) >= 64 && png.readUInt32BE(20) >= 64, 'ロゴに使えるだけの大きさ（64px 以上）');
  // 緑の顔の飾り（.global-app-cube）と部品の見た目（.minecraft-block-icon）は、使う所がなくなったので残さない（2回目のレビューの軽い指摘）。
  for (const file of ['src/index.css', 'src/studio.css']) assert.doesNotMatch(read(file), /global-app-cube|minecraft-block-icon/, file);
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
  // 同じ強さの index.css・studio.css の決まりに勝つよう、いちばん後に読む（コンポーネントから読むと、組み立てた CSS の頭に入って負けた。最後のレビュー）。
  const main = read('src/main.tsx');
  assert.ok(main.indexOf('import "./studio.css";') >= 0 && main.indexOf('import "./components/DashboardLayout.css";') > main.indexOf('import "./studio.css";'), 'main.tsx で studio.css の後に読む');
  assert.doesNotMatch(dash, /DashboardLayout\.css/, 'DashboardPage からは読まない（読み込みの順がずれる）');
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
  // studio.css の .ui-refresh .cockpit-layout（2列）より後で、同じ強さで1列にする（右に空の列を残さない）。
  assert.match(narrow, /\.ui-refresh \.cockpit-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(narrow, /\.ui-refresh \.cockpit-lower-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, '下のカードは2列（右に空きを作らない）');
  for (const rule of ['.cockpit-preflight', '.cockpit-lower-grid']) {
    assert.match(css, new RegExp(`\\n\\${rule} \\{[^}]*align-self: start;`), `${rule} は右の列の高さに引き伸ばされない`);
  }
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

// 画面の外から出る知らせ（アプリ・BRIDGE の文）と手順書も、同じ言葉にそろえる（最後のレビューの軽い指摘。2026-10-29 ユーザーの決定「全部直す」）。
test('言葉：アプリ・BRIDGE の知らせと手順書にも「ダッシュボード」「TOP」「ギフト設定保存・読込」「再読込」を残さない', () => {
  const files = [
    ...fs.readdirSync(path.join(root, 'electron')).filter(n => n.endsWith('.cjs')).map(n => 'electron/' + n),
    ...fs.readdirSync(path.join(root, 'bridge')).filter(n => /\.(cjs|js)$/.test(n)).map(n => 'bridge/' + n),
    ...fs.readdirSync(path.join(root, 'src/lib')).filter(n => n.endsWith('.ts')).map(n => 'src/lib/' + n),
  ];
  for (const file of files) {
    const src = code(read(file));
    assert.doesNotMatch(src, /ダッシュボード(で|の|へ|から)|TOP(で|から|の|に)|ギフト設定保存|ギフト設定(を)?読込|再読込/, file);
  }
  for (const file of fs.readdirSync(path.join(root, 'docs')).filter(n => n.endsWith('.md')).map(n => 'docs/' + n)) {
    assert.doesNotMatch(read(file), /ギフト設定保存|ギフト設定読込/, file);
  }
});

test('配信ホーム：「切替は停止中に」はいつも見え、ギフト設定は保存できない理由をボタンの横に出す', () => {
  const ui = read('src/components/GameSelector.tsx');
  const details = ui.indexOf('<summary>くわしく</summary>');
  const at = ui.indexOf('切替はサーバー・Minecraft・BRIDGEの停止中に行います');
  assert.ok(at >= 0 && at < details, '「くわしく」の外');
  const bar = read('src/components/GiftTemplateToolbar.tsx');
  const hint = bar.indexOf('{count === 0 && <span');
  assert.ok(hint >= 0 && hint < bar.indexOf('<summary>くわしく</summary>'), '押せない理由はボタンの横に見える形で');
});
