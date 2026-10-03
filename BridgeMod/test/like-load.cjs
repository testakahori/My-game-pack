const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const { Rcon } = require('rcon-client');
const { createModEventDelivery } = require('../../bridge/mod_event_delivery.cjs');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'), 'utf8')).purpose !== 'disposable-gift-effects-test') throw Error('Disposable test world marker required');
const props = fs.readFileSync(path.join(root, 'server.properties'), 'utf8');
for (const setting of ['server-ip=127.0.0.1', 'server-port=25587', 'rcon.port=25588']) if (!props.includes(setting)) throw Error('Isolated QA ports required');
const password = props.match(/^rcon.password=(.*)$/m)[1].trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const status = async () => (await fetch('http://127.0.0.1:25578/bridge/status')).json();
const post = data => fetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
async function until(fn, ms = 70000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(100); }
  throw Error('Timed out');
}
const result = { checks: [], samples: [], giftLatencyMs: [] };
let bot, rcon, sampler;
const cmd = text => rcon.send(text);
const pass = message => { result.checks.push(message); console.log('PASS ' + message); };
(async () => {
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password, timeout: 15000 });
  rcon.on('error', error => console.error(error.message));
  assert.equal((await status()).player.online, false, 'No users may be online in the disposable test');
  const baseSpawned = (await status()).likeCodSpawned;
  const commands = path.join(root, 'bridge/commands/minecraft');
  // Run the production zombie file and record actual execution order after each spawn.
  fs.writeFileSync(path.join(commands, 'qa_gift_fifo.txt'), fs.readFileSync(path.join(commands, 'zombie.txt'), 'utf8') + '\ndata modify storage bridge:qa giftOrder append value "{ListenerName}"\n');
  fs.appendFileSync(path.join(commands, 'cod.txt'), '\ndata modify storage bridge:qa likeOrder append value "{ListenerName}"\n');
  await cmd('data modify storage bridge:qa giftOrder set value []');
  await cmd('data modify storage bridge:qa likeOrder set value []');
  await cmd('gamerule doMobSpawning false');
  await cmd('setworldspawn 0 64 0');
  await cmd('fill -18 59 -18 18 72 18 stone hollow');
  await cmd('fill -17 60 -17 17 71 17 water');
  // Without a player, cod wait at the head. Fill all 120 slots and ensure the oldest survives.
  for (let i = 0; i < 120; i++) {
    const res = await post({ type: 'like', key: 'cod', count: 1, listenerName: 'Like' + i, announce: false, eventId: 'full-' + i });
    assert.equal(res.status, 202); await res.text();
  }
  let res = await post({ type: 'like', key: 'cod', count: 1, eventId: 'excess' });
  assert.equal(res.status, 429); await res.text();
  res = await post({ type: 'like', key: 'cod', count: 1, eventId: 'full-0' });
  assert.equal(res.status, 429); await res.text();
  assert.equal((await status()).like, 120);
  pass('full like queue applies backpressure without dropping old requests');
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'LikeLoadTester', auth: 'offline', version: '1.20.1', viewDistance: 'tiny' });
  bot.on('error', error => console.error(error.message));
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); });
  await cmd('gamemode creative LikeLoadTester'); await cmd('tp LikeLoadTester 0 64 0');
  await cmd('summon minecraft:cod 0 64 0 {Tags:["qa_world_fish"],PersistenceRequired:1b,Invulnerable:1b}');
  const delivery = createModEventDelivery({ send: async event => {
    const res = await post({ ...event, key: event.commandFile.replace('.txt', '') });
    const body = await res.text(); if (res.status !== 202) throw Error(body);
  } });
  sampler = setInterval(async () => { try { result.samples.push(await status()); } catch {} }, 500);
  const orders = [];
  for (let i = 0; i < 20; i++) {
    const name = 'Gift' + String(i).padStart(2, '0'); orders.push(name);
    const start = Date.now();
    await delivery.enqueue({ type: 'gift', commandFile: 'qa_gift_fifo.txt', count: 1, listenerName: name, announce: false });
    await until(async () => (await cmd('data get storage bridge:qa giftOrder')).includes(name), 5000);
    result.giftLatencyMs.push(Date.now() - start);
  }
  const recorded = await cmd('data get storage bridge:qa giftOrder');
  assert.deepEqual(recorded.match(/Gift\d+/g), orders);
  for (const name of orders) assert.match(await cmd('execute as @e[type=minecraft:zombie] run data get entity @s CustomName'), new RegExp(name));
  assert.ok((await status()).like > 0, 'gifts finish while likes still wait');
  pass('20 gifts execute exactly once in FIFO order, each summons a named zombie while likes remain pending');
  await delivery.enqueue({ type: 'gift', commandFile: 'cod.txt', count: 2, listenerName: 'GiftFish', announce: false });
  await cmd('execute as @e[type=minecraft:cod,name=GiftFish] run data merge entity @s {Invulnerable:1b,PersistenceRequired:1b}');
  await until(async () => (await status()).like === 0);
  const done = await status();
  assert.equal(done.likeCodSpawned - baseSpawned, 120, 'every accepted like results in one fish');
  const likeOrder = await cmd('data get storage bridge:qa likeOrder');
  assert.deepEqual(likeOrder.match(/Like\d+/g), Array.from({ length:120 }, (_, i) => 'Like' + i));
  assert.ok(result.samples.every(s => s.likeCodActive <= 64));
  assert.ok(result.samples.some(s => s.likeCodActive === 64), 'test actually reaches the active cap');
  res = await post({ type: 'like', key: 'cod', count: 1, eventId: 'full-0' });
  assert.equal(res.status, 202); await res.text(); await sleep(500);
  assert.equal((await status()).likeCodSpawned, done.likeCodSpawned + 1);
  pass('120 likes all execute, active like fish stay within 64, common requests run again even with the same ID');
  await until(async () => (await status()).likeCodActive === 0, 30000);
  assert.match(await cmd('data get entity @e[tag=qa_world_fish,limit=1] Health'), /20|3/);
  await cmd('scoreboard objectives add qa_fish dummy');
  await cmd('scoreboard players set #gift qa_fish 0');
  await cmd('execute as @e[type=minecraft:cod,name=GiftFish] run scoreboard players add #gift qa_fish 1');
  assert.match(await cmd('scoreboard players get #gift qa_fish'), /has 2 /);
  pass('temporary like fish expire; world fish and gift fish remain');
  assert.equal((await status()).failed, 0);
  result.maxTickMs = Math.max(...result.samples.map(s => s.tickMs));
  result.minTps = Math.min(...result.samples.map(s => s.tps));
  result.maxGiftLatencyMs = Math.max(...result.giftLatencyMs);
  result.ok = true;
})().catch(error => { result.error = error.stack; process.exitCode = 1; console.error(error); }).finally(async () => {
  clearInterval(sampler); bot?.quit(); rcon?.end();
  fs.writeFileSync(path.join(root, 'like-load-results.json'), JSON.stringify(result, null, 2));
});
