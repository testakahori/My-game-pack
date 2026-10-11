# 強さの上限をやめる・TNT大爆発の衝撃波 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 妨害の強さの上限（BridgeMOD・SaikutuMOD・BRIDGE の BridgeMOD 経路）をなくし、TNT大爆発を「N 個で、横 48×N・上下 11×N の楕円体の衝撃波を1回」にする。

**Architecture:** BridgeMOD は `EffectLimits` を消し、スーパージャンプは `JumpPhysics.stackTarget` で高さを足すだけにして低速落下を付けない。BRIDGE は BridgeMOD へ送るときだけ「個別最大コマンド数」を掛けない（判定は `bridge/event_rules.cjs` の `isBridgeModTransport` に集める）。SaikutuMOD は `SaikutuLimits` を消し、TNT大爆発を大技に移して、形と進み方を純粋な Java の `Shockwave` に、えぐる処理を `SaikutuEffects` の衝撃波（`Wave`）に置く。

**Tech Stack:** Java 17・Minecraft 1.20.1・Forge 47.x（公式マッピング）、Node.js 24（`node:test`）、mineflayer・rcon-client（実機テスト）。

**Spec:** `docs/superpowers/specs/2026-10-11-no-strength-limits-design.md`

## Global Constraints

- 制限は一切なし。上限・間引き・消去を新しく入れない（衝撃波の 1 tick あたりの予算は「遅らせる」だけで、えぐる範囲は削らない）。
- BridgeMOD 1.7.0、SaikutuMOD 1.1.0。SaikutuMOD の `mods.toml` の bridgemod は `[1.6.0,)` のまま。
- 衝撃波：`R = 48 × N`、`D = 11 × N`、横に1 tick 2ブロック（毎秒40）、発動から40 tick 後に開始、予算は全部の衝撃波で合わせて 1 tick 50,000 ブロック、横に調べるのは `(描画距離 + 2) × 16` まで。
- えぐるのは `SaikutuEffects.set()` と同じ判定（読み込み済み・建築できる高さ・`BlockProtection.canModifyBlock`・BlockEntity は飛ばす・岩盤は残す）。チャンクを読み込ませない。アイテムは落とさない。
- 頭上の TNT は今の txt の6行を、N に関係なく1回だけ実行する（2行目が動かないことも含めて今と同じ）。
- スーパージャンプは上限なし・低速落下なし。
- 「個別最大コマンド数」は BridgeMOD 経路で掛けない。RCON・Telnet では今までどおり掛ける。
- 手元の MOD のビルドは `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`。SaikutuMod・DisplayMod は `..\BridgeMod\gradlew.bat`。
- D 側で `git stash` を使わない。PR の前にブランチを切る。マージはユーザーの許可を得てから。`git clean` は使わない（未追跡は退避フォルダーへ移す）。
- 使い捨ての検証サーバーは `<scratchpad>\qa-server.ps1`（2026-10-11 に作成済み。無ければ `docs/superpowers/plans/2026-10-10-protected-blocks.md` の Task 4 Step 2 と同じ手順）で作り、消す前に必ずジャンクション `libraries` を外す。

## Review Focus

1. 衝撃波が、読み込まれていないチャンクや世界の端にかかっても、チャンクを読み込ませたり生成させたりしない。→ Task 6 の配線テスト（`carve` は `o.allowed(p)` を `getBlockState` より先に見る）。
2. gift・like・other の衝撃波が同時に進んでも、予算はサーバーの1 tick ごとに1回だけ戻る。→ Task 6 の配線テスト（`server.getTickCount()` で戻す）。
3. 衝撃波の途中でサーバーが止まったら、衝撃波は捨てる。→ Task 6 の配線テスト（`stop()` で `waves.clear()`）。
4. 爆心の列（dy=0）もえぐり、殻と殻の間に抜けや重なりがない。→ Task 5 の契約テスト（全殻の和が楕円体の内側とちょうど一致）。
5. とても大きな N（100,000）でも例外や桁あふれにならず、横に調べる範囲は描画距離で止まる。→ Task 5 の契約テスト。

---

## PR1：BridgeMOD 1.7.0 ＋ BRIDGE ＋ アプリ（ブランチ `feat/no-strength-limits-bridge`）

始める前に（D 側）：

```powershell
cd D:\Dev02\game_dev\MyGamePack02\My-game-pack-review
git status --short --branch   # 変更がないこと
git switch main; git pull --ff-only origin main
git switch -c feat/no-strength-limits-bridge
```

### Task 1: BridgeMOD の上限をなくし、スーパージャンプを上限なし・低速落下なしにする

**Files:**
- Delete: `BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java`
- Delete: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/EffectLimitsContractTest.java`
- Create: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/JumpPhysicsContractTest.java`
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/JumpPhysics.java`
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java`（`Jump` 77〜81行、`start` 151〜155行、`jump`・`tickJumps` 537〜565行）
- Modify: `BridgeMod/gradle.properties`（`mod_version=1.7.0`）
- Modify: `scripts/test-bridge-contracts.cjs`（17〜27行）
- Modify: `electron/test/mod-limits-wiring.test.cjs`（19〜25行のテストを置き換える）
- Modify: `electron/test/block-protection-wiring.test.cjs`（版の確認を「1.6.0 以上」に）

**Interfaces:**
- Produces: `JumpPhysics.JUMP_HEIGHT`（`static final int`、32）、`static double JumpPhysics.stackTarget(double currentTarget, int count)`。

- [ ] **Step 1: 失敗するテストを書く**

`BridgeMod/src/contractTest/java/jp/douma/bridgemod/JumpPhysicsContractTest.java`：

```java
package jp.douma.bridgemod;

// スーパージャンプの高さに上限がないこと（2026-10-11 ユーザーの決定）を Minecraft なしで確かめる。
public final class JumpPhysicsContractTest {
    private static int checks;

    public static void main(String[] args) {
        same(32, JumpPhysics.JUMP_HEIGHT, "one jump is 32 blocks");
        same(132.0, JumpPhysics.stackTarget(100, 1), "one jump");
        same(100.0 + 32 * 100, JumpPhysics.stackTarget(100, 100), "100 jumps, no cap");
        same(132.0, JumpPhysics.stackTarget(100, 0), "at least one jump");
        // 空中で何度重ねても上限はない（以前は最初の高さ＋320 で止まった）。
        double target = 100;
        for (int i = 0; i < 20; i++) target = JumpPhysics.stackTarget(target, 10);
        same(100.0 + 32 * 200, target, "stacked jumps keep adding");
        // 上昇の速さの計算は今のまま。
        check(JumpPhysics.heightForVelocity(JumpPhysics.velocityForHeight(32)) >= 32, "velocity reaches the height");
        System.out.println("JumpPhysics contract: " + checks + " checks passed");
    }

    private static void check(boolean ok, String name) { checks++; if (!ok) throw new AssertionError(name); }
    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
```

`scripts/test-bridge-contracts.cjs` の17〜27行を次にする（`EffectLimits` を `JumpPhysics` に替える。採掘の分は PR2 で直すので、ここでは `SaikutuLimits` を残す）：

```js
  execFileSync(bin('javac'), ['-encoding', 'UTF-8', '-d', classes,
    ...['BridgeAuth', 'JumpPhysics', 'ListenerNames', 'api/ProtectedBlockIds'].map(name => main + name + '.java'),
    ...['BridgeAuthContractTest', 'JumpPhysicsContractTest', 'ListenerNamesContractTest', 'ListenerNamesParity', 'ProtectedBlockIdsContractTest'].map(name => contract + name + '.java'),
    saikutu + 'SaikutuLimits.java', saikutuContract + 'SaikutuLimitsContractTest.java'],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  const run = (name, ...args) => execFileSync(bin('java'), ['-Xmx64m', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-cp', classes, name.includes('.') ? name : 'jp.douma.bridgemod.' + name, ...args],
    { cwd: root, windowsHide: true, stdio: 'inherit' });
  run('BridgeAuthContractTest', fixture);
  run('JumpPhysicsContractTest');
  run('ListenerNamesContractTest');
  run('ProtectedBlockIdsContractTest');
  run('jp.douma.saikutumod.SaikutuLimitsContractTest');
```

