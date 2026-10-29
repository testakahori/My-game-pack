const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Disposable server required');
const props = fs.readFileSync(path.join(root, 'server.properties'), 'utf8');
for (const item of ['server-ip=127.0.0.1', 'server-port=25587', 'rcon.port=25588']) if (!props.includes(item)) throw Error('QA ports required');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(fn, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(100); } throw Error('Timed out'); }
let bot, rcon;
const result = { checks: [] };
const pass = msg => { result.checks.push(msg); console.log('PASS ' + msg); };
(async () => {
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props.match(/^rcon.password=(.*)$/m)[1].trim(), timeout: 30000 });
  const cmd = command => rcon.send(command);
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'EnvTester', auth: 'offline', version: '1.20.1', viewDistance: 'tiny' });
  bot.on('error', error => console.log('BOT: ' + error.message));
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); });
  await cmd('gamemode creative EnvTester');
  await sleep(500);
  const rules = JSON.parse(await cmd('environmentprobe rules'));
  assert.equal(rules.sendCommandFeedback, false); assert.equal(rules.commandBlockOutput, false);
  assert.equal(rules.doMobSpawning, true); assert.equal(rules.keepInventory, true);
  assert.equal(rules.dayTime, 1000); assert.equal(rules.raining, false);
  pass('固定ルール: 実行通知OFF・コマンドブロック出力OFF・動物の自然発生は有効');
  for (const [rule, fixed] of [['sendCommandFeedback', false], ['commandBlockOutput', false], ['doMobSpawning', true]]) {
    await cmd('gamerule ' + rule + ' ' + !fixed); await sleep(200);
    assert.equal(JSON.parse(await cmd('environmentprobe rules'))[rule], fixed);
  }
  pass('設定を変更しても、出力OFF・動物の自然発生ONへ戻る');
  for (const dimension of ['minecraft:overworld', 'minecraft:the_nether']) {
    await cmd('execute in ' + dimension + ' run forceload add 0 0');
    await wait(async () => /passed/.test(await cmd('execute in ' + dimension + ' if loaded 0 90 0')));
  }
  await sleep(500); // Entity sections become visible after the chunk finishes loading.
  assert.match(await cmd('environmentprobe spawns'), /spawn-probe-written/);
  const matrix = JSON.parse(fs.readFileSync(path.join(root, 'fixed-spawn-probe.json'), 'utf8'));
  const hostile = new Set(['zombie', 'skeleton', 'creeper', 'slime', 'magma_cube', 'phantom', 'pillager', 'ghast']);
  const natural = new Set(['NATURAL', 'CHUNK_GENERATION', 'PATROL', 'REINFORCEMENT']);
  let checked = 0;
  for (const dimension of ['minecraft:overworld', 'minecraft:the_nether']) {
    assert.equal(Object.keys(matrix[dimension]).length, 88);
    for (const [key, actual] of Object.entries(matrix[dimension])) {
      const [id, reason] = key.split('/'); const blocked = hostile.has(id.split(':')[1]) && natural.has(reason);
      assert.equal(actual.placementDenied, blocked, dimension + ' placement ' + key);
      assert.equal(actual.spawned, !blocked, dimension + ' spawn ' + key); checked++;
    }
  }
  assert.equal(matrix.siegeCanceled, true);
  result.spawnMatrix = matrix;
  pass(checked + '条件: 敵の自然発生・巡回・増援を停止、牛・羊・魚と明示的な召喚は維持');
  pass('村への自動ゾンビ襲撃を停止');
  await cmd('summon zombie 0 91 0 {NoAI:1b,PersistenceRequired:1b,Tags:["qa_existing"]}');
  await sleep(400);
  assert.match(await cmd('execute if entity @e[tag=qa_existing]'), /passed/);
  pass('手動で召喚した敵を後から削除しない');
  const post = async key => {
    const response = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'gift', key, count: 1, requestId: 'environment-' + key, listenerName: 'SpawnTestGifter', announce: true }) });
    assert.equal(response.status, 202); await response.text();
  };
  await post('zombie');
  await wait(async () => /SpawnTestGifter/.test(await cmd('execute as @e[type=minecraft:zombie] run data get entity @s CustomName')));
  await post('cod');
  await wait(async () => /SpawnTestGifter/.test(await cmd('execute as @e[type=minecraft:cod] run data get entity @s CustomName')));
  pass('ギフト経路で名前付きゾンビとタラを召喚できる');
  const status = await (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
  assert.equal(status.failed, 0, status.lastError); result.status = status; result.ok = true;
})().catch(error => { result.error = error.stack; console.error(error); process.exitCode = 1; })
  .finally(() => { fs.writeFileSync(path.join(root, 'fixed-environment-results.json'), JSON.stringify(result, null, 2)); bot?.quit(); rcon?.end(); });
