const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const { planTestEvent } = require('../event_tests.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('「個別最大コマンド数」はBridgeMOD経由のギフト・いいねにも効き、ゲームMODの要求には掛けない', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n', cod: '# TITLE: cod\nsay cod\n',
      tower: '# TITLE: tower\n# GAME_MOD: gameprobe\nsay game\n' },
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 20 }, { giftId: '2', name: '塔', commandFile: 'tower.txt', repeat: 20 }],
      likeEvents: [{ enabled: true, threshold: 10, commandFile: 'cod.txt', repeat: 1 }],
      options: { maxCommandsPerGift: 5 },
    },
  });
  const gift = giftId => bridge.emit('WebcastGiftMessage', { giftId, gift: { name: 'g' + giftId }, repeatCount: 1, repeatEnd: 1 });
  await gift('1');
  await bridge.until(() => bridge.requests.some(x => x.key === 'zombie'), 'capped gift');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'zombie').map(x => x.count), [5], '20回の割り当ても5回まで');
  // 配信の途中から大量のいいねが届いても、1回分は上限まで（以前は滞留した分がそのまま積まれた）。
  await bridge.emit('WebcastLikeMessage', { count: 300, total: '300' });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'capped likes');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.filter(x => x.key === 'cod').map(x => x.count), [5]);
  // ゲームMODは count の意味をゲーム側が決める約束なので、そのまま1件で渡す。
  await gift('2');
  await bridge.until(() => bridge.requests.some(x => x.key === 'tower'), 'game request');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'tower').map(x => x.count), [20]);
  assert.ok(bridge.logs.some(x => x.includes('個別最大コマンド数（5）') && x.includes('zombie.txt') && x.includes('20 -> 5')));
});

test('テスト発火も同じ上限で回数を減らし、理由を表示する', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'zombie.txt'), 'say test\n');
  fs.writeFileSync(path.join(dir, 'tower.txt'), '# GAME_MOD: gameprobe\nsay game\n');
  const options = { maxCommandsPerGift: 5 };
  const plain = planTestEvent({ options }, { type: 'gift', commandFile: 'zombie.txt', count: 30 }, dir);
  assert.equal(plain.steps[0].count, 5);
  assert.ok(plain.notes.some(note => note.includes('個別最大コマンド数（5）')));
  const game = planTestEvent({ options }, { type: 'gift', commandFile: 'tower.txt', count: 30 }, dir);
  assert.equal(game.steps[0].count, 30);
});