1行目のコメントの「強さの上限」は「ジャンプの高さ」に直す。

`electron/test/mod-limits-wiring.test.cjs` の2つ目のテスト（19〜25行）を次に置き換える：

```js
test('BridgeMOD は大技の count を抑えず、スーパージャンプに上限も低速落下もない', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  assert.doesNotMatch(source, /EffectLimits/, '上限のクラスを使わない');
  assert.doesNotMatch(source, /SLOW_FALLING/, '低速落下を付けない（落下死してよい）');
  assert.match(source, /j\.target = JumpPhysics\.stackTarget\(j\.target, count\);/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java')), false);
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.7\.0\r?$/m);
});
```

`electron/test/block-protection-wiring.test.cjs` の版のテストを次にする：

```js
test('BridgeMOD は 1.6.0 以上（保護ブロック API は 1.6.0 から）', () => {
  const [major, minor] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.\d+\r?$/m).slice(1).map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 6), `mod_version ${major}.${minor} must be >= 1.6`);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: FAIL（javac が `JumpPhysics.JUMP_HEIGHT`・`stackTarget` を見つけられない）。

Run: `node --test electron/test/mod-limits-wiring.test.cjs`
Expected: FAIL（`EffectLimits` がまだある）。

- [ ] **Step 3: 実装を書く**

`JumpPhysics.java` のクラスの先頭に足す：

```java
    /** ジャンプ1回あたりの高さ（ブロック）。 */
    static final int JUMP_HEIGHT = 32;

    /** 連続ジャンプの目標の高さ。今の目標に 32×count を足すだけで、上限はない（2026-10-11 ユーザーの決定）。 */
    static double stackTarget(double currentTarget, int count) {
        return currentTarget + JUMP_HEIGHT * (double) Math.max(1, count);
    }
```

`GiftEffects.java`：

- `Jump`（77〜81行）を次にする：

```java
    private static final class Jump {
        // 着地するまで同じ Jump を使う。高さの上限はなく、低速落下も付けない（落下死してよい。2026-10-11 ユーザーの決定）。
        final ServerLevel level; double target, liftY; boolean coasting; int age;
        Jump(ServerPlayer p) { level = p.serverLevel(); target = liftY = p.getY(); }
    }
```

- `start` の153〜155行（`int limited = EffectLimits.clamp(...)` から `count = limited;` まで）を消す。
- `jump` を次にする：

```java
    private void jump(ServerPlayer p, int count) {
        Jump j = jumps.computeIfAbsent(p.getUUID(), id -> new Jump(p));
        if (j.level != p.serverLevel()) { j = new Jump(p); jumps.put(p.getUUID(), j); }
        j.target = JumpPhysics.stackTarget(j.target, count); j.liftY = p.getY(); j.coasting = false; j.age = 0;
        p.removeEffect(MobEffects.JUMP); p.removeEffect(MobEffects.LEVITATION);
        p.setOnGround(false);
    }
```

- `tickJumps` の `j.chain.target()` を `j.target` にし（2か所）、最後の低速落下を付け直す3行（「着地するまで低速落下を切らさない」のコメントから `p.addEffect(... SLOW_FALLING ...)` まで）を消す。

`EffectLimits.java` と `EffectLimitsContractTest.java` を消す：

```powershell
git rm BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java BridgeMod/src/contractTest/java/jp/douma/bridgemod/EffectLimitsContractTest.java
```

`BridgeMod/gradle.properties` を `mod_version=1.7.0` にする。

- [ ] **Step 4: テスト・ビルド・全体の確認**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: PASS（`JumpPhysics contract: 6 checks passed` を含む）。

Run: `node --test electron/test/mod-limits-wiring.test.cjs electron/test/block-protection-wiring.test.cjs electron/test/dev-commands-dir.test.cjs`
Expected: PASS。

Run（BridgeMod フォルダー）: `.\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`、続けて SaikutuMod フォルダーで `..\BridgeMod\gradlew.bat build --offline --no-daemon "-Dnet.minecraftforge.gradle.check.certs=false"`
Expected: どちらも `BUILD SUCCESSFUL`。`bridgemod-1.7.0.jar` ができる。

Run（ルート）: `npm run verify`
Expected: 終了コード 0。

- [ ] **Step 5: コミット**

```powershell
git add -A BridgeMod/src scripts/test-bridge-contracts.cjs electron/test/mod-limits-wiring.test.cjs electron/test/block-protection-wiring.test.cjs BridgeMod/gradle.properties
git commit -m "feat(bridgemod): 大技の上限をなくし、スーパージャンプを上限なし・低速落下なしにする（1.7.0）"
```

### Task 2: BRIDGE とアプリで「個別最大コマンド数」を BridgeMOD 経路に掛けない

**Files:**
- Modify: `bridge/event_rules.cjs`（`isBridgeModTransport` を足して書き出す）
- Modify: `bridge/index.js`（38行の require、812〜830行の `limitEventCount`、1048〜1055行の判定、1337〜1339行）
- Modify: `electron/event_tests.cjs`（4行の require、21〜38行）
- Modify: `src/components/OperationsPage.tsx`（407〜409行）
- Modify: `electron/test/bridge-count-limit.test.cjs`（全体を書き換える）

**Interfaces:**
- Produces: `isBridgeModTransport(transport: string | undefined): boolean`（`bridge/event_rules.cjs`）。`bridge_mod`・`douma_mod`・`doumamod`・`bridgemod`・`mod`・`http` なら true（大文字・前後の空白は無視、空なら `rcon` 扱い）。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/bridge-count-limit.test.cjs` を次に書き換える：

```js
// 「個別最大コマンド数」は、Minecraft（BridgeMOD 経路）では掛けない。RCON・Telnet で送るゲームにだけ掛ける（2026-10-11 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const { planTestEvent } = require('../event_tests.cjs');
const { isBridgeModTransport } = require('../../bridge/event_rules.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('BridgeMOD 経路の判定は、bridge/index.js と同じ名前の並びを受け付ける', () => {
  for (const name of ['bridge_mod', 'BRIDGE_MOD', ' douma_mod ', 'doumamod', 'bridgemod', 'mod', 'http']) assert.equal(isBridgeModTransport(name), true, name);
  for (const name of ['rcon', 'telnet', '', undefined, null]) assert.equal(isBridgeModTransport(name), false, String(name));
});

test('「個別最大コマンド数」は BridgeMOD 経由のギフトに掛けない（送られた数どおり）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n', tower: '# TITLE: tower\n# GAME_MOD: gameprobe\nsay game\n' },
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 20 }, { giftId: '2', name: '塔', commandFile: 'tower.txt', repeat: 20 }],
      options: { maxCommandsPerGift: 5 },
    },
  });
  const gift = giftId => bridge.emit('WebcastGiftMessage', { giftId, gift: { name: 'g' + giftId }, repeatCount: 1, repeatEnd: 1 });
  await gift('1');
  await bridge.until(() => bridge.requests.some(x => x.key === 'zombie'), 'gift');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'zombie').map(x => x.count), [20], '20回の割り当ては20回のまま');
  await gift('2');
  await bridge.until(() => bridge.requests.some(x => x.key === 'tower'), 'game request');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'tower').map(x => x.count), [20]);
  assert.ok(!bridge.logs.some(x => x.includes('個別最大コマンド数')), '回数を減らしたログを出さない');
});

test('テスト発火も、BridgeMOD 経由なら回数を抑えず、RCON・Telnet なら抑える', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-limit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'zombie.txt'), 'say test\n');
  fs.writeFileSync(path.join(dir, 'tower.txt'), '# GAME_MOD: gameprobe\nsay game\n');
  const mod = planTestEvent({ options: { commandTransport: 'bridge_mod', maxCommandsPerGift: 5 } }, { type: 'gift', commandFile: 'zombie.txt', count: 30 }, dir);
  assert.equal(mod.steps[0].count, 30);
  assert.ok(!mod.notes.some(note => note.includes('個別最大コマンド数')));
  const rcon = planTestEvent({ options: { commandTransport: 'rcon', maxCommandsPerGift: 5 } }, { type: 'gift', commandFile: 'zombie.txt', count: 30 }, dir);
  assert.equal(rcon.steps[0].count, 5);
  assert.ok(rcon.notes.some(note => note.includes('個別最大コマンド数（5）')));
  const game = planTestEvent({ options: { commandTransport: 'rcon', maxCommandsPerGift: 5 } }, { type: 'gift', commandFile: 'tower.txt', count: 30 }, dir);
  assert.equal(game.steps[0].count, 30, 'ゲームMODのコマンドは count の意味をゲームが決めるので抑えない');
});

test('運用センターの「個別最大コマンド数」に、Minecraft では使わないことを書く', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../../src/components/OperationsPage.tsx'), 'utf8');
  assert.match(page, /Minecraft（BridgeMOD）では使いません。RCON・Telnet で送るゲームの、1回あたりのコマンド数の上限です。/);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/bridge-count-limit.test.cjs`
