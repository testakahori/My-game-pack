// 初期セットアップ・Forge インストーラー・セットアップの確認・環境の実測・フォルダー選択の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSetupIpc } = require('../setup_ipc.cjs');

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  let answer;
  const setupIpc = createSetupIpc({
    app: { getVersion: () => '9.9.9', getPath: () => dir },
    dialog: { showMessageBox: () => new Promise(resolve => { answer = resolve; }) },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    spawnSync: (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { stderr: 'openjdk version "17.0.8"\nmore', stdout: '' }; },
    getServerRoot: () => dir, getGvDataDir: () => path.join(dir, 'gv'),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => calls.push('mapIdle'),
    serverChild: () => null,
    ...overrides,
  });
  setupIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, calls, setupIpc, invoke: (name, ...args) => handlers.get(name)({}, ...args), answer: response => answer({ response }) };
}

test('初期セットアップ: 規約の確認を待つ間は作業中。重ねて始めず、キャンセルで終わる', async t => {
  const x = setup(t);
  assert.equal(x.setupIpc.isRunning(), false);
  const first = x.invoke('server:setup:atPath', x.dir);
  assert.equal(x.setupIpc.isRunning(), true);
  assert.deepEqual(x.calls, ['gameProfileIdle', 'mapIdle']);
  assert.equal(x.invoke('server:setup:status').state, 'running');
  await assert.rejects(x.invoke('server:setup:atPath', x.dir), /環境構築が進行中です。完了までお待ちください。/);
  x.answer(2);
  assert.equal((await first).canceled, true);
  assert.equal(x.setupIpc.isRunning(), false);
  assert.deepEqual(x.invoke('server:setup:status'), { state: 'idle', message: '環境構築をキャンセルしました。' });
});

test('初期セットアップ: サーバーが動いている間は始めない（main から受け取った子プロセスを見る）', async t => {
  const x = setup(t, { serverChild: () => ({ pid: 1 }) });
  await assert.rejects(x.invoke('server:setup:atPath', x.dir), /Minecraftサーバーを停止してから環境構築を実行してください。/);
  assert.equal(x.setupIpc.isRunning(), false);
});

test('環境の実測: java は main から受け取った spawnSync で調べ、BRIDGE の版はアプリの版', async t => {
  const x = setup(t);
  const env = await x.invoke('setup:inspectEnvironment');
  assert.deepEqual(x.calls, ['java -version']);
  assert.deepEqual(env.java, { detected: true, version: 'openjdk version "17.0.8"' });
  assert.deepEqual(env.bridge, { detected: true, version: '9.9.9' });
  assert.equal(env.tiktokApi.version, '未確認（gifts.meta.jsonなし）');
});
