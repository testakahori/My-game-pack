// 保護ブロック（コマンドブロック3種）が、妨害のコマンドで置き換えられても、同じ向き・同じ中身で残ることを、
// 使い捨ての Forge サーバーで確かめる。使い方は README.md の「保護ブロック」。
// --bridge-only で BridgeMOD の分だけ、--saikutu-only で採掘の分だけを実行する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
if (props['enable-command-block'] !== 'true') throw Error('enable-command-block=true is required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv.includes('--bridge-only') ? 'bridge' : process.argv.includes('--saikutu-only') ? 'saikutu' : null;
let rcon;
const results = [];
const cmd = s => rcon.send(s);
const status = async () => (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
const restores = async () => (await status()).protectedBlockRestores;
async function wait(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(100); } throw Error('Timed out'); }
async function idle() {
  await wait(async () => { const s = await status(); const g = s.games?.saikutumod; return !s.gift && !s.other && !s.effectsPending && !(g && (g.gift || g.other || g.effectsPending)); });
}
async function post(key, count = 1) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(r.status, 202); await r.text();
}
async function exec(commands) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/exec', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands }) });
  assert.equal(r.status, 202); await r.text();
}
async function score(name) { const m = (await cmd(`scoreboard players get ${name} qa_protect`)).match(/has (-?\d+)/); return m ? Number(m[1]) : 0; }
async function isBlock(x, y, z, spec) { return /Test passed/.test(await cmd(`execute if block ${x} ${y} ${z} ${spec}`)); }

