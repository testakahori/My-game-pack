// BRIDGE の起動・停止・再起動・ログ・状態、Euler の鍵、TikTok LIVE の確かめ（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBridgeProcess } = require('../bridge_process.cjs');
const { bridgeModTokenPath } = require('../../bridge/bridge_mod_token.cjs');

// 子プロセスの終わりを待つ（server_process の waitChildExit と同じ約束）。
const waitChildExit = (child, ms) => new Promise(resolve => {
  if (child.exitCode !== null) return resolve(true);
  const timer = setTimeout(() => resolve(false), ms);
  child.once('exit', () => { clearTimeout(timer); resolve(true); });
});

function setup(t, { ensureNodeRuntimeAvailable = async () => {}, migrateSavedConfig = () => {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-process-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), server = path.join(root, 'server');
  fs.mkdirSync(bridge); fs.mkdirSync(server);
  fs.writeFileSync(path.join(bridge, 'index.js'), '');
  fs.writeFileSync(path.join(bridge, 'config.minecraft.json'), '{}');
  const spawned = [], children = [], records = [], handlers = new Map();
  const spawn = (cmd, args, options) => {
    spawned.push([cmd, args, options]);
    const child = Object.assign(new EventEmitter(), { pid: 40000 + children.length, stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, exitCode: null, signalCode: null,
      send: () => setImmediate(() => { child.exitCode = 0; child.emit('exit', 0); }) });
    children.push(child);
    return child;
  };
  const bridgeProcess = createBridgeProcess({
    process: { platform: 'linux' }, spawn, spawnSync: () => ({ stdout: '' }), shell: { openExternal: async () => {} }, runProc: async () => ({ out: '{}' }),
    stopRequests: { record: (kind, origin) => { records.push(`${kind}:${origin}`); return '出どころ'; } },
    eulerCredentials: { runtime: () => ({ env: { FIXTURE: '1' }, revision: 7 }), status: (revision, running) => ({ revision, running }), save() {}, clear() {} },
    getBridgeBatDir: () => bridge, getServerRoot: () => server, getConfigPath: () => path.join(bridge, 'config.minecraft.json'),
    getNodeCommand: () => 'node-fixture', getGvToolPath: name => path.join(root, name),
    getBridgeEntryPoint: dir => path.join(dir, 'index.js'), ensureNodeRuntimeAvailable,
    assertGameProfileIdle: () => {}, selectableCommandNames: () => [], gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    waitChildExit, assertMapIdle: () => {}, migrateSavedConfig,
    getTtsSettingsPath: () => path.join(root, 'userData', 'tts-settings.json'),
  });
  bridgeProcess.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, bridge, server, spawned, children, records, bridgeProcess, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BRIDGE の起動と停止: main から受け取った spawn・Euler の鍵・トークンの場所で起動し、child() と isActive() に出る。止めると消える', async t => {
  const x = setup(t);
  assert.equal(x.bridgeProcess.isActive(), false);
  assert.equal((await x.invoke('bridge:launch')).pid, 40000);
  const [cmd, args, options] = x.spawned[0];
  assert.deepEqual([cmd, args, options.cwd], ['node-fixture', [path.join(x.bridge, 'index.js'), '--config', path.join(x.bridge, 'config.minecraft.json')], x.bridge]);
  assert.deepEqual([options.env.FIXTURE, options.env.BRIDGE_MOD_TOKEN_FILE], ['1', bridgeModTokenPath(x.server)]);
  // BRIDGE 側の読み上げの設定が壊れていて写しも使えないとき、BRIDGE は userData 側を読む（設定ファイルの PR2）。
  assert.equal(options.env.TTS_SETTINGS_FALLBACK_FILE, path.join(x.root, 'userData', 'tts-settings.json'));
  assert.equal(x.bridgeProcess.child(), x.children[0]);
  assert.equal(x.bridgeProcess.isActive(), true);
  assert.deepEqual(x.invoke('euler:status'), { revision: 7, running: true });
  await x.invoke('bridge:stop', 'home:stop');
  assert.deepEqual(x.records, ['bridge:home:stop']);
  assert.equal(x.bridgeProcess.child(), null);
  assert.equal(x.bridgeProcess.isActive(), false);
});

// 起動のときの直しが届かなかった設定（手動インストールのあと、古いフォルダーを使い直したときなど）も、BRIDGE を起動する前に直す（PR3 の最終レビュー）。
test('BRIDGE の起動: 起動する前に保存済みの設定の直しを呼ぶ', async t => {
  let spawnedWhenMigrated = null;
  const x = setup(t, { migrateSavedConfig: () => { spawnedWhenMigrated = x.spawned.length; } });
  await x.invoke('bridge:launch');
  assert.equal(spawnedWhenMigrated, 0, '起動（spawn）より前に直す');
  assert.equal(x.spawned.length, 1);
  await x.invoke('bridge:stop', 'home:stop');
});

