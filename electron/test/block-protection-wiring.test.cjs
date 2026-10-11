// 保護ブロックの戻し方と、BridgeMOD・SaikutuMOD への組み込みを、ソースで確かめる（Minecraft なしでは動かせない部分）。
// 保護する ID の一覧そのものは scripts/test-bridge-contracts.cjs の契約テストで確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const protection = () => read('BridgeMod/src/main/java/jp/douma/bridgemod/api/BlockProtection.java');

test('保護ブロックは loadStatic で戻し、常時実行のインパルス型を再実行させない', () => {
  const source = protection();
  const restore = source.slice(source.indexOf('private static int restore('));
  assert.match(restore, /BlockEntity\.loadStatic\(k\.pos, k\.state, nbt\)/);
  assert.doesNotMatch(source, /\.load\(nbt\)/, 'level のある BlockEntity に load すると実行が予約される');
  // 通知なしで置く → BlockEntity を置く → 周りへ通知、の順。
  const place = restore.indexOf('Block.UPDATE_CLIENTS');
  const entity = restore.indexOf('setBlockEntity(');
  const notify = restore.indexOf('blockUpdated(');
  assert.ok(place > 0 && entity > place && notify > entity, '置く → BlockEntity → 通知 の順にする');
});

test('runProtected は処理が例外を投げても戻し、入れ子では控え直さない', () => {
  const source = protection();
  const run = source.slice(source.indexOf('public static int runProtected('), source.indexOf('private static List<Kept> capture('));
  assert.match(run, /if \(depth > 0 \|\| server == null\) \{ action\.run\(\); return 0; \}/);
  assert.match(run, /try \{\s*action\.run\(\);\s*\} finally \{\s*depth--;\s*restored = restore\(kept, label\);\s*\}/);
});

test('控える範囲は、プレイヤーの描画距離・強制読み込み・スポーンチャンクで、読み込みを起こさない', () => {
  const source = protection();
  const capture = source.slice(source.indexOf('private static List<Kept> capture('), source.indexOf('private static int restore('));
  assert.match(capture, /getPlayerList\(\)\.getViewDistance\(\)/);
  assert.match(capture, /getForcedChunks\(\)/);
  assert.match(capture, /getSharedSpawnPos\(\)/);
  assert.match(capture, /getChunkNow\(/);
  assert.doesNotMatch(capture, /getChunk\(/, '読み込まれていないチャンクを読み込まない');
});