// 3種のコマンドブロック。インパルス型とリピート型は常時実行で、スコアを +1 する。チェーン型は中身だけを持つ。
const KINDS = {
  impulse: { id: 'minecraft:command_block', score: '#imp_' },
  repeating: { id: 'minecraft:repeating_command_block', score: '#rep_' },
  chain: { id: 'minecraft:chain_command_block', score: '#chain_' },
};
const spec = (kind, tag) => `${KINDS[kind].id}[facing=up]{auto:1b,Command:"scoreboard players add ${KINDS[kind].score}${tag} qa_protect ${kind === 'chain' ? 0 : 1}"}`;
async function placeTrio(tag, positions) {
  for (const [kind, [x, y, z]] of Object.entries(positions)) assert.match(await cmd(`setblock ${x} ${y} ${z} ${spec(kind, tag)} replace`), /Changed the block/, `${tag} ${kind} placed`);
  await sleep(500);
  return { imp: await score('#imp_' + tag) };
}
async function assertTrio(tag, positions, before) {
  for (const [kind, [x, y, z]] of Object.entries(positions)) {
    assert.ok(await isBlock(x, y, z, KINDS[kind].id + '[facing=up]'), `${tag}: ${kind} at ${x},${y},${z} must stay`);
    assert.match(await cmd(`data get block ${x} ${y} ${z} Command`), new RegExp(KINDS[kind].score + tag), `${tag}: ${kind} keeps its command`);
  }
  if (positions.impulse) assert.equal(await score('#imp_' + tag), before.imp, `${tag}: always-active impulse must not run again`);
  if (positions.repeating) { const rep = await score('#rep_' + tag); await sleep(500); assert.ok(await score('#rep_' + tag) > rep, `${tag}: repeating keeps running`); }
}
async function prepare(cx, deep = false) {
  await idle();
  await cmd(`tp QAProtect ${cx + 0.5} 64 0.5`); await sleep(1500);
  await cmd(`kill @e[type=!minecraft:player]`);
  await cmd(`fill ${cx - 15} 64 -15 ${cx + 15} 96 15 air`);
  await cmd(`fill ${cx - 15} 97 -15 ${cx + 15} 129 15 air`);
  await cmd(`fill ${cx - 15} 63 -15 ${cx + 15} 63 15 stone`);
  if (deep) for (const [lo, hi] of [[8, 35], [36, 62]]) await cmd(`fill ${cx - 15} ${lo} -15 ${cx + 15} ${hi} 15 stone`);
  await cmd(`tp QAProtect ${cx + 0.5} 64 0.5`); await sleep(800);
}
async function test(group, name, fn) {
  if (only && only !== group) return;
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 10000 });
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QAProtect', auth: 'offline', version: '1.20.1', viewDistance: 'normal' });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('Spawn timeout')), 30000).unref(); });
  for (const rule of ['doMobSpawning false', 'doWeatherCycle false', 'doDaylightCycle false', 'doFireTick false', 'commandBlockOutput false', 'mobGriefing false']) await cmd('gamerule ' + rule);
  await cmd('gamemode creative QAProtect');
  await cmd('scoreboard objectives add qa_protect dummy');

  await test('bridge', 'lavafloor: fill と setblock で置き換えても、3種とレッドストーンで動くインパルス型が残る', async () => {
    const cx = -3001; await prepare(cx);
    const pos = { impulse: [cx + 2, 63, 0], repeating: [cx - 2, 63, 0], chain: [cx + 4, 64, 4] };
    const before = await placeTrio('lavafloor', pos);
    // Review Focus 3：常時実行でない、レッドストーンで動かすインパルス型。真下の赤石ブロックで1回だけ実行される。
    await cmd(`setblock ${cx} 63 -2 minecraft:command_block[facing=up]{Command:"scoreboard players add #pow qa_protect 1"} replace`);
    await cmd(`setblock ${cx} 62 -2 minecraft:redstone_block replace`); await sleep(500);
    const pow = await score('#pow'); assert.equal(pow, 1, 'powered impulse runs once when powered');
    const restoresBefore = await restores();
    await post('lavafloor'); await idle(); await sleep(300);
    await assertTrio('lavafloor', pos, before);
    assert.ok(await isBlock(cx, 63, -2, 'minecraft:command_block[facing=up]'), 'powered impulse stays');
    assert.equal(await score('#pow'), 1, 'powered impulse must not run again after restore');
    assert.ok(await isBlock(cx + 1, 63, 1, 'minecraft:magma_block'), 'the rest of the floor still becomes magma');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 4, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', '信号の元もいっしょに置き換えられても、次の合図でインパルス型が動く（レビュー M3）', async () => {
    const cx = -3901; await prepare(cx);
    // 床（y=63）に、常時実行でないインパルス型と、その横の赤石ブロック（信号の元）を並べる。lavafloor は両方を置き換える。
    await cmd(`setblock ${cx + 1} 63 0 minecraft:command_block[facing=up]{Command:"scoreboard players add #src qa_protect 1"} replace`);
    const start = await score('#src');
    await cmd(`setblock ${cx + 2} 63 0 minecraft:redstone_block replace`); await sleep(500);
    assert.equal(await score('#src'), start + 1, 'runs once when the source is placed');
    await post('lavafloor'); await idle(); await sleep(300);
    assert.ok(await isBlock(cx + 1, 63, 0, 'minecraft:command_block[facing=up]'), 'impulse stays');
    assert.ok(await isBlock(cx + 2, 63, 0, 'minecraft:magma_block'), 'the source was replaced');
    assert.equal(await score('#src'), start + 1, 'restore does not run it');
    // MAP が次の合図を出す（赤石ブロックを置き直す）。powered が古いまま true だと、この合図を取りこぼす。
    await cmd(`setblock ${cx + 2} 63 0 minecraft:redstone_block replace`); await sleep(500);
    assert.equal(await score('#src'), start + 2, 'the next signal runs it again');
    return { runs: (await score('#src')) - start };
  });

  await test('bridge', 'husk_watertower: setblock の水で置き換えても残り、ハスクは出る', async () => {
    const cx = -3101; await prepare(cx);
    const pos = { chain: [cx, 74, 0] };
    const before = await placeTrio('husk', pos);
    const restoresBefore = await restores();
    await post('husk_watertower'); await idle(); await sleep(300);
    await assertTrio('husk', pos, before);
    assert.match(await cmd(`execute positioned ${cx} 74 0 if entity @e[type=minecraft:husk,distance=..30]`), /Test passed/, 'husks still spawn');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 1, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', '/bridge/exec の絶対座標の fill で置き換えても残り、ほかの床は変わる', async () => {
    const cx = -3201; await prepare(cx);
    const pos = { impulse: [cx + 2, 63, 0], repeating: [cx - 2, 63, 0], chain: [cx, 63, 2] };
    const before = await placeTrio('exec', pos);
    const restoresBefore = await restores();
    await exec([`fill ${cx - 3} 63 -3 ${cx + 3} 63 3 minecraft:glass`]); await idle(); await sleep(300);
    await assertTrio('exec', pos, before);
    assert.ok(await isBlock(cx + 1, 63, 1, 'minecraft:glass'), 'the rest of the floor becomes glass');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', '同じ種類のコマンドブロックで上書きされても、元のコマンドに戻る（Review Focus 1）', async () => {
    const cx = -3301; await prepare(cx);
    const pos = { impulse: [cx + 2, 63, 0], repeating: [cx - 2, 63, 0] };
    const before = await placeTrio('same', pos);
    const restoresBefore = await restores();
    // 同じ種類・同じ向きで中身が空のものへの置き換え（destroy モード。replace モードは同じ状態なら何もしない）と、別の保護ブロックへの置き換え。
    await exec([`setblock ${cx + 2} 63 0 minecraft:command_block[facing=up] destroy`, `setblock ${cx - 2} 63 0 minecraft:command_block[facing=up] replace`]);
    await idle(); await sleep(300);
    await assertTrio('same', pos, before);
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 2, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', 'プレイヤーから遠い forceload のチャンクでも戻る（Review Focus 2）', async () => {
    const cx = -3401; await prepare(cx);
    const far = cx - 1000;   // 描画距離（6チャンク）の外で、ほかのテストの場所とも重ならない
    await cmd(`forceload add ${far} 0`); await sleep(1500);
    // 同じワールドで流し直したときに前回のコマンドブロックが残っていると、同じ状態の setblock は何もしないので片付ける。
    await cmd(`fill ${far - 3} 63 -3 ${far + 3} 63 3 minecraft:stone`);
    const pos = { impulse: [far + 2, 63, 0], repeating: [far - 2, 63, 0], chain: [far, 63, 2] };
    const before = await placeTrio('far', pos);
    const restoresBefore = await restores();
    await exec([`fill ${far - 3} 63 -3 ${far + 3} 63 3 minecraft:glass`]); await idle(); await sleep(300);
    await assertTrio('far', pos, before);
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    await cmd(`forceload remove ${far} 0`);
    return { restored };
  });

  fs.writeFileSync(path.join(root, 'protected-blocks-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`protected blocks: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
