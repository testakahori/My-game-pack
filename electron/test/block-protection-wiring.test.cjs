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

test('戻したあとの powered は今の信号に合わせる（信号の元も壊れたとき、次の合図を取りこぼさない）', () => {
  const restore = protection().slice(protection().indexOf('private static int restore('));
  assert.match(restore, /if \(entity instanceof CommandBlockEntity commandBlock\) commandBlock\.setPowered\(k\.level\.hasNeighborSignal\(k\.pos\)\);/);
  assert.ok(restore.indexOf('setPowered(') < restore.indexOf('setBlockEntity('), 'BlockEntity を置く前にそろえる（置いてからだと通知で実行が予約されうる）');
});

test('戻せたことを確かめてから数え、戻せなければ失敗としてログに出す', () => {
  const restore = protection().slice(protection().indexOf('private static int restore('));
  const check = restore.indexOf('if (entity == null || k.level.getBlockState(k.pos) != k.state || k.level.getBlockEntity(k.pos) != entity)');
  assert.ok(check > restore.indexOf('blockUpdated(') && check < restore.indexOf('restored++'), '置いて通知したあと、数える前に確かめる');
  assert.match(restore.slice(check, restore.indexOf('restored++')), /restore failed[\s\S]*continue;/);
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

test('BridgeMOD は 1.6.0 以上（保護ブロック API は 1.6.0 から）', () => {
  const [major, minor] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.\d+\r?$/m).slice(1).map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 6), `mod_version ${major}.${minor} must be >= 1.6`);
});

test('地形の効果は、岩盤を含む壊せないブロック（硬さが負：バリア・エンドポータルの枠など）を残す（2026-10-11 ユーザーの決定）', () => {
  for (const file of ['BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java', 'SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java']) {
    const source = read(file);
    const set = source.slice(source.indexOf('private void set(Origin o'), source.indexOf('private void summon(Origin o'));
    assert.match(set, /o\.level\.getBlockState\(p\)\.getDestroySpeed\(o\.level, p\) >= 0/, file);
    assert.doesNotMatch(set, /Blocks\.BEDROCK/, file + '：岩盤も硬さが負なので、同じ判定で残る');
  }
  // 壊せないブロックを残すのは BridgeMOD 1.7.1・SaikutuMOD 1.1.1 から。
  const version = file => read(file).match(/^mod_version=(\d+)\.(\d+)\.(\d+)\r?$/m).slice(1).map(Number);
  const atLeast = (v, min) => v[0] !== min[0] ? v[0] > min[0] : v[1] !== min[1] ? v[1] > min[1] : v[2] >= min[2];
  assert.ok(atLeast(version('BridgeMod/gradle.properties'), [1, 7, 1]), 'BridgeMOD 1.7.1 以上');
  const saikutu = version('SaikutuMod/gradle.properties');
  assert.ok(atLeast(saikutu, [1, 1, 1]), 'SaikutuMOD 1.1.1 以上');
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, `saikutumod-${saikutu.join('.')}.jar`);
});

test('SaikutuMOD は tick ごとのキュー処理（内蔵 txt）を runProtected で包み、set で canModifyBlock を通す', () => {
  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  const tick = mod.slice(mod.indexOf('public void tick(TickEvent.ServerTickEvent event)'), mod.indexOf('private int process('));
  assert.match(tick, /BlockProtection\.runProtected\(server, "saikutumod", this::processQueues\)/);
  assert.doesNotMatch(tick.slice(0, tick.indexOf('private void processQueues()')), /process\("gift"/, 'キューを包みの外で処理しない');
  assert.match(tick, /private void processQueues\(\) \{\s*wrapChunks = playerChunks\(\);\s*int budget = 52;\s*budget -= process\("gift", budget\); process\("other", budget\); process\("like", 8\);\s*\}/);
  // randomtp などでプレイヤーが別のチャンクへ移ったら、控えた範囲の外を掘りうるので、残りは次の tick（移った先で控え直す）に回す（PR #69 のレビュー I1）。
  const process = mod.slice(mod.indexOf('private int process('));
  assert.match(process, /while \(used < budget && !queue\.isEmpty\(\)\) \{\s*if \(playersMoved\(\)\) break;/);
  assert.match(mod, /private boolean playersMoved\(\) \{\s*return !playerChunks\(\)\.equals\(wrapChunks\);\s*\}/);
  assert.match(mod, /player\.level\(\)\.dimension\(\)\.location\(\) \+ ":" \+ player\.chunkPosition\(\)\.toLong\(\)/, 'ディメンションとチャンクで比べる');
  const effects = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java');
  const set = effects.slice(effects.indexOf('private void set(Origin o'), effects.indexOf('private void summon(Origin o'));
  assert.match(set, /BlockProtection\.canModifyBlock\(o\.level, p\)/);
});

test('SaikutuMOD 1.0.3 以上は BridgeMOD 1.6.0 以上を要求し、ゲームパックの jar 名もそろえる', () => {
  const [minor, patch] = read('SaikutuMod/gradle.properties').match(/^mod_version=1\.(\d+)\.(\d+)\r?$/m).slice(1).map(Number);
  assert.ok(minor > 0 || patch >= 3, 'SaikutuMOD 1.0.3 以上');
  const toml = read('SaikutuMod/src/main/resources/META-INF/mods.toml');
  assert.match(toml, /\[\[dependencies\.saikutumod\]\]\s*modId="bridgemod"\s*mandatory=true\s*versionRange="\[1\.6\.0,\)"/);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, pack.clientJar);
  assert.match(pack.serverJar, /^saikutumod-\d+\.\d+\.\d+\.jar$/);
});
