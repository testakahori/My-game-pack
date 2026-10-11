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
  // loadStatic は NBT の id で種類を決める。id のない saveWithoutMetadata だと null が返り、中身が空のまま残る（2026-10-11 の実機テストで発覚）。
  assert.match(restore, /CompoundTag nbt = k\.entity\.saveWithId\(\);/);
  assert.doesNotMatch(source, /saveWithoutMetadata\(\)/, 'id のない NBT は loadStatic で読めない');
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
  // チケットは周り2チャンクまで読み込むので、fill が届く。強制読み込み・プレイヤー・スポーンのどれも2チャンク広げる（2026-10-11 の実機テストで発覚）。
  assert.match(source, /static final int LOADED_MARGIN = 2;/);
  assert.match(capture, /for \(long forced : level\.getForcedChunks\(\)\) addSquare\(chunks, new ChunkPos\(forced\), LOADED_MARGIN\);/);
  assert.match(capture, /addSquare\(chunks, player\.chunkPosition\(\), view \+ LOADED_MARGIN\)/);
  assert.match(capture, /SPAWN_CHUNK_RADIUS \+ LOADED_MARGIN\)/);
});

test('BridgeMOD は tick ごとのキュー処理（txt と /bridge/exec）を runProtected で包む', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java');
  const tick = source.slice(source.indexOf('public void onServerTick('), source.indexOf('private void processQueues()'));
  assert.match(tick, /if \(hasQueuedEvents\(\)\) BlockProtection\.runProtected\(activeServer, "bridgemod", this::processQueues\);/);
  assert.doesNotMatch(tick, /processQueue\(activeServer/, 'キューを包みの外で処理しない');
  const queues = source.slice(source.indexOf('private void processQueues()'));
  for (const name of ['giftQueue', 'otherQueue', 'likeQueue']) assert.match(queues.slice(0, 600), new RegExp('processQueue\\(activeServer, ' + name));
  assert.match(source, /",\\"protectedBlockRestores\\":" \+ BlockProtection\.restoredTotal\(\)/);
});

test('BridgeMOD の Java の書き換え（GiftEffects.set）は canModifyBlock を通す', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  const set = source.slice(source.indexOf('private void set(Origin o'), source.indexOf('private void summon(Origin o'));
  assert.match(set, /BlockProtection\.canModifyBlock\(o\.level, p\)/);
  assert.match(set, /o\.level\.getBlockEntity\(p\) == null/, '今の判定（BlockEntity がある位置は飛ばす）も残す');
});

test('BridgeMOD は 1.6.0（保護ブロック API を足した版）', () => {
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.6\.0$/m);
});
