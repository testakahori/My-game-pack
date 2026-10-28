const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const React = require('react');
const root = path.resolve(__dirname, '../..');
const sourceRoot = process.env.UI_REPAIR_BASELINE || root;

// 副作用を動かさず、実際のコンポーネントが持つクリック処理と再描画を検証する。
function setupHarness(api) {
  let cursor = 0;
  const values = [];
  const hooks = { ...React, useEffect() {}, useState(initial) {
    const index = cursor++;
    if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial;
    return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
  } };
  const file = path.join(sourceRoot, 'src/components/InitialSetupPage.tsx');
  const compiled = new Module(file, module);
  compiled.paths = Module._nodeModulePaths(path.join(root, 'src/components'));
  const realRequire = compiled.require.bind(compiled);
  compiled.require = name => name === 'react' ? hooks : realRequire(name);
  compiled._compile(buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react-dom'], loader: { '.png': 'dataurl' }, nodePaths: [path.join(root, 'node_modules')], define: { 'import.meta.env.DEV': 'false' }, logLevel: 'silent' }).outputFiles[0].text, file);
  let completed = 0;
  global.window = { mygamepack: api };
  return { render(setupComplete = false) { cursor = 0; return compiled.exports.default({ setupComplete, onSetupComplete() { completed++; }, onResetSetup() {} }); }, get completed() { return completed; } };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, predicate));
  return [...(predicate(tree) ? [tree] : []), ...nodes(tree.props?.children, predicate)];
}
const existingButton = tree => nodes(tree, node => node.props?.className === 'setup-existing-button-v2')[0];

test('完了画面には元のヘッダー画像を表示する', () => {
  const tree = setupHarness({}).render(true);
  const images = nodes(tree, node => node.type === 'img' && node.props.className === 'setup-complete-hero-image-v2');
  assert.equal(images.length, 1);
  assert.match(images[0].props.src, /^data:image\/png/);
});

test('既存セットアップの確認失敗を押したボタンの近くで知らせ、再試行できる', async () => {
  const writes = [];
  const harness = setupHarness({
    appConfigRead: async () => ({ serverFolder: 'D:\\existing-server' }),
    appConfigWrite: async patch => writes.push(patch),
    serverCheckSetupComplete: async () => ({ complete: false, missing: ['run.bat'] }),
  });
  await existingButton(harness.render()).props.onClick();
  const copy = nodes(harness.render(), node => node.props?.className === 'setup-first-copy-v2')[0];
  const alerts = nodes(copy, node => node.props?.role === 'alert');
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].props.children, /run\.bat/);
  assert.equal(existingButton(copy).props.disabled, false);
  assert.equal(harness.completed, 0);
  assert.ok(writes.every(patch => patch.setupComplete !== true));
});

test('既存セットアップを確認中は別のセットアップ操作を止め、完了後に画面を開く', async () => {
  let finish;
  const wait = new Promise(resolve => { finish = resolve; });
  const writes = [];
  const harness = setupHarness({
    appConfigRead: () => wait,
    appConfigWrite: async patch => writes.push(patch),
    serverCheckSetupComplete: async () => ({ complete: true }),
    bridgeExtractTo: async () => ({}),
  });
  const pending = existingButton(harness.render()).props.onClick();
  const busy = harness.render();
  assert.equal(existingButton(busy).props['aria-busy'], true);
  const folderButton = nodes(busy, node => node.type === 'button' && node.props.children === '📁 フォルダを選択')[0];
  assert.equal(folderButton.props.disabled, true);
  finish({ serverFolder: 'D:\\existing-server' });
  await pending;
  assert.equal(harness.completed, 1);
  assert.deepEqual(writes.at(-1), { setupComplete: true, setupRequiredByInstall: false });
});

test('開発ブラウザーで保存先が空でも既存セットアップを再検出する', async () => {
  const file = path.join(sourceRoot, 'src/lib/devApiMock.ts');
  global.window = { location: { search: '' } };
  global.localStorage = { getItem: () => JSON.stringify({ serverFolder: '', setupComplete: false }), setItem() {} };
  // import.meta.glob（同梱のゲームパックの game.json を読む）は Vite だけのもの。ここではパックの無い形にする。
  global.__viteGlob = () => ({});
  const compiled = new Module(file, module);
  compiled._compile(buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', define: { 'import.meta.env.DEV': 'true', 'import.meta.glob': '__viteGlob' }, logLevel: 'silent' }).outputFiles[0].text, file);
  const status = await window.mygamepack.serverCheckSetupComplete();
  assert.ok(status.dir, '標準の保存先が返る');
});

test('ゲーム未保存でもホームを表示し、セットアップのやり直しでは保存先を保持する', () => {
  const app = fs.readFileSync(path.join(sourceRoot, 'src/App.tsx'), 'utf8');
  assert.doesNotMatch(app, /activePage === AppPage\.DASHBOARD && gameReady &&/);
  assert.match(app, /startReady=\{gameReady\}/);
  assert.doesNotMatch(app.slice(app.indexOf('const handleResetSetup'), app.indexOf('if (!configLoaded')), /serverFolder: ""/);
});
