# 保護ブロック（コマンドブロック3種）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** BridgeMOD と SaikutuMOD の妨害処理が、`command_block`・`chain_command_block`・`repeating_command_block` を壊したり置き換えたりしないようにし、その判定を公開 API としてゲーム MOD にも提供する。

**Architecture:** BridgeMOD に `jp.douma.bridgemod.api.ProtectedBlockIds`（Minecraft に依存しない ID の一覧）と `BlockProtection`（判定と、コマンド実行の前後で控えて戻す `runProtected`）を足す。BridgeMOD と SaikutuMOD は、tick ごとのキュー処理を `runProtected` で包み、Java の `set()` で `canModifyBlock` を呼ぶ。戻すときは `BlockEntity.loadStatic` を使い、常時実行のインパルス型を再実行させない。

**Tech Stack:** Java 17・Minecraft 1.20.1・Forge 47.x（公式マッピング）・ForgeGradle 6、Node.js 24（`node:test`）、mineflayer・rcon-client（実機テスト）。

**Spec:** `docs/superpowers/specs/2026-10-10-protected-blocks-design.md`

## Global Constraints

- 保護対象は `minecraft:command_block`・`minecraft:chain_command_block`・`minecraft:repeating_command_block` の3つだけ。設定で増やす機能は作らない。
- Mixin は使わない。ビルドの仕組み（Gradle のプラグイン）は変えない。
- BridgeMOD の版は `1.6.0`、SaikutuMOD は `1.0.3`。SaikutuMOD の `mods.toml` の bridgemod は `versionRange="[1.6.0,)"`。
- 手元の MOD のビルドは `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`（プロキシの証明書の問題のため）。DisplayMod・SaikutuMod は `..\BridgeMod\gradlew.bat` を使う。
- D 側の作業コピー（`D:\Dev02\game_dev\MyGamePack02\My-game-pack-review`）で `git stash` を使わない。並行作業は git worktree。PR の前に必ずブランチを切る。
- PR は2つに分ける。PR1 = BridgeMOD（Task 1〜5）、PR2 = SaikutuMOD（Task 6〜7）。PR2 は PR1 のマージ後に main から切る。
- マージはユーザーの許可を得てから行う。
- ログの文言：`[BlockProtection] restored <ブロックID> at <x>,<y>,<z> in <ディメンション> (<label>)`。状態の項目名：`protectedBlockRestores`。
- `runProtected` の label は、BridgeMOD が `"bridgemod"`、SaikutuMOD が `"saikutumod"`。

## Review Focus

テストの手順では直接ふれないが、使う人が出会いやすい入力・状態。各行の確認は、担当の Task にテストとして入れてある。

1. 同じ種類・同じ向きのコマンドブロックで上書きされ、中身（コマンド）が空になる（`setblock … command_block destroy` など。replace モードは同じ状態なら何もしない）。ブロックの状態が同じでも、元のコマンドに戻るべき。→ Task 4 の「同じ種類での上書き」。
2. プレイヤーから遠い、強制読み込みのチャンクにあるコマンドブロックを、絶対座標の `/bridge/exec` が置き換える。戻るべき。→ Task 4 の「forceload の遠いチャンク」。
3. レッドストーンで動かしている（常時実行でない）インパルス型が置き換えられて戻ったとき、もう一度実行されてはいけない。→ Task 4 の lavafloor の `#pow`。
4. 包んだ処理の中で例外が出ても、戻す処理は行われ、例外はそのまま呼び出し元へ届くべき。→ Task 2 のソースのテスト。
5. `runProtected` の中でさらに `runProtected` が呼ばれても、控え直したり二重に戻したりしない。→ Task 2 のソースのテスト。

---

## PR1：BridgeMOD 1.6.0（ブランチ `feat/bridgemod-protected-blocks`）

始める前に（D 側）：

```powershell
cd D:\Dev02\game_dev\MyGamePack02\My-game-pack-review
git status --short --branch   # 変更がないこと
git switch main; git pull --ff-only origin main
git switch -c feat/bridgemod-protected-blocks
```

### Task 1: 保護対象の ID の一覧と契約テスト

**Files:**
- Create: `BridgeMod/src/main/java/jp/douma/bridgemod/api/ProtectedBlockIds.java`
- Create: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/ProtectedBlockIdsContractTest.java`
- Modify: `scripts/test-bridge-contracts.cjs:17-27`（コンパイルと実行の一覧に足す）

**Interfaces:**
- Produces: `public final class jp.douma.bridgemod.api.ProtectedBlockIds`。`public static final List<String> IDS`、`public static boolean isProtectedId(String id)`。

- [ ] **Step 1: 失敗するテストを書く**

`BridgeMod/src/contractTest/java/jp/douma/bridgemod/ProtectedBlockIdsContractTest.java`：

```java
package jp.douma.bridgemod;

import jp.douma.bridgemod.api.ProtectedBlockIds;

// 保護するブロックが、コマンドブロック3種だけであることを Minecraft なしで確かめる。
public final class ProtectedBlockIdsContractTest {
    private static int checks;

    public static void main(String[] args) {
        same(true, ProtectedBlockIds.isProtectedId("minecraft:command_block"), "impulse");
        same(true, ProtectedBlockIds.isProtectedId("minecraft:chain_command_block"), "chain");
        same(true, ProtectedBlockIds.isProtectedId("minecraft:repeating_command_block"), "repeating");
        same(3, ProtectedBlockIds.IDS.size(), "exactly three ids");
        // 似たブロック・名前空間なし・大文字・空・null は守らない。
        same(false, ProtectedBlockIds.isProtectedId("minecraft:structure_block"), "structure block");
        same(false, ProtectedBlockIds.isProtectedId("minecraft:stone"), "stone");
        same(false, ProtectedBlockIds.isProtectedId("command_block"), "no namespace");
        same(false, ProtectedBlockIds.isProtectedId("minecraft:Command_Block"), "case sensitive");
        same(false, ProtectedBlockIds.isProtectedId(""), "empty");
        same(false, ProtectedBlockIds.isProtectedId(null), "null");
        // 一覧は書き換えられない。
        boolean immutable;
        try { ProtectedBlockIds.IDS.add("minecraft:stone"); immutable = false; } catch (UnsupportedOperationException e) { immutable = true; }
        same(true, immutable, "ids are immutable");
        System.out.println("ProtectedBlockIds contract: " + checks + " checks passed");
    }

    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
```

`scripts/test-bridge-contracts.cjs` の javac の引数（17〜21行目）と実行（24〜27行目）を次のようにする：

```js
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', classes,
    ...['BridgeAuth', 'EffectLimits', 'ListenerNames', 'api/ProtectedBlockIds'].map(name => main + name + '.java'),
    ...['BridgeAuthContractTest', 'EffectLimitsContractTest', 'ListenerNamesContractTest', 'ListenerNamesParity', 'ProtectedBlockIdsContractTest'].map(name => contract + name + '.java'),
    saikutu + 'SaikutuLimits.java', saikutuContract + 'SaikutuLimitsContractTest.java'],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
