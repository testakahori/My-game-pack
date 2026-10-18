# 処理のコピー PR2（配信中に保存した設定を再起動なしで効かせる）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配信中に保存したミュート・クールダウン・ゲームの設定などを、BRIDGE を再起動しなくても効かせる。再起動が要る「つなぎ方」の設定を変えたときは、BRIDGE のログと配信ホームに「BRIDGE を再起動すると反映されます」と出す（設計書の 8）。

**Architecture:** `options` から BRIDGE が使う値を作る式を `bridge/live_config.cjs` の1か所にまとめ、BRIDGE は起動のときと設定の再読込のときの両方でそれを使う（今は起動のときに `const` で1回だけ作っている）。つなぎ方の設定は、起動したときの値と再読込した値を比べ、違うものの名前を `runtime-status.json` の `pendingRestart` に書く。アプリは `bridge:processStatus` でそれを読み、配信ホームに出す。

**Tech Stack:** Node.js（CommonJS、node:test）、React（配信ホーム）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md

## Global Constraints

- 保存したらすぐ効かせるもの（設計書 8）: `mutedUsers`・`ttsNgWords`・`giftCooldownMs`・`maxCommandsPerGift`・`maxLikeCatchUpPerEvent`・`likeBatchWindowMs`・`logUnknownGifts`・アナウンス（`announceFunction`・`announceStorage`・`announceEveryRepeat`・`announceEnabled`）・`gameplay`・`protection`。考え方は「つなぎ方以外の `options` 全部」なので、`rconQueueWarnSize` も入れる。
- `gameplay` は、今の状態（いいねの累計・連打・上位者など）を保ったまま設定だけ差し替える（`FeatureEngine` を作り直さず `config` を入れ替える）。
- 再起動が要るもの（つなぎ方）: TikTok ID（`tiktokUsername`）、送り方（`commandTransport`）、BridgeMOD のホスト・ポート（`bridgeModHost`・`bridgeModPort`。旧い `doumaModHost`・`doumaModPort` も）、RCON・Telnet（`target`・`rcon`）、コマンドの場所（`commandsDir`）。BRIDGE はこれらを起動したときの値のまま動き続ける。
- つなぎ方を変えて保存したら、BRIDGE のログに `[Config] BRIDGE を再起動すると反映されます: <名前>`（名前は `・` でつなぐ）を出し、配信ホームに「BRIDGE を再起動すると反映されます（<名前>）。」を出す。名前は「TikTok ID」「送り方」「BridgeMOD のホスト」「BridgeMOD のポート」「RCON・Telnet の接続先」「コマンドの場所」。
- 再読込で設定にエラーがあるときは、今と同じく直前の設定のまま動き続ける（すぐ効かせる値も変えない）。
- 値を作る式は今の BRIDGE のまま（既定値・範囲の丸めを変えない。厳しい確かめは PR3）。
- ipc の名前は変えない。画面は配信ホームに案内を1つ足すだけ。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `fix/logic-copies-2`（main の c5c561b から切った）。git は PowerShell、`git add` の前に `git hash-object -w <file>`、commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。文書の場所は `/` 区切り。コメントは日本語、既存ファイルの改行（CRLF）は変えない。
- 見えない文字（BOM・全角空白など）をテストに書くときは `\u` のエスケープで書く。バッククォートや `\` を含む複数行のスクリプトは Bash の heredoc・`node -e` に書かず、Write でファイルにしてから実行する。

## Review Focus

1. 再読込した設定にエラーがあるとき、ミュートなどのすぐ効かせる値も前のまま残ること → Task 2 のミュートのテストで、エラーのある設定を書いたあとも止めたままであることを確かめる。
2. いいねをまとめる時間を変えたとき、まとめている途中のいいねを落とさず、次のまとまりから新しい時間になること → Task 2 の `createLikeBatcher` のテストで確かめる。
3. ゲームの設定を差し替えても、いいねの累計・連打・上位者の数え方が最初からやり直しにならないこと → Task 2 で、再読込が `FeatureEngine` を作り直さず `config` を入れ替えることを確かめる。
4. つなぎ方以外（ギフトの割り当て・ミュートなど）だけを変えたときは「再起動で反映」を出さないこと、つなぎ方を元に戻したら案内が消えること → Task 1 の `restartRequired` のテストと Task 2 の結合テストで確かめる。
5. BRIDGE を起動し直したら、前の「再起動で反映」が残らないこと → Task 2 で、起動のときに `pendingRestart` を空にすることを確かめる。

---

### Task 1: 値を作る式とつなぎ方の比べ方を `bridge/live_config.cjs` にまとめる

**Files:**
- Create: `bridge/live_config.cjs`
- Create: `electron/test/live-config.test.cjs`

**Interfaces:**
- Produces:
  - `liveOptions(options: object) => { giftCooldownMs, maxCommandsPerGift, maxLikeCatchUpPerEvent, rconQueueWarnSize, likeBatchWindowMs, logUnknownGifts, mutedUsers, ttsNgWords, announceFunction, announceStorage, announceEveryRepeat, announceEnabled, protection, gameplay }`。式は今の `bridge/index.js:1033-1060`・`:1955` と同じ（`giftCooldownMs` は `Number(options.giftCooldownMs ?? 300)`、`maxCommandsPerGift` は `Number(options.maxCommandsPerGift ?? 200)`、`maxLikeCatchUpPerEvent` は 1〜100 で既定 5、`rconQueueWarnSize` は 1〜10000 で既定 20、`likeBatchWindowMs` は 100〜10000 で既定 1200、`mutedUsers` は配列でなければ `[]`、`ttsNgWords` は文字列にして前後の空白を除き空を捨てる、`announceFunction` の既定 `"gift_stream:_announce"`・`announceStorage` の既定 `"gift_stream:bridge"`（前後の空白を除く）、`announceEveryRepeat`・`announceEnabled` は `!== false`、`protection` の既定 `{ enabled: false }`、`gameplay` の既定 `{}`）。範囲の丸めは `bridge/event_rules.cjs` の `boundedInt` を使う（`clampInt` と同じ動き）。
  - `restartRequired(started: object, next: object) => string[]`。つなぎ方の名前を、Global Constraints の順で、`started` と `next` で値が違うものだけ返す。比べる値: TikTok ID は前後の空白を除いたもの、送り方は小文字にして前後の空白を除き空なら `"rcon"`、ホストは `bridgeModHost || doumaModHost || "127.0.0.1"` の前後の空白を除いたもの、ポートは `Number(bridgeModPort || doumaModPort || 25576)`、RCON・Telnet は `JSON.stringify({ target, rcon })`、コマンドの場所は `commandsDir || "commands"`。

- [ ] **Step 1: テストを書く**

```js
test('すぐ効かせる値: 今の BRIDGE と同じ式で作る（既定値と範囲の丸め）', () => {
  assert.deepEqual(liveOptions({}), { giftCooldownMs: 300, maxCommandsPerGift: 200, maxLikeCatchUpPerEvent: 5, rconQueueWarnSize: 20, likeBatchWindowMs: 1200,
    logUnknownGifts: false, mutedUsers: [], ttsNgWords: [], announceFunction: 'gift_stream:_announce', announceStorage: 'gift_stream:bridge',
    announceEveryRepeat: true, announceEnabled: true, protection: { enabled: false }, gameplay: {} });
  const v = liveOptions({ maxLikeCatchUpPerEvent: 500, likeBatchWindowMs: 50, ttsNgWords: [' a ', '', 3], mutedUsers: ['troll'], announceEnabled: false, gameplay: { timedMode: { multiplier: 2 } } });
  assert.deepEqual([v.maxLikeCatchUpPerEvent, v.likeBatchWindowMs, v.ttsNgWords, v.mutedUsers, v.announceEnabled, v.gameplay.timedMode.multiplier], [100, 100, ['a', '3'], ['troll'], false, 2]);
});
test('つなぎ方: 違うものの名前だけを決まった順で返す。つなぎ方以外の違いは数えない', () => {
  const started = { tiktokUsername: 'a', rcon: { port: 25575 }, options: { commandTransport: 'bridge_mod', bridgeModPort: 25576, commandsDir: 'commands/minecraft', mutedUsers: [] }, mappings: [] };
  assert.deepEqual(restartRequired(started, { ...started, mappings: [{ giftId: '1' }], options: { ...started.options, mutedUsers: ['x'] } }), []);
  assert.deepEqual(restartRequired(started, { ...started, tiktokUsername: ' b ', options: { ...started.options, bridgeModPort: 25600, commandsDir: 'x' } }), ['TikTok ID', 'BridgeMOD のポート', 'コマンドの場所']);
  assert.deepEqual(restartRequired(started, { ...started, tiktokUsername: ' a ', options: { ...started.options, commandTransport: ' BRIDGE_MOD ' } }), [], '前後の空白・大文字小文字だけの違いは同じ');
  assert.deepEqual(restartRequired(started, { ...started, rcon: { port: 25580 } }), ['RCON・Telnet の接続先']);
  assert.deepEqual(restartRequired({ options: { doumaModPort: 25600 } }, { options: { bridgeModPort: 25600 } }), [], '旧い名前の同じ値は同じ');
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/live-config.test.cjs`
Expected: FAIL（`Cannot find module '../../bridge/live_config.cjs'`）。

- [ ] **Step 3: `bridge/live_config.cjs` を作る**

Interfaces のとおり。`bridge/` の配布物（`build/bridge-bundle`）は esbuild が束ねるので、`package.json` の `build.files` には足さない（electron は読まない）。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/live-config.test.cjs`
Expected: PASS。

- [ ] **Step 5: commit**

```powershell
git add bridge/live_config.cjs electron/test/live-config.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: BRIDGE がすぐ効かせる設定の式と、つなぎ方の比べ方を live_config.cjs にまとめる」
```

---

### Task 2: BRIDGE が再読込ですぐ効かせ、つなぎ方の変更を知らせる

**Files:**
- Modify: `bridge/index.js:1028-1063`（起動のときの値）・`:1165-1200` 付近（`reloadDynamicConfig`）・`:1493`（`featureEngine`）・`:1955-1960`（いいねのまとめ）・`:2262-2264`（テスト発火の `FeatureEngine` といいねのまとめ）
- Modify: `bridge/mod_event_delivery.cjs:116`（`createLikeBatcher` の `windowMs` に関数も受け付ける）
- Create: `electron/test/bridge-live-options.test.cjs`
- Modify: `electron/test/mod-event-delivery.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `liveOptions`・`restartRequired`。
- Produces: `runtime-status.json` の `pendingRestart: string[]`（起動のときに `[]`、再読込のたびに `restartRequired(起動したときの設定, 再読込した設定)`）。Task 3 が読む。`createLikeBatcher({ windowMs })` の `windowMs` は数か、毎回呼ぶ関数。

- [ ] **Step 1: テストを書く**

`electron/test/bridge-live-options.test.cjs`（`electron/test/helpers/bridge-fixture.cjs` の `startBridgeFixture` を使う。設定は `bridge.dir` の `config.json` を一時ファイルに書いて置き換え、ログの `Config reloaded` か `Config reload skipped` が増えるまで待つ。ミュートの送り主の形は `electron/test/bridge-muted-users.test.cjs` に合わせる）:

```js
test('配信中の保存: ミュートは再起動なしで効き、エラーのある設定を書いても前のまま止め続ける', async t => {
  // mutedUsers: [] で起動 → troll のギフトは送る → mutedUsers: ['troll'] を保存 → troll のギフトは送らず、friend のギフトは送る
  // → repeat: 0 のようなエラーのある設定を保存（Config reload skipped）→ troll のギフトはまだ送らない
});
test('配信中の保存: ゲームの設定（時限倍率）は再起動なしで効く', async t => {
  // 1.5倍・repeat 3 で起動 → 回数 5 → 2倍にして保存 → 回数 6
});
test('配信中の保存: つなぎ方を変えたらログと runtime-status.json に再起動で反映と出し、元に戻したら消す。起動のときは空', async t => {
  // 起動直後の runtime-status.json の pendingRestart は []
  // tiktokUsername を 'other' にして保存 → ログに '[Config] BRIDGE を再起動すると反映されます: TikTok ID'、pendingRestart は ['TikTok ID']
  // 'fixture' に戻して保存 → pendingRestart は []
});
test('配信中の保存: 再読込は FeatureEngine を作り直さず config を入れ替える（いいねの累計・連打・上位者を保つ）', () => {
  // bridge/index.js の reloadDynamicConfig の中に new FeatureEngine がなく、featureEngine.config への代入があること
});
```

`electron/test/mod-event-delivery.test.cjs` に足す:

```js
test('いいねのまとめ: windowMs が関数なら、まとまりを始めるたびに読む（途中のまとまりは前の時間のまま、次から新しい時間）', async () => {
  // windowMs: () => current。1つ目のまとまりの途中で current を変えても、そのまとまりは落とさずに送り、次のまとまりで新しい時間を使う
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/bridge-live-options.test.cjs electron/test/mod-event-delivery.test.cjs`
Expected: FAIL（ミュートが再読込で効かない、倍率が 5 のまま、pendingRestart がない、windowMs が関数を受け付けない）。

- [ ] **Step 3: BRIDGE を直す**

- 起動のときの `const` の値（Interfaces の `liveOptions` の項目）を `let` にし、`applyLiveOptions(values)` で一度に入れる。起動のときと、`reloadDynamicConfig` で確かめが通ったあとの両方で `applyLiveOptions(liveOptions(newCfg.options || {}))` を呼ぶ。`isMutedUser` は `createMuteMatcher(values.mutedUsers)` で作り直す。`runtimeProtection` も入れる。
- `featureEngine.config = values.gameplay`（作り直さない）。テスト発火の `new FeatureEngine(...)` は、今のすぐ効かせる `gameplay` を使う。
- いいねのまとめは `windowMs: () => likeBatchWindowMs` にする（`createLikeBatcher` は関数ならまとまりを始めるたびに呼ぶ）。
- 起動したときの設定を覚えておき、再読込のたびに `restartRequired` を計算する。空でなければ `console.warn('[Config] BRIDGE を再起動すると反映されます: ' + names.join('・'))`。どちらの場合も `updateRuntimeStatus({ pendingRestart: names })`。起動のときは `updateRuntimeStatus({ pendingRestart: [] })`。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/bridge-live-options.test.cjs electron/test/mod-event-delivery.test.cjs electron/test/bridge-live-events.test.cjs electron/test/bridge-muted-users.test.cjs electron/test/bridge-minor-fixes.test.cjs electron/test/test-fire-parity.test.cjs`
Expected: PASS。
Run: `npm run test:bridge`
Expected: PASS。

- [ ] **Step 5: commit**

```powershell
git add bridge/index.js bridge/mod_event_delivery.cjs electron/test/bridge-live-options.test.cjs electron/test/mod-event-delivery.test.cjs
git commit -F <メッセージのファイル>   # 「fix: 配信中に保存したミュート・ゲームの設定などを BRIDGE の再起動なしで効かせる」
```

---

### Task 3: 配信ホームに「BRIDGE を再起動すると反映されます」を出す

**Files:**
- Modify: `electron/bridge_process.cjs`（`bridge:processStatus` に `pendingRestart`）
- Modify: `src/components/DashboardPage.tsx:912` 付近（BridgeMOD の認証の失敗の案内の前）
- Test: `electron/test/bridge-process-module.test.cjs`、`electron/test/live-config.test.cjs`

**Interfaces:**
- Consumes: Task 2 の `runtime-status.json` の `pendingRestart`。
- Produces: `bridge:processStatus` の戻り値に `pendingRestart: string[]`（BRIDGE が動いているときだけ `runtime-status.json` の値。止まっていれば `[]`）。

- [ ] **Step 1: テストを書く**

- `bridge-process-module.test.cjs`: BRIDGE を起動し、bridge フォルダーの `runtime-status.json` に `{ "pendingRestart": ["TikTok ID"] }` を書く → `bridge:processStatus` の `pendingRestart` が `['TikTok ID']`。止めたあとは `[]`。
- `live-config.test.cjs`: `src/components/DashboardPage.tsx` が `bridgeProcess.pendingRestart` を読み、「BRIDGE を再起動すると反映されます（」を出すこと（ほかの UI のテストと同じく、ソースを読んで確かめる）。

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/bridge-process-module.test.cjs electron/test/live-config.test.cjs`
Expected: FAIL（`pendingRestart` がない、配信ホームに案内がない）。

- [ ] **Step 3: 直す**

- `bridge:processStatus` の戻り値に `pendingRestart: status.running && Array.isArray(runtime.pendingRestart) ? runtime.pendingRestart : []` を足す。
- 配信ホームは `bridgeProcess.pendingRestart?.length` のとき `<p role="status" className="cockpit-launch-notice cockpit-launch-notice--info">BRIDGE を再起動すると反映されます（{bridgeProcess.pendingRestart.join("・")}）。「BRIDGEだけを操作」の再起動で反映できます。</p>` を出す（`--info` の見た目がなければ、今ある `cockpit-launch-notice` の種類に合わせる）。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/bridge-process-module.test.cjs electron/test/live-config.test.cjs` と `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: commit**

```powershell
git add electron/bridge_process.cjs src/components/DashboardPage.tsx electron/test/bridge-process-module.test.cjs electron/test/live-config.test.cjs
git commit -F <メッセージのファイル>   # 「feat: つなぎ方を変えたら配信ホームに BRIDGE を再起動すると反映されますと出す」
```

---

### Task 4: 全体の確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番の「処理のコピー」）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。

- [ ] **Step 2: HANDOFF を書く**

「処理のコピー」の下に、PR1 のマージ（PR #118、c5c561b）、PR2 でしたこと（すぐ効かせる設定・つなぎ方の案内）、次の配布のリリースノートに足すこと（「配信中に保存したミュート・NG ワード・クールダウン・ゲームの設定などは、BRIDGE を再起動しなくてもすぐ効きます」「TikTok ID などのつなぎ方を変えたときは、配信ホームに再起動の案内が出ます」）、次にやること（PR3：設定の確かめと既定値）を書く。PR 番号は PR を出してから書き足す。

- [ ] **Step 3: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に処理のコピー PR2 を書く」
```
