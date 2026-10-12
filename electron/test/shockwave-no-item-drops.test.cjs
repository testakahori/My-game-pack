// TNT大爆発の衝撃波でえぐっている間に出たアイテム（支えを失った花・たいまつなど）は出さない（2026-10-12 ユーザーの決定「落ちるアイテムも消す」）。
// 実機では BridgeMod/test/no-limits.cjs の「支えを失った花・たいまつはアイテムにならない」で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('えぐる1ブロックの間だけ印を立て、その間に出たアイテムは出さない', () => {
  const effects = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java');
  const carve = effects.slice(effects.indexOf('private boolean carve('), effects.indexOf('private Set<UUID> presentAt('));
  assert.match(carve, /carving = true;\s*try \{ set\(o, at, Blocks\.AIR\.defaultBlockState\(\)\); \} finally \{ carving = false; \}/,
    'set の中で起きる、隣のブロックの壊れ（花・たいまつ）のアイテムだけを対象にする');
  assert.match(effects, /private static boolean carving;/);
  assert.match(effects, /static boolean carving\(\) \{ return carving; \}/);

  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  // チャンクの読み込みで戻ってくるアイテム（前から落ちていた物）は消さない。新しく出たアイテムだけ。
  assert.match(mod, /@SubscribeEvent public void noDropsWhileCarving\(EntityJoinLevelEvent event\) \{\s*if \(SaikutuEffects\.carving\(\) && !event\.loadedFromDisk\(\) && event\.getEntity\(\) instanceof ItemEntity\) event\.setCanceled\(true\);\s*\}/);
});

test('SaikutuMOD は 1.1.3、採掘パックも 1.1.3 を使う', () => {
  assert.match(read('SaikutuMod/gradle.properties'), /^mod_version=1\.1\.3\r?$/m);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, 'saikutumod-1.1.3.jar');
  assert.equal(pack.clientJar, 'saikutumod-1.1.3.jar');
});
