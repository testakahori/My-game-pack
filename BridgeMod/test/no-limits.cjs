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
    // 新しく生成されたチャンクには鶏が自然に湧くことがあるので、雨で降らせた鶏（douma_chickenrain）だけを数える。
    await killCount('minecraft:chicken');
    await post('chickenrain', 5); await idle(); await sleep(2000);
    const chickens = await killCount('minecraft:chicken,tag=douma_chickenrain');
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

  // 採掘のゲームの振り分けファイル（アプリの切替と同じ形）。
  if (only !== 'bridge') {
    const dir = path.join(root, 'bridge', 'commands', 'minecraft');
    for (const key of ['tntdaibakuhatu', 'flood', 'get_tree'])
      fs.writeFileSync(path.join(dir, `game_saikutu_${key}.txt`), `# GAME_MOD: saikutumod\n# GAME_KEY: ${key}\n# COUNT_MODE: aggregate\n# DISPLAY_OWNER: game\nsaikutu ${key} {Count} {ListenerName}\n`);
  }

  await test('saikutu', 'TNT大爆発 count=2 は、横96・深さ22の楕円体の衝撃波でえぐり、コマンドブロックは残る', async () => {
    const cx = -3000, R = 104;
    await cmd('gamemode creative QANoLimit'); await cmd(`tp QANoLimit ${cx + 0.5} 120 0.5`); await sleep(4000);
    // 石の台（半径104・y=0〜63）。fill は1回32,768ブロックまで。
    for (let x = cx - R; x <= cx + R; x += 32) for (let z = -R; z <= R; z += 32) for (let y = 0; y <= 63; y += 32)
      await cmd(`fill ${x} ${y} ${z} ${Math.min(x + 31, cx + R)} ${Math.min(y + 31, 63)} ${Math.min(z + 31, R)} minecraft:stone`);
    await cmd(`fill ${cx - 16} 64 -16 ${cx + 16} 110 16 minecraft:air`);
    await cmd(`setblock ${cx + 60} 55 0 minecraft:command_block{Command:"say keep"} replace`);
    // ゾンビは昼の日光で燃えて体力が減るので、燃えないハスクで「衝撃波に巻き込まれたか」を見る。
    await cmd('kill @e[type=minecraft:husk,tag=qa_wave]');
    await cmd(`summon minecraft:husk ${cx + 30} 64 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["qa_wave"]}`);
    // 地面より20ブロック上の柱の上のハスク。柱（足場）が先にえぐられて落ちても、衝撃波の爆発は当たる（PR #75 再レビュー）。
    // 柱は頭上の TNT（爆心の ±7）の外に、葉で作る。先端の輪の爆発は葉を地面とみなさない高さ（ハスクの20ブロック下）で起きるので届かず、
    // 低速落下で落下ダメージも受けない。体力が減るのは、ハスクの位置での衝撃波の爆発だけ。
    // NoAI の生き物には重力がかからず落ちないので、AI はそのままにして移動速度を0にする（歩き回らずに落ちる）。
    await cmd('kill @e[type=minecraft:husk,tag=qa_pillar]');
    await cmd(`fill ${cx + 10} 64 0 ${cx + 10} 83 0 minecraft:oak_leaves[persistent=true]`);
    await cmd(`summon minecraft:husk ${cx + 10.5} 84 0.5 {PersistenceRequired:1b,Tags:["qa_pillar"],Attributes:[{Name:"generic.movement_speed",Base:0.0d}],ActiveEffects:[{Id:28,Amplifier:0b,Duration:12000,ShowParticles:0b}]}`);
    await cmd(`tp QANoLimit ${cx + 0.5} 64 0.5`); await sleep(1500);
    await post('tntdaibakuhatu', 2);
    // 頭上の TNT の連鎖は重いので、置かれたらすぐ片付けて、衝撃波（40 tick 後に始まる）だけを測る。
    await wait(async () => /Test passed/.test(await cmd(`execute if block ${cx} 94 0 minecraft:tnt`)), 20000);
    await cmd('kill @e[type=minecraft:tnt]');
    await cmd(`fill ${cx - 7} 69 -7 ${cx + 7} 101 7 minecraft:air replace minecraft:tnt`);
    await cmd(`tp QANoLimit ${cx + 0.5} 120 0.5`);
    await idle(180000); await sleep(2000);
    // 爆心の y=64 から下へえぐれた深さ（いちばん上の石の y と 63 の差）を、横の距離ごとに測る。
    const bottom = (dx) => { for (let y = 63; y >= 0; y--) { const b = bot.blockAt(new Vec3(cx + dx, y, 0)); if (b && b.name === 'stone') return y; } return -1; };
    const depth = dx => 63 - bottom(dx);
    const at = { 0: depth(0), 48: depth(48), 90: depth(90), 100: depth(100) };
    // 楕円体の深さ：0→22、48→19、90→7、100→0（端の外）。爆心の列は y=42 まで、つまり 63 からの深さ 22。
    assert.ok(Math.abs(at[0] - 22) <= 1, 'centre depth ' + at[0]);
    assert.ok(Math.abs(at[48] - 19) <= 1, 'depth at 48: ' + at[48]);
    assert.ok(Math.abs(at[90] - 7) <= 1, 'depth at 90: ' + at[90]);
    assert.equal(at[100], 0, 'outside the rim stays');
    assert.match(await cmd(`execute if block ${cx + 60} 55 0 minecraft:command_block`), /Test passed/, 'protected command block stays');
    // 衝撃波に巻き込まれたハスクは、死んだか体力が減っている（最大20）。
    let husk = 'dead';
    if (/Test passed/.test(await cmd('execute if entity @e[type=minecraft:husk,tag=qa_wave]'))) {
      husk = Number((await cmd('data get entity @e[type=minecraft:husk,tag=qa_wave,limit=1] Health')).match(/([\d.]+)f/)?.[1]);
      assert.ok(husk < 20, 'husk hurt: ' + husk);
    }
    let pillar = 'dead';
    if (/Test passed/.test(await cmd('execute if entity @e[type=minecraft:husk,tag=qa_pillar]'))) {
      pillar = Number((await cmd('data get entity @e[type=minecraft:husk,tag=qa_pillar,limit=1] Health')).match(/([\d.]+)f/)?.[1]);
      assert.ok(pillar < 20, 'the husk on the pillar is hit even though it fell as the pillar was carved: ' + pillar);
    }
    return { depth: at, husk, pillar };
  });

  await test('saikutu', '洪水 count=5 はドラウンド 30×5＝150体（以前は3で止まり90体）', async () => {
    await cmd(`tp QANoLimit -5000.5 64 0.5`); await sleep(2000);
    await cmd('fill -5016 63 -16 -4984 63 16 minecraft:stone');
    await killCount('minecraft:drowned');
    await post('flood', 5); await idle(180000); await sleep(3000);
    const drowned = await killCount('minecraft:drowned');
    // 洪水のウーパールーパーはドラウンドを襲うので、待つ間に数体減ることがある。上限があったころは90体で止まった。
    assert.ok(drowned >= 140 && drowned <= 150, 'drowned ' + drowned);
    return { drowned };
  });

  await test('saikutu', '木 count=210 は 210 回くり返す（以前は200で止まった）', async () => {
    await cmd('clear QANoLimit');
    await post('get_tree', 210); await idle(180000);
    const m = (await cmd('clear QANoLimit minecraft:oak_wood 0')).match(/Found (\d+)/);
    const logs = m ? Number(m[1]) : 0;
    assert.equal(logs, 2100);
    return { logs };
  });

  await test('saikutu', 'TNT大爆発 count=1000 は、調べる範囲をえぐり終えたら衝撃波を終える（以前は端まで 24,000 tick ≒ 20分続いた）', async () => {
    // フラットワールドの地表（草は y=-61）。描画距離10なら、横は192ブロック、上下は建築できる高さ（y=-64〜319）まで調べる。
    const cx = -8000;
    await cmd('gamemode creative QANoLimit'); await cmd(`tp QANoLimit ${cx + 0.5} -60 0.5`); await sleep(4000);
    const started = Date.now();
    await post('tntdaibakuhatu', 1000);
    await wait(async () => /Test passed/.test(await cmd(`execute if block ${cx} -30 0 minecraft:tnt`)), 20000);
    await cmd('kill @e[type=minecraft:tnt]');
    await cmd(`fill ${cx - 7} -55 -7 ${cx + 7} -23 7 minecraft:air replace minecraft:tnt`);
    await idle(240000);
    const seconds = Math.round((Date.now() - started) / 1000);
    // 衝撃波が終わったあとに来た生き物は爆発させない（燃えないハスクで見る）。
    await cmd('kill @e[type=minecraft:husk,tag=qa_after]');
    await cmd(`summon minecraft:husk ${cx + 3} -63 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["qa_after"]}`);
    await sleep(3000);
    const health = Number((await cmd('data get entity @e[type=minecraft:husk,tag=qa_after,limit=1] Health')).match(/([\d.]+)f/)?.[1]);
    assert.equal(health, 20, 'a husk that arrives after the wave is not blown up');
    return { seconds, health };
  });

  fs.writeFileSync(path.join(root, 'no-limits-results.json'), JSON.stringify({ results }, null, 2));
  if (results.length === 0) throw Error('no tests ran');
  console.log(`no limits: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
