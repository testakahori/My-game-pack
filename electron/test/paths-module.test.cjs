// 配置の場所（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 開発版はリポジトリの中、配布版は resources とユーザーのフォルダー。分ける前と同じ場所を返すことを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPaths } = require('../paths.cjs');
const { newBridgeConfig } = require('../../bridge/config_defaults.cjs');

function setup(t, { packaged = false, appConfig = {}, platform = 'win32' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'userData'), documents = path.join(root, 'documents'), resources = path.join(root, 'resources');
  const app = { isPackaged: packaged, getPath: name => ({ userData, documents, appData: path.join(root, 'appData') })[name] };
  const paths = createPaths({ app, process: { resourcesPath: resources, platform }, appDir: path.join(root, 'repo', 'electron'), readAppConfig: () => appConfig });
  return { root, userData, documents, resources, repo: path.join(root, 'repo'), paths };
}

test('開発版の場所は、リポジトリ（main.cjs の1つ上）の中', t => {
  const { repo, paths } = setup(t, { packaged: false });
  assert.equal(paths.getInstalledBridgeRoot(), path.join(repo, 'bridge_runtime'));
  assert.equal(paths.getBridgeDir(), path.join(repo, 'bridge_runtime', 'bridge'));
  assert.equal(paths.getBridgeBatDir(), path.join(repo, 'bridge'));
  assert.equal(paths.getConfigPath(), path.join(repo, 'bridge', 'config.minecraft.json'));
  assert.equal(paths.getServerTemplatePath(), path.join(repo, 'server', 'Douma_Craft'));
  assert.equal(paths.getServerRoot(), path.join(repo, 'server', 'Douma_Craft'));
  assert.equal(paths.getGiftsMinPath(), path.join(repo, 'GiftsViewer', 'data', 'gifts', 'gifts.min.json'));
  assert.equal(paths.getGvDataDir(), path.join(repo, 'GiftsViewer', 'data', 'gifts'));
  assert.equal(paths.getGvToolsDir(), path.join(repo, 'GiftsViewer', 'tools'), 'tools-bundled がなければ tools');
  fs.mkdirSync(path.join(repo, 'GiftsViewer', 'tools-bundled'), { recursive: true });
  assert.equal(paths.getGvToolPath('fetch_gifts.cjs'), path.join(repo, 'GiftsViewer', 'tools-bundled', 'fetch_gifts.cjs'));
});

test('配布版の場所は、resources とユーザーのフォルダー。保存先が決まっていれば、そこを優先する', t => {
  const { userData, documents, resources, paths } = setup(t, { packaged: true });
  assert.equal(paths.getInstalledBridgeRoot(), path.join(resources, 'bridge'));
  assert.equal(paths.getServerTemplatePath(), path.join(resources, 'server', 'Douma_Craft'));
  assert.equal(paths.getServerRoot(), path.join(documents, 'MyGamePack', 'Server'), '初回の保存先はアプリの外');
  assert.equal(paths.getBridgeBatDir(), path.join(userData, 'bridge'), 'セットアップ前は userData/bridge');
  assert.equal(paths.getGvToolsDir(), path.join(resources, 'gv-tools'));
  assert.equal(paths.getGvDataDir(), path.join(userData, 'gv-data', 'gifts'));
  assert.equal(paths.getGvSettingsPath(), path.join(userData, 'gv-settings.json'));
  const server = path.join(userData, 'myServer');
  fs.mkdirSync(server, { recursive: true });
  const configured = setup(t, { packaged: true, appConfig: { serverFolder: server, setupComplete: true } }).paths;
  assert.equal(configured.getServerRoot(), path.resolve(server));
  assert.equal(configured.getBridgeBatDir(), path.join(server, 'bridge'));
  const missing = setup(t, { packaged: true, appConfig: { serverFolder: path.join(userData, 'gone'), setupComplete: true } }).paths;
  assert.equal(missing.getServerRoot(), path.resolve(path.join(userData, 'gone')), '保存先が消えていても別のサーバーに切り替えない');
});

// 配布版のギフト・BRIDGE・設定の場所と、同梱 node の最後の候補（PR1 の最終レビュー M4）。
test('配布版のギフト・BRIDGE の中身・セットアップ前の設定の場所。同梱 node は resources/node も探す', t => {
  const { userData, resources, paths } = setup(t, { packaged: true });
  assert.equal(paths.getGiftsDir(), path.join(userData, 'gv-data', 'gifts'));
  assert.equal(paths.getBridgeDir(), path.join(resources, 'bridge', 'bridge'));
  assert.equal(paths.getConfigPath(), path.join(userData, 'bridge', 'config.minecraft.json'));
  assert.equal(paths.getNodeCommand(), 'node');
  const exe = path.join(resources, 'node', 'node.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  assert.equal(paths.getNodeCommand(), exe);
});

// 分ける前から誰も呼んでいなかった関数は、移さずに消した（PR1 の最終レビュー M2）。
test('使われていなかった BRIDGE の tools の場所の関数は返さない', t => {
  const { paths } = setup(t);
  assert.equal(paths.getToolsPath, undefined);
  assert.equal(paths.ensureToolsExist, undefined);
});

test('同梱の node を探し、なければ PATH の node。Windows 以外は node', t => {
  const { repo, paths } = setup(t, { packaged: false });
  assert.equal(paths.detectBundledNodeExe(), null);
  assert.equal(paths.getNodeCommand(), 'node');
  const exe = path.join(repo, 'bridge', 'node', 'node.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  assert.equal(paths.getNodeCommand(), exe);
  assert.equal(setup(t, { platform: 'linux' }).paths.getNodeCommand(), 'node');
});

test('BRIDGE の設定がなければ、すべての項目がそろった形で作る（作ったあとは書き換えない）', t => {
  const { root, paths } = setup(t);
  const file = path.join(root, 'new', 'config.minecraft.json');
  paths.ensureConfigExists(file);
  const created = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(created.options.commandTransport, 'bridge_mod');
  assert.deepEqual(created.mappings, []);
  // 雛形は bridge/config_defaults.cjs の1か所（配布の準備 scripts/prepare-bridge-runtime.cjs と同じ。処理のコピー PR4）。
  assert.deepEqual(created, newBridgeConfig());
  assert.equal(created.configVersion, 2, '次の起動の直しで書き直さない');
  fs.writeFileSync(file, '{"keep":true}');
  paths.ensureConfigExists(file);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"keep":true}');
});
