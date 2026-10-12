// 地形を書き換えている間に出たアイテム（支えを失った花・たいまつなど）は出さない（2026-10-12 ユーザーの決定）。
// 対象：TNT大爆発の衝撃波（「落ちるアイテムも消す」）、天変地異の穴と地割れ（「天変地異も消す」）、氷河期の地面の氷（「氷河期も消す」）。
// 実機では BridgeMod/test/no-limits.cjs の「…アイテムにならない」で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const effects = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java');
const between = (from, to) => effects.slice(effects.indexOf(from), effects.indexOf(to));

test('setNoDrops は1ブロック書き換える間だけ印を立てる（印は元に戻す）', () => {
  assert.match(effects, /private void setNoDrops\(Origin o, BlockPos p, BlockState state\) \{\s*boolean was = noDrops;\s*noDrops = true;\s*try \{ set\(o, p, state\); \} finally \{ noDrops = was; \}\s*\}/);
  assert.match(effects, /private static boolean noDrops;/);
  assert.match(effects, /static boolean noDrops\(\) \{ return noDrops; \}/);
});

test('衝撃波・天変地異の穴と地割れ・氷河期の地面は setNoDrops で書き換える', () => {
  const carve = between('private boolean carve(', 'private Set<UUID> presentAt(');
  assert.match(carve, /BlockPos at = p\.immutable\(\);\s*(?:\/\/[^\n]*\s*)*setNoDrops\(o, at, Blocks\.AIR\.defaultBlockState\(\)\);/);
  const crater = between('private Job earthquakeCrater(', 'private void cataclysm(');
  assert.match(crater, /setNoDrops\(o, new BlockPos\(centreX \+ dx, y, centreZ \+ dz\), Blocks\.AIR\.defaultBlockState\(\)\);/);
  const fissures = between('private void cataclysm(', 'UUID targetId = target.getUUID();');
  assert.match(fissures, /setNoDrops\(o, new BlockPos\(x \+ dx, y, z \+ dz\), Blocks\.AIR\.defaultBlockState\(\)\);/);
  const ice = between('private Job iceage(', 'private void fallingIce(');
  assert.match(ice, /setNoDrops\(o, ground, Blocks\.PACKED_ICE\.defaultBlockState\(\)\);/);
  assert.match(ice, /setNoDrops\(o, snow, Blocks\.SNOW\.defaultBlockState\(\)\);/);
  // この4か所には、印を立てない set が残っていない。
  for (const [name, body] of Object.entries({ carve, crater, fissures, ice })) assert.doesNotMatch(body, /\bset\(o, /, name);
});

test('SaikutuMod は、印が立っている間に新しく出たアイテムをサーバーの世界で出さない', () => {
  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  // サーバーの世界だけ（1人プレイではクライアントにも同じイベントが来る。PR #87 レビュー）。
  // チャンクの読み込みで戻ってくるアイテム（前から落ちていた物）は消さない。新しく出たアイテムだけ。
  assert.match(mod, /@SubscribeEvent public void noDropsWhileReshaping\(EntityJoinLevelEvent event\) \{\s*if \(SaikutuEffects\.noDrops\(\) && !event\.getLevel\(\)\.isClientSide\(\) && !event\.loadedFromDisk\(\) && event\.getEntity\(\) instanceof ItemEntity\) event\.setCanceled\(true\);\s*\}/);
});

test('SaikutuMOD は 1.1.4 以上、採掘パックも同じ版の jar を使う', () => {
  const version = read('SaikutuMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)\r?$/m);
  assert.ok(version, 'mod_version must be major.minor.patch');
  const [major, minor, patch] = version.slice(1).map(Number);
  assert.ok(major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 4))), `mod_version ${major}.${minor}.${patch} must be >= 1.1.4`);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, `saikutumod-${major}.${minor}.${patch}.jar`);
  assert.equal(pack.clientJar, `saikutumod-${major}.${minor}.${patch}.jar`);
});
