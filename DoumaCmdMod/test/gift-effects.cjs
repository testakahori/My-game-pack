const fs = require('node:fs');
const assert = require('node:assert/strict');
const mineflayer = require('mineflayer');
const path = require('node:path');
const { Rcon } = require('rcon-client');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'), 'utf8')).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required. Never use a player world.');
const properties = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(line => line.includes('=')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
if (properties['server-ip'] !== '127.0.0.1' || properties['server-port'] !== '25587' || properties['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const output = process.env.GIFT_QA_OUTPUT || root;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = { tests: [] };
let bot, rcon;
let spawns = [];
async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await sleep(100); }
  throw Error('Timed out waiting for condition');
}
async function status() { return (await fetch('http://127.0.0.1:25578/douma/status')).json(); }
async function gift(key, count = 1) {
  const response = await fetch('http://127.0.0.1:25578/douma/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(response.status, 202);
  await sleep(200);
}
async function idle() { await waitFor(async () => { const s = await status(); return !s.gift && !s.other && !s.effectsPending; }, 45000); }
async function cmd(text) { return rcon.send(text); }
async function reset() {
  await idle(); await cmd('kill @e[type=!minecraft:player]');
  await cmd('effect clear GiftTester');
  await cmd('effect give GiftTester minecraft:resistance 1000000 255 true');
  await cmd('fill -5 -36 -5 5 -36 5 stone'); await cmd('fill -5 -35 -5 5 -20 5 air');
  await cmd('tp GiftTester 0.5 -35 0.5'); await waitFor(async () => Math.abs(bot.entity.position.y + 35) < 0.1 && Math.abs((await status()).player.y + 35) < 0.1); await sleep(500); spawns = [];
}
async function test(name, fn) {
  if(process.argv.includes('--weather-only') && !/iceage|storm|force clear|cataclysm/.test(name))return;
  console.log('TEST', name);
  const info = await fn(); result.tests.push({ name, passed: true, info });
  fs.writeFileSync(output + (process.argv.includes('--weather-only')?'/weather-results.json':'/gift-results.json'), JSON.stringify(result, null, 2));
  console.log('PASS', name, JSON.stringify(info || {}));
}
async function apex(count, separate = false) {
  await reset(); const base = bot.entity.position.y; let peak = base; const initialStatus = await status(); let serverPeak = initialStatus.player.y; const trace = []; const poll = setInterval(async () => { const s = await status(); serverPeak = Math.max(serverPeak,s.player.y); trace.push({t:Date.now(),server:s.player.y,client:bot.entity.position.y,vy:bot.entity.velocity.y}); },50);
  const sample = () => { peak = Math.max(peak, bot.entity.position.y); };
  bot.on('physicsTick', sample);
  if (separate) { for (let i = 0; i < count; i++) { await gift('superjump', 1); await sleep(70); } }
  else await gift('superjump', count);
  await waitFor(() => peak > base + count * 32 - 2, 25000);
  await sleep(1200);
  bot.off('physicsTick', sample);
  clearInterval(poll); fs.writeFileSync(output+"/jump-trace-"+count+"-"+separate+".json",JSON.stringify({base,initialStatus,serverPeak,peak,trace},null,2)); const height = peak - base; console.log("HEIGHT_DEBUG",{base,serverBase:initialStatus.player.y,serverHeight:serverPeak-initialStatus.player.y,height});
  assert.ok(Math.abs(height - count * 32) < 2, `height ${height}, expected ${count * 32}`);
  return { count, separate, height };
}

(async () => {
  await waitFor(async () => { try { return (await status()).ok; } catch { return false; } }, 180000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: properties['rcon.password'], timeout: 10000 });
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'GiftTester', auth: 'offline', version: '1.20.1', viewDistance: 'far' });
  bot.on('error', e => console.error('BOT_ERROR', e.message)); bot.on('kicked', reason => console.error('BOT_KICKED', reason));
  bot.on('entitySpawn', e => spawns.push({ type: e.name, position: { ...e.position } }));
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('bot spawn timeout')), 30000).unref(); });
  await cmd('gamerule doMobSpawning false'); await cmd('gamerule doDaylightCycle false');
  await cmd('gamerule doWeatherCycle false'); await cmd('gamerule doFireTick false');
  await cmd('gamerule keepInventory true'); await cmd('gamerule fallDamage false');
  await cmd('time set midnight'); await cmd('gamemode survival GiftTester');
  await sleep(3000);
  await test('superjump x1', () => apex(1));
  await test('superjump x10 in one gift', () => apex(10));
  await test('superjump ten consecutive gifts', () => apex(10, true));
  if (process.argv.includes('--jumps-only')) { result.passed=true; return; }
  await test('skytrap rapid descent', async () => {
    await reset(); let high = -Infinity, downward = 0;
    const sample = () => { high = Math.max(high, bot.entity.position.y); downward = Math.min(downward, bot.entity.velocity.y); };
    bot.on('physicsTick', sample); await gift('skytrap'); await sleep(2000); bot.off('physicsTick', sample);
    assert.ok(high > 45); assert.ok(downward < -3); return { high, downward };
  });
  for (const [key, type, expected] of [['anvildrop', 'falling_block', 100], ['chickenrain', 'chicken', 200], ['meteor', 'fireball', 100], ['volcano', 'falling_block', 50]]) {
    await test(key + ' spawn count', async () => {
      await reset(); await gift(key); await idle(); await sleep(700);
      const n = spawns.filter(e => e.type === type).length;
      assert.equal(n, expected, JSON.stringify(spawns.reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {})));
      return { count: n };
    });
  }
  await test('zombiewave four types x50', async () => {
    await reset(); await gift('zombiewave'); await idle(); await sleep(500);
    const counts = {};
    for (const type of ['zombie', 'husk', 'drowned', 'zombie_villager']) { counts[type] = spawns.filter(e => e.type === type).length; assert.equal(counts[type], 50); }
    return counts;
  });
  await test('bullets random directions', async () => {
    await reset(); await gift('bullettime'); await idle(); await sleep(500);
    const arrows = spawns.filter(e => e.type === 'arrow');
    assert.equal(arrows.length, 240); assert.ok(arrows.some(e => e.position.x < -10)); assert.ok(arrows.some(e => e.position.x > 10));
    assert.ok(arrows.some(e => e.position.z < -10)); assert.ok(arrows.some(e => e.position.z > 10));
    return { arrows: arrows.length, fourDirections: true };
  });
  await test('flood starts high above player', async () => {
    await reset(); const startY = bot.entity.position.y; await gift('flood'); await idle();
    const block = bot.blockAt(bot.entity.position.offset(0, 48, 0).floored());
    assert.equal(block?.name, 'water'); return { startY, sourceHeight: 48 };
  });
  await test('iceage broad ice persists after 120 seconds', async () => {
    await reset(); await cmd('tp GiftTester 160.5 -35 0.5'); await sleep(4000);
    await gift('iceage'); const started = Date.now(); await idle(); await sleep(1000);
    assert.equal(bot.blockAt(new (require('vec3').Vec3)(190,-36,0))?.name,'packed_ice');
    assert.equal(bot.isRaining, true);
    await waitFor(() => !bot.isRaining, 130000);
    const seconds = (Date.now() - started) / 1000; assert.ok(seconds >= 118 && seconds <= 128);
    assert.equal(bot.blockAt(new (require('vec3').Vec3)(190,-36,0))?.name,'packed_ice');
    return { seconds, iceRemains: true };
  });
  await test('storm stops after 180 seconds with weather cycle disabled', async () => {
    await gift('storm'); const start = Date.now(); await idle(); assert.equal(bot.isRaining, true);
    await waitFor(() => !bot.isRaining, 190000);
    const seconds = (Date.now() - start) / 1000; assert.ok(seconds >= 178 && seconds <= 188); return { seconds };
  });
  await test('force clear weather', async () => { await gift('storm'); await idle(); assert.equal(bot.isRaining, true); await gift('clearweather'); await waitFor(() => !bot.isRaining); return { clear: true }; });
  await test('cataclysm composite', async () => {
    await reset(); await cmd('tp GiftTester 320.5 -35 0.5'); await sleep(4000); await gift('cataclysm'); await idle();
    const counts = spawns.reduce((a, e) => (a[e.type] = (a[e.type] || 0) + 1, a), {});
    assert.equal(counts.tnt, 100); assert.equal(counts.zombified_piglin, 50); assert.equal(counts.wither, 1);
    return counts;
  });
  const s = await status(); assert.equal(s.effectsFailed, 0, s.effectsError); assert.equal(s.failed, 0, s.lastError);
  result.passed = true;
})().catch(e => { result.passed = false; result.error = String(e.stack || e); console.error(e); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(output + '/gift-results.json', JSON.stringify(result, null, 2));
  bot?.quit(); if (rcon) await rcon.end(); console.log('RESULT', JSON.stringify(result));
});
