// 「個別最大コマンド数」は、Minecraft（BridgeMOD 経路）では掛けない。RCON・Telnet で送るゲームにだけ掛ける（2026-10-11 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const { planTestEvent } = require('../event_tests.cjs');
const { isBridgeModTransport } = require('../../bridge/event_rules.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('BridgeMOD 経路の判定は、bridge/index.js と同じ名前の並びを受け付ける', () => {
  for (const name of ['bridge_mod', 'BRIDGE_MOD', ' douma_mod ', 'doumamod', 'bridgemod', 'mod', 'http']) assert.equal(isBridgeModTransport(name), true, name);
  for (const name of ['rcon', 'telnet', '', undefined, null]) assert.equal(isBridgeModTransport(name), false, String(name));
});

test('「個別最大コマンド数」は BridgeMOD 経由のギフトに掛けない（送られた数どおり）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n', tower: '# TITLE: tower\n# GAME_MOD: gameprobe\nsay game\n' },
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 20 }, { giftId: '2', name: '塔', commandFile: 'tower.txt', repeat: 20 }],
      options: { maxCommandsPerGift: 5 },
    },
  });
  const gift = giftId => bridge.emit('WebcastGiftMessage', { giftId, gift: { name: 'g' + giftId }, repeatCount: 1, repeatEnd: 1 });
  await gift('1');
  await bridge.until(() => bridge.requests.some(x => x.key === 'zombie'), 'gift');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'zombie').map(x => x.count), [20], '20回の割り当ては20回のまま');
  await gift('2');
  await bridge.until(() => bridge.requests.some(x => x.key === 'tower'), 'game request');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'tower').map(x => x.count), [20]);
  assert.ok(!bridge.logs.some(x => x.includes('個別最大コマンド数')), '回数を減らしたログを出さない');
});

test('テスト発火も、BridgeMOD 経由なら回数を抑えず、RCON・Telnet なら抑える', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'zombie.txt'), 'say test\n');
  fs.writeFileSync(path.join(dir, 'tower.txt'), '# GAME_MOD: gameprobe\nsay game\n');
  const mod = planTestEvent({ options: { commandTransport: 'bridge_mod', maxCommandsPerGift: 5 } }, { type: 'gift', commandFile: 'zombie.txt', count: 30 }, dir);
  assert.equal(mod.steps[0].count, 30);
  assert.ok(!mod.notes.some(note => note.includes('個別最大コマンド数')));
  const rcon = planTestEvent({ options: { commandTransport: 'rcon', maxCommandsPerGift: 5 } }, { type: 'gift', commandFile: 'zombie.txt', count: 30 }, dir);
  assert.equal(rcon.steps[0].count, 5);
  assert.ok(rcon.notes.some(note => note.includes('個別最大コマンド数（5）')));
  const game = planTestEvent({ options: { commandTransport: 'rcon', maxCommandsPerGift: 5 } }, { type: 'gift', commandFile: 'tower.txt', count: 30 }, dir);
  assert.equal(game.steps[0].count, 30, 'ゲームMODのコマンドは count の意味をゲームが決めるので抑えない');
});

test('運用センターの「個別最大コマンド数」に、Minecraft では使わないことを書く', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../src/components/OperationsPage.tsx'), 'utf8');
  assert.match(page, /Minecraft（BridgeMOD）では使いません。RCON・Telnet で送るゲームの、1回あたりのコマンド数の上限です。/);
});
