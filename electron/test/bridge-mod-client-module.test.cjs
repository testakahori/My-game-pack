// BridgeMOD との通信・状態・一時停止と再開・テスト発火の受け渡し・応答待ち（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createBridgeModClient } = require('../bridge_mod_client.cjs');
const { bridgeModTokenPath } = require('../../bridge/bridge_mod_token.cjs');

// 空いているポート（BridgeMOD がいない）。
async function closedPort() {
  const server = require('node:net').createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function setup(t, { port = 25576 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mod-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ options: { commandTransport: 'bridge_mod', bridgeModHost: '127.0.0.1', bridgeModPort: port } }));
  const logs = [], state = { server: null, bridge: null }, handlers = new Map();
  const client = createBridgeModClient({
    getConfigPath: () => configPath, getServerRoot: () => root, stopRequests: { record: () => '出どころ' },
    selectableCommandNames: () => [], gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    appendServerLog: line => logs.push(line), serverChild: () => state.server, bridgeChild: () => state.bridge,
  });
  client.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, configPath, logs, state, client, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

// テスト発火の「ギフト（コマンド直接）」も、選んだコマンドが今のゲームで使えるかを確かめる（PR5 の最終レビュー。
// 参照の数え方を commandFileRefs にしたとき、設定の一番上に commandFile を置く確かめが何もしなくなっていた）。
test('テスト発火（コマンド直接）: 今のゲームで使えないコマンド・ないコマンドは送らずに止める', async t => {
  const x = setup(t);
  await assert.rejects(x.invoke('mod:testEvent', { type: 'gift', commandFile: 'missing.txt' }), /使えないコマンドです: missing\.txt（テスト発火（コマンド直接））/);
});

// 接続先の読み方は bridge/config_defaults.cjs の bridgeModEndpoint の1か所（BRIDGE と同じ。処理のコピー PR4）。
// 前のアプリはホストの前後の空白を除かず、BRIDGE には届く BridgeMOD に状態・テスト発火・一時停止が届かなかった。
test('BridgeMOD との通信: 接続先は BRIDGE と同じ読み方（ホストの前後の空白を除く、旧い doumaModPort も読む）', async t => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(JSON.stringify({ ok: true })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const x = setup(t);
  fs.writeFileSync(x.configPath, JSON.stringify({ options: { commandTransport: 'bridge_mod', bridgeModHost: ' 127.0.0.1 ', doumaModPort: server.address().port } }));
  assert.deepEqual(await x.client.requestBridgeMod('GET', '/bridge/status'), { ok: true });
});

test('BridgeMOD との通信: 設定のポートへトークン付きで送り、403 は認証の失敗として直し方を返す', async t => {
  let status = 403;
  const tokens = [];
  const server = http.createServer((req, res) => { tokens.push(req.headers['x-bridge-token']); res.writeHead(status); res.end(JSON.stringify({ ok: true, tps: 20 })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const x = setup(t, { port: server.address().port });
  fs.mkdirSync(path.dirname(bridgeModTokenPath(x.root)), { recursive: true });
  fs.writeFileSync(bridgeModTokenPath(x.root), 'fixture-token\n');
  await assert.rejects(x.client.requestBridgeMod('GET', '/bridge/status'), error => error.authFailed === true && error.message === x.client.BRIDGE_MOD_AUTH_FAILED);
  status = 200;
  assert.deepEqual(await x.client.requestBridgeMod('GET', '/bridge/status'), { ok: true, tps: 20 });
  assert.deepEqual(tokens, ['fixture-token', 'fixture-token']);
});

test('BridgeMOD の応答待ち: 動いているサーバーで一度時間切れになったら、同じサーバーでは待たずに諦める（ログは main から受け取った関数へ）', async t => {
  const x = setup(t, { port: await closedPort() });
  x.state.server = { pid: 1 };
  assert.equal(await x.client.waitForBridgeMod(50, 10), false);
  assert.ok(x.logs.some(line => line.includes('Modの応答待ちがタイムアウトしました')));
  const count = x.logs.length;
  assert.equal(await x.client.waitForBridgeMod(50, 10), false);
  assert.equal(x.logs.length, count, '同じサーバーでは待たない');
});

test('テスト発火: main から受け取った BRIDGE の子プロセスへ送り、返事がなければ setTestEventReplyMs の時間で理由を返す', async t => {
  const x = setup(t);
  const asked = [];
  x.state.bridge = Object.assign(new EventEmitter(), { connected: true, send: (message, callback) => { asked.push(message.type); callback?.(null); return true; } });
  x.client.setTestEventReplyMs(30);
  await assert.rejects(x.invoke('mod:testEvent', { type: 'share', preview: true }), /BRIDGE から返事がありません/);
  assert.deepEqual(asked, ['testEvent']);
  x.state.bridge = null;
  assert.equal((await x.invoke('mod:testEvent', { type: 'share', preview: true })).bridgeStopped, true);
});

// ギフト設定が読めないときは、配信前チェックと同じ案内で止める（PR3 の最後のレビューの軽い 3）。
test('テスト発火: ギフト設定が読めなければ、配信前チェックと同じ案内で止める', async t => {
  const x = setup(t);
  fs.writeFileSync(x.configPath, '{壊れた');
  await assert.rejects(x.invoke('mod:testEvent', { type: 'share', preview: true }), /設定を読み込めません。初期セットアップと設定バックアップを確認してください。/);
});