Expected: FAIL（`isBridgeModTransport is not a function`、ギフトが5回に抑えられる、など）。

- [ ] **Step 3: 実装を書く**

`bridge/event_rules.cjs` の `module.exports` の前に足し、書き出しに加える：

```js
// BridgeMOD（HTTP）で送る設定か。空なら RCON。bridge/index.js とアプリのテスト発火で同じ判定を使う。
function isBridgeModTransport(transport) {
  return ['bridge_mod', 'douma_mod', 'doumamod', 'bridgemod', 'mod', 'http'].includes(String(transport || 'rcon').toLowerCase().trim());
}

module.exports = { boundedInt, enabledCommand, matchingCommentRules, deathRouletteMatches, likeRuleProgress, commentExtras, isBridgeModTransport };
```

`bridge/index.js`：

- 38行目の require に `isBridgeModTransport` を足す。
- 1048〜1055行を次にする：

```js
  const commandTransport = String(options.commandTransport || "rcon").toLowerCase().trim();
  const useBridgeModTransport = targetType === "minecraft" && isBridgeModTransport(commandTransport);
```

- 812〜819行の `limitEventCount` 関数（とその上のコメント）を消し、`bridgeEventDelivery` の `prepare` を `return prepare(event);` にする（829行）。
- 1337〜1339行を次にする（`maxCount` を渡さない）。その上に「Minecraft（BridgeMOD 経路）では『個別最大コマンド数』を掛けない（2026-10-11 ユーザーの決定）。」とコメントを書く：

```js
  const modDelivery = bridgeMod ? bridgeEventDelivery(bridgeMod, { prepare: prepareGameEvent }) : null;
```

`electron/event_tests.cjs`：

- 4行目の require に `isBridgeModTransport` を足す。
- 21〜22行を次にする：

```js
  // 「個別最大コマンド数」は RCON・Telnet で送るゲームだけ（本番の Bridge と同じ）。Minecraft（BridgeMOD 経路）では掛けない。
  const maxCount = isBridgeModTransport(config.options?.commandTransport) ? Infinity : boundedInt(config.options?.maxCommandsPerGift ?? 200, 1, 10000, 200);
```

（34〜38行の判定は `amount > maxCount` のままで、`Infinity` なら掛からない。）

`src/components/OperationsPage.tsx` の407〜409行を次にする：

```tsx
                <FieldLabel label="個別最大コマンド数">
                  <input type="number" value={o.maxCommandsPerGift ?? 200} onChange={(event) => setOption("maxCommandsPerGift", Number(event.target.value) || 0)} />
                  <small className="mt-1 block text-[11px] leading-relaxed text-slate-400">Minecraft（BridgeMOD）では使いません。RCON・Telnet で送るゲームの、1回あたりのコマンド数の上限です。</small>
                </FieldLabel>
```

- [ ] **Step 4: テストと全体の確認**

Run: `node --test electron/test/bridge-count-limit.test.cjs`
Expected: PASS（4件）。

Run: `npm run verify`
Expected: 終了コード 0（`bridge-live-events.test.cjs` など既存のテストも通る）。

- [ ] **Step 5: コミット**

```powershell
git add bridge/event_rules.cjs bridge/index.js electron/event_tests.cjs src/components/OperationsPage.tsx electron/test/bridge-count-limit.test.cjs
git commit -m "feat(bridge): 「個別最大コマンド数」を Minecraft（BridgeMOD 経路）では掛けない"
```

### Task 3: 実機テスト（BridgeMOD の分）

**Files:**
- Create: `BridgeMod/test/no-limits.cjs`
- Modify: `BridgeMod/test/README.md`（末尾に節を足す）

**Interfaces:**
- Consumes: `bridgemod-1.7.0.jar`。
- Produces: `node no-limits.cjs [--bridge-only|--saikutu-only]`。Task 7 が採掘の分を足す。関数 `post(key, count)`・`idle()`・`killCount(type)`・`test(group, name, fn)`。

- [ ] **Step 1: テストを書く**

`BridgeMod/test/no-limits.cjs`：

```js
// 強さの上限をやめたこと（2026-10-11）を、使い捨ての Forge サーバーで確かめる。使い方は README.md の「強さの上限なし」。
// --bridge-only で BridgeMOD の分だけ、--saikutu-only で採掘の分だけを実行する。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const mineflayer = require('mineflayer'), { Rcon } = require('rcon-client'), { Vec3 } = require('vec3');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const only = process.argv.includes('--bridge-only') ? 'bridge' : process.argv.includes('--saikutu-only') ? 'saikutu' : null;
let rcon, bot;
const results = [];
const cmd = s => rcon.send(s);
const status = async () => (await bridgeFetch('http://127.0.0.1:25578/bridge/status')).json();
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
async function idle(ms = 120000) {
  await wait(async () => { const s = await status(); const g = s.games?.saikutumod; return !s.gift && !s.other && !s.effectsPending && !(g && (g.gift || g.other || g.effectsPending)); }, ms);
}
async function post(key, count) {
  const r = await bridgeFetch('http://127.0.0.1:25578/bridge/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'gift', key, count, listenerName: 'QA', announce: false }) });
  assert.equal(r.status, 202); await r.text();
}
async function killCount(type) { const m = (await cmd(`kill @e[type=${type}]`)).match(/Killed (\d+)/); return m ? Number(m[1]) : 0; }
async function test(group, name, fn) {
  if (only && only !== group) return;
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QANoLimit', auth: 'offline', version: '1.20.1', viewDistance: 'far' });
  await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('kicked', reject); setTimeout(() => reject(Error('Spawn timeout')), 30000).unref(); });
  for (const rule of ['doMobSpawning false', 'doWeatherCycle false', 'doDaylightCycle false', 'doFireTick false', 'mobGriefing false']) await cmd('gamerule ' + rule);
  await cmd('time set day');

  await test('bridge', 'chickenrain count=5 は 200×5＝1000羽（以前は3で止まり600羽）', async () => {
    await cmd('gamemode creative QANoLimit'); await cmd('tp QANoLimit -1000.5 64 0.5'); await sleep(2000);
    await cmd('fill -1016 63 -16 -984 63 16 minecraft:stone');
    await killCount('minecraft:chicken');
    await post('chickenrain', 5); await idle(); await sleep(2000);
    const chickens = await killCount('minecraft:chicken');
    assert.equal(chickens, 1000);
    return { chickens };
  });

  await test('bridge', 'スーパージャンプ count=20 は 640 ブロック上がり、低速落下は付かない', async () => {
    await cmd('tp QANoLimit -1200.5 64 0.5'); await sleep(2000);
    await cmd('fill -1216 63 -16 -1184 63 16 minecraft:stone');
    await cmd('gamemode survival QANoLimit'); await cmd('effect clear QANoLimit'); await sleep(500);
    const startY = bot.entity.position.y; let maxY = startY, slowFalling = false;
    const watch = setInterval(() => {
      maxY = Math.max(maxY, bot.entity.position.y);
      if (Object.values(bot.entity.effects || {}).some(e => e.id === 28)) slowFalling = true;   // 28 = slow_falling
    }, 50);
    await post('superjump', 20);
    await wait(async () => maxY >= startY + 600, 120000).catch(() => {});
    await sleep(3000);
    clearInterval(watch);
    assert.ok(maxY >= startY + 600, `rose to ${maxY - startY}`);
    assert.equal(slowFalling, false, 'no slow falling');
    await cmd('gamemode creative QANoLimit'); await cmd('tp QANoLimit -1200.5 64 0.5');
    return { rose: Math.round(maxY - startY), slowFalling };
  });

  fs.writeFileSync(path.join(root, 'no-limits-results.json'), JSON.stringify({ results }, null, 2));
  if (results.length === 0) throw Error('no tests ran');
  console.log(`no limits: ${results.length} tests passed`);
  bot.quit(); await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; process.exit(1); });
```

