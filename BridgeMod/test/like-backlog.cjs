// 配信が終わったら、BridgeMOD に溜まったいいねの待ちを捨てる（BridgeMOD 1.7.5 の /bridge/control、2026-10-14 ユーザーの決定）。
// 使い捨てのサーバーで確かめる。使い方は README.md の「いいねの待ちを捨てる」。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:25578';
const status = async () => (await bridgeFetch(base + '/bridge/status')).json();
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
const post = (url, body) => bridgeFetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const results = [];
async function test(name, fn) {
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  // いいねで実行する txt。1回で100行の say を、ゆっくり（1 tick に8行）実行させて待ちを作る。
  fs.writeFileSync(path.join(root, 'bridge', 'commands', 'minecraft', 'qa_like.txt'), '# TITLE: qa like\nsay qa like\n');

  await test('いいねの待ちを捨てると、BridgeMOD に溜まったいいねがすぐなくなる（ギフトの待ちは捨てない）', async () => {
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
    assert.ok(body.discarded >= before - 1, 'discarded ' + body.discarded + ' of ' + before);
    await sleep(200);
    assert.equal((await status()).like, 0, 'the like queue is empty');
    return { queuedBefore: before, discarded: body.discarded };
  });

  await test('捨てたあとに来たいいねは、ふつうに実行する', async () => {
    const r = await post('/bridge/event', { type: 'like', key: 'qa_like', count: 3, listenerName: 'QA', announce: false });
    assert.equal(r.status, 202); await r.text();
    await wait(async () => (await status()).like === 0, 10000);
    return { drained: true };
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
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
