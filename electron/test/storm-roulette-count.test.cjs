// 嵐とルーレットも、送られた数だけ起こす（2026-10-11 ユーザーの決定）。
// 嵐は雷も雨も N 倍（形は scripts/test-bridge-contracts.cjs の StormPlanContractTest で確かめる）。ルーレットは N 回つづけて回す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const { rouletteSpins } = require('../../bridge/roulette.cjs');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('嵐は StormPlan で雷も雨も N 倍にし、雨は残りに足す', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  assert.match(source, /case "storm" -> storm\(o, level, count\);/);
  const storm = source.slice(source.indexOf('private void storm('), source.indexOf('private void clearWeather('));
  // 実際に雨が降っていないとき（バニラの /weather clear のあとなど）は、覚えている残りに足さず今から数える（見送った軽い点 2026-10-12）。
  // level.isRaining() は雨の強さ（0.2 超）で見るので降り始めは false。続けて来た嵐を足せるよう、降っているかの印で見る。
  assert.match(storm, /long end = StormPlan\.rainEnd\(now, level\.getLevelData\(\)\.isRaining\(\) \? weatherEnds\.get\(id\) : null, count\);/);
  assert.match(storm, /level\.setWeatherParameters\(0, StormPlan\.rainTicks\(now, end\), true, true\);/);
  assert.match(storm, /lightning\(o, StormPlan\.bolts\(count\)\);/);
  assert.doesNotMatch(source, /rain\(level, 180\)/, '1個ぶんの3分で上書きしない');
});

test('ルーレットを回す回数は、送られた回数（数でなければ1回）', () => {
  assert.equal(rouletteSpins(1), 1);
  assert.equal(rouletteSpins(3), 3);
  assert.equal(rouletteSpins('5'), 5);
  assert.equal(rouletteSpins(100000), 100000, '上限はない');
  for (const value of [0, -2, undefined, null, 'x', NaN]) assert.equal(rouletteSpins(value), 1, String(value));
  assert.equal(rouletteSpins(1.5), 2, '時限倍率の端数は四捨五入');
});

test('Bridge のルーレットは来た順にまとめて回し、当たりは回す直前にその時の設定で決める（2026-10-12 ユーザーの決定）', () => {
  // N 回分を先に全部決めると、大きな N で Bridge が止まり、途中で設定を変えても古い当たりが出る（PR #79 レビュー）。
  const source = read('bridge/index.js');
  const run = source.slice(source.indexOf('function runRoulette('), source.indexOf('function dispatchBridgeEvent('));
  assert.match(run, /rouletteRequests\.push\(\{ getConfig, triggerName, historyType, spins: rouletteSpins\(count\), done: 0 \}\);/);
  assert.match(run, /const rl = request\.getConfig\(\);/);
  assert.match(run, /if \(request\.done > 0\) console\.warn\(`\[Roulette\] ルーレットが無効になったため、残り\$\{request\.spins - request\.done\}回を取りやめました`\);/,
    '途中で無効にしたら残りは回さず、取りやめた回数をログに出す（PR #79 再レビュー）');
  assert.match(run, /round = prepareRoulette\(rl, commandsDirAbs\);/);
  assert.match(run, /request\.done\+\+;\s*if \(request\.done < request\.spins\) nextRouletteSpin\(\); else finish\(\);/, '同じ依頼を全部回してから次の依頼');
  assert.match(run, /Promise\.resolve\(\)\.then\(nextRouletteSpin\)/, '取りやめが続いても呼び出しを深く重ねない');
  assert.match(source, /runRoulette\(\(\) => rouletteCfg, event\.listenerName, event\.historyType \|\| "roulette", event\.count\)/);
  assert.match(source, /runRoulette\(\(\) => rl, String\(status\.player \|\| "player"\), "death_roulette"\)/, 'デスルーレットは1回');
});

test('同時に来た2人のルーレットは、来た順にまとめて回す（AAA BBB）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: '# TITLE: qa\nsay test\n', roulette: '# TITLE: roulette\n' },
    config: {
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] },
      mappings: [{ giftId: '7', name: 'ルーレット', commandFile: 'roulette.txt', repeat: 3 }],
    },
    respond: (payload, url) => url === '/bridge/exec' ? 429 : 202,
  });
  const gift = name => bridge.emit('WebcastGiftMessage', { giftId: '7', gift: { name: 'g7' }, repeatCount: 1, repeatEnd: 1, user: { uniqueId: name, nickname: name } });
  await gift('alice'); await gift('bob');
  await bridge.until(() => bridge.requests.filter(x => x.key === 'qa').length >= 6, '6 winners');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'qa').map(x => x.listenerName), ['alice', 'alice', 'alice', 'bob', 'bob', 'bob']);
});

test('テスト発火のルーレットは、演出を送れなかった印を回ごとに消す（PR #79 レビュー）', () => {
  const main = read('electron/main.cjs');
  const loop = main.slice(main.indexOf('for (let spin = 1; spin <= spins; spin++) {'), main.indexOf('outcomes.push({ key: winner.commandFile'));
  assert.match(loop, /animationError = null;/);
});

test('嵐の txt の説明は N 倍に合わせる', () => {
  assert.match(read('bridge/commands/minecraft/storm.txt'), /^\/\/ 1個で雷20連発・雨3分の暴風雨。N 個なら雷も雨も N 倍/m);
});

test('ギフトでルーレットが3回分送られたら、3回回して当選を3回送る', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: '# TITLE: qa\nsay test\n', roulette: '# TITLE: roulette\n' },
    config: {
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 2 }] },
      mappings: [{ giftId: '7', name: 'ルーレット', commandFile: 'roulette.txt', repeat: 3 }],
    },
    // 演出（/bridge/exec）は断り、すぐ当選へ進ませる（演出を送れなくても当選は送る作り）。
    respond: (payload, url) => url === '/bridge/exec' ? 429 : 202,
  });
  await bridge.emit('WebcastGiftMessage', { giftId: '7', gift: { name: 'g7' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.filter(x => x.key === 'qa').length >= 3, '3 winners');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.deepEqual(bridge.requests.filter(x => x.key === 'qa').map(x => x.count), [2, 2, 2], '1回ごとに当選の回数（2）');
});