`BridgeMod/test/README.md` の末尾に足す：

```markdown
## 強さの上限なし（2026-10-11）

`node no-limits.cjs` は、上限をやめたことを確かめます。上と同じマーカー・ポート・GIFT_QA_SERVER を使います。

- BridgeMOD の分（`--bridge-only`）：鶏の雨 count=5 が1000羽になる。スーパージャンプ count=20 が640ブロック上がり、低速落下が付かない。
- 採掘の分（`--saikutu-only`）：SaikutuMOD を入れたサーバーで実行します。TNT大爆発 count=2 の衝撃波の穴、洪水 count=5、木 count=210。

結果はサーバールートの `no-limits-results.json` に保存します。
```

- [ ] **Step 2: 直す前の jar で落ちることを確かめる**

```powershell
$sp = '<scratchpad>'   # 2026-10-11 のセッションのスクラッチパッド。qa-server.ps1 がある場所
$r = 'D:\Dev02\game_dev\MyGamePack02\My-game-pack-review'
& "$sp\qa-server.ps1" -Action create
& "$sp\qa-server.ps1" -Action start -Jars "$r\BridgeMod\build\libs\bridgemod-1.6.1.jar"
# 起動を待つ（server-out.log に Bridge HTTP listening が出るまで）
cd "$r\BridgeMod\test"; $env:GIFT_QA_SERVER = Join-Path $env:TEMP 'mygamepack-protect-qa'
node no-limits.cjs --bridge-only
```

Expected: FAIL（鶏が600羽）。

- [ ] **Step 3: 1.7.0 で通ることを確かめる**

```powershell
& "$sp\qa-server.ps1" -Action stop
& "$sp\qa-server.ps1" -Action start -Jars "$r\BridgeMod\build\libs\bridgemod-1.7.0.jar"
node no-limits.cjs --bridge-only
```

Expected: `PASS` 2件と `no limits: 2 tests passed`。

- [ ] **Step 4: 検証サーバーを止めてジャンクションを外す**

```powershell
& "$sp\qa-server.ps1" -Action stop
& "$sp\qa-server.ps1" -Action unlink   # Task 7 で使うのでフォルダーは残す
```

- [ ] **Step 5: コミット**

```powershell
git add BridgeMod/test/no-limits.cjs BridgeMod/test/README.md
git commit -m "test(bridgemod): 強さの上限なしの実機テスト（鶏の雨・スーパージャンプ）を足す"
```

### Task 4: PR1

- [ ] **Step 1: 全体の確認**

Run（ルート）: `npm run verify`、`node scripts/test-bridge-contracts.cjs`、`node scripts/test-game-contract.cjs`、`node scripts/test-display-contract.cjs`
Expected: すべて終了コード 0。

- [ ] **Step 2: push と PR**

```powershell
git push -u origin feat/no-strength-limits-bridge
gh pr create --base main --head feat/no-strength-limits-bridge --title "feat: 妨害の強さの上限をなくす（BridgeMOD 1.7.0・BRIDGE）" --body-file <PR本文のファイル>
```

本文には、なくした上限（大技の count・スーパージャンプの高さと低速落下・BridgeMOD 経路の「個別最大コマンド数」）、ユーザーの決定（2026-10-10・11）、実機テストの結果（直す前は落ち、1.7.0 で通る）を書く。末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。

- [ ] **Step 3: CI とレビュー**

`gh pr checks <番号> --watch` で3チェックの成功を確かめる。別のエージェントにブランチ全体のレビューを頼み、Critical・Important を直す。マージはユーザーの許可を得てから。

---

## PR2：SaikutuMOD 1.1.0（ブランチ `feat/saikutu-shockwave`）

PR1 のマージ後に main から切る。

```powershell
git switch main; git pull --ff-only origin main
git switch -c feat/saikutu-shockwave
```

### Task 5: 衝撃波の形と進み方（`Shockwave`）と契約テスト

**Files:**
- Create: `SaikutuMod/src/main/java/jp/douma/saikutumod/Shockwave.java`
- Create: `SaikutuMod/src/contractTest/java/jp/douma/saikutumod/ShockwaveContractTest.java`
- Modify: `scripts/test-bridge-contracts.cjs`（コンパイルと実行に足す）

**Interfaces:**
- Produces（package-private、`jp.douma.saikutumod.Shockwave`）：
  - `static final int BASE_RADIUS = 48, BASE_DEPTH = 11;` `static final double BLOCKS_PER_TICK = 2.0;`
  - `Shockwave(int count, int limit)`、`final int radius, depth, limit`
  - `double distance(int dx, int dy, int dz)`、`boolean finished()`、`double reached()`、`double nextReach()`、`void advanceTo(double to)`
  - `int columnReach(double to)`、`int[] verticalBand(int dx, int dz, double from, double to)`（`{min, max}` の |dy|、空なら null）
  - `double depthAt(double r)`

- [ ] **Step 1: 失敗するテストを書く**

`SaikutuMod/src/contractTest/java/jp/douma/saikutumod/ShockwaveContractTest.java`：

```java
package jp.douma.saikutumod;

import java.util.HashSet;
import java.util.Set;

// TNT大爆発の衝撃波の形（今の穴を横も深さも N 倍）と進み方（1 tick 2ブロック）を Minecraft なしで確かめる。
public final class ShockwaveContractTest {
    private static int checks;

    public static void main(String[] args) {
        Shockwave one = new Shockwave(1, 1000), two = new Shockwave(2, 1000), four = new Shockwave(4, 1000);
        same(48, one.radius, "N=1 radius"); same(11, one.depth, "N=1 depth");
        same(96, two.radius, "N=2 radius"); same(22, two.depth, "N=2 depth");
        same(192, four.radius, "N=4 radius"); same(44, four.depth, "N=4 depth");
        same(48, new Shockwave(0, 1000).radius, "count below one is one");
        // 楕円体の端と中心。
        near(0, one.distance(0, 0, 0), "centre"); near(1, one.distance(48, 0, 0), "edge x"); near(1, one.distance(0, 0, -48), "edge z");
        near(1, one.distance(0, 11, 0), "edge up"); near(1, one.distance(0, -11, 0), "edge down");
        // N=1 の深さは、2026-10-11 の実測（半径25で9〜11、36で7〜8、44で4）と合う。
        between(9, 10, one.depthAt(25), "depth at 25"); between(7, 8, one.depthAt(36), "depth at 36"); between(4, 5, one.depthAt(44), "depth at 44");
        near(0, one.depthAt(48), "depth at the rim");
        // 1 tick 2ブロックで広がり、R/2 tick で端に届く。
        same(24, ticksToFinish(new Shockwave(1, 1000)), "N=1 finishes in 24 ticks");
        same(48, ticksToFinish(new Shockwave(2, 1000)), "N=2 finishes in 48 ticks");
        // 横に調べる範囲は、読み込まれている範囲（limit）で止まる。とても大きな N でも桁あふれしない。
        same(128, new Shockwave(4, 128).columnReach(1), "reach is capped by the loaded area");
        same(24, new Shockwave(1, 128).columnReach(0.5), "reach follows the front");
        same(128, new Shockwave(100000, 128).columnReach(1), "huge N stays within the loaded area");
        // すべての殻を合わせると、楕円体の内側とちょうど一致する（抜けも重なりもない。爆心の列の dy=0 も入る）。
        for (int[] c : new int[][] { {0, 0}, {10, 5}, {30, 20}, {47, 0}, {48, 0}, {0, 48}, {34, 34} }) coverage(new Shockwave(1, 1000), c[0], c[1]);
        for (int[] c : new int[][] { {0, 0}, {60, 30}, {95, 0} }) coverage(new Shockwave(2, 1000), c[0], c[1]);
        System.out.println("Shockwave contract: " + checks + " checks passed");
    }

    private static int ticksToFinish(Shockwave w) {
        int ticks = 0;
        while (!w.finished()) { w.advanceTo(w.nextReach()); ticks++; if (ticks > 100000) throw new AssertionError("never finishes"); }
        return ticks;
    }

    private static void coverage(Shockwave w, int dx, int dz) {
        Set<Integer> carved = new HashSet<>();
        while (!w.finished()) {
            double from = w.reached(), to = w.nextReach();
            int[] band = w.verticalBand(dx, dz, from, to);
            if (band != null) for (int a = band[0]; a <= band[1]; a++) {
                check(carved.add(a), "no overlap at dy=" + a + " column " + dx + "," + dz);
                if (a != 0) check(carved.add(-a), "no overlap at dy=" + -a + " column " + dx + "," + dz);
            }
            w.advanceTo(to);
        }
        Set<Integer> expected = new HashSet<>();
        for (int dy = -w.depth - 1; dy <= w.depth + 1; dy++) if (w.distance(dx, dy, dz) <= 1 + 1e-9) expected.add(dy);
        same(expected, carved, "column " + dx + "," + dz + " carves exactly the inside");
    }

    private static void check(boolean ok, String name) { checks++; if (!ok) throw new AssertionError(name); }
    private static void near(double expected, double actual, String name) { checks++; if (Math.abs(expected - actual) > 1e-9) throw new AssertionError(name + ": expected " + expected + " but was " + actual); }
    private static void between(double lo, double hi, double actual, String name) { checks++; if (actual < lo || actual > hi) throw new AssertionError(name + ": " + actual + " not in " + lo + ".." + hi); }
    private static void same(Object expected, Object actual, String name) {
        checks++;
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + ": expected " + expected + " but was " + actual);
    }
}
```

