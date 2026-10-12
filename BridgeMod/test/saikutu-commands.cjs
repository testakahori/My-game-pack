// 採掘へ移したコマンドが、SaikutuMOD の内蔵 txt から動くことを確かめる。使い方は README.md の「採掘へ移したコマンド」。
// 2026-10-12：採掘速度上昇・低下（give_haste・give_fatigue）を採掘パックへ移した（SaikutuMOD 1.1.2 から）。
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
const idle = () => wait(async () => { const s = await status(); const g = s.games?.saikutumod; return !s.gift && !s.other && !(g && (g.gift || g.other || g.effectsPending)); });
async function post(key, count) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(r.status, 202); await r.text();
}
const hasEffect = async id => /Test passed/.test(await cmd(`execute if entity @a[name=QASaikutu,nbt={ActiveEffects:[{Id:${id}}]}]`));
async function test(name, fn) {
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  // 採掘のゲームの振り分けファイル（アプリの切替と同じ形）。
  const dir = path.join(root, 'bridge', 'commands', 'minecraft');
  for (const key of ['give_haste', 'give_fatigue'])
    fs.writeFileSync(path.join(dir, `game_saikutu_${key}.txt`), `# GAME_MOD: saikutumod\n# GAME_KEY: ${key}\n# COUNT_MODE: aggregate\n# DISPLAY_OWNER: game\nsaikutu ${key} {Count} {ListenerName}\n`);
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QASaikutu', auth: 'offline', version: '1.20.1' });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('Spawn timeout')), 30000).unref(); });
  await cmd('effect clear QASaikutu');

  await test('採掘速度上昇は採掘MODから効く（採掘速度上昇 = Id 3）', async () => {
    await post('give_haste', 1); await idle(); await sleep(500);
    assert.ok(await hasEffect(3), 'haste');
    return { haste: true };
  });

  await test('採掘速度低下は採掘MODから効く（採掘速度低下 = Id 4）', async () => {
    await post('give_fatigue', 1); await idle(); await sleep(500);
    assert.ok(await hasEffect(4), 'mining fatigue');
    return { fatigue: true };
  });

  fs.writeFileSync(path.join(root, 'saikutu-commands-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`saikutu commands: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
