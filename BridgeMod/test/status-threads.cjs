// BridgeMOD 1.7.6（アプリレビュー 2026-10-08 P5）：状態の作成と WebSocket の送信が、サーバーの tick を止めないこと。
// 使い捨てのサーバーで確かめる。使い方は README.md の「状態と WebSocket の送信（2026-10-14）」。
// 「直す前は読まない相手で tick が止まる」ことは、ここでは時間がかかりすぎるので JUnit（WebSocketOutboxTest）で確かめる。
const fs = require('node:fs'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const { Rcon } = require('rcon-client');
const mineflayer = require('mineflayer');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:25578', wsPort = 25579;
const token = () => fs.readFileSync(path.join(root, 'config', 'bridgemod-token.txt'), 'utf8').trim();
const status = async () => (await bridgeFetch(base + '/bridge/status')).json();
const post = (url, body) => bridgeFetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
let rcon, bot;
const results = [];
async function test(name, fn) {
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}
// Bridge と同じつなぎ方（?token=）。届いたメッセージを順にためる。
function listen() {
  const messages = [];
  const socket = new WebSocket(`ws://127.0.0.1:${wsPort}/?token=${encodeURIComponent(token())}`);
  socket.addEventListener('message', event => messages.push({ at: Date.now(), data: JSON.parse(event.data) }));
  return { socket, messages, opened: new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); }) };
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  fs.writeFileSync(path.join(root, 'bridge', 'commands', 'minecraft', 'qa_status_like.txt'), '# TITLE: qa status like\nscoreboard players add #qa qastatus 1\n');
  await rcon.send('scoreboard objectives add qastatus dummy');

  await test('/bridge/status は、これまでと同じ値をすべて返す', async () => {
    const s = await status();
    for (const key of ['gift', 'like', 'other', 'executed', 'failed', 'effectsPending', 'effectsFailed', 'deaths', 'protectedSkips', 'protectedBlockRestores', 'likeCodActive', 'likeCodSpawned', 'discardedGameRequests', 'tps', 'tickMs'])
      assert.equal(typeof s[key], 'number', key);
    for (const key of ['games', 'gameSessions', 'player']) assert.equal(typeof s[key], 'object', key);
    assert.equal(s.ok, true);
    assert.equal(s.mod, 'bridgemod');
    return { tps: s.tps, games: Object.keys(s.games) };
  });

  await test('待ちの件数は、その時点の値を返す（積んだ直後・捨てた直後）', async () => {
    for (let i = 0; i < 30; i++) {
      const r = await post('/bridge/event', { type: 'like', key: 'qa_status_like', count: 100, listenerName: 'QA', announce: false });
      assert.equal(r.status, 202); await r.text();
    }
    const queued = (await status()).like;
    assert.ok(queued >= 20, 'likes are visible right after they are queued: ' + queued);
    const r = await post('/bridge/control', { action: 'discard', type: 'like' });
    assert.equal(r.status, 200); await r.text();
    assert.equal((await status()).like, 0, 'the like queue is empty right after the discard');
    return { queued };
  });

  await test('WebSocket へ、つないだらすぐ状態が届き、そのあと1秒ごとに届く。プレイヤーの死亡も届く', async () => {
    const ws = listen();
    await ws.opened;
    await wait(() => ws.messages.length > 0, 3000);
    await sleep(3500);
    const statuses = ws.messages.filter(m => m.data.ok === true);
    assert.ok(statuses.length >= 3, 'status messages: ' + statuses.length);
    bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QAStatus', auth: 'offline', version: '1.20.1', viewDistance: 'tiny' });
    await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reason => reject(Error('kicked: ' + reason))); });
    const deathsBefore = (await status()).deaths;
    await rcon.send('kill QAStatus');
    await wait(() => ws.messages.some(m => m.data.type === 'death' && m.data.player === 'QAStatus'), 10000);
    assert.equal((await status()).deaths, deathsBefore + 1, '/bridge/status はその時点の死亡数を返す');
    ws.socket.close();
    return { statusMessages: statuses.length };
  });

  await test('読まない WebSocket の相手がいても、サーバーの tick と、ほかの接続への送信は止まらない（15秒）', async () => {
    const raw = net.connect(wsPort, '127.0.0.1');
    await new Promise((resolve, reject) => { raw.once('connect', resolve); raw.once('error', reject); });
    raw.write(`GET /?token=${encodeURIComponent(token())} HTTP/1.1\r\nHost: 127.0.0.1:${wsPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
      + `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    const head = await new Promise(resolve => raw.once('data', data => resolve(data.toString('latin1'))));
    assert.match(head, /^HTTP\/1\.1 101/);
    raw.pause(); // ここから先は読まない
    const ws = listen();
    await ws.opened;
    const gameTime = async () => Number((await rcon.send('time query gametime')).match(/(\d+)/)[1]);
    const t0 = await gameTime(), started = Date.now();
    await sleep(15000);
    const t1 = await gameTime(), seconds = (Date.now() - started) / 1000;
    const statusMessages = ws.messages.filter(m => m.data.ok === true).length;
    const s = await status();
    ws.socket.close();
    raw.destroy();
    assert.ok((t1 - t0) / seconds >= 15, `the server keeps ticking: ${t1 - t0} ticks in ${seconds}s`);
    assert.ok(statusMessages >= 12, 'the other client still receives status every second: ' + statusMessages);
    assert.ok(s.tps >= 15, 'tps ' + s.tps);
    return { ticksPerSecond: Math.round((t1 - t0) / seconds * 10) / 10, statusMessages, tps: s.tps };
  });

  fs.writeFileSync(path.join(root, 'status-threads-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`status threads: ${results.length} tests passed`);
  bot?.quit();
  await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; bot?.quit(); process.exit(1); });