`scripts/test-bridge-contracts.cjs` の javac の引数に `saikutu + 'Shockwave.java', saikutuContract + 'ShockwaveContractTest.java'` を足し、実行に `run('jp.douma.saikutumod.ShockwaveContractTest');` を足す。

- [ ] **Step 2: 失敗を確かめる**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: FAIL（javac が `Shockwave.java` を見つけられない）。

- [ ] **Step 3: 実装を書く**

`SaikutuMod/src/main/java/jp/douma/saikutumod/Shockwave.java`：

```java
package jp.douma.saikutumod;

/**
 * TNT大爆発の衝撃波の形と進み方。Minecraft に依存しない（scripts/test-bridge-contracts.cjs の契約テストで確かめる）。
 * 爆心を中心にした楕円体：横の半径 R = 48×N、上下の半径 D = 11×N。今の穴（2026-10-11、count=1 の実測）を N 倍にした形。
 * 横に毎秒40ブロック（1 tick 2ブロック）で広がる。
 */
final class Shockwave {
    static final int BASE_RADIUS = 48;
    static final int BASE_DEPTH = 11;
    static final double BLOCKS_PER_TICK = 2.0;

    final int radius, depth, limit;
    private double reached;

    /** count は送られた TNT大爆発の数（1 未満は 1）。limit は横に調べる最大の距離（読み込まれている範囲）。 */
    Shockwave(int count, int limit) {
        int n = Math.max(1, count);
        radius = Math.multiplyExact(BASE_RADIUS, n);
        depth = Math.multiplyExact(BASE_DEPTH, n);
        this.limit = Math.max(0, limit);
    }

    /** 爆心からの正規化した距離。1 以下が楕円体の内側。 */
    double distance(int dx, int dy, int dz) {
        double h = ((double) dx * dx + (double) dz * dz) / ((double) radius * radius);
        return Math.sqrt(h + (double) dy * dy / ((double) depth * depth));
    }

    boolean finished() { return reached >= 1; }
    double reached() { return reached; }

    /** 次の殻の外側。1 tick に 2/R ずつ進み、1 で止まる。 */
    double nextReach() { return Math.min(1, reached + BLOCKS_PER_TICK / radius); }

    /** 殻をえぐり終えたら呼ぶ。 */
    void advanceTo(double to) { reached = Math.max(reached, Math.min(1, to)); }

    /** 殻の外側が to のときに調べる列の、横の最大距離（ブロック）。読み込まれている範囲を超えない。 */
    int columnReach(double to) { return (int) Math.min(limit, Math.ceil(to * radius)); }

    /**
     * 列 (dx, dz) で、正規化した距離が (from, to] に入る |dy| の範囲 {min, max}。入らなければ null。
     * 上（+dy）と下（-dy）の両方に同じ範囲がある。from が 0 の最初の殻は dy=0 も含む。
     * 前の殻の to と次の殻の from は同じ値で計算するので、殻と殻の間に抜けも重なりもない。
     */
    int[] verticalBand(int dx, int dz, double from, double to) {
        double h = ((double) dx * dx + (double) dz * dz) / ((double) radius * radius);
        double d2 = (double) depth * depth;
        double hi = d2 * (to * to - h);
        if (hi < 0) return null;
        int max = (int) Math.floor(Math.sqrt(hi) + 1e-9);
        double lo = d2 * (from * from - h);
        int min = (from <= 0 || lo < 0) ? 0 : (int) Math.floor(Math.sqrt(lo) + 1e-9) + 1;
        return min > max ? null : new int[] { min, max };
    }

    /** 横の距離 r（ブロック）での、爆心から下へのえぐる深さ。 */
    double depthAt(double r) {
        double q = 1 - (r * r) / ((double) radius * radius);
        return q <= 0 ? 0 : depth * Math.sqrt(q);
    }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: PASS（`Shockwave contract: … checks passed` を含む）。`coverage` で落ちたら `verticalBand` の境界（`1e-9` と `min` の決め方）を見直す。

- [ ] **Step 5: コミット**

```powershell
git add SaikutuMod/src/main/java/jp/douma/saikutumod/Shockwave.java SaikutuMod/src/contractTest/java/jp/douma/saikutumod/ShockwaveContractTest.java scripts/test-bridge-contracts.cjs
git commit -m "feat(saikutumod): TNT大爆発の衝撃波の形と進み方（Shockwave）を足す"
```

### Task 6: TNT大爆発を衝撃波の大技にし、SaikutuMOD の上限をなくす（1.1.0）

**Files:**
- Modify: `SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java`（`KEYS` 44行、`pendingJobs` 53行、`stop` 82〜85行、`start` 86〜100行、`tick` 101〜123行、新しいメソッド）
- Modify: `SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java`（`offer` 72〜79行）
- Modify: `SaikutuMod/src/main/resources/commands/tntdaibakuhatu.txt`（コマンドの行を消し、メタ情報だけ残す）
- Delete: `SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuLimits.java`、`SaikutuMod/src/contractTest/java/jp/douma/saikutumod/SaikutuLimitsContractTest.java`
- Modify: `scripts/test-bridge-contracts.cjs`（`SaikutuLimits` を外す）
- Modify: `electron/test/mod-limits-wiring.test.cjs`（1つ目のテストを置き換え、テストを足す）
- Modify: `SaikutuMod/gradle.properties`（`mod_version=1.1.0`）、`game-packs/saikutu/game.json`（jar 名）
- Modify: `electron/test/block-protection-wiring.test.cjs`（SaikutuMOD の版の確認を `1.0.3` から「1.0.3 以上」に）

**Interfaces:**
- Consumes: `Shockwave`（Task 5）、`SaikutuEffects.set(Origin, BlockPos, BlockState)`・`surface`・`loaded`・`Origin.allowed`（既存）。
- Produces: `SaikutuEffects.KEYS` に `"tntdaibakuhatu"`。`static final List<String> TNT_CANOPY`、`static final int WAVE_DELAY_TICKS = 40`、`static final int WAVE_BLOCK_BUDGET = 50_000`。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/mod-limits-wiring.test.cjs` を次に書き換える（1つ目のテストを置き換え、BridgeMOD のテストは Task 1 のまま残す）：

