// ギフト割り当ての「使う形」は bridge/gift_mappings.cjs の1か所（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10。処理のコピー PR5）。
// BRIDGE の起動と再読込、ギフトのテンプレートが使う。
const test = require('node:test');
const assert = require('node:assert/strict');
const { giftMappingOf, giftMappingsById } = require('../../bridge/gift_mappings.cjs');

test('ギフト割り当ての使う形: giftId・名前・コマンドを整え、回数を 1〜100 に収め、enabled:false だけを無効にする', () => {
  assert.deepEqual(giftMappingOf({ giftId: ' 5655 ', name: ' ', commandFile: ' zombie ', repeat: 500, enabled: false }), { giftId: '5655', name: 'gift:5655', commandFile: 'zombie.txt', repeat: 100, enabled: false });
  assert.deepEqual(giftMappingOf({ giftId: 7, name: 'バラ', commandFile: 'TNT.TXT' }), { giftId: '7', name: 'バラ', commandFile: 'TNT.TXT', repeat: 1, enabled: true });
  assert.deepEqual([giftMappingOf({ giftId: '  ' }), giftMappingOf(null)], [null, null]);
  const byId = giftMappingsById([{ giftId: '1', commandFile: 'a.txt' }, null, { giftId: '1 ', commandFile: 'b.txt' }]);
  assert.deepEqual([...byId.keys()], ['1']);
  assert.equal(byId.get('1').commandFile, 'b.txt', '同じ giftId は後のもの');
  assert.equal(giftMappingsById(undefined).size, 0);
});