```

```js
  run('BridgeAuthContractTest', fixture);
  run('EffectLimitsContractTest');
  run('ListenerNamesContractTest');
  run('ProtectedBlockIdsContractTest');
  run('jp.douma.saikutumod.SaikutuLimitsContractTest');
```

ファイル先頭のコメント（1行目）も「認証・強さの上限・視聴者名・保護するブロック」に直す。

- [ ] **Step 2: 失敗を確かめる**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: FAIL。javac が `api/ProtectedBlockIds.java` を見つけられない（`file not found`）。

- [ ] **Step 3: 最小の実装を書く**

`BridgeMod/src/main/java/jp/douma/bridgemod/api/ProtectedBlockIds.java`：

```java
package jp.douma.bridgemod.api;

import java.util.List;

/**
 * 妨害の自動処理から守るブロックの ID。保護対象の一覧はここだけに置く。
 * Minecraft に依存しないので、scripts/test-bridge-contracts.cjs の契約テストで直接確かめる。
 */
public final class ProtectedBlockIds {
    public static final List<String> IDS = List.of(
        "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block");

    private ProtectedBlockIds() {}

    /** 完全一致で判定する。名前空間のない ID・null は守らない。 */
    public static boolean isProtectedId(String id) {
        return id != null && IDS.contains(id);
    }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: PASS。`ProtectedBlockIds contract: 11 checks passed` が出て、終了コード 0。

- [ ] **Step 5: コミット**

```powershell
git add BridgeMod/src/main/java/jp/douma/bridgemod/api/ProtectedBlockIds.java BridgeMod/src/contractTest/java/jp/douma/bridgemod/ProtectedBlockIdsContractTest.java scripts/test-bridge-contracts.cjs
git commit -m "feat(bridgemod): 保護するブロック（コマンドブロック3種）の ID の一覧を足す"
```

### Task 2: BlockProtection（判定と、控えて戻す runProtected）

**Files:**
- Create: `BridgeMod/src/main/java/jp/douma/bridgemod/api/BlockProtection.java`
- Create: `electron/test/block-protection-wiring.test.cjs`

**Interfaces:**
- Consumes: `ProtectedBlockIds.isProtectedId(String)`（Task 1）。
- Produces:
  - `public static boolean isProtectedBlock(BlockState state)`
  - `public static boolean isProtectedBlock(BlockGetter level, BlockPos pos)`
  - `public static boolean canModifyBlock(BlockGetter level, BlockPos pos)`
  - `public static int runProtected(MinecraftServer server, String label, Runnable action)` … 戻した数を返す
  - `public static long restoredTotal()` … 起動してから戻した数の累計

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/block-protection-wiring.test.cjs`：

```js
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
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/block-protection-wiring.test.cjs`
Expected: FAIL（`ENOENT` … `BlockProtection.java` がない）。

- [ ] **Step 3: 実装を書く**

`BridgeMod/src/main/java/jp/douma/bridgemod/api/BlockProtection.java`：

```java
package jp.douma.bridgemod.api;

import it.unimi.dsi.fastutil.longs.LongOpenHashSet;
import it.unimi.dsi.fastutil.longs.LongSet;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.BlockGetter;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.LevelChunk;

import java.util.ArrayList;
import java.util.List;

/**
 * 妨害の自動処理から守るブロック（コマンドブロック3種。一覧は ProtectedBlockIds）。ゲーム MOD からも使う公開 API。
 * <ul>
 *   <li>Java でブロックを書き換える前に {@link #canModifyBlock} を呼び、false なら飛ばす。</li>
 *   <li>/fill・/setblock など、ブロックを変えうるコマンドを実行するときは {@link #runProtected} で包む。
 *       実行のあとで、変わってしまった保護ブロックを中身（コマンド・自動実行など）ごと戻す。</li>
 * </ul>
 * サーバーのメインスレッドから呼ぶこと。
 */
public final class BlockProtection {
    /** オーバーワールドのスポーン地点の周りで常に読み込まれている範囲（ServerLevel.setDefaultSpawnPos の TicketType.START と同じ半径）。 */
    static final int SPAWN_CHUNK_RADIUS = 11;
    private static int depth;
    private static long restoredTotal;

    private record Kept(ServerLevel level, BlockPos pos, BlockState state, BlockEntity entity) {}

    private BlockProtection() {}

    public static boolean isProtectedBlock(BlockState state) {
        return state != null && ProtectedBlockIds.isProtectedId(BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString());
    }

    public static boolean isProtectedBlock(BlockGetter level, BlockPos pos) {
        return isProtectedBlock(level.getBlockState(pos));
    }

    /** 自動処理がこの位置のブロックを書き換えてよいか。保護ブロックなら false。 */
    public static boolean canModifyBlock(BlockGetter level, BlockPos pos) {
        return !isProtectedBlock(level, pos);
    }

    /** サーバーを起動してから戻した数の累計（BridgeMOD の状態の protectedBlockRestores）。 */
    public static long restoredTotal() {
        return restoredTotal;
    }

    /**
     * action を実行し、その間に変わった保護ブロックを戻す。戻した数を返す。label はログ用（"bridgemod" など）。
     * action が例外を投げても戻してから、その例外を呼び出し元へ投げ直す。
     * 入れ子で呼ばれたときは控え直さず、外側の呼び出しがまとめて戻す。
     */
    public static int runProtected(MinecraftServer server, String label, Runnable action) {
        if (depth > 0 || server == null) { action.run(); return 0; }
        List<Kept> kept = capture(server);
        int restored = 0;
        depth++;
        try {
            action.run();
        } finally {
            depth--;
            restored = restore(kept, label);
        }
        return restored;
    }

    // プレイヤーの描画距離・強制読み込み・スポーンチャンクのうち、読み込み済みのチャンクにある保護ブロックを控える。
    // NBT は戻すときだけ取り出す（取り除かれた BlockEntity にも値は残っている）。
    private static List<Kept> capture(MinecraftServer server) {
        List<Kept> kept = new ArrayList<>();
        int view = server.getPlayerList().getViewDistance();
        for (ServerLevel level : server.getAllLevels()) {
            LongSet chunks = new LongOpenHashSet(level.getForcedChunks());
            for (ServerPlayer player : level.players()) addSquare(chunks, player.chunkPosition(), view);
            if (level.dimension() == Level.OVERWORLD) addSquare(chunks, new ChunkPos(level.getSharedSpawnPos()), SPAWN_CHUNK_RADIUS);
            for (long packed : chunks) {
                LevelChunk chunk = level.getChunkSource().getChunkNow(ChunkPos.getX(packed), ChunkPos.getZ(packed));
                if (chunk == null) continue;
                for (BlockEntity entity : chunk.getBlockEntities().values()) {
                    BlockPos pos = entity.getBlockPos();
                    BlockState state = chunk.getBlockState(pos);
                    if (isProtectedBlock(state)) kept.add(new Kept(level, pos.immutable(), state, entity));
                }
            }
        }
        return kept;
    }

