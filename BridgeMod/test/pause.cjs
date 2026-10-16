// 妨害の一時停止（BridgeMOD 1.8.0、2026-10-16 ユーザーの決定）。使い捨てのサーバーで確かめる。使い方は README.md の「妨害の一時停止」。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const { Rcon } = require('rcon-client');
const mineflayer = require('mineflayer');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:25578';
const status = async () => (await bridgeFetch(base + '/bridge/status')).json();
const post = (url, body) => bridgeFetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
const only = process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length);
let rcon, bot;
const results = [];
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}
const score = async who => Number((await rcon.send(`scoreboard players get #${who} qapause`)).match(/has (\d+)/)?.[1] || 0);
const control = async action => { const r = await post('/bridge/control', { action }); const body = await r.json(); return { status: r.status, body }; };
const event = async (type, count) => { const r = await post('/bridge/event', { type, key: 'qa_pause', count, listenerName: 'QA', announce: false }); await r.text(); return r.status; };

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  await rcon.send('scoreboard objectives add qapause dummy');
  const dir = path.join(root, 'bridge', 'commands', 'minecraft');
  fs.writeFileSync(path.join(dir, 'qa_pause.txt'), '# TITLE: qa pause\nscoreboard players add #pause qapause 1\n');

  await test('一時停止と再開は /bridge/control で切り替わり、2回押しても 200。状態に paused が出る', async () => {
    assert.deepEqual(await control('pause'), { status: 200, body: { ok: true, paused: true } });
    assert.deepEqual(await control('pause'), { status: 200, body: { ok: true, paused: true } });
    assert.equal((await status()).paused, true);
    assert.deepEqual(await control('resume'), { status: 200, body: { ok: true, paused: false } });
    assert.deepEqual(await control('resume'), { status: 200, body: { ok: true, paused: false } });
    assert.equal((await status()).paused, false);
    return { toggled: true };
  });

  await test('止めている間は、ギフト・いいね・そのほか・/bridge/exec・ゲーム内の /bridge を実行せずに預かり、再開したら送った数どおり実行する', async () => {
    await rcon.send('scoreboard players set #pause qapause 0');
    await rcon.send('scoreboard players set #exec qapause 0');
    await control('pause');
    assert.equal(await event('gift', 3), 202);
    assert.equal(await event('like', 4), 202);
    assert.equal(await event('other', 5), 202);
    const exec = await post('/bridge/exec', { listenerName: 'QA', commands: ['scoreboard players add #exec qapause 1'] });
    assert.equal(exec.status, 202); await exec.text();
    const said = await rcon.send('bridge qa_pause 2');
    assert.match(said, /一時停止中/);
    await sleep(2000);
    assert.equal(await score('pause'), 0, '止めている間は実行しない');
    assert.equal(await score('exec'), 0);
    const held = await status();
    assert.ok(held.gift >= 1 && held.like >= 1 && held.other >= 3, JSON.stringify({ gift: held.gift, like: held.like, other: held.other }));
    await control('resume');
    await wait(async () => await score('pause') === 3 + 4 + 5 + 2 && await score('exec') === 1, 20000);
    await sleep(1000);
    assert.equal(await score('pause'), 14, '余分に実行しない');
    return { held: { gift: held.gift, like: held.like, other: held.other } };
  });

  await test('止めている間に配信が終わったら、預かったいいねは捨てる（10-14 の決定のまま）', async () => {
    await rcon.send('scoreboard players set #pause qapause 0');
    await control('pause');
    assert.equal(await event('like', 10), 202);
    const discard = await post('/bridge/control', { action: 'discard', type: 'like' });
    assert.equal(discard.status, 200); await discard.text();
    assert.equal((await status()).like, 0);
    await control('resume');
    await sleep(2000);
    assert.equal(await score('pause'), 0);
    return { discarded: true };
  });

  await test('止めている間に待ちがいっぱいになったら 429 を返し、再開したら預かった分は全部実行する', async () => {
    await rcon.send('scoreboard players set #pause qapause 0');
    await control('pause');
    let accepted = 0, refused = 0;
    for (let i = 0; i < 300 && refused === 0; i++) { const s = await event('other', 1); if (s === 202) accepted++; else if (s === 429) refused++; }
    assert.equal(refused, 1, '待ちがいっぱいなら 429');
    await control('resume');
    await wait(async () => await score('pause') === accepted, 60000);
    return { accepted };
  });

  await test('始まっている演出は、止めても最後まで続く', async () => {
    bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QAPause', auth: 'offline', version: '1.20.1', viewDistance: 'tiny' });
    await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reason => reject(Error('kicked: ' + reason))); });
    await rcon.send('effect give QAPause minecraft:resistance 1000000 255 true');
    const r = await post('/bridge/event', { type: 'gift', key: 'anvildrop', count: 1, listenerName: 'QA', announce: false });
    assert.equal(r.status, 202); await r.text();
    await wait(async () => (await status()).effectsPending > 0, 10000);
    await control('pause');
    await wait(async () => (await status()).effectsPending === 0, 60000);
    await control('resume');
    return { finishedWhilePaused: true };
  });

  fs.writeFileSync(path.join(root, 'pause-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`pause: ${results.length} tests passed`);
  bot?.quit();
  await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; bot?.quit(); process.exit(1); });
