// 強さの上限をやめたこと（2026-10-11）を、使い捨ての Forge サーバーで確かめる。使い方は README.md の「強さの上限なし」。
// --bridge-only で BridgeMOD の分だけ、--saikutu-only で採掘の分だけを実行する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client'), { Vec3 } = require('vec3');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv.includes('--bridge-only') ? 'bridge' : process.argv.includes('--saikutu-only') ? 'saikutu' : null;
let rcon, bot;
const results = [];
const cmd = s => rcon.send(s);
const status = async () => (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
async function idle(ms = 120000) {
  await wait(async () => { const s = await status(); const g = s.games?.saikutumod; return !s.gift && !s.other && !s.effectsPending && !(g && (g.gift || g.other || g.effectsPending)); }, ms);
}
async function post(key, count) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(r.status, 202); await r.text();
}
async function killCount(type) { const m = (await cmd(`kill @e[type=${type}]`)).match(/Killed (\d+)/); return m ? Number(m[1]) : 0; }
async function test(group, name, fn) {
  if (only && only !== group) return;
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QANoLimit', auth: 'offline', version: '1.20.1', viewDistance: 'far' });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('Spawn timeout')), 30000).unref(); });
  for (const rule of ['doMobSpawning false', 'doWeatherCycle false', 'doDaylightCycle false', 'doFireTick false', 'mobGriefing false']) await cmd('gamerule ' + rule);
  await cmd('time set day');

  await test('bridge', 'chickenrain count=5 は 200×5＝1000羽（以前は3で止まり600羽）', async () => {
    await cmd('gamemode creative QANoLimit'); await cmd('tp QANoLimit -1000.5 64 0.5'); await sleep(2000);
    await cmd('fill -1016 63 -16 -984 63 16 minecraft:stone');
    await killCount('minecraft:chicken');
    await post('chickenrain', 5); await idle(); await sleep(2000);
    const chickens = await killCount('minecraft:chicken');
    assert.equal(chickens, 1000);
    return { chickens };
  });

  await test('bridge', 'スーパージャンプ count=20 は 640 ブロック上がり、低速落下は付かない', async () => {
    await cmd('tp QANoLimit -1200.5 64 0.5'); await sleep(2000);
    await cmd('fill -1216 63 -16 -1184 63 16 minecraft:stone');
    await cmd('gamemode survival QANoLimit'); await cmd('effect clear QANoLimit'); await sleep(500);
    const startY = bot.entity.position.y; let maxY = startY, slowFalling = false;
    const watch = setInterval(() => {
      maxY = Math.max(maxY, bot.entity.position.y);
      if (Object.values(bot.entity.effects || {}).some(e => e.id === 28)) slowFalling = true;   // 28 = slow_falling
    }, 50);
    await post('superjump', 20);
    await wait(async () => maxY >= startY + 600, 120000).catch(() => {});
    await sleep(3000);
    clearInterval(watch);
    assert.ok(maxY >= startY + 600, `rose to ${maxY - startY}`);
    assert.equal(slowFalling, false, 'no slow falling');
    await cmd('gamemode creative QANoLimit'); await cmd('tp QANoLimit -1200.5 64 0.5');
    return { rose: Math.round(maxY - startY), slowFalling };
  });

  fs.writeFileSync(path.join(root, 'no-limits-results.json'), JSON.stringify({ results }, null, 2));
  if (results.length === 0) throw Error('no tests ran');
  console.log(`no limits: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