```js
// 強さの上限をなくしたこと（2026-10-11）と、TNT大爆発の衝撃波が実際の処理につながっていることを、ソースで確かめる。
// 衝撃波の形そのものは scripts/test-bridge-contracts.cjs の ShockwaveContractTest で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const effects = () => read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java');

test('採掘MODは大技の倍率もくり返し回数も抑えない', () => {
  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  assert.doesNotMatch(mod, /SaikutuLimits/);
  assert.doesNotMatch(effects(), /SaikutuLimits/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuLimits.java')), false);
});

test('BridgeMOD は大技の count を抑えず、スーパージャンプに上限も低速落下もない', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  assert.doesNotMatch(source, /EffectLimits/, '上限のクラスを使わない');
  assert.doesNotMatch(source, /SLOW_FALLING/, '低速落下を付けない（落下死してよい）');
  assert.match(source, /j\.target = JumpPhysics\.stackTarget\(j\.target, count\);/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java')), false);
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.7\.\d+\r?$/m);
});

test('TNT大爆発は大技で、頭上の TNT は N に関係なく1回、衝撃波は N 倍', () => {
  const source = effects();
  assert.match(source, /static final Set<String> KEYS = Set\.of\([^)]*"tntdaibakuhatu"/);
  const blast = source.slice(source.indexOf('private void tntBlast('), source.indexOf('private void tickWaves('));
  assert.match(blast, /for \(String line : TNT_CANOPY\) o\.level\.getServer\(\)\.getCommands\(\)\.performPrefixedCommand\(source, line\);/);
  assert.match(blast, /new Shockwave\(count, limit\)/);
  assert.match(blast, /\(o\.level\.getServer\(\)\.getPlayerList\(\)\.getViewDistance\(\) \+ 2\) \* 16/);
  assert.match(blast, /ticks \+ WAVE_DELAY_TICKS/);
  // txt はメタ情報だけ（コマンドの行は Java の TNT_CANOPY に移した）。
  const txt = read('SaikutuMod/src/main/resources/commands/tntdaibakuhatu.txt');
  assert.deepEqual(txt.split(/\r?\n/).filter(line => line.trim() && !/^\s*(#|\/\/)/.test(line)), []);
});

test('衝撃波は set() と同じ判定でえぐり、チャンクを読み込ませない（Review Focus 1）', () => {
  const source = effects();
  const carve = source.slice(source.indexOf('private boolean carve('), source.indexOf('private void front('));
  const allowed = carve.indexOf('o.allowed(p)'), state = carve.indexOf('getBlockState(p)');
  assert.ok(allowed > 0 && allowed < state, '読み込み済みかを先に確かめる');
  assert.match(carve, /BlockPos at = p\.immutable\(\);\s*set\(o, at, Blocks\.AIR\.defaultBlockState\(\)\);/);
});

test('衝撃波の予算は全部の衝撃波で 1 tick に1回だけ戻り、止めたら捨てる（Review Focus 2・3）', () => {
  const source = effects();
  assert.match(source, /static final int WAVE_BLOCK_BUDGET = 50_000;/);
  assert.match(source, /private static long waveBudgetTick = -1;/);
  assert.match(source, /if \(waveBudgetTick != now\) \{ waveBudgetTick = now; waveBudgetLeft = WAVE_BLOCK_BUDGET; \}/);
  assert.match(source, /long now = server\.getTickCount\(\);/);
  const stop = source.slice(source.indexOf('void stop()'), source.indexOf('int start('));
  assert.match(stop, /waves\.clear\(\)/);
  assert.match(source, /int pendingJobs\(\) \{ return jobs\.size\(\) \+ waves\.size\(\); \}/);
});

test('SaikutuMOD 1.1.0 とゲームパックの jar 名', () => {
  assert.match(read('SaikutuMod/gradle.properties'), /^mod_version=1\.1\.0\r?$/m);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, 'saikutumod-1.1.0.jar');
  assert.equal(pack.clientJar, 'saikutumod-1.1.0.jar');
});
```

`electron/test/block-protection-wiring.test.cjs` の SaikutuMOD のテスト（`SaikutuMOD 1.0.3 は BridgeMOD 1.6.0 以上を要求し…`）の版とゲームパックの確認を次にする：

```js
  const [minor, patch] = read('SaikutuMod/gradle.properties').match(/^mod_version=1\.(\d+)\.(\d+)\r?$/m).slice(1).map(Number);
  assert.ok(minor > 0 || patch >= 3, 'SaikutuMOD 1.0.3 以上');
  const toml = read('SaikutuMod/src/main/resources/META-INF/mods.toml');
  assert.match(toml, /\[\[dependencies\.saikutumod\]\]\s*modId="bridgemod"\s*mandatory=true\s*versionRange="\[1\.6\.0,\)"/);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, pack.clientJar);
  assert.match(pack.serverJar, /^saikutumod-\d+\.\d+\.\d+\.jar$/);
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/mod-limits-wiring.test.cjs`
Expected: FAIL（`SaikutuLimits` がある、`tntBlast` がない、など）。

- [ ] **Step 3: 実装を書く**

`SaikutuEffects.java`：

- 44行の `KEYS` を `Set.of("skytrap", "cataclysm", "iceage", "flood", "tntdaibakuhatu")` にする。
- 53行の `pendingJobs` を `int pendingJobs() { return jobs.size() + waves.size(); }` にする（衝撃波が終わるまで「処理中」に数える）。
- `stop()` の `jobs.clear();` の後ろに `waves.clear();` を足す。
- `start` の87〜90行（`SaikutuLimits` の4行）を消し、`switch` に `case "tntdaibakuhatu" -> tntBlast(source, o, count);` を足す。
- `tick` の最後（`blizzards` のパーティクルのあと、メソッドの閉じかっこの前）に `tickWaves(server);` を足す。
- `KEYS` の下に、次の宣言を足す：

```java
    // TNT大爆発（2026-10-11 ユーザーの決定）。頭上の TNT は今の txt と同じ6行を N に関係なく1回だけ実行する
    // （2行目の赤石ブロックは、1行目で頭上が TNT になるので動かない。見た目を変えないため、そのまま残す）。
    static final List<String> TNT_CANOPY = List.of(
        "execute at @p if block ~ ~30 ~ air run fill ~7 ~37 ~-7 ~-7 ~5 ~7 minecraft:tnt",
        "execute at @p if block ~ ~30 ~ air run fill ~ ~4 ~ ~ ~4 ~ minecraft:redstone_block",
        "execute at @p unless block ~ ~30 ~ air run summon tnt ~2 ~ ~ {Fuse:40}",
        "execute at @p unless block ~ ~30 ~ air run summon tnt ~-2 ~ ~ {Fuse:40}",
        "execute at @p unless block ~ ~30 ~ air run summon tnt ~ ~ ~2 {Fuse:40}",
        "execute at @p unless block ~ ~30 ~ air run summon tnt ~ ~ ~-2 {Fuse:40}");
    // 足元の TNT（Fuse:40）が爆発するときに衝撃波を始める。
    static final int WAVE_DELAY_TICKS = 40;
    // 衝撃波が 1 tick に空気へ変えるブロックの数。gift・like・other の衝撃波で合わせてこの数まで（実機テストで調整）。
    // 使い切ったら次の tick に続きをえぐる（範囲は削らない）。
    static final int WAVE_BLOCK_BUDGET = 50_000;
    private static long waveBudgetTick = -1;
    private static int waveBudgetLeft;
    private final List<Wave> waves = new ArrayList<>();
    private static final class Wave {
        final Origin origin; final BlockPos centre; final Shockwave shape; final long startTick;
        final Set<UUID> hit = new HashSet<>();
        double from, to = -1; long cursor; int ring;
        Wave(Origin origin, BlockPos centre, Shockwave shape, long startTick) {
            this.origin = origin; this.centre = centre; this.shape = shape; this.startTick = startTick;
        }
    }
```

- `common` メソッドの前に、次のメソッドを足す：