// 配信中につなぎ方（TikTok ID など）を変えて保存したら、BRIDGE が runtime-status.json に書いた名前を配信ホームへ渡す（2026-10-18 処理のコピー PR2）。
test('BRIDGE の状態: 動いている間は runtime-status.json の pendingRestart（再起動で反映される設定）を返し、止まっていれば空', async t => {
  const x = setup(t);
  await x.invoke('bridge:launch');
  const file = path.join(x.bridge, 'runtime-status.json');
  fs.writeFileSync(file, JSON.stringify({ pendingRestart: ['TikTok ID'] }));
  // Linux はファイルの時刻を粗い時計で記録するので、起動の直後に書いても起動の時刻（Date.now()）より前になることがある
  // （ubuntu の CI でだけ落ちた。PR3）。本物の BRIDGE は起動のずっとあとに書くので、ここでは起動のあとの時刻をはっきり付ける。
  const later = new Date(Date.now() + 1000);
  fs.utimesSync(file, later, later);
  assert.deepEqual(x.invoke('bridge:processStatus').pendingRestart, ['TikTok ID']);
  await x.invoke('bridge:stop', 'home:stop');
  assert.deepEqual(x.invoke('bridge:processStatus').pendingRestart, []);
});

// 前の BRIDGE が書いた runtime-status.json を、新しい BRIDGE が書き直すまでの間に出さない（PR2 の最終レビュー）。
test('BRIDGE の状態: 起動する前に書かれた pendingRestart（前の BRIDGE の案内）は出さない', async t => {
  const x = setup(t);
  const file = path.join(x.bridge, 'runtime-status.json');
  fs.writeFileSync(file, JSON.stringify({ pendingRestart: ['TikTok ID'] }));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(file, old, old);
  await x.invoke('bridge:launch');
  assert.deepEqual(x.invoke('bridge:processStatus').pendingRestart, []);
  await x.invoke('bridge:stop', 'home:stop');
});

test('BRIDGE の自動再起動: 落ちて再起動を待つ間も isActive() が true（ゲームの切り替え・MAP の作業・設定の復元が止める）。止めると待ちも消える', async t => {
  const x = setup(t);
  await x.invoke('bridge:launch');
  x.children[0].exitCode = 1;
  x.children[0].emit('exit', 1);
  assert.equal(x.bridgeProcess.child(), null);
  assert.equal(x.bridgeProcess.isActive(), true, '再起動を待っている');
  await x.invoke('bridge:stop', 'home:stop');
  assert.equal(x.bridgeProcess.isActive(), false);
  assert.equal(x.spawned.length, 1, '止めたので再起動しない');
});

// 自動再起動の待ちの間に「起動」「一括起動」を押すと、待ちが終わったときにもう1つ起動して BRIDGE が2つ動いていた（ギフトが2回動く。PR5 の最終レビューで見つけた）。
test('BRIDGE の起動: 落ちて自動再起動を待つ間に起動したら、待ちを取りやめて今すぐ1つだけ起動する（待ちが過ぎても2つ目を起動しない）', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const x = setup(t);
  await x.invoke('bridge:launch');
  x.children[0].exitCode = 1;
  x.children[0].emit('exit', 1);
  assert.equal(x.bridgeProcess.isActive(), true, '再起動を待っている');
  assert.equal((await x.invoke('bridge:launch')).pid, 40001, '今すぐ起動した');
  const cancelled = () => x.invoke('bridge:logs').lines.filter(line => line.includes('自動再起動の待ちを取りやめ')).length;
  assert.equal(cancelled(), 1, '取りやめたことをログに出す');
  assert.equal((await x.invoke('bridge:launch')).pid, 40001, '動いている間の起動は、今の BRIDGE を返す');
  assert.equal(cancelled(), 1, '取りやめた待ちの印は残さない（残すと、BRIDGE が止まったあとも作業中のままになる）');
  t.mock.timers.tick(60000);
  assert.equal(x.spawned.length, 2, '待ちが過ぎても、もう1つは起動しない');
  assert.equal(x.bridgeProcess.child(), x.children[1]);
  await x.invoke('bridge:stop', 'home:stop');
  t.mock.timers.tick(60000);
  assert.equal(x.bridgeProcess.isActive(), false);
  assert.equal(x.spawned.length, 2, '止めたあとも起動しない');
});

test('BRIDGE の起動: 起動の準備（同梱 node の確かめ）の間に自動再起動が先に動いたら、起動はそれを使い、2つ目を起動しない', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let preparing = null;
  const x = setup(t, { ensureNodeRuntimeAvailable: () => (preparing ? preparing.promise : Promise.resolve()) });
  await x.invoke('bridge:launch');
  x.children[0].exitCode = 1;
  x.children[0].emit('exit', 1);
  preparing = Promise.withResolvers();
  const launching = x.invoke('bridge:launch');
  t.mock.timers.tick(60000);
  assert.equal(x.spawned.length, 2, '自動再起動が先に起動した');
  preparing.resolve();
  assert.equal((await launching).pid, 40001, '起動は自動再起動の BRIDGE を返す');
  assert.equal(x.spawned.length, 2);
  assert.equal(x.bridgeProcess.child(), x.children[1]);
  await x.invoke('bridge:stop', 'home:stop');
});
