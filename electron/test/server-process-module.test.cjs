// Minecraft サーバーの起動・停止・ログ・稼働の確かめ（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createServerProcess } = require('../server_process.cjs');

function setup(t, extras = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-process-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'run.bat'), '');
  const calls = [], spawned = [], handlers = new Map();
  let release;
  const child = Object.assign(new EventEmitter(), { pid: 777, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  const serverProcess = createServerProcess({
    app: { isPackaged: true }, process: { env: {}, platform: 'win32' },
    spawn: (cmd, args, options) => { spawned.push([cmd, args, options]); return child; },
    getServerRoot: () => dir, getBridgeBatDir: () => path.join(dir, 'bridge'), getConfigPath: () => path.join(dir, 'config.json'),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'), assertMapIdle: () => calls.push('mapIdle'),
    isInitialSetupRunning: () => false,
    // MAP の保存の後始末の代わり。release() するまで返さない（その間は起動の準備中）。
    recoverMapSaves: () => new Promise(resolve => { release = resolve; }),
    requestBridgeMod: async () => { throw new Error('使わない'); },
    authFailedMessage: () => 'auth failed',
    stopRequests: { record: (kind, origin) => { calls.push(`record:${kind}:${origin}`); return '出どころ'; } },
    ...extras,
  });
  serverProcess.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, calls, spawned, child, serverProcess, release: () => release(), invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('サーバーの起動: 準備の間は isStarting() が true で、重ねて起動・停止しない。起動した子プロセスは child() で見え、出力はログに入る', async t => {
  const x = setup(t);
  const starting = x.invoke('server:start');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.serverProcess.isStarting(), true);
  await assert.rejects(x.invoke('server:start'), /サーバーを起動・停止中です。完了までお待ちください。/);
  await assert.rejects(x.invoke('server:stop'), /サーバーを起動・停止中です。完了までお待ちください。/);
  x.release();
  assert.deepEqual(await starting, { ok: true });
  assert.equal(x.serverProcess.isStarting(), false);
  assert.equal(x.serverProcess.child(), x.child);
  assert.deepEqual(x.spawned.map(([cmd, args, options]) => [cmd, args, options.cwd, options.env.NO_PAUSE]), [['cmd.exe', ['/c', path.join(x.dir, 'run.bat')], x.dir, '1']]);
  x.child.stdout.emit('data', Buffer.from('Done (1.0s)!\n'));
  assert.ok(x.invoke('server:logs').lines.some(line => line.endsWith('Done (1.0s)!')));
});

test('サーバーの停止: 保存の完了を待つ間は isStopping() が true。setStopWaitMs で待ちを短くすると、止まらないときは強制終了せずに知らせる', async t => {
  const x = setup(t);
  const written = [];
  const server = Object.assign(new EventEmitter(), { pid: 888, exitCode: null, signalCode: null, stdin: { writable: true, write: text => written.push(text) } });
  x.serverProcess.attach(server);
  x.serverProcess.setStopWaitMs(30);
  const stopping = x.invoke('server:stop', 'home:stop');
  assert.equal(x.serverProcess.isStopping(), true);
  await assert.rejects(stopping, /強制終了せずに待機しています/);
  assert.deepEqual(written, ['stop\n']);
  assert.ok(x.calls.includes('record:server:home:stop'));
  assert.equal(x.serverProcess.isStopping(), false);
  assert.equal(x.serverProcess.child(), server, '止まらなかったサーバーは持ったまま');
  x.serverProcess.attach(null);
  assert.equal(x.serverProcess.child(), null);
});

// OBSMOD はサーバーの起動のときに obs-send.properties を読むので、アプリから起動するたびに、起動の直前にアプリの設定どおりに書く（OBS 連携。2026-10-25）。
test('サーバーの起動: 起動の直前に、OBS 連携の設定を obs-send.properties に書く（設定を渡さないときは書かない）', async t => {
  const x = setup(t, { obsSend: () => ({ enabled: true, endpoint: 'http://192.168.0.5:3000/event' }) });
  const starting = x.invoke('server:start');
  await new Promise(resolve => setImmediate(resolve));
  x.release();
  await starting;
  const file = path.join(x.dir, 'config', 'minecraft_obs_bridge', 'obs-send.properties');
  assert.equal(fs.readFileSync(file, 'utf8'), 'enabled=true\nendpoint=http://192.168.0.5:3000/event\n');
  assert.ok(x.invoke('server:logs').lines.some(line => line.includes('OBS 連携') && line.includes('送る')), 'ログに出す');
  const plain = setup(t);
  const second = plain.invoke('server:start');
  await new Promise(resolve => setImmediate(resolve));
  plain.release();
  await second;
  assert.equal(fs.existsSync(path.join(plain.dir, 'config', 'minecraft_obs_bridge', 'obs-send.properties')), false);
});

// 書けなくても起動は止めない（ログに出す）。起動のログには送り先の場所（scheme・ホスト・ポート）だけを出し、道や ? 以降は出さない（PR3 の最後のレビュー 軽い8・9）。
test('サーバーの起動: OBS 連携の設定が書けなくても起動し、ログに出す。送り先は場所だけを出す', async t => {
  const failing = setup(t, { obsSend: () => { throw new Error('書けない'); } });
  const starting = failing.invoke('server:start');
  await new Promise(resolve => setImmediate(resolve));
  failing.release();
  assert.deepEqual(await starting, { ok: true });
  assert.ok(failing.invoke('server:logs').lines.some(line => line.includes('OBS 連携の設定を書けませんでした')));
  const x = setup(t, { obsSend: () => ({ enabled: true, endpoint: 'http://192.168.0.5:3000/event?token=secret' }) });
  const second = x.invoke('server:start');
  await new Promise(resolve => setImmediate(resolve));
  x.release();
  await second;
  const line = x.invoke('server:logs').lines.find(l => l.includes('OBS 連携'));
  assert.ok(line.includes('http://192.168.0.5:3000') && !line.includes('secret'), line);
});
