const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

// 表示名は整えた形（' → ’ など）になる。設定に生の名前を書いても、整えた名前を書いても、ミュートが効くこと。
test('ミュート: 生の名前（it\'s me）と整えた表示名（it’s me）のどちらで設定しても本番の受信で効く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n' },
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }],
      options: { mutedUsers: ["it's me", 'quote’d'] },
    },
  });
  const gift = user => bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: 1, repeatEnd: 1, user });
  await gift({ id: '201', displayId: 'muted1', nickname: "it's me" }); // 設定も名前も生
  await gift({ id: '202', displayId: 'muted2', nickname: "It's Me" }); // 大文字小文字だけ違う
  await gift({ id: '203', displayId: 'muted3', nickname: "quote'd" }); // 設定は整えた形、名前は生
  await gift({ id: '204', displayId: 'free', nickname: "free'viewer" });
  await bridge.until(() => bridge.requests.length >= 1, 'unmuted gift');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.listenerName), ['free’viewer']);
  assert.equal(bridge.logs.filter(x => x.includes('[Safety] muted user event ignored')).length, 3);
});