```java
    private void tntBlast(CommandSourceStack source, Origin o, int count) {
        for (String line : TNT_CANOPY) o.level.getServer().getCommands().performPrefixedCommand(source, line);
        // 横に調べるのは、プレイヤーの周りに読み込まれている範囲まで（チケットの届く2チャンクを足す）。
        int limit = (o.level.getServer().getPlayerList().getViewDistance() + 2) * 16;
        waves.add(new Wave(o, BlockPos.containing(o.pos), new Shockwave(count, limit), ticks + WAVE_DELAY_TICKS));
    }
    private void tickWaves(MinecraftServer server) {
        if (waves.isEmpty()) return;
        long now = server.getTickCount();
        if (waveBudgetTick != now) { waveBudgetTick = now; waveBudgetLeft = WAVE_BLOCK_BUDGET; }
        for (Iterator<Wave> it = waves.iterator(); it.hasNext();) {
            Wave w = it.next();
            if (ticks < w.startTick) continue;
            try {
                if (stepWave(w) && w.shape.finished()) it.remove();
            } catch (Exception e) { fail(e); it.remove(); }
        }
    }
    // 1 tick 分の殻をえぐる。予算が尽きたら false を返し、次の tick に同じ殻の続きの列から再開する（列の途中では止めない）。
    private boolean stepWave(Wave w) {
        if (w.to < 0) { w.from = w.shape.reached(); w.to = w.shape.nextReach(); w.cursor = 0; front(w); }
        int reach = w.shape.columnReach(w.to), side = reach * 2 + 1;
        long columns = (long) side * side;
        BlockPos.MutableBlockPos p = new BlockPos.MutableBlockPos();
        while (w.cursor < columns) {
            if (waveBudgetLeft <= 0) return false;
            int dx = (int) (w.cursor / side) - reach, dz = (int) (w.cursor % side) - reach;
            w.cursor++;
            int[] band = w.shape.verticalBand(dx, dz, w.from, w.to);
            if (band == null) continue;
            for (int a = band[0]; a <= band[1]; a++) {
                p.set(w.centre.getX() + dx, w.centre.getY() + a, w.centre.getZ() + dz);
                if (carve(w.origin, p)) waveBudgetLeft--;
                if (a != 0) {
                    p.set(w.centre.getX() + dx, w.centre.getY() - a, w.centre.getZ() + dz);
                    if (carve(w.origin, p)) waveBudgetLeft--;
                }
            }
        }
        w.shape.advanceTo(w.to); w.to = -1;
        return true;
    }
    // set() と同じ判定で空気にする。読み込み済みかを先に確かめ、チャンクを読み込ませない。実際に変えたら true（予算を数えるため）。
    private boolean carve(Origin o, BlockPos p) {
        if (!o.allowed(p) || o.level.getBlockState(p).isAir()) return false;
        // 呼び出し側は使い回しの MutableBlockPos を渡すので、書き換える位置だけ固定した BlockPos にする。
        BlockPos at = p.immutable();
        set(o, at, Blocks.AIR.defaultBlockState());
        return o.level.getBlockState(at).isAir();
    }
    // 先端の輪で地形を壊さない爆発（見た目・音・吹き飛ばし）を最大16か所。先端が届いた生き物は、その位置でも1回爆発させる。
    private void front(Wave w) {
        ServerLevel level = w.origin.level;
        double r = w.to * w.shape.radius;
        for (int i = 0; i < 16; i++) {
            double angle = Math.PI * 2 * (i + (w.ring % 4) * 0.25) / 16;
            int x = w.centre.getX() + (int) Math.round(Math.cos(angle) * r), z = w.centre.getZ() + (int) Math.round(Math.sin(angle) * r);
            if (Math.abs(x - w.centre.getX()) > w.shape.limit || Math.abs(z - w.centre.getZ()) > w.shape.limit || !loaded(w.origin, x, z)) continue;
            level.explode(null, x + 0.5, surface(w.origin, x, z), z + 0.5, 4f, Level.ExplosionInteraction.NONE);
        }
        w.ring++;
        double hr = Math.min(r, w.shape.limit) + 2, vr = w.to * w.shape.depth + 2;
        AABB box = new AABB(w.centre.getX() - hr, w.centre.getY() - vr, w.centre.getZ() - hr,
            w.centre.getX() + hr + 1, w.centre.getY() + vr + 1, w.centre.getZ() + hr + 1);
        for (LivingEntity e : level.getEntitiesOfClass(LivingEntity.class, box)) {
            if (w.hit.contains(e.getUUID())) continue;
            int dx = e.getBlockX() - w.centre.getX(), dy = e.getBlockY() - w.centre.getY(), dz = e.getBlockZ() - w.centre.getZ();
            if (w.shape.distance(dx, dy, dz) > w.to) continue;
            w.hit.add(e.getUUID());
            level.explode(null, e.getX(), e.getY(), e.getZ(), 4f, Level.ExplosionInteraction.NONE);
        }
    }
```

`set` は `private void set(Origin o, BlockPos p, BlockState state)` のまま変えない。

`SaikutuMod.java` の `offer`（72〜78行）の、`if (!SaikutuEffects.KEYS.contains(request.key)) { … }` のブロックを消す（くり返し回数を抑えない）。

`tntdaibakuhatu.txt` を次にする：

```
# TITLE: TNT大爆発
# SUBTITLE: とにかくドッカン
# CATEGORY: 妨害系
// 超大量のTNTが降ってきて爆発し、そのあと衝撃波が広がって地形をえぐる（N 個で半径 N 倍）。
// コマンドは SaikutuEffects.TNT_CANOPY と衝撃波（Shockwave）に移した。
```

`SaikutuLimits.java`・`SaikutuLimitsContractTest.java` を `git rm` で消し、`scripts/test-bridge-contracts.cjs` の javac の引数から `saikutu + 'SaikutuLimits.java', saikutuContract + 'SaikutuLimitsContractTest.java'` を、実行から `run('jp.douma.saikutumod.SaikutuLimitsContractTest');` を外す。

`SaikutuMod/gradle.properties` を `mod_version=1.1.0` に、`game-packs/saikutu/game.json` の `serverJar`・`clientJar` を `saikutumod-1.1.0.jar` にする。

- [ ] **Step 4: テスト・ビルド・全体の確認**

Run: `node --test electron/test/mod-limits-wiring.test.cjs electron/test/block-protection-wiring.test.cjs`
Expected: PASS。

Run（BridgeMod → SaikutuMod の順）: 両方の `gradlew build --offline …`
Expected: `BUILD SUCCESSFUL`。`saikutumod-1.1.0.jar` ができる。

Run（ルート）: `node scripts/test-bridge-contracts.cjs`、`node scripts/prepare-game-packs.cjs`、`npm run verify`、`node scripts/test-game-contract.cjs`
Expected: すべて終了コード 0。

- [ ] **Step 5: コミット**

```powershell
git add -A SaikutuMod scripts/test-bridge-contracts.cjs electron/test/mod-limits-wiring.test.cjs electron/test/block-protection-wiring.test.cjs game-packs/saikutu/game.json
git commit -m "feat(saikutumod): TNT大爆発を N 倍の衝撃波にし、採掘MODの上限をなくす（1.1.0）"
```

### Task 7: 実機テスト（採掘の分）と PR2

**Files:**
- Modify: `BridgeMod/test/no-limits.cjs`（採掘の3件を、結果の保存の前に足す）

**Interfaces:**
- Consumes: Task 3 の `post`・`idle`・`killCount`・`test`・`cmd`・`bot`・`Vec3`、`saikutumod-1.1.0.jar`。

- [ ] **Step 1: テストを足す**

`BridgeMod/test/no-limits.cjs` の `fs.writeFileSync(path.join(root, 'no-limits-results.json'), …)` の前に足す：

