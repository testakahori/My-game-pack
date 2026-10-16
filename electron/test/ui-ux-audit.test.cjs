// UIで伝える状態と操作名の回帰テスト。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');

function component(name) {
  const file = path.join(process.env.UI_UX_BASELINE || root, 'src/components', name + '.tsx');
  const { outputFiles } = buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], nodePaths: [path.join(root, 'node_modules')], logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled.paths = Module._nodeModulePaths(path.join(root, 'src/components'));
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('スイッチは有効・無効どちらでも操作対象の名前を読み上げる', () => {
  const { ToggleSlider } = component('ToggleSlider');
  for (const checked of [false, true]) {
    const html = render(ToggleSlider, { label: 'フォローを有効にする', checked, onChange() {} });
    assert.match(html, /role="switch"/);
    assert.match(html, /aria-label="フォローを有効にする"/);
    assert.match(html, new RegExp(`aria-checked="${checked}"`));
  }
});

test('保存失敗を知らせ、編集中の再保存を許可する', () => {
  const { default: SaveBar } = component('SaveBar');
  const html = render(SaveBar, { dirty: true, saving: false, onSave() {}, message: { type: 'error', text: '保存できませんでした。再試行してください。' } });
  assert.match(html, /未保存の変更があります/);
  assert.match(html, /role="alert"[^>]*>保存できませんでした/);
  assert.doesNotMatch(html, /disabled/);
  const saving = render(SaveBar, { dirty: true, saving: true, onSave() {} });
  assert.match(saving, /button[^>]*disabled/);
  assert.match(saving, /保存中…/);
});

test('配信手順は未確認のMAPや停止中のプロセスを完了扱いにしない', () => {
  const { default: LaunchGuide } = component('LaunchGuide');
  const html = render(LaunchGuide, { server: 'pending', bridge: 'pending', gameRunning: false, live: false, world: 'world' });
  assert.doesNotMatch(html, /<em>完了<\/em>/);
  assert.match(html, /ワールド・MAP保存を確認/);
  assert.match(html, /自分で確認/);
});

test('配信手順は処理中・失敗・実際の配信開始を区別する', () => {
  const { default: LaunchGuide } = component('LaunchGuide');
  const html = render(LaunchGuide, { server: 'active', bridge: 'error', gameRunning: false, live: true, world: '' });
  assert.match(html, /<em>処理中<\/em>/);
  assert.match(html, /<em>確認が必要<\/em>/);
  assert.equal((html.match(/<em>完了<\/em>/g) || []).length, 1);
});


test('編集を再開したら古い保存成功を表示しない', () => {
  const { default: SaveBar } = component('SaveBar');
  const message = { type: 'ok', text: '設定を保存しました。' };
  const dirty = render(SaveBar, { dirty: true, saving: false, onSave() {}, message });
  assert.match(dirty, /未保存の変更があります/);
  assert.doesNotMatch(dirty, /設定を保存しました。/);
  const saved = render(SaveBar, { dirty: false, saving: false, onSave() {}, message });
  assert.match(saved, /設定を保存しました。/);
  assert.match(saved, /button[^>]*disabled/);
});
