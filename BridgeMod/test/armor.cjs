// ダイヤ装備・ネザライト装備は、今着ている防具を消さずに持ち物へ移す（2026-10-12 ユーザーの決定）。使い方は README.md の「防具」。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let rcon;
const results = [];
const cmd = s => rcon.send(s);
const status = async () => (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
const idle = () => wait(async () => { const s = await status(); return !s.gift && !s.other && !s.effectsPending; });
async function post(key, count) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(r.status, 202); await r.text();
}
// clear の数え方：持ち物と防具の欄を合わせた数（0 は数えるだけで消さない）。
async function owned(item) { const m = (await cmd(`clear QAArmor minecraft:${item} 0`)).match(/Found (\d+)/); return m ? Number(m[1]) : 0; }
async function wearing(slot, item) {
  return /Test passed/.test(await cmd(`execute if entity @a[name=QAArmor,nbt={Inventory:[{Slot:${slot}b,id:"minecraft:${item}"}]}]`));
}
const PARTS = ['helmet', 'chestplate', 'leggings', 'boots'], SLOTS = { helmet: 103, chestplate: 102, leggings: 101, boots: 100 };
async function test(name, fn) {
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QAArmor', auth: 'offline', version: '1.20.1' });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('Spawn timeout')), 30000).unref(); });
  await cmd('gamemode survival QAArmor'); await cmd('tp QAArmor -6000.5 64 0.5'); await sleep(1500);
  await cmd('fill -6005 63 -5 -5995 63 5 minecraft:stone');

  await test('ネザライトを着ていてダイヤ装備が来たら、ネザライトは持ち物に残る（以前は消えた）', async () => {
    await cmd('clear QAArmor');
    for (const part of PARTS) await cmd(`item replace entity QAArmor armor.${part === 'helmet' ? 'head' : part === 'chestplate' ? 'chest' : part === 'leggings' ? 'legs' : 'feet'} with minecraft:netherite_${part}`);
    await post('daiyasoubi', 1); await idle(); await sleep(500);
    for (const part of PARTS) {
      assert.ok(await wearing(SLOTS[part], 'diamond_' + part), 'wearing diamond ' + part);
      assert.equal(await owned('netherite_' + part), 1, 'netherite ' + part + ' kept');
    }
    return { wearing: 'diamond', kept: 'netherite x4' };
  });

  await test('ネザライト装備を数2で送ると2回着せ、前のセットは持ち物へ（持ち物はダイヤ1・ネザライト2、ネザライトを着る）', async () => {
    await post('nezaraitosoubi', 2); await idle(); await sleep(500);
    for (const part of PARTS) {
      assert.ok(await wearing(SLOTS[part], 'netherite_' + part), 'wearing netherite ' + part);
      assert.equal(await owned('diamond_' + part), 1, 'diamond ' + part);
      assert.equal(await owned('netherite_' + part), 3, 'netherite ' + part + ': 1 from the first test, 1 from the first of two, 1 worn');
    }
    return { wearing: 'netherite' };
  });

  await test('持ち物がいっぱいなら、外した防具は足元に落とす', async () => {
    await cmd('clear QAArmor'); await cmd('kill @e[type=minecraft:item]');
    for (const part of PARTS) await cmd(`item replace entity QAArmor armor.${part === 'helmet' ? 'head' : part === 'chestplate' ? 'chest' : part === 'leggings' ? 'legs' : 'feet'} with minecraft:netherite_${part}`);
    for (let slot = 0; slot < 36; slot++) await cmd(`item replace entity QAArmor container.${slot} with minecraft:stone 64`);
    await cmd('gamerule doTileDrops true');
    await post('daiyasoubi', 1); await idle(); await sleep(500);
    for (const part of PARTS) assert.ok(await wearing(SLOTS[part], 'diamond_' + part), 'wearing diamond ' + part);
    const dropped = (await cmd('execute as QAArmor at @s run kill @e[type=minecraft:item,distance=..4]')).match(/Killed (\d+)/);
    assert.equal(dropped ? Number(dropped[1]) : 0, 4, 'four netherite pieces dropped at the feet');
    await cmd('clear QAArmor');
    return { dropped: 4 };
  });

  fs.writeFileSync(path.join(root, 'armor-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`armor: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
