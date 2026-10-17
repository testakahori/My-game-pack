// MAP の保存・読込とプリセット（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMapOperations } = require('../map_operations.cjs');

function setup(t, { serverRunning = false, bridgeActive = false, holdStop = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-operations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'world'));
  fs.writeFileSync(path.join(root, 'world', 'level.dat'), 'world');
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  const calls = [], state = { starting: false }, handlers = new Map();
  let releaseStop;
  const mapOperations = createMapOperations({
    getServerRoot: () => root, getBridgeBatDir: () => path.join(root, 'bridge'), getConfigPath: () => path.join(root, 'config.json'),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    isInitialSetupRunning: () => false, isServerStarting: () => state.starting, isServerStopping: () => false,
    serverChild: () => (serverRunning ? { pid: 1 } : null),
    startServer: async resume => { calls.push(`startServer:${resume}`); },
    // サーバーの保存・停止の代わり。holdStop なら releaseStop() まで返さない（その間は MAP の作業中）。
    stopMapServer: origin => { calls.push(`stopMapServer:${origin}`); return holdStop ? new Promise(resolve => { releaseStop = resolve; }) : Promise.resolve(); },
    assertMapServerStopped: async () => {},
    isBridgeActive: () => bridgeActive,
    stopBridge: async origin => { calls.push(`stopBridge:${origin}`); },
    launchBridge: async () => { calls.push('launchBridge'); },
    readSavedBridgeConfig: () => null, writeBridgeConfig: () => ({ ok: true }),
  });
  mapOperations.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { calls, state, mapOperations, releaseStop: () => releaseStop(), invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('MAP の作業: 作業の間は isBusy() が true で assertIdle() が止める。サーバーの準備・停止中は始めない（main から受け取った関数で見る）', async t => {
  const x = setup(t, { holdStop: true });
  x.state.starting = true;
  await assert.rejects(x.invoke('world:saves:save', 'first'), /サーバーの準備・停止が終わるまでお待ちください。/);
  x.state.starting = false;
  const saving = x.invoke('world:saves:save', 'first');
  assert.equal(x.mapOperations.isBusy(), true);
  assert.throws(() => x.mapOperations.assertIdle(), /MAPを保存・読込中です。完了までお待ちください。/);
  x.releaseStop();
  const result = await saving;
  assert.equal(result.saved.name, 'first');
  assert.equal(result.restarted, false);
  assert.equal(x.mapOperations.isBusy(), false);
  x.mapOperations.assertIdle();
});

test('MAP の作業: 動いていたサーバーと BRIDGE は、止めて作業したあと main から受け取った関数で起動し直す', async t => {
  const x = setup(t, { serverRunning: true, bridgeActive: true });
  const result = await x.invoke('world:saves:save', 'second');
  assert.equal(result.restarted, true);
  assert.equal(result.restartError, '');
  assert.deepEqual(x.calls, ['gameProfileIdle', 'stopBridge:map:save', 'stopMapServer:map:save', 'startServer:true', 'launchBridge']);
});