```js
  // 採掘のゲームの振り分けファイル（アプリの切替と同じ形）。
  if (only !== 'bridge') {
    const dir = path.join(root, 'bridge', 'commands', 'minecraft');
    for (const key of ['tntdaibakuhatu', 'flood', 'get_tree'])
      fs.writeFileSync(path.join(dir, `game_saikutu_${key}.txt`), `# GAME_MOD: saikutumod\n# GAME_KEY: ${key}\n# COUNT_MODE: aggregate\n# DISPLAY_OWNER: game\nsaikutu ${key} {Count} {ListenerName}\n`);
  }

  await test('saikutu', 'TNT大爆発 count=2 は、横96・深さ22の楕円体の衝撃波でえぐり、コマンドブロックは残る', async () => {
    const cx = -3000, R = 104;
    await cmd('gamemode creative QANoLimit'); await cmd(`tp QANoLimit ${cx + 0.5} 120 0.5`); await sleep(4000);
    // 石の台（半径104・y=0〜63）。fill は1回32,768ブロックまで。
    for (let x = cx - R; x <= cx + R; x += 32) for (let z = -R; z <= R; z += 32) for (let y = 0; y <= 63; y += 32)
      await cmd(`fill ${x} ${y} ${z} ${Math.min(x + 31, cx + R)} ${Math.min(y + 31, 63)} ${Math.min(z + 31, R)} minecraft:stone`);
    await cmd(`fill ${cx - 16} 64 -16 ${cx + 16} 110 16 minecraft:air`);
    await cmd(`setblock ${cx + 60} 55 0 minecraft:command_block{Command:"say keep"} replace`);
    await cmd(`summon minecraft:zombie ${cx + 30} 64 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["qa_wave"]}`);
    await cmd(`tp QANoLimit ${cx + 0.5} 64 0.5`); await sleep(1500);
    await post('tntdaibakuhatu', 2);
    // 頭上の TNT の連鎖は重いので、置かれたらすぐ片付けて、衝撃波（40 tick 後に始まる）だけを測る。
    await wait(async () => /Test passed/.test(await cmd(`execute if block ${cx} 94 0 minecraft:tnt`)), 20000);
    await cmd('kill @e[type=minecraft:tnt]');
    await cmd(`fill ${cx - 7} 69 -7 ${cx + 7} 101 7 minecraft:air replace minecraft:tnt`);
    await cmd(`tp QANoLimit ${cx + 0.5} 120 0.5`);
    await idle(180000); await sleep(2000);
    // 爆心の y=64 から下へえぐれた深さ（いちばん上の石の y と 63 の差）を、横の距離ごとに測る。
    const bottom = (dx) => { for (let y = 63; y >= 0; y--) { const b = bot.blockAt(new Vec3(cx + dx, y, 0)); if (b && b.name === 'stone') return y; } return -1; };
    const depth = dx => 63 - bottom(dx);
    const at = { 0: depth(0), 48: depth(48), 90: depth(90), 100: depth(100) };
    // 楕円体の深さ：0→22、48→19、90→7、100→0（端の外）。爆心の列は y=42 まで、つまり 63 からの深さ 22。
    assert.ok(Math.abs(at[0] - 22) <= 1, 'centre depth ' + at[0]);
    assert.ok(Math.abs(at[48] - 19) <= 1, 'depth at 48: ' + at[48]);
    assert.ok(Math.abs(at[90] - 7) <= 1, 'depth at 90: ' + at[90]);
    assert.equal(at[100], 0, 'outside the rim stays');
    assert.match(await cmd(`execute if block ${cx + 60} 55 0 minecraft:command_block`), /Test passed/, 'protected command block stays');
    // 衝撃波に巻き込まれたゾンビは、死んだか体力が減っている（最大20）。
    if (/Test passed/.test(await cmd('execute if entity @e[type=minecraft:zombie,tag=qa_wave]'))) {
      const health = Number((await cmd('data get entity @e[type=minecraft:zombie,tag=qa_wave,limit=1] Health')).match(/([\d.]+)f/)?.[1]);
      assert.ok(health < 20, 'zombie hurt: ' + health);
    }
    return { depth: at };
  });

  await test('saikutu', '洪水 count=5 はドラウンド 30×5＝150体（以前は3で止まり90体）', async () => {
    await cmd(`tp QANoLimit -5000.5 64 0.5`); await sleep(2000);
    await cmd('fill -5016 63 -16 -4984 63 16 minecraft:stone');
    await killCount('minecraft:drowned');
    await post('flood', 5); await idle(180000); await sleep(3000);
    const drowned = await killCount('minecraft:drowned');
    assert.equal(drowned, 150);
    return { drowned };
  });

  await test('saikutu', '木 count=210 は 210 回くり返す（以前は200で止まった）', async () => {
    await cmd('clear QANoLimit');
    await post('get_tree', 210); await idle(180000);
    const m = (await cmd('clear QANoLimit minecraft:oak_wood 0')).match(/Found (\d+)/);
    const logs = m ? Number(m[1]) : 0;
    assert.equal(logs, 2100);
    return { logs };
  });
```

- [ ] **Step 2: 直す前の jar で落ちることを確かめる**

穴を爆心から100ブロック先まで測るので、検証サーバーの描画距離を10にしておく（6だと端のチャンクが読み込まれず、石の台も測る位置も欠ける）。

```powershell
$qa = Join-Path $env:TEMP 'mygamepack-protect-qa'
(Get-Content "$qa\server.properties") -replace '^view-distance=\d+$', 'view-distance=10' | Set-Content "$qa\server.properties" -Encoding ascii
& "$sp\qa-server.ps1" -Action start -Jars "$r\BridgeMod\build\libs\bridgemod-1.7.0.jar", "$r\SaikutuMod\build\libs\saikutumod-1.0.3.jar"
cd "$r\BridgeMod\test"; node no-limits.cjs --saikutu-only
```

Expected: FAIL（TNT大爆発に衝撃波がない／洪水が90体）。

- [ ] **Step 3: 1.1.0 で通ることを確かめる**

```powershell
& "$sp\qa-server.ps1" -Action stop
& "$sp\qa-server.ps1" -Action start -Jars "$r\BridgeMod\build\libs\bridgemod-1.7.0.jar", "$r\SaikutuMod\build\libs\saikutumod-1.1.0.jar"
node no-limits.cjs
```

Expected: `PASS` 5件と `no limits: 5 tests passed`。重さを `server-out.log` の `Can't keep up` で見て、衝撃波の間に大きく遅れるなら `WAVE_BLOCK_BUDGET` を下げることを検討し（範囲は削らない）、決めたことを記録する。

- [ ] **Step 4: 検証サーバーを止めて消す**

```powershell
& "$sp\qa-server.ps1" -Action stop
& "$sp\qa-server.ps1" -Action unlink
& "$sp\qa-server.ps1" -Action remove
```

- [ ] **Step 5: コミット・push・PR・CI・レビュー**

```powershell
git add BridgeMod/test/no-limits.cjs
git commit -m "test(saikutumod): 強さの上限なしの実機テストに TNT大爆発の衝撃波・洪水・木を足す"
git push -u origin feat/saikutu-shockwave
gh pr create --base main --head feat/saikutu-shockwave --title "feat(saikutumod): TNT大爆発を N 倍の衝撃波にし、採掘MODの上限をなくす（1.1.0）" --body-file <PR本文のファイル>
```

本文には、衝撃波の形（横48×N・上下11×N、毎秒40ブロック、予算50,000）、えぐる範囲と残すもの、実機テストの結果（直す前は落ち、1.1.0 で通る、測った深さ）、既存の利用者は採掘を選び直すまで古い版のままになることを書く。CI の成功とレビューを経て、ユーザーの許可を得てからマージ。

### Task 8: 開発版のアプリでの確認と HANDOFF

- [ ] **Step 1: 開発版で確かめる**

2026-10-11 と同じ手順（メモ `electron-dev-device-check`）：閉じる → 退避（`bridge\node`・`bridge\node_modules` は除く）→ `npm run dev:refresh` → 開発版で採掘に切り替えて一括起動 → ユーザーに Minecraft で入ってもらう。

- テスト発火で TNT大爆発（数を2に）を押してもらい、TNT が降ってきたあとに衝撃波が広がって地形がえぐれることを見てもらう（頭上の TNT の連鎖で約10分重くなる。ユーザーは承知）。
- テスト発火でスーパージャンプ（数を20）を押してもらい、高く上がって低速落下なしで落ちることを見てもらう。

終わったら退避から戻し、一覧と照合する。D 側は `git restore bridge/` と、未追跡ファイルを退避フォルダーへ移す。

- [ ] **Step 2: HANDOFF04 を更新して docs の PR にする**

やったこと（PR 番号・マージコミット・実機テストの結果・測った深さ）、次にやること、リリースノートに書くこと（既存の利用者は採掘を選び直す）を書く。ブランチ `docs/handoff-<日付>` で PR を作り、CI の成功後にマージする。
