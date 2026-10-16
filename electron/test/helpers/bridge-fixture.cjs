// 本番の bridge/index.js を、仮想の TikTok 接続と偽 BridgeMOD（HTTP）で動かすテスト用の下準備。
// 受信→判定→送信は本番のコードを通し、外部との通信だけを置き換える。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const source = path.resolve(__dirname, '../../../bridge/index.js');
const bridgeRequire = createRequire(source);
const { TikTokLiveConnection } = bridgeRequire('tiktok-live-connector');
const proto = bridgeRequire('tiktok-live-connector');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 150; i++) { if (check()) return; await wait(20); }
  assert.fail('Timed out: ' + label);
}

/**
 * @param commands { 'cod': 'say test\n', ... } を commands/ に書く（.txt は自動で付ける）
 * @param config bridge の設定。options の commandsDir・transport・接続先はこちらで埋める
 * @param respond 偽 BridgeMOD が返す HTTP ステータス（要求の本文と URL を受け取る）。既定は 202
 */
async function startBridgeFixture(t, { commands = {}, config = {}, env = {}, respond = () => 202 } = {}) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-fixture-')));
  const requests = [], logs = [], timers = new Set(), watchers = [], streams = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      const payload = JSON.parse(body); requests.push(payload);
      const status = respond(payload, req.url);
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(status < 300 ? '{"ok":true}' : '{"ok":false}');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const timer of timers) { clearInterval(timer); clearTimeout(timer); }
    for (const watcher of watchers) watcher.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(dir, 'commands'));
  for (const [name, text] of Object.entries(commands)) fs.writeFileSync(path.join(dir, 'commands', name + '.txt'), text);
  fs.writeFileSync(path.join(dir, 'tts-settings.json'), JSON.stringify({ enabled: false }));
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ tiktokUsername: 'fixture', ...config,
    options: { commandsDir: 'commands', commandTransport: 'bridge_mod', bridgeModHost: '127.0.0.1', bridgeModPort: server.address().port,
      likeBatchWindowMs: 100, ...(config.options || {}) } }));
  let connection, roomId = 'fixture-room';
  class FixtureConnection extends TikTokLiveConnection {
    constructor(...args) { super(...args); connection = this; }
    async connect() { return { roomId }; }
    async disconnect() {}
  }
  const replies = [];
  const fakeProcess = Object.assign(new EventEmitter(), { argv: ['node', source], env, platform: process.platform, cwd: () => dir,
    exit: code => { throw Error('unexpected exit ' + code); },
    // アプリ（main）との ipc の代わり。BRIDGE からの返事を、ipc と同じく JSON で写してためる。
    send: message => { replies.push(JSON.parse(JSON.stringify(message))); return true; } });
  const testFs = { ...fs, watch: (...args) => { const w = fs.watch(...args); watchers.push(w); return w; },
    createWriteStream: (...args) => { const s = fs.createWriteStream(...args); streams.push(s); return s; } };
  const context = { module: { exports: {} }, exports: {}, __dirname: dir, __filename: source, process: fakeProcess, Buffer, URL,
    console: Object.fromEntries(['log', 'warn', 'error'].map(name => [name, (...args) => logs.push(args.join(' '))])),
    setTimeout: (fn, ms, ...args) => { const timer = setTimeout(fn, ms, ...args); timers.add(timer); return timer; }, clearTimeout,
    setInterval: (fn, ms, ...args) => { const timer = setInterval(fn, ms, ...args); timers.add(timer); return timer; }, clearInterval,
    require: id => id === 'tiktok-live-connector' ? { TikTokLiveConnection: FixtureConnection } : id === 'fs' ? testFs : bridgeRequire(id) };
  vm.runInNewContext(fs.readFileSync(source, 'utf8') + '\nmodule.exports.startFixture=main;', context, { filename: source });
  await context.module.exports.startFixture();
  await until(() => logs.some(x => x.includes('[TikTok] Connected.')), 'connected');
  // Bridge はログファイルを少しあとに開く。開く前にテストが終わると、後片付けで消したフォルダーに開こうとして例外になる（PR #85 の ubuntu CI）。
  await until(() => streams.length > 0 && streams.every(s => !s.pending), 'log file opened');
  let msg = 100;
  const emit = async (type, fields) => {
    const message = { ...proto[type].decode(new Uint8Array()), ...fields,
      common: { ...proto.CommonMessageData.decode(new Uint8Array()), msgId: String(++msg), createTime: String(Math.floor(Date.now() / 1000)), ...fields.common },
      user: { ...proto.User.decode(new Uint8Array()), id: '123', displayId: 'viewer', nickname: '視聴者', ...fields.user } };
    if (fields.gift) message.gift = { ...proto.Gift.decode(new Uint8Array()), type: 1, ...fields.gift };
    await connection.processDecodedData({ type, data: proto[type].decode(proto[type].encode(message).finish()) });
  };
  // 仮想の TikTok 接続そのもの。配信終了（streamEnd）など、メッセージを通らないイベントを出すときに使う。
  // setRoomId は、次につなぎ直したときの配信の番号（別の配信につないだことにする）。
  // アプリのテスト発火と同じ問い合わせを送り、返事を待つ（ルーレットの演出は1回2秒ほどかかる）。
  let testId = 0;
  const testEvent = async input => {
    const id = 'fixture-test-' + (++testId);
    fakeProcess.emit('message', { type: 'testEvent', id, input });
    for (let i = 0; i < 1000 && !replies.some(reply => reply.id === id); i++) await wait(20);
    const reply = replies.find(reply => reply.id === id);
    assert.ok(reply, 'Timed out: test event ' + id);
    return reply.result;
  };
  return { dir, requests, logs, emit, until, wait, testEvent, connection: () => connection, setRoomId: id => { roomId = id; } };
}

module.exports = { startBridgeFixture };
