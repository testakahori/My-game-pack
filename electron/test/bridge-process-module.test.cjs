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

function setup(t, { ensureNodeRuntimeAvailable = async () => {} } = {}) {
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
    waitChildExit, assertMapIdle: () => {},
  });
  bridgeProcess.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, server, spawned, children, records, bridgeProcess, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BRIDGE の起動と停止: main から受け取った spawn・Euler の鍵・トークンの場所で起動し、child() と isActive() に出る。止めると消える', async t => {
  const x = setup(t);
  assert.equal(x.bridgeProcess.isActive(), false);
  assert.equal((await x.invoke('bridge:launch')).pid, 40000);
  const [cmd, args, options] = x.spawned[0];
  assert.deepEqual([cmd, args, options.cwd], ['node-fixture', [path.join(x.bridge, 'index.js'), '--config', path.join(x.bridge, 'config.minecraft.json')], x.bridge]);
  assert.deepEqual([options.env.FIXTURE, options.env.BRIDGE_MOD_TOKEN_FILE], ['1', bridgeModTokenPath(x.server)]);
  assert.equal(x.bridgeProcess.child(), x.children[0]);
  assert.equal(x.bridgeProcess.isActive(), true);
  assert.deepEqual(x.invoke('euler:status'), { revision: 7, running: true });
  await x.invoke('bridge:stop', 'home:stop');
  assert.deepEqual(x.records, ['bridge:home:stop']);
  assert.equal(x.bridgeProcess.child(), null);
  assert.equal(x.bridgeProcess.isActive(), false);
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
