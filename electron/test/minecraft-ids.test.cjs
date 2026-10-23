// 音・粒子の ID の決まりは bridge/minecraft_ids.cjs の1か所。受け取る側の DisplayMOD（DisplayRequest.resource）と同じ
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10。処理のコピー PR7）。
// 例の一覧 bridge/test/fixtures/minecraft-ids.json は、scripts/test-bridge-contracts.cjs が DisplayMOD にも通す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isResourceId } = require('../../bridge/minecraft_ids.cjs');
const { commentExtras } = require('../../bridge/event_rules.cjs');

const fixture = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../bridge/test/fixtures', name), 'utf8'));

test('音・粒子の ID: 例の一覧（DisplayMOD の契約テストも同じものを読む）', () => {
  for (const c of fixture('minecraft-ids.json')) assert.equal(isResourceId(c.id), c.ok, JSON.stringify(c.id));
  assert.deepEqual([isResourceId(null), isResourceId(3)], [false, false]);
});

test('コメントギフトは同じ決まりで確かめ、正しくなければ今どおり既定の音・粒子にする', () => {
  assert.equal(commentExtras({ sound: 'block.note_block.bell' })[0], 'playsound block.note_block.bell master @a ~ ~ ~ 1 1');
  assert.match(commentExtras({ particle: 'minecraft:flame' })[0], / particle minecraft:flame /);
  assert.match(commentExtras({ particle: 'minecraft:block/stone' })[0], / particle minecraft:block\/stone /, '/ のある path は DisplayMOD と同じく通す');
  assert.equal(commentExtras({ sound: 'a:b:c' })[0], 'playsound entity.experience_orb.pickup master @a ~ ~ ~ 1 1', '正しくない ID は既定の音');
});