    private static void addSquare(LongSet chunks, ChunkPos center, int radius) {
        for (int x = center.x - radius; x <= center.x + radius; x++)
            for (int z = center.z - radius; z <= center.z + radius; z++) chunks.add(ChunkPos.asLong(x, z));
    }

    // ブロックの状態が違う、または BlockEntity が別物に入れ替わった位置だけを戻す（/data で中身だけ変えた場合は戻さない）。
    private static int restore(List<Kept> kept, String label) {
        int restored = 0;
        for (Kept k : kept) {
            try {
                if (k.level.getBlockState(k.pos) == k.state && k.level.getBlockEntity(k.pos) == k.entity) continue;
                CompoundTag nbt = k.entity.saveWithoutMetadata();
                // 周りへ通知せずに置く。通知すると、空の BlockEntity（powered=false）のまま隣の信号で実行が予約される。
                k.level.setBlock(k.pos, k.state, Block.UPDATE_CLIENTS);
                // loadStatic は level が null の状態で読み込むので、auto=true でも実行を予約しない（ワールドの読み込みと同じ）。
                BlockEntity entity = BlockEntity.loadStatic(k.pos, k.state, nbt);
                if (entity != null) { k.level.setBlockEntity(entity); entity.setChanged(); }
                // powered を戻してから周りへ通知し、レッドストーンや比較器の状態をそろえる。
                k.level.blockUpdated(k.pos, k.state.getBlock());
                restored++;
                System.out.println("[BlockProtection] restored " + BuiltInRegistries.BLOCK.getKey(k.state.getBlock()) + " at "
                    + k.pos.getX() + "," + k.pos.getY() + "," + k.pos.getZ() + " in " + k.level.dimension().location() + " (" + label + ")");
            } catch (RuntimeException error) {
                System.err.println("[BlockProtection] restore failed at " + k.pos.getX() + "," + k.pos.getY() + "," + k.pos.getZ()
                    + " in " + k.level.dimension().location() + " (" + label + "): " + error);
            }
        }
        restoredTotal += restored;
        return restored;
    }
}
```

- [ ] **Step 4: テストとビルドが通ることを確かめる**

Run: `node --test electron/test/block-protection-wiring.test.cjs`
Expected: PASS（3件）。

Run（BridgeMod フォルダーで）: `.\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`
Expected: `BUILD SUCCESSFUL`。コンパイルエラーが出たら、メソッド名を `~/.gradle/caches/forge_gradle/minecraft_user_repo/net/minecraftforge/forge/1.20.1-47.4.16_mapped_official_1.20.1/*-sources.jar` で確かめて直す（`LevelChunk.getBlockEntities()`・`ServerChunkCache.getChunkNow(int,int)`・`ServerLevel.getForcedChunks()`・`BlockEntity.loadStatic`・`Level.blockUpdated` は 2026-10-10 に存在を確認済み）。

- [ ] **Step 5: コミット**

```powershell
git add BridgeMod/src/main/java/jp/douma/bridgemod/api/BlockProtection.java electron/test/block-protection-wiring.test.cjs
git commit -m "feat(bridgemod): 保護ブロックの判定と、コマンドの前後で控えて戻す runProtected を足す"
```

### Task 3: BridgeMOD への組み込み・状態の数・1.6.0

**Files:**
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java:161-177`（`onServerTick`）、`:400-424`（`buildStatusJson`）、import
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java:222-224`（`set`）、import
- Modify: `BridgeMod/gradle.properties:51`（`mod_version=1.6.0`）
- Modify: `electron/test/block-protection-wiring.test.cjs`（テストを足す）

**Interfaces:**
- Consumes: `BlockProtection.runProtected(MinecraftServer, String, Runnable)`、`BlockProtection.canModifyBlock(BlockGetter, BlockPos)`、`BlockProtection.restoredTotal()`（Task 2）。
- Produces: `/bridge/status` と WebSocket の状態の JSON に `"protectedBlockRestores": <long>`。`BridgeMod` に `private void processQueues()` と `private synchronized boolean hasQueuedEvents()`。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/block-protection-wiring.test.cjs` の末尾に足す：

```js
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
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/block-protection-wiring.test.cjs`
Expected: FAIL（新しい3件。`hasQueuedEvents` がない・`canModifyBlock` がない・`mod_version=1.5.0`）。

- [ ] **Step 3: 実装を書く**

`BridgeMod.java` の import に足す（`import jp.douma.bridgemod.api.EnvironmentOverrides;` の次の行）：

```java
import jp.douma.bridgemod.api.BlockProtection;
```

`onServerTick`（161〜177行目）を次にする：

```java
    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || activeServer == null) return;

        likeCod.tick();
        // 妨害のコマンド（txt と /bridge/exec）は、実行のあとで変わったコマンドブロックを中身ごと戻す（BlockProtection）。
        if (hasQueuedEvents()) BlockProtection.runProtected(activeServer, "bridgemod", this::processQueues);
        giftEffects.tick(activeServer);
        environment.apply(activeServer, giftEffects);
        if (++statusBroadcastTicks >= 20) {
            statusBroadcastTicks = 0;
            broadcastWebSocket(buildStatusJson());
        }
    }

    private void processQueues() {
        // Gift work is independent. Likes cannot borrow unused gift budget and cause a burst.
        int budget = MAX_COMMANDS_PER_TICK - LIKE_RESERVED_COMMANDS_PER_TICK;
        budget -= processQueue(activeServer, giftQueue, budget);
        budget -= processQueue(activeServer, otherQueue, budget);
        processQueue(activeServer, likeQueue, LIKE_RESERVED_COMMANDS_PER_TICK);
    }

    private synchronized boolean hasQueuedEvents() {
        return !giftQueue.isEmpty() || !otherQueue.isEmpty() || !likeQueue.isEmpty();
    }
```

`buildStatusJson` の `+ ",\"protectedSkips\":" + protectedSkips` の次の行に足す：

```java
            + ",\"protectedBlockRestores\":" + BlockProtection.restoredTotal()
```

`GiftEffects.java` の import に `import jp.douma.bridgemod.api.BlockProtection;` を足し（`package` の次の空行のあと）、`set`（222〜224行目）を次にする：

```java
    private void set(Origin o, BlockPos p, net.minecraft.world.level.block.state.BlockState state) {
        if (o.allowed(p) && BlockProtection.canModifyBlock(o.level, p) && o.level.getBlockEntity(p) == null
                && !o.level.getBlockState(p).is(Blocks.BEDROCK)) o.level.setBlock(p, state, 3);
    }
```

`BridgeMod/gradle.properties` の51行目を `mod_version=1.6.0` にする。

- [ ] **Step 4: テスト・ビルド・全体の確認**

Run: `node --test electron/test/block-protection-wiring.test.cjs`
Expected: PASS（6件）。

Run（BridgeMod フォルダー）: `.\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`
Expected: `BUILD SUCCESSFUL`、`BridgeMod/build/libs/bridgemod-1.6.0.jar` ができる。

Run（SaikutuMod フォルダー。BridgeMOD の build 結果に対してコンパイルされることの確認）: `..\BridgeMod\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`
Expected: `BUILD SUCCESSFUL`。

Run（リポジトリのルート）: `npm run verify` と `node scripts/test-bridge-contracts.cjs` と `node scripts/test-game-contract.cjs`
Expected: すべて終了コード 0。

- [ ] **Step 5: コミット**

```powershell
git add BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java BridgeMod/gradle.properties electron/test/block-protection-wiring.test.cjs
git commit -m "feat(bridgemod): 妨害のキュー処理と GiftEffects の書き換えに保護ブロックの判定を通し、1.6.0 にする"
```

### Task 4: 実機テスト（BridgeMOD の分）と使い捨てサーバーでの確認

**Files:**
- Create: `BridgeMod/test/protected-blocks.cjs`
- Modify: `BridgeMod/test/README.md`（末尾に節を足す）

**Interfaces:**
- Consumes: `/bridge/status` の `protectedBlockRestores`（Task 3）、`bridgemod-1.6.0.jar`。
- Produces: `node protected-blocks.cjs [--bridge-only|--saikutu-only]`。Task 7 が採掘の分を足す。関数 `placeTrio(tag, positions)`・`assertTrio(tag, positions, before)`・`prepare(cx, deep)`・`post(key)`・`exec(commands)`・`restores()`。

- [ ] **Step 1: テストを書く**

`BridgeMod/test/protected-blocks.cjs`：

```js
// 保護ブロック（コマンドブロック3種）が、妨害のコマンドで置き換えられても、同じ向き・同じ中身で残ることを、
// 使い捨ての Forge サーバーで確かめる。使い方は README.md の「保護ブロック」。
// --bridge-only で BridgeMOD の分だけ、--saikutu-only で採掘の分だけを実行する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
if (props['enable-command-block'] !== 'true') throw Error('enable-command-block=true is required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv.includes('--bridge-only') ? 'bridge' : process.argv.includes('--saikutu-only') ? 'saikutu' : null;
let rcon;
const results = [];
const cmd = s => rcon.send(s);
const status = async () => (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
const restores = async () => (await status()).protectedBlockRestores;
async function wait(fn, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(100); } throw Error('Timed out'); }
async function idle() {
  await wait(async () => { const s = await status(); const g = s.games?.saikutumod; return !s.gift && !s.other && !s.effectsPending && !(g && (g.gift || g.other || g.effectsPending)); });
}
async function post(key, count = 1) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(r.status, 202); await r.text();
}
async function exec(commands) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/exec', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ commands }) });
  assert.equal(r.status, 202); await r.text();
}
async function score(name) { const m = (await cmd(`scoreboard players get ${name} qa_protect`)).match(/has (-?\d+)/); return m ? Number(m[1]) : 0; }
async function isBlock(x, y, z, spec) { return /Test passed/.test(await cmd(`execute if block ${x} ${y} ${z} ${spec}`)); }

// 3種のコマンドブロック。インパルス型とリピート型は常時実行で、スコアを +1 する。チェーン型は中身だけを持つ。
const KINDS = {
  impulse: { id: 'minecraft:command_block', score: '#imp_' },
  repeating: { id: 'minecraft:repeating_command_block', score: '#rep_' },
  chain: { id: 'minecraft:chain_command_block', score: '#chain_' },
};
const spec = (kind, tag) => `${KINDS[kind].id}[facing=up]{auto:1b,Command:"scoreboard players add ${KINDS[kind].score}${tag} qa_protect ${kind === 'chain' ? 0 : 1}"}`;
async function placeTrio(tag, positions) {
  for (const [kind, [x, y, z]] of Object.entries(positions)) assert.match(await cmd(`setblock ${x} ${y} ${z} ${spec(kind, tag)} replace`), /Changed the block/, `${tag} ${kind} placed`);
  await sleep(500);
  return { imp: await score('#imp_' + tag) };
}
async function assertTrio(tag, positions, before) {
  for (const [kind, [x, y, z]] of Object.entries(positions)) {
    assert.ok(await isBlock(x, y, z, KINDS[kind].id + '[facing=up]'), `${tag}: ${kind} at ${x},${y},${z} must stay`);
    assert.match(await cmd(`data get block ${x} ${y} ${z} Command`), new RegExp(KINDS[kind].score + tag), `${tag}: ${kind} keeps its command`);
  }
  if (positions.impulse) assert.equal(await score('#imp_' + tag), before.imp, `${tag}: always-active impulse must not run again`);
  if (positions.repeating) { const rep = await score('#rep_' + tag); await sleep(500); assert.ok(await score('#rep_' + tag) > rep, `${tag}: repeating keeps running`); }
}
async function prepare(cx, deep = false) {
  await idle();
  await cmd(`tp QAProtect ${cx + 0.5} 64 0.5`); await sleep(1500);
  await cmd(`kill @e[type=!minecraft:player]`);
  await cmd(`fill ${cx - 15} 64 -15 ${cx + 15} 96 15 air`);
  await cmd(`fill ${cx - 15} 97 -15 ${cx + 15} 129 15 air`);
  await cmd(`fill ${cx - 15} 63 -15 ${cx + 15} 63 15 stone`);
  if (deep) for (const [lo, hi] of [[8, 35], [36, 62]]) await cmd(`fill ${cx - 15} ${lo} -15 ${cx + 15} ${hi} 15 stone`);
  await cmd(`tp QAProtect ${cx + 0.5} 64 0.5`); await sleep(800);
}
async function test(group, name, fn) {
  if (only && only !== group) return;
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 10000 });
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QAProtect', auth: 'offline', version: '1.20.1', viewDistance: 'normal' });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('Spawn timeout')), 30000).unref(); });
  for (const rule of ['doMobSpawning false', 'doWeatherCycle false', 'doDaylightCycle false', 'doFireTick false', 'commandBlockOutput false', 'mobGriefing false']) await cmd('gamerule ' + rule);
  await cmd('gamemode creative QAProtect');
  await cmd('scoreboard objectives add qa_protect dummy');

  await test('bridge', 'lavafloor: fill と setblock で置き換えても、3種とレッドストーンで動くインパルス型が残る', async () => {
    const cx = -3001; await prepare(cx);
    const pos = { impulse: [cx + 2, 63, 0], repeating: [cx - 2, 63, 0], chain: [cx + 4, 64, 4] };
    const before = await placeTrio('lavafloor', pos);
    // Review Focus 3：常時実行でない、レッドストーンで動かすインパルス型。真下の赤石ブロックで1回だけ実行される。
    await cmd(`setblock ${cx} 63 -2 minecraft:command_block[facing=up]{Command:"scoreboard players add #pow qa_protect 1"} replace`);
    await cmd(`setblock ${cx} 62 -2 minecraft:redstone_block replace`); await sleep(500);
    const pow = await score('#pow'); assert.equal(pow, 1, 'powered impulse runs once when powered');
    const restoresBefore = await restores();
    await post('lavafloor'); await idle(); await sleep(300);
    await assertTrio('lavafloor', pos, before);
    assert.ok(await isBlock(cx, 63, -2, 'minecraft:command_block[facing=up]'), 'powered impulse stays');
    assert.equal(await score('#pow'), 1, 'powered impulse must not run again after restore');
    assert.ok(await isBlock(cx + 1, 63, 1, 'minecraft:magma_block'), 'the rest of the floor still becomes magma');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 4, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', 'husk_watertower: setblock の水で置き換えても残り、ハスクは出る', async () => {
    const cx = -3101; await prepare(cx);
    const pos = { chain: [cx, 74, 0] };
    const before = await placeTrio('husk', pos);
    const restoresBefore = await restores();
    await post('husk_watertower'); await idle(); await sleep(300);
    await assertTrio('husk', pos, before);
    assert.match(await cmd(`execute positioned ${cx} 74 0 if entity @e[type=minecraft:husk,distance=..30]`), /Test passed/, 'husks still spawn');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 1, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', '/bridge/exec の絶対座標の fill で置き換えても残り、ほかの床は変わる', async () => {
    const cx = -3201; await prepare(cx);
    const pos = { impulse: [cx + 2, 63, 0], repeating: [cx - 2, 63, 0], chain: [cx, 63, 2] };
    const before = await placeTrio('exec', pos);
    const restoresBefore = await restores();
    await exec([`fill ${cx - 3} 63 -3 ${cx + 3} 63 3 minecraft:glass`]); await idle(); await sleep(300);
    await assertTrio('exec', pos, before);
    assert.ok(await isBlock(cx + 1, 63, 1, 'minecraft:glass'), 'the rest of the floor becomes glass');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', '同じ種類のコマンドブロックで上書きされても、元のコマンドに戻る（Review Focus 1）', async () => {
    const cx = -3301; await prepare(cx);
    const pos = { impulse: [cx + 2, 63, 0], repeating: [cx - 2, 63, 0] };
    const before = await placeTrio('same', pos);
    const restoresBefore = await restores();
    // 同じ種類・同じ向きで中身が空のものへの置き換え（destroy モード。replace モードは同じ状態なら何もしない）と、別の保護ブロックへの置き換え。
    await exec([`setblock ${cx + 2} 63 0 minecraft:command_block[facing=up] destroy`, `setblock ${cx - 2} 63 0 minecraft:command_block[facing=up] replace`]);
    await idle(); await sleep(300);
    await assertTrio('same', pos, before);
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 2, 'restored ' + restored);
    return { restored };
  });

  await test('bridge', 'プレイヤーから遠い forceload のチャンクでも戻る（Review Focus 2）', async () => {
    const cx = -3401; await prepare(cx);
    const far = cx - 1000;   // 描画距離（6チャンク）の外で、ほかのテストの場所とも重ならない
    await cmd(`forceload add ${far} 0`); await sleep(1500);
    const pos = { impulse: [far + 2, 63, 0], repeating: [far - 2, 63, 0], chain: [far, 63, 2] };
    const before = await placeTrio('far', pos);
    const restoresBefore = await restores();
    await exec([`fill ${far - 3} 63 -3 ${far + 3} 63 3 minecraft:glass`]); await idle(); await sleep(300);
    await assertTrio('far', pos, before);
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    await cmd(`forceload remove ${far} 0`);
    return { restored };
  });

  fs.writeFileSync(path.join(root, 'protected-blocks-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`protected blocks: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
```

`BridgeMod/test/README.md` の末尾に足す：

```markdown
## 保護ブロック（コマンドブロック3種）

`node protected-blocks.cjs` は、妨害のコマンドでコマンドブロックが置き換えられても、同じ向き・同じコマンドで残ること、常時実行のインパルス型が再実行されないこと、リピート型が動き続けることを確かめます。上と同じマーカー・ポート・GIFT_QA_SERVER に加えて、server.properties に `enable-command-block=true` が必要です。

- BridgeMOD の分（`--bridge-only`）：lavafloor・husk_watertower・`/bridge/exec` の fill、同じ種類のコマンドブロックでの上書き、プレイヤーから遠い forceload のチャンク。
- 採掘の分（`--saikutu-only`）：SaikutuMOD を入れたサーバーで実行します。テストが `bridge/commands/minecraft/game_saikutu_*.txt` を書きます。

結果はサーバールートの `protected-blocks-results.json` に保存します。
```

- [ ] **Step 2: 使い捨ての検証サーバーを作る（PowerShell）**

ゲームに使うサーバー（`D:\新しいフォルダー (3)`）とルートの `server\Douma_Craft` には書き込まない。`Douma_Craft` は jdk と libraries を読むだけ（libraries はジャンクションでつなぐ）。

```powershell
$repo = 'D:\Dev02\game_dev\MyGamePack02\My-game-pack-review'
$tpl = 'D:\Dev02\game_dev\MyGamePack02\server\Douma_Craft'
$qa = Join-Path $env:TEMP 'mygamepack-protect-qa'
if (Test-Path $qa) { throw "already exists: $qa" }
New-Item -ItemType Directory -Path "$qa\mods", "$qa\bridge\commands" | Out-Null
New-Item -ItemType Junction -Path "$qa\libraries" -Target "$tpl\libraries" | Out-Null
Copy-Item "$tpl\eula.txt" $qa
Set-Content -Path "$qa\gift-qa-marker.json" -Value '{"purpose":"disposable-gift-effects-test"}' -Encoding ascii -NoNewline
@'
server-ip=127.0.0.1
server-port=25587
enable-rcon=true
rcon.port=25588
rcon.password=qa-protect
online-mode=false
allow-flight=true
view-distance=6
level-type=minecraft\:flat
spawn-protection=0
enable-command-block=true
'@ | Set-Content -Path "$qa\server.properties" -Encoding ascii
Copy-Item "$repo\BridgeMod\build\libs\bridgemod-1.6.0.jar" "$qa\mods\"
Copy-Item -Recurse "$repo\bridge\commands\minecraft" "$qa\bridge\commands\minecraft"
Start-Process -FilePath "$tpl\jdk-21.0.4+7\bin\java.exe" -WorkingDirectory $qa -WindowStyle Hidden `
  -ArgumentList '-Dbridgemod.bridgePort=25578', '-Xmx2G', '@libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt', 'nogui' `
  -RedirectStandardOutput "$qa\server-out.log" -RedirectStandardError "$qa\server-err.log"
```

Expected: 1〜2分で `server-out.log` に `Done (` が出て、`$qa\config\bridgemod-token.txt` ができる。出なければ `server-err.log` を見る。

- [ ] **Step 3: テストを実行する**

```powershell
cd D:\Dev02\game_dev\MyGamePack02\My-game-pack-review\BridgeMod\test
if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
$env:GIFT_QA_SERVER = Join-Path $env:TEMP 'mygamepack-protect-qa'
node protected-blocks.cjs --bridge-only
```

Expected: `PASS` が5件と `protected blocks: 5 tests passed`。`$qa\server-out.log` に `[BlockProtection] restored minecraft:command_block at` の行がある。

失敗したら、どの assert かを見て直す（例：インパルス型が再実行された → `restore` の順序、戻らない → `capture` の範囲）。直したら Task 2・3 のテストと build をやり直してから、もう一度この Step を実行する。

- [ ] **Step 4: 検証サーバーを止めて片付ける**

```powershell
cd D:\Dev02\game_dev\MyGamePack02\My-game-pack-review\BridgeMod\test
node -e "const {Rcon}=require('rcon-client');(async()=>{const r=await Rcon.connect({host:'127.0.0.1',port:25588,password:'qa-protect'});await r.send('stop');await r.end();})()"
```

サーバーが終わってから（`Get-Process java` で該当の java.exe が消えるまで待つ）、ジャンクションを先に外す。Task 7 で再び使うので、フォルダーそのものは残してよい。

```powershell
$qa = Join-Path $env:TEMP 'mygamepack-protect-qa'
[IO.Directory]::Delete("$qa\libraries", $false)   # ジャンクションだけを外す。Douma_Craft の libraries は消えない
```

- [ ] **Step 5: コミット**

```powershell
git add BridgeMod/test/protected-blocks.cjs BridgeMod/test/README.md
git commit -m "test(bridgemod): 保護ブロックの実機テスト（lavafloor・husk_watertower・/bridge/exec・上書き・forceload）を足す"
```

### Task 5: 連携 API の文書と PR1

**Files:**
- Modify: `docs/ゲームMOD連携API_v1.4.md`（末尾に節を足す）

**Interfaces:**
- Consumes: Task 1〜4 の成果。

- [ ] **Step 1: 文書に節を足す**

`docs/ゲームMOD連携API_v1.4.md` の末尾に足す：

````markdown
## 保護ブロック API（BridgeMOD 1.6.0 から）

MAP の進行に使うコマンドブロック（`minecraft:command_block`・`minecraft:chain_command_block`・`minecraft:repeating_command_block`）を、妨害の自動処理から守るための API です。プレイヤー自身がブロックを壊すことは止めません。

### BridgeMOD が守るもの

- BRIDGE の txt（`bridge/commands/minecraft/*.txt`）と `/bridge/exec` のコマンド：tick ごとのキュー処理の前後で、近くのコマンドブロックを控え、変わったものを中身ごと戻します。
- BridgeMOD の大技（流星群・火山など）の Java の書き換え：保護ブロックの位置は書き換えません。
- 爆発・ウィザー・落下ブロックでは、バニラの時点でコマンドブロックは壊れません。

### ゲーム MOD からの使い方

`mods.toml` で bridgemod の `versionRange` を `[1.6.0,)` 以上にしてください。古い BridgeMOD と組み合わせると、起動時に `NoClassDefFoundError` で止まります。

```java
import jp.douma.bridgemod.api.BlockProtection;

// Java でブロックを書き換える前に呼ぶ。保護ブロックなら飛ばす（処理全体は止めない）。
if (BlockProtection.canModifyBlock(level, pos)) level.setBlock(pos, state, 3);

// fill・setblock などのコマンドを実行するときは包む。実行のあとで、変わった保護ブロックを中身ごと戻す。
BlockProtection.runProtected(server, "mygame", () -> {
    server.getCommands().performPrefixedCommand(source, "fill ~-3 ~-1 ~-3 ~3 ~-1 ~3 minecraft:air");
});
```

- `isProtectedBlock(level, pos)`・`isProtectedBlock(state)`：保護ブロックかどうか。
- `runProtected(server, label, action)`：戻した数を返します。サーバーのログに `[BlockProtection] restored … (label)` を出します。サーバーのメインスレッドから呼んでください。入れ子で呼んでも、外側がまとめて戻します。
- 戻すときは、ワールドの読み込みと同じ方法で中身を戻すので、常時実行のインパルス型がもう一度実行されることはありません。リピート型は動き続けます。

### 守れない範囲

- 置き換えられた瞬間の、周りへの通知（隣のレッドストーンの更新など）は起きます。同じ tick の中で戻るので、見た目は変わりません。
- 控えるのは、プレイヤーの描画距離内・強制読み込み（`/forceload`）・オーバーワールドのスポーンチャンクの、読み込み済みのチャンクだけです。
- `runProtected` も `canModifyBlock` も使わずにゲーム MOD が行う処理は守れません。
- `/data` で中身だけを書き換えた場合は戻しません。
````

- [ ] **Step 2: 全体の確認**

Run（ルート）: `npm run verify`、`node scripts/test-bridge-contracts.cjs`、`node scripts/test-game-contract.cjs`、`node scripts/test-display-contract.cjs`
Expected: すべて終了コード 0。

- [ ] **Step 3: コミット・push・PR**

```powershell
git add "docs/ゲームMOD連携API_v1.4.md"
git commit -m "docs: ゲームMOD連携API に保護ブロック API（BridgeMOD 1.6.0）の節を足す"
git push -u origin feat/bridgemod-protected-blocks
gh pr create --base main --head feat/bridgemod-protected-blocks --title "feat(bridgemod): 保護ブロック（コマンドブロック3種）を妨害から守る API を足す（1.6.0）" --body-file <PR本文のファイル>
```

PR の本文には、どの処理に判定を足したか（`onServerTick` のキュー処理・`GiftEffects.set`）、守るブロック（3種）、ゲーム MOD から使えること（`BlockProtection`）、実機テストの結果（Task 4 の PASS 件数）を書く。末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

- [ ] **Step 4: CI とレビュー**

`gh pr checks <番号> --watch` で3チェック（verify ubuntu・verify windows・mod-build）の成功を確かめる。別のエージェント（code-reviewer）にレビューを頼み、CRITICAL・HIGH を直す。マージはユーザーの許可を得てから `gh pr merge <番号> --merge`。

---

## PR2：SaikutuMOD 1.0.3（ブランチ `feat/saikutumod-protected-blocks`）

PR1 がマージされてから始める。

```powershell
cd D:\Dev02\game_dev\MyGamePack02\My-game-pack-review
git switch main; git pull --ff-only origin main
git switch -c feat/saikutumod-protected-blocks
```

### Task 6: SaikutuMOD への組み込み・1.0.3

**Files:**
- Modify: `SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java:108-116`（`tick`）、import
- Modify: `SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java:137-139`（`set`）、import
- Modify: `SaikutuMod/src/main/resources/META-INF/mods.toml:30`
- Modify: `SaikutuMod/gradle.properties:3`
- Modify: `game-packs/saikutu/game.json:6-7`
- Modify: `electron/test/block-protection-wiring.test.cjs`（テストを足す）

**Interfaces:**
- Consumes: `BlockProtection.runProtected`・`BlockProtection.canModifyBlock`（PR1）。
- Produces: `SaikutuMod` に `private void processQueues()`。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/block-protection-wiring.test.cjs` の末尾に足す：

```js
test('SaikutuMOD は tick ごとのキュー処理（内蔵 txt）を runProtected で包み、set で canModifyBlock を通す', () => {
  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  const tick = mod.slice(mod.indexOf('public void tick(TickEvent.ServerTickEvent event)'), mod.indexOf('private int process('));
  assert.match(tick, /BlockProtection\.runProtected\(server, "saikutumod", this::processQueues\)/);
  assert.doesNotMatch(tick.slice(0, tick.indexOf('private void processQueues()')), /process\("gift"/, 'キューを包みの外で処理しない');
  assert.match(tick, /private void processQueues\(\) \{\s*int budget = 52;\s*budget -= process\("gift", budget\); process\("other", budget\); process\("like", 8\);\s*\}/);
  const effects = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java');
  const set = effects.slice(effects.indexOf('private void set(Origin o'), effects.indexOf('private void summon(Origin o'));
  assert.match(set, /BlockProtection\.canModifyBlock\(o\.level, p\)/);
});

test('SaikutuMOD 1.0.3 は BridgeMOD 1.6.0 以上を要求し、ゲームパックの jar 名もそろえる', () => {
  assert.match(read('SaikutuMod/gradle.properties'), /^mod_version=1\.0\.3$/m);
  const toml = read('SaikutuMod/src/main/resources/META-INF/mods.toml');
  assert.match(toml, /\[\[dependencies\.saikutumod\]\]\s*modId="bridgemod"\s*mandatory=true\s*versionRange="\[1\.6\.0,\)"/);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, 'saikutumod-1.0.3.jar');
  assert.equal(pack.clientJar, 'saikutumod-1.0.3.jar');
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/block-protection-wiring.test.cjs`
Expected: FAIL（新しい2件）。

- [ ] **Step 3: 実装を書く**

`SaikutuMod.java` の import に `import jp.douma.bridgemod.api.BlockProtection;` を足し（`import jp.douma.bridgemod.api.GameEvents;` の前）、`tick`（108〜116行目）を次にする：

```java
    @SubscribeEvent public void tick(TickEvent.ServerTickEvent event) {
        if (event.phase != TickEvent.Phase.END || server == null) return;
        // 内蔵 txt の fill などは、実行のあとで変わったコマンドブロックを中身ごと戻す（BridgeMOD の BlockProtection）。
        if (queues.values().stream().anyMatch(queue -> !queue.isEmpty())) BlockProtection.runProtected(server, "saikutumod", this::processQueues);
        effects.get("gift").tick(server, 12, 384);
        effects.get("other").tick(server, 2, 64);
        effects.get("like").tick(server, 2, 64);
        updateStatus();
    }
    private void processQueues() {
        int budget = 52;
        budget -= process("gift", budget); process("other", budget); process("like", 8);
    }
```

`SaikutuEffects.java` の import に `import jp.douma.bridgemod.api.BlockProtection;` を足し（`import jp.douma.bridgemod.api.GameEvents;` の前）、`set`（137〜139行目）を次にする：

```java
    private void set(Origin o, BlockPos p, net.minecraft.world.level.block.state.BlockState state) {
        if (o.allowed(p) && BlockProtection.canModifyBlock(o.level, p) && o.level.getBlockEntity(p) == null
                && !o.level.getBlockState(p).is(Blocks.BEDROCK)) o.level.setBlock(p, state, 3);
    }
```

`SaikutuMod/src/main/resources/META-INF/mods.toml` の30行目を `versionRange="[1.6.0,)"` にする。`SaikutuMod/gradle.properties` の3行目を `mod_version=1.0.3` にする。`game-packs/saikutu/game.json` の6〜7行目を `"serverJar": "saikutumod-1.0.3.jar",`・`"clientJar": "saikutumod-1.0.3.jar",` にする。

- [ ] **Step 4: テスト・ビルド・全体の確認**

Run: `node --test electron/test/block-protection-wiring.test.cjs`
Expected: PASS（8件）。

Run（BridgeMod → SaikutuMod の順。SaikutuMod は BridgeMod の build 結果に対してコンパイルする）:
`cd BridgeMod; .\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`、
`cd ..\SaikutuMod; ..\BridgeMod\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`
Expected: どちらも `BUILD SUCCESSFUL`。`SaikutuMod/build/libs/saikutumod-1.0.3.jar` ができる。

Run（ルート）: `node scripts/prepare-game-packs.cjs`、`npm run verify`、`node scripts/test-game-contract.cjs`、`node scripts/test-bridge-contracts.cjs`
Expected: すべて終了コード 0。

- [ ] **Step 5: コミット**

```powershell
git add SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java SaikutuMod/src/main/resources/META-INF/mods.toml SaikutuMod/gradle.properties game-packs/saikutu/game.json electron/test/block-protection-wiring.test.cjs
git commit -m "feat(saikutumod): 内蔵 txt と地形の書き換えに保護ブロックの判定を通し、1.0.3 にする"
```

### Task 7: 実機テスト（採掘の分）と PR2

**Files:**
- Modify: `BridgeMod/test/protected-blocks.cjs`（採掘の4件を、forceload のテストのあと・結果の保存の前に足す）

**Interfaces:**
- Consumes: Task 4 の `prepare`・`placeTrio`・`assertTrio`・`post`・`restores`・`isBlock`・`cmd`・`idle`・`test`、`saikutumod-1.0.3.jar`。

- [ ] **Step 1: テストを足す**

`BridgeMod/test/protected-blocks.cjs` の `fs.writeFileSync(path.join(root, 'protected-blocks-results.json'), …)` の前に足す：

```js
  // 採掘の内蔵 txt は SaikutuMOD が自分で実行する。アプリと同じ形の振り分けファイルを書いて、BRIDGE の経路から送る。
  if (only !== 'bridge') {
    const dir = path.join(root, 'bridge', 'commands', 'minecraft');
    for (const key of ['otosiana', 'maguma_jigoku', 'fissure', 'tntdaibakuhatu'])
      fs.writeFileSync(path.join(dir, `game_saikutu_${key}.txt`), `# GAME_MOD: saikutumod\n# GAME_KEY: ${key}\n# COUNT_MODE: aggregate\n# DISPLAY_OWNER: game\nsaikutu ${key} {Count} {ListenerName}\n`);
  }

  await test('saikutu', 'otosiana: 足元の 3×3×3 を空気にしても残り、穴はあく', async () => {
    const cx = -3501; await prepare(cx);
    const pos = { impulse: [cx + 1, 63, 0], repeating: [cx - 1, 62, 0], chain: [cx, 61, 1] };
    const before = await placeTrio('otosiana', pos);
    const restoresBefore = await restores();
    await post('otosiana'); await idle(); await sleep(300);
    await assertTrio('otosiana', pos, before);
    assert.ok(await isBlock(cx, 62, 0, 'minecraft:air'), 'the pit still opens');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    return { restored };
  });

  await test('saikutu', 'maguma_jigoku: 頭上を溶岩で埋めても残り、溶岩は出る', async () => {
    const cx = -3601; await prepare(cx);
    const pos = { impulse: [cx + 2, 66, 0], repeating: [cx - 2, 70, 0], chain: [cx, 74, 3] };
    const before = await placeTrio('magma', pos);
    const restoresBefore = await restores();
    await post('maguma_jigoku'); await idle(); await sleep(300);
    await assertTrio('magma', pos, before);
    assert.ok(await isBlock(cx, 68, 0, 'minecraft:lava'), 'lava still fills the space');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    await cmd(`fill ${cx - 6} 65 -6 ${cx + 6} 76 6 air replace minecraft:lava`);
    return { restored };
  });

  await test('saikutu', 'fissure: 地割れの fill で空気にしても残り、地割れはできる', async () => {
    const cx = -3701; await prepare(cx, true);
    const pos = { impulse: [cx + 1, 63, 1], repeating: [cx - 1, 58, 0], chain: [cx, 55, -2] };
    const before = await placeTrio('fissure', pos);
    const restoresBefore = await restores();
    await post('fissure'); await idle(); await sleep(300);
    await assertTrio('fissure', pos, before);
    assert.ok(await isBlock(cx, 60, 0, 'minecraft:air'), 'the fissure still opens');
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    return { restored };
  });

  await test('saikutu', 'tntdaibakuhatu: TNT で埋めても残る（爆発の前に TNT を片付ける）', async () => {
    const cx = -3801; await prepare(cx);
    const pos = { impulse: [cx + 3, 80, 3], repeating: [cx - 3, 90, -3], chain: [cx, 70, 0] };
    const before = await placeTrio('tnt', pos);
    const restoresBefore = await restores();
    await post('tntdaibakuhatu'); await idle();
    // 赤石ブロックで最下段の TNT に火が付く（4秒）。連鎖すると検証サーバーが固まるので、確かめる前に片付ける。
    await cmd('kill @e[type=minecraft:tnt]');
    assert.ok(await isBlock(cx + 6, 100, 6, 'minecraft:tnt'), 'tnt still fills the sky');
    await cmd(`fill ${cx - 7} 69 -7 ${cx + 7} 101 7 air replace minecraft:tnt`);
    await cmd(`setblock ${cx} 68 0 air`);
    await assertTrio('tnt', pos, before);
    const restored = (await restores()) - restoresBefore; assert.ok(restored >= 3, 'restored ' + restored);
    return { restored };
  });
```

- [ ] **Step 2: 検証サーバーに SaikutuMOD を入れて実行する**

Task 4 の Step 2 と同じフォルダーを使う。ジャンクションを外していればつなぎ直し、jar を入れ替えて起動する。

```powershell
$repo = 'D:\Dev02\game_dev\MyGamePack02\My-game-pack-review'
$tpl = 'D:\Dev02\game_dev\MyGamePack02\server\Douma_Craft'
$qa = Join-Path $env:TEMP 'mygamepack-protect-qa'
if (-not (Test-Path "$qa\libraries")) { New-Item -ItemType Junction -Path "$qa\libraries" -Target "$tpl\libraries" | Out-Null }
Get-ChildItem "$qa\mods" -Filter *.jar | Remove-Item
Copy-Item "$repo\BridgeMod\build\libs\bridgemod-1.6.0.jar", "$repo\SaikutuMod\build\libs\saikutumod-1.0.3.jar" "$qa\mods\"
Start-Process -FilePath "$tpl\jdk-21.0.4+7\bin\java.exe" -WorkingDirectory $qa -WindowStyle Hidden `
  -ArgumentList '-Dbridgemod.bridgePort=25578', '-Xmx2G', '@libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt', 'nogui' `
  -RedirectStandardOutput "$qa\server-out.log" -RedirectStandardError "$qa\server-err.log"
cd "$repo\BridgeMod\test"
$env:GIFT_QA_SERVER = $qa
node protected-blocks.cjs
```

Expected: `PASS` が9件と `protected blocks: 9 tests passed`。`server-out.log` に `(saikutumod)` の付いた `[BlockProtection] restored` の行がある。

- [ ] **Step 3: 検証サーバーを止めて消す**

Task 4 の Step 4 と同じ方法で stop し、java.exe が終わってから：

```powershell
$qa = Join-Path $env:TEMP 'mygamepack-protect-qa'
[IO.Directory]::Delete("$qa\libraries", $false)   # 先にジャンクションだけを外す
if (Test-Path "$qa\libraries") { throw 'junction still present; do not delete' }
Remove-Item -LiteralPath $qa -Recurse -Force
```

- [ ] **Step 4: コミット・push・PR・CI・レビュー**

```powershell
git add BridgeMod/test/protected-blocks.cjs
git commit -m "test(saikutumod): 保護ブロックの実機テストに採掘の内蔵 txt（otosiana・maguma_jigoku・fissure・tntdaibakuhatu）を足す"
git push -u origin feat/saikutumod-protected-blocks
gh pr create --base main --head feat/saikutumod-protected-blocks --title "feat(saikutumod): 内蔵 txt と地形の書き換えでコマンドブロックを守る（1.0.3）" --body-file <PR本文のファイル>
```

本文には、Task 6 で変えた場所・`versionRange` を上げた理由・実機テストの結果を書く。CI の3チェックの成功を確かめ、別のエージェント（code-reviewer）にレビューを頼む。マージはユーザーの許可を得てから。

---

### Task 8: 開発版のアプリでの確認と HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（先頭に節を足す。docs のブランチと PR で）

- [ ] **Step 1: 開発版で確かめる**

2026-10-10 と同じ手順（メモ `electron-dev-device-check`）：インストール版・Minecraft・開発版を閉じる → 退避（`bridge\node`・`bridge\node_modules` は除く）→ D 側で `npm run dev:refresh`（BridgeMod 1.6.0・SaikutuMod 1.0.3 を作る）→ `Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run electron:dev` → 採掘に切り替えて一括起動。

ユーザーに、ゲーム内で足元にコマンドブロック（`/give @s minecraft:command_block`、常時実行・`say ok` など）を置いてもらい、テスト発火で lavafloor と採掘の落とし穴を発火する。コマンドブロックが残り、サーバーのログに `[BlockProtection] restored` が出ることを確かめる。

終わったら退避から戻し、一覧と照合する。D 側は `git restore bridge/` と、未追跡ファイルを退避フォルダーへ移す（`git clean` は使わない）。

- [ ] **Step 2: HANDOFF04 を更新して docs の PR にする**

やったこと（PR 番号・マージコミット・テスト結果）、ユーザーへ報告する3点（どの処理に判定を足したか・守るブロック・ゲーム MOD から使えるか）、次にやることを書く。ブランチ `docs/handoff-<日付>` で PR を作り、CI の成功後にマージする。
