// bridge-fixture-cleanup.test.cjs が別のプロセスで動かす。ルーレットの演出の途中でテストを終えても、試験台の片付けのあとにプロセスが終わるかを見る。
const test = require('node:test');
const { startBridgeFixture } = require('./bridge-fixture.cjs');

test('ルーレットの演出の途中で終える', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'roulette.txt', repeat: 1 }],
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] } } });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => Array.isArray(x.commands)), 'first roulette frame');
});

// 要求が届く途中で終える。片付けのあとに届いた返事で、ルーレットの演出・送り直しが新しいタイマーを作っても、プロセスは終わる。
test('ギフトを送った直後に終える', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'roulette.txt', repeat: 1 }],
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] } } });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ' }, repeatCount: 1, repeatEnd: 1 });
});
