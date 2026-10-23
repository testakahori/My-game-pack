// 画面の TikTok ID の整え方は src/lib/tiktokId.ts の1か所（処理のコピー PR9）。
// 画面（TypeScript）からは bridge の CJS を読まないので、bridge/tiktok_id.cjs の写しになる。食い違えばここで落ちる（integerInput.ts・commandFiles.ts と同じ形）。
// 前は画面ごとに「@ を除くだけ」の写しを持ち、小文字にしないので、大文字小文字だけ違う ID を「非承認」と出し、古い設定の名前（tiktok.username）も読んで、
// BRIDGE が使わない ID を「承認済み」と出していた。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const bridge = require('../../bridge/tiktok_id.cjs');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'src/lib/tiktokId.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const ui = compiled.exports;

const values = [' @Foo_Bar ', 'foo-bar', '@', '', 'a'.repeat(24), 'a'.repeat(25), 'ＦＯＯ', 'foo.bar', null, undefined, 3, '　foo　', '@@foo', 'FOO'];

test('画面の TikTok ID: bridge/tiktok_id.cjs と同じ例で同じ結果', () => {
  for (const value of values) {
    assert.equal(ui.normalizeTikTokId(value), bridge.normalizeTikTokId(value), JSON.stringify(value));
    assert.equal(ui.isValidTikTokId(value), bridge.isValidTikTokId(value), JSON.stringify(value));
    assert.equal(ui.tiktokIdProblem(value), bridge.tiktokIdProblem(value), JSON.stringify(value));
  }
});

test('画面の TikTok ID: 大文字小文字・@・前後の空白だけが違う ID は同じ ID', () => {
  assert.equal(ui.sameTikTokId('foo', 'Foo'), true);
  assert.equal(ui.sameTikTokId('foo', '@foo '), true);
  assert.equal(ui.sameTikTokId('foo', 'foo2'), false);
  assert.equal(ui.sameTikTokId('', ''), false, '空どうしは同じ ID ではない');
  assert.equal(ui.sameTikTokId('@', null), false);
});

test('画面の TikTok ID: 画面は自分の整え方と古い設定の名前を持たない', () => {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const screens = ['src/components/DashboardPage.tsx', 'src/components/GiftsViewerPage.tsx', 'src/components/GiftsGridSection.tsx', 'src/components/GiftSettingsPage.tsx'];
  for (const relative of [...screens, 'GiftsViewer/src/App.tsx']) {
    const source = read(relative);
    assert.doesNotMatch(source, /\.replace\(\/\^@\//, relative + ' に @ を除く写しが残っている');
    // 設定（cfg・existingCfg）の古い名前だけを見る（BRIDGE の状態の bridgeProcess.tiktok?.username は正しい書き方。PR9 の最後のレビュー）。
    assert.doesNotMatch(source, /[cC]fg\?\.tiktok\?\.(username|user)\b/, relative + ' が古い設定の名前（tiktok.username・tiktok.user）を読んでいる');
    assert.doesNotMatch(source, /username is empty/, relative + ' に英語の空の文が残っている');
  }
  for (const relative of screens) assert.match(read(relative), /from "\.\.\/lib\/tiktokId"/, relative + ' が src/lib/tiktokId.ts を使っていない');
  // 配信ホームは LIVE の確かめが返す理由を出す（前は「確認できません」だけで、main の理由を捨てていた）。
  assert.match(read('src/components/DashboardPage.tsx'), /accountLive\.error/);
});

// PR9 の最後のレビューの軽い指摘（処理のコピー PR9）。
test('画面の TikTok ID: 記録と表示は整えた形、更新の失敗は main の理由だけ、形の正しくない保存済みの ID は承認済みと出さない', () => {
  const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
  const dashboard = read('src/components/DashboardPage.tsx');
  // 前は「@Foo_Bar」と入力して承認すると、ログが「@@Foo_Bar」になった（設定は入力したままの形で保存するため）。
  assert.doesNotMatch(dashboard, /@\$\{applied\.username\}/, '配信ホームのログに入力のままの ID を出している');
  assert.match(dashboard, /@\$\{normalizeTikTokId\(applied\.username\)\}/);
  assert.doesNotMatch(read('src/components/GiftsViewerPage.tsx'), /@\{meta\?\.username \|\| username \|\|/, 'ギフト一覧の画面に入力のままの ID を出している');
  // 前は保存済みの foo-bar（古い設定・手で書いた設定）でも「承認済み」と出て、BRIDGE は起動しなかった。
  assert.match(dashboard, /idApproved = sameTikTokId\(username, appliedUsername\) && isValidTikTokId\(appliedUsername\)/);
  // LIVE の確かめの理由は長いので、丸い表示は短くし、全文はマウスを載せると出す。
  assert.match(dashboard, /liveState === "error" \? "確認できません"/);
  assert.match(dashboard, /title=\{item\.icon === "tiktok" \? liveTitle : undefined\}/);
  // ギフト一覧の更新の失敗は、Electron の英語の前置きを除いた main の理由だけを出す（前は「Error invoking remote method …」が付いた）。
  for (const relative of ['src/components/GiftsGridSection.tsx', 'src/components/GiftsViewerPage.tsx']) {
    const source = read(relative);
    assert.doesNotMatch(source, /setErr\(e\?\.message \|\| String\(e\)\)/, relative + ' が Electron の英語の前置きを付けたまま出している');
    assert.match(source, /setErr\(ipcErrorMessage\(e\)\)/, relative);
  }
});

test('開発用の表示: 承認（configWrite）でも TikTok ID を確かめる', () => {
  const mock = fs.readFileSync(path.join(root, 'src/lib/devApiMock.ts'), 'utf8');
  const write = mock.slice(mock.indexOf('configWrite:'), mock.indexOf('configPath:'));
  assert.match(write, /mockTikTokIdProblem\(next\)/, '前は configWrite が確かめず、開発用の表示では foo-bar も承認できた');
  assert.match(mock.slice(mock.indexOf('configValidate:')), /mockTikTokIdProblem\(next\)/);
});
