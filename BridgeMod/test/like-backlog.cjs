// 配信が終わったら、BridgeMOD に溜まったいいねの待ちを捨てる（BridgeMOD 1.7.5 の /bridge/control、2026-10-14 ユーザーの決定）。
// 使い捨てのサーバーで確かめる。使い方は README.md の「いいねの待ちを捨てる」。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const { Rcon } = require('rcon-client');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:25578';
const status = async () => (await bridgeFetch(base + '/bridge/status')).json();
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
const post = (url, body) => bridgeFetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
let rcon;
// いいねで実行した回数（txt がスコアを1ずつ足す）。
const runs = async () => Number((await rcon.send('scoreboard players get #qa qalike')).match(/has (\d+)/)?.[1] || 0);
const results = [];
async function test(name, fn) {
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  await rcon.send('scoreboard objectives add qalike dummy');
  await rcon.send('scoreboard players set #qa qalike 0');
  // いいね1回でスコアを1足す txt。1件100回を、1 tick に8回ずつ実行させて待ちを作る。
  fs.writeFileSync(path.join(root, 'bridge', 'commands', 'minecraft', 'qa_like.txt'), '# TITLE: qa like\nscoreboard players add #qa qalike 1\n');

  await test('いいねの待ちを捨てると、溜まったいいねはそこで止まる（実行中の1回分を除く）', async () => {
    for (let i = 0; i < 60; i++) {
      const r = await post('/bridge/event', { type: 'like', key: 'qa_like', count: 100, listenerName: 'QA', announce: false });
      assert.equal(r.status, 202); await r.text();
    }
    await sleep(1000);
    const before = (await status()).like;
    assert.ok(before >= 50, 'likes are queued: ' + before);
    const r = await post('/bridge/control', { action: 'discard', type: 'like' });
    assert.equal(r.status, 200);
    const body = await r.json();
    const atDiscard = await runs();
    assert.ok(body.discarded >= before - 1, 'discarded ' + body.discarded + ' of ' + before);
    await sleep(2000);
    const after = await runs();
    // 1 tick に実行するいいねは最大8回。捨てたあとに増えるのは、実行中だった分の残りだけ。
    assert.ok(after - atDiscard <= 8, 'likes stopped: ' + atDiscard + ' -> ' + after);
    assert.ok(after < 6000, 'most of the 6,000 runs were discarded: ' + after);
    assert.equal((await status()).like, 0, 'the like queue is empty');
    return { queuedBefore: before, discarded: body.discarded, runsAtDiscard: atDiscard, runsAfter2s: after };
  });

  await test('捨てたあとに来たいいねは、送った回数どおり実行する', async () => {
    const start = await runs();
    const r = await post('/bridge/event', { type: 'like', key: 'qa_like', count: 3, listenerName: 'QA', announce: false });
    assert.equal(r.status, 202); await r.text();
    await wait(async () => (await status()).like === 0 && await runs() === start + 3, 10000);
    return { ran: 3 };
  });

  await test('ギフト・そのほかの待ちは /bridge/control で捨てない（いいねだけ）', async () => {
    for (const type of ['gift', 'other']) {
      const r = await post('/bridge/control', { action: 'discard', type });
      assert.equal(r.status, 400, type); await r.text();
    }
    return { refused: ['gift', 'other'] };
  });

  fs.writeFileSync(path.join(root, 'like-backlog-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`like backlog: ${results.length} tests passed`);
  await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
