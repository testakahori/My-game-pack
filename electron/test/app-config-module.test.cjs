// アプリ設定（app-config.json）の読み書きと、その ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppConfig } = require('../app_config.cjs');

function setup(t, { packaged = false, serverStarting = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  const app = { isPackaged: packaged, getPath: () => dir, getVersion: () => '9.9.9' };
  const appConfig = createAppConfig({
    app,
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => calls.push('mapIdle'),
    isServerStarting: () => serverStarting,
    getConfigPath: () => path.join(dir, 'config.minecraft.json'),
    getSettingsBackups: () => ({ create: kind => calls.push('backup:' + kind) }),
    refreshGameModsOnStartup: async () => { calls.push('refreshMods'); },
    migrateSavedConfig: () => calls.push('migrateConfig'),
  });
  appConfig.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, app, appConfig, calls, invoke: (name, ...args) => handlers.get(name)({}, ...args), handlers };
}

// 手動インストール（更新も含む）のあとは、初期セットアップを終えるまで設定の場所が userData/bridge の予備を指す。
// 起動のときの直しは配信者の設定に届かないので、セットアップを終えたときと保存先を変えたときにも直す（PR3 の最終レビュー）。
test('保存済みの設定の直し: 初期セットアップを終えたときと保存先を変えたときに呼ぶ。ほかの保存では呼ばない', async t => {
  const x = setup(t);
  await x.invoke('app:config:write', { minecraftPlayerName: 'Steve' });
  assert.ok(!x.calls.includes('migrateConfig'), 'セットアップ前の保存では呼ばない');
  await x.invoke('app:config:write', { setupComplete: true });
  assert.equal(x.calls.filter(c => c === 'migrateConfig').length, 1, 'セットアップを終えたとき');
  await x.invoke('app:config:write', { minecraftPlayerName: 'Alex' });
  assert.equal(x.calls.filter(c => c === 'migrateConfig').length, 1, 'ほかの保存では呼ばない');
  await x.invoke('app:config:write', { serverFolder: x.dir });
  assert.equal(x.calls.filter(c => c === 'migrateConfig').length, 2, '保存先を変えたとき');
});

test('読み込み: ファイルがない・壊れているときは既定値、書き込みは今の値に足し、保存先は絶対パスにする', t => {
  const { dir, appConfig } = setup(t);
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false });
  fs.writeFileSync(path.join(dir, 'app-config.json'), '{壊れた');
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false });
  appConfig.writeAppConfig({ serverFolder: 'server', authEmail: 'a@b.cd', authToken: 't', authLoginAt: 'x' });
  appConfig.writeAppConfig({ minecraftPlayerName: 'Steve' });
  const saved = appConfig.readAppConfig();
  assert.equal(path.isAbsolute(saved.serverFolder), true);
  assert.equal(saved.minecraftPlayerName, 'Steve');
  assert.equal(appConfig.getAppConfigPath(), path.join(dir, 'app-config.json'));
  assert.deepEqual(Object.keys(appConfig.readPublicAppConfig()).sort(), ['minecraftPlayerName', 'serverFolder', 'setupComplete'], '画面にはログインの情報を渡さない');
});

test('画面からの書き込みは決まった項目・型だけ', () => {
  const { sanitizeRendererAppConfigUpdate } = createAppConfig({ app: { getPath: () => os.tmpdir() } });
  assert.deepEqual(sanitizeRendererAppConfigUpdate({ setupComplete: true, minecraftPlayerName: 'Steve' }), { setupComplete: true, minecraftPlayerName: 'Steve' });
  assert.throws(() => sanitizeRendererAppConfigUpdate({ authToken: 'x' }), /変更できないアプリ設定です: authToken/);
  assert.throws(() => sanitizeRendererAppConfigUpdate({ setupComplete: 'yes' }), /setupComplete must be a boolean/);
  assert.throws(() => sanitizeRendererAppConfigUpdate({ serverFolder: 'x'.repeat(4097) }), /serverFolder must be a string/);
});

test('ipc: 版・手動配布の知らせ・設定の読み書きを登録する', async t => {
  const { invoke, handlers } = setup(t);
  assert.deepEqual([...handlers.keys()].sort(), ['app:config:read', 'app:config:write', 'app:version', 'updater:check', 'updater:install', 'updater:status']);
  assert.equal(await invoke('app:version'), '9.9.9');
  assert.equal((await invoke('updater:check')).state, 'manual');
  assert.deepEqual([(await invoke('updater:install')).ok, (await invoke('updater:install')).version], [false, '9.9.9']);
  assert.deepEqual(await invoke('app:config:write', { minecraftPlayerName: 'Alex' }), { ok: true });
  assert.equal((await invoke('app:config:read')).minecraftPlayerName, 'Alex');
  await assert.rejects(invoke('app:config:write', null), /data must be an object/);
});

test('保存先は止まっているときだけ変える。サーバーの起動中は理由を返す', async t => {
  const { invoke, calls } = setup(t, { serverStarting: true });
  await assert.rejects(invoke('app:config:write', { serverFolder: 'other' }), /サーバーの起動中は保存先を変更できません。/);
  assert.deepEqual(calls, ['gameProfileIdle', 'mapIdle']);
});

// ワールドの指定（world）も保存先と同じく止める。MAP の作業中は MAP の理由で止まり、サーバーの判定まで進まない（PR1 の最終レビュー M5）。
test('world の指定も止める。MAP の作業中は MAP の理由で止め、サーバーの判定まで進まない', async t => {
  const starting = setup(t, { serverStarting: true });
  await assert.rejects(starting.invoke('app:config:write', { world: 'w' }), /サーバーの起動中は保存先を変更できません。/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  const appConfig = createAppConfig({
    app: { isPackaged: false, getPath: () => dir, getVersion: () => '9.9.9' },
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => { throw new Error('MAP の保存・読込中です。'); },
    isServerStarting: () => { calls.push('serverStarting'); return true; },
    getConfigPath: () => path.join(dir, 'config.minecraft.json'),
    getSettingsBackups: () => ({ create: () => {} }),
    refreshGameModsOnStartup: async () => {},
  });
  appConfig.register({ handle: (name, fn) => handlers.set(name, fn) });
  await assert.rejects(handlers.get('app:config:write')({}, { serverFolder: 'other' }), /MAP の保存・読込中です。/);
  assert.deepEqual(calls, ['gameProfileIdle']);
});

test('自動バックアップの切り替えでは、設定があれば先にバックアップする。初期セットアップを終えたら MOD を入れ替える', async t => {
  const { dir, invoke, calls } = setup(t);
  fs.writeFileSync(path.join(dir, 'config.minecraft.json'), '{}');
  await invoke('app:config:write', { autoBackupOnServerStart: true });
  assert.ok(calls.includes('backup:automatic'));
  await invoke('app:config:write', { setupComplete: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(calls.includes('refreshMods'));
});

test('インストーラーの印は配布版でだけ受け取り、初期セットアップをやり直す', t => {
  for (const packaged of [false, true]) {
    const { dir, appConfig } = setup(t, { packaged });
    fs.writeFileSync(path.join(dir, 'require-initial-setup.flag'), '');
    appConfig.writeAppConfig({ setupComplete: true, serverFolder: dir });
    appConfig.consumeInstallerSetupReset();
    assert.equal(fs.existsSync(path.join(dir, 'require-initial-setup.flag')), !packaged);
    assert.equal(appConfig.readAppConfig().setupComplete, !packaged);
    assert.equal(appConfig.readAppConfig().serverFolder, dir, '保存先は残す');
  }
});
