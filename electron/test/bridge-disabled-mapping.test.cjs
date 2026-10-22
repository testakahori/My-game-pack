// 手で enabled: false にしたギフト割り当ては、そのコマンドを動かさず、未設定ギフトにも回さない。
// ゲームの数え方（上位者・コンボ・時限倍率）には今までどおり入れ、コマンドのないコンボの段は撃たない
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10、2026-10-22 ユーザーの決定。処理のコピー PR5）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

test('無効のギフト割り当て: そのコマンドも未設定ギフトも撃たず、コンボの回数には入る（コマンドのない段は撃たない）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say z\n', cod: 'say cod\n', boom: 'say boom\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1, enabled: false }, { giftId: '2', name: 'ハート', commandFile: 'cod.txt', repeat: 1 }],
      unmappedGiftEvent: { enabled: true, commandFile: 'cod.txt', repeat: 1 },
      options: { gameplay: { combo: { windowMs: 10000, levels: [{ count: 2, repeat: 1 }, { count: 3, commandFile: 'boom.txt', repeat: 1 }] } } } } });
  for (let i = 1; i <= 3; i++) await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: i, repeatEnd: i === 3 ? 1 : 0 });
  await bridge.emit('WebcastGiftMessage', { giftId: '2', gift: { name: 'ハート' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'enabled gift');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.key).sort(), ['boom', 'cod']);
});
