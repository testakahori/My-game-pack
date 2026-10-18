# 処理のコピー PR3（設定の確かめを1つに・保存済みの設定を直す・TikTok ID）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定（config.minecraft.json）の確かめを1つにし、今どこも確かめていない回数・いいねの閾値・送り方・TikTok ID を確かめる。保存済みの設定はアプリの更新のときに1回だけ直す（設計書の 7 の前半と 9）。

**Architecture:** 確かめは `bridge/config_schema.js` を正本にし、electron は `electron/config_schema.cjs` からそれを読み直すだけにする。保存済みの設定を直す式は `bridge/config_migration.cjs`、TikTok ID の整え方と確かめは `bridge/tiktok_id.cjs` の1か所に置き、アプリ・配信前チェック・LIVE の確かめ・BRIDGE が使う。

**Tech Stack:** Node.js（CommonJS、node:test）、React（入力欄）、TypeScript（`src/lib` の小さな関数。テストは esbuild で読む）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md

**PR の分け方（設計書 12 は「3 と 4 は作る人がもっと細かく分けてもよい」）:** 設計書の PR3 を2本に分ける。この PR3 は確かめ・直し・TikTok ID。既定値の1か所・コマンドの場所・BridgeMOD のホストとポートの読み方・画面の古い名前は PR4、設計書の PR4（参照の数え方・ギフト割り当て・ゲーム）は PR5 にする。

## Global Constraints

- 確かめは1つ: `validateBridgeConfig(config, { previous } = {})`（`bridge/config_schema.js`）。`electron/config_schema.cjs` は `module.exports = require("../bridge/config_schema.js")` だけにする。electron が読む bridge のモジュールは `package.json` の `build.files` に足す（`bridge/config_schema.js`・`bridge/config_migration.cjs`・`bridge/tiktok_id.cjs`）。
- TikTok ID が空の文は、今のアプリの文（「TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。ダッシュボードでIDを入力して承認してください」）にそろえる。
- BridgeMOD が受け付けない名前（設計書 7）: `previous` を渡さないとき（BRIDGE・配信前チェック・バックアップの一覧）は、すべて保存済みとみなして「警告」。`previous`（配列）を渡したとき（アプリの保存・`config:validate`・プリセットの読込）は、その中のどれかに同じ**コマンドの名前**（前後の空白を除いた `commandFile`）があれば警告、なければ「エラー」。前の「場所＋名前」での比べ方（`refKey`）はやめる。
- 回数（`repeat`）は 1〜100 の整数。数の文字列（`"3"`）・小数・範囲外はエラー。書いていない（`undefined`）ものはよい（既定の1）。`enabled: false` の項目も確かめる。対象: `mappings[]`・`likeEvents[]`・`shareEvent`・`followEvent`・`memberEvent`・`unmappedGiftEvent`・`roulette.items[]`・`deathRoulette.items[]`・`commentGifts.rules[]`・`options.gameplay.combo.levels[]`・`options.gameplay.likeMilestones[]`・`options.gameplay.followMilestones[]`・`options.gameplay.commentCommands` の値（オブジェクトのとき）・`options.gameplay.poll.options` の値（オブジェクトのとき）。
- いいねの閾値（`threshold`）は 1 以上の整数。対象: `likeEvents[]`・`options.gameplay.likeMilestones[]`・`options.gameplay.followMilestones[]`。書いていないものはよい。
- 送り方（`options.commandTransport`）は、空か `bridge/command_files.cjs` の知っている名前（`rcon` と、今の `BRIDGE_MOD_TRANSPORTS`。前後の空白と大文字小文字は区別しない。判定は `isKnownTransport(transport)` を足して1か所にする）。知らない名前は警告「options.commandTransport「<値>」は知らない送り方です。RCON として扱います（BridgeMOD で送るなら bridge_mod）」。
- TikTok ID: 前後の空白と先頭の `@` を除いて小文字にし、`^[a-z0-9_.]{1,24}$` に合うか。空ならエラー（上の文）、合わなければエラー「TikTok ID「<入力>」の形が正しくありません。半角英数字・_・. の24文字以内で入力してください」（BRIDGE も起動しない）。保存する形は変えない（設計書 14 で作る人に任された。配信ホームは入力欄の値を `@` を除いただけの形で保存済みの値と比べて「保存していない変更」を出すので、小文字に直して保存するとずっと変更ありになる）。整えるのは使う所（確かめ・配信前チェック・LIVE の確かめ・BRIDGE の接続・再起動が要るかの比べ方）。
- 保存済みの設定の直し（設計書 7、ユーザーの決定）: 回数は四捨五入して 1〜100（数にならないものは 1）、閾値は四捨五入して 1 以上（0・負の数・数にならないものは 1）。上の対象すべて（`enabled: false` も）。送り方と TikTok ID は直さない。
  - アプリの起動のとき（画面が設定を読む前。`createWindow()` より前）、設定に `configVersion` が無いか 2 より小さければ1回だけ直し、`configVersion: 2` を書く。直したものがあれば、直す前に設定のバックアップを取り（理由 `migration`。設定のバックアップの画面では「更新で直す前の自動保存」と出す）、何を直したかをログに残して、ウィンドウを出したあと配信者にダイアログで1回知らせる。直したものがなければバックアップもダイアログも出さず、`configVersion` だけ書く。設定のファイルが無い・読めないときは何もしない。
  - アプリが設定を書くとき（`writeBridgeConfig`・復元）は、いつも `configVersion: 2` を書く（確かめを通った値なので。画面が送る設定に `configVersion` が無くても、次の起動で手で書き換えた値を黙って直さないように）。
  - 設定のバックアップの復元・プリセットの読込・ギフトのテンプレートの読み込みでも、同じ直しを通してから確かめる。
  - 直したあとは、手で書き換えた正しくない値も含めて、どこでもエラー（アプリの保存・配信前チェック・BRIDGE の起動）。
- 画面の回数と閾値の入力欄は整数だけを受け付ける（`src/lib/integerInput.ts` の `toRepeat`・`toThreshold`）。
- ipc の名前は変えない。作業は D 側の作業コピーのブランチ `fix/logic-copies-3`（main の 5d4f32e から切った）。git は PowerShell、`git add` の前に `git hash-object -w <file>`、commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。作業コピーにある追跡していない `docs/soutenmon/StreamToEarn_code/` には触らない（ユーザーのもの）。文書の場所は `/` 区切り。コメントは日本語、既存ファイルの改行（CRLF）は変えない。見えない文字は `\u` のエスケープで書く。複数行のスクリプトは Write でファイルにしてから実行する。

## Review Focus

1. 更新した配信者の設定に 2.5 回・"3" 回・500 回・閾値 0 があっても、起動のときに1回だけ直り、BRIDGE が起動でき、配信前チェックが通ること。2回目の起動では直さず、バックアップも増えないこと → Task 3 のテストで確かめる。
2. 古いバックアップ（2.5 回など）を戻せること → Task 2 の復元のテストで確かめる。
3. ギフト名やいいねの閾値を変えるだけで、前から保存されていた BridgeMOD が受け付けない名前（`ネコ.txt` など）のせいで保存が止まらないこと → Task 2 のテストで確かめる。
4. `@Foo_Bar` のような ID は整えて受け付け（接続は `foo_bar`）、`foo-bar` は保存・配信前チェック・BRIDGE の起動のどこでも止めること。保存した ID の形は変えないこと（配信ホームが「保存していない変更」を出し続けないように）→ Task 2・Task 4 のテストで確かめる。
5. 入力欄に 2.5 や -1 を入れても、保存される値が整数の範囲に収まること → Task 5 のテストで確かめる。

---

### Task 1: TikTok ID と、保存済みの設定を直す式を1か所に置く

**Files:**
- Create: `bridge/tiktok_id.cjs`、`bridge/config_migration.cjs`
- Create: `electron/test/config-migration.test.cjs`

**Interfaces:**
- Produces:
  - `normalizeTikTokId(value: any) => string`（文字列でなければ `""`。前後の空白と先頭の `@` を除き小文字にする）、`isValidTikTokId(value: any) => boolean`（整えた形が `^[a-z0-9_.]{1,24}$`）。
  - `repeatTargets(config) => Array<{ where: string, item: object }>` と `thresholdTargets(config) => Array<{ where: string, item: object }>`（Global Constraints の対象を、`enabled` を見ずにすべて並べる。`where` は `commandFileRefs`（`bridge/command_files.cjs`）と同じ名前: `ギフト割り当て（バラ）`・`いいね（100いいねごと）`・`シェア`・`ルーレット項目（<label か commandFile>）`・`デスルーレット項目（…）`・`コメントギフト（「…」）`・`コンボ（5連）`・`いいねマイルストーン（100）`・`フォローマイルストーン（10）`・`コメントコマンド（「!creeper」）`・`コメント投票（!1）`。文字列だけで書いたコメントコマンド・投票の選択肢は対象にしない）。Task 2 の確かめも使う。
  - `CONFIG_VERSION = 2`、`migrateBridgeConfig(config: object) => { config: object, changes: string[] }`（`config` は直して `configVersion: CONFIG_VERSION` を付けた写し。元は変えない。`changes` は値を変えたものだけで、前の値は `JSON.stringify` で書く。例: `ギフト割り当て（バラ）の回数 "3" → 3`・`いいね（0いいねごと）の閾値 0 → 1`）。

- [ ] **Step 1: テストを書く**

```js
test('TikTok ID: 前後の空白・先頭の @ を除いて小文字にし、半角英数字・_・. の24文字以内だけを正しいとする', () => {
  assert.equal(normalizeTikTokId('  @Foo_Bar.1 '), 'foo_bar.1');
  assert.deepEqual(['foo_bar', '@Foo', 'a'.repeat(24)].map(isValidTikTokId), [true, true, true]);
  assert.deepEqual(['', 'foo-bar', 'a'.repeat(25), 'ねこ', null].map(isValidTikTokId), [false, false, false, false, false]);
});
test('保存済みの設定を直す: 回数は四捨五入して1〜100、閾値は四捨五入して1以上。無効な項目も直し、元は変えない', () => {
  const original = { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: '3' }, { giftId: '2', name: 'b', commandFile: 'a.txt', repeat: 500 }],
    likeEvents: [{ threshold: 0, commandFile: 'a.txt', repeat: 2.5, enabled: false }],
    shareEvent: { commandFile: 'a.txt', repeat: 'x' },
    options: { gameplay: { combo: { levels: [{ count: 5, commandFile: 'a.txt', repeat: 0 }] }, commentCommands: { '!c': { commandFile: 'a.txt', repeat: 7.4 }, '!s': 'a.txt' } } } };
  const before = JSON.stringify(original);
  const { config, changes } = migrateBridgeConfig(original);
  assert.equal(JSON.stringify(original), before, '元の設定は変えない');
  assert.deepEqual([config.mappings[0].repeat, config.mappings[1].repeat, config.likeEvents[0].repeat, config.likeEvents[0].threshold, config.shareEvent.repeat,
    config.options.gameplay.combo.levels[0].repeat, config.options.gameplay.commentCommands['!c'].repeat, config.options.gameplay.commentCommands['!s']], [3, 100, 3, 1, 1, 1, 7, 'a.txt']);
  assert.ok(changes.includes('ギフト割り当て（バラ）の回数 "3" → 3'));
  assert.ok(changes.includes('いいね（0いいねごと）の閾値 0 → 1'));
  assert.deepEqual(migrateBridgeConfig(config).changes, [], '直したものはもう直さない');
  assert.equal(config.configVersion, CONFIG_VERSION);
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/config-migration.test.cjs` / Expected: FAIL（モジュールがない）。

- [ ] **Step 3: 2つのモジュールを作る**（Interfaces のとおり。`where` の名前は `bridge/command_files.cjs` の `commandFileRefs` の名前に合わせる）。

- [ ] **Step 4: 動かす** — Expected: PASS。

- [ ] **Step 5: commit**（「refactor: TikTok ID の整え方と、保存済みの設定を直す式を1か所に置く」）

---

### Task 2: 設定の確かめを1つにし、足す確かめを入れる

**Files:**
- Modify: `bridge/config_schema.js`（正本。`previous`・回数・閾値・送り方・TikTok ID）
- Modify: `electron/config_schema.cjs`（`require("../bridge/config_schema.js")` だけ）
- Modify: `bridge/command_files.cjs`（`refKey` を消し、`isKnownTransport` を足す）
- Modify: `electron/settings_backups.cjs`（一覧の数え方を復元のときと同じ設定で）
- Modify: `package.json`（`build.files` に `bridge/config_schema.js`・`bridge/config_migration.cjs`・`bridge/tiktok_id.cjs`）
- Test: `electron/test/command-files.test.cjs`、`electron/test/config-schema.test.cjs`（新規）、`electron/test/settings-safety.test.cjs`（バックアップの一覧の今のテストの形に合わせる）

**Interfaces:**
- Consumes: Task 1 の `repeatTargets`・`thresholdTargets`・`normalizeTikTokId`・`isValidTikTokId`・`migrateBridgeConfig`。
- Produces: `validateBridgeConfig(config, { previous } = {}) => { ok, errors, warnings }`（Global Constraints のとおり）。`settings_backups.cjs` の復元と一覧は、同じ関数 `restoredBridgeConfig(snapshot, current)`（バックアップの設定に今のつなぎ方の `options` と `rcon` を戻し、`migrateBridgeConfig` を通したもの。今の `restore` の 99〜104 行の式）を使う。一覧の `issues` は、それを `validateBridgeConfig`（`previous` なし）で確かめたエラーの数。`summary(value, id, current)` は、呼ぶ側（`list`・`create`・`restore`）が1回読んだ今の設定を受け取る（読めなければ `{}`）。

- [ ] **Step 1: テストを書く**

```js
test('確かめは1つ: アプリと BRIDGE は同じ関数を使う', () => {
  assert.equal(require('../config_schema.cjs').validateBridgeConfig, require('../../bridge/config_schema.js').validateBridgeConfig);
});
test('回数・閾値: 1〜100 の整数・1 以上の整数でなければエラー（無効な項目も、ゲームの設定も）。書いていなければよい', () => {
  // repeat: '3'・2.5・0・101 と、gameplay.combo.levels の repeat 500、enabled:false の likeEvents の threshold 0 がそれぞれ場所の名前付きでエラー
  // repeat を書いていない mappings はエラーにしない
});
test('送り方: 知らない名前は警告して RCON 扱い。TikTok ID: 空・形が正しくないものはエラー、@ や大文字は整えれば正しい', () => { /* ... */ });
test('BridgeMOD が受け付けない名前: previous を渡さなければ警告。渡せば、同じコマンドの名前が保存済みなら警告、新しければエラー（ギフト名やいいねの閾値を変えても警告のまま）', () => {
  // 保存済み: mappings [{ name: 'バラ', commandFile: 'ネコ.txt' }]、likeEvents [{ threshold: 100, commandFile: 'ネコ.txt' }]
  // 次: name を 'ローズ'、threshold を 200 に変える → errors なし・warnings あり
  // 次: 'イヌ.txt' を新しく足す → errors に 'イヌ.txt'
});
```

`settings-safety.test.cjs`（または今のバックアップのテスト）に: 今の設定が BridgeMOD で送る設定のとき、`ネコ.txt` があるバックアップの一覧の `issues` は 0（警告は数えない。今は送り方を消して数えている）、`repeat: 2.5` のバックアップも 0（戻すときに直るので）、TikTok ID が `foo-bar` のバックアップは 1。

復元: `repeat: 2.5` のバックアップを戻せて、戻した設定は 3 で `configVersion: 2`（直す前のコードでは 2.5 のまま書かれ、新しい確かめで BRIDGE が起動できなくなる）。

`config-schema.test.cjs` の送り方: `isKnownTransport` は `''`・`' RCON '`・`'bridge_mod'`・`'http'` を知っていて、`'bridge-mod'` を知らない。

- [ ] **Step 2: 動かす** — Expected: FAIL。

- [ ] **Step 3: 直す**（Interfaces のとおり。`bridge/index.js` は今のまま `validateBridgeConfig(config)`（`previous` なし）を使う）。

- [ ] **Step 4: 動かす** — Run: `npm run test:app` と `npm run test:bridge` / Expected: PASS。

- [ ] **Step 5: commit**（「fix: 設定の確かめを1つにし、回数・閾値・送り方・TikTok ID を確かめる」）

---

### Task 3: 保存済みの設定を更新のときに1回だけ直す（復元・プリセット・テンプレートも）

**Files:**
- Modify: `electron/bridge_settings.cjs`（`migrateSavedConfigOnStartup()`・`notifyConfigMigration(changes)` を足す。`writeBridgeConfig` は `configVersion: CONFIG_VERSION` を書く）
- Modify: `electron/main.cjs`（`app.whenReady` の中で、`createWindow()` の前に直し、あとで知らせる）
- Modify: `electron/map_operations.cjs`（プリセットの読込の前に直す）、`electron/gift_templates.cjs`（`parseTemplate` の回数の確かめの前に直す）、`src/components/SettingsBackupsPanel.tsx`（`reasonLabel` に `migration`）
- Test: `electron/test/bridge-settings-module.test.cjs`、`electron/test/app-regressions.test.cjs`（配線）、`electron/test/gift-templates.test.cjs`、今の復元・プリセットのテスト

**Interfaces:**
- Consumes: Task 1 の `migrateBridgeConfig`・`CONFIG_VERSION`、Task 2 の `validateBridgeConfig`・`restoredBridgeConfig`。
- Produces: `bridgeSettings.migrateSavedConfigOnStartup() => { changes: string[] }`。設定が無い・読めない、または `configVersion` が 2 以上なら何もせず `{ changes: [] }`。直したものがあれば `settingsBackups.create("migration")` のあと書き、ログ（`console.log("[Config] 保存済みの設定を直しました: ...")`）。`bridgeSettings.notifyConfigMigration(changes)` は `changes` が空でなければ `dialog.showMessageBox({ type: "info", title: "設定を直しました", message: "古い版で保存した設定の一部を、今の決まりに合わせて直しました。", detail: <直したもの（10件まで、ほかは「ほか N 件」）> + "\n\n直す前の設定は「設定のバックアップ」から戻せます。" })`。main は `const migration = bridgeSettings.migrateSavedConfigOnStartup(); createWindow(); bridgeSettings.notifyConfigMigration(migration.changes);` の順で呼ぶ（直しで例外が出ても起動は止めず、ログに残す）。

- [ ] **Step 1: テストを書く**

- `bridge-settings-module.test.cjs`: 保存済みの設定に `repeat: 2.5`・`"3"`・`500`・`threshold: 0`（`configVersion` なし）→ `migrateSavedConfigOnStartup()` の `changes` が4件、`calls` に `backup:migration`、書いた設定の値が直り `configVersion: 2`、直した設定は `validateBridgeConfig` を通る。`notifyConfigMigration(changes)` でダイアログが1回。もう一度呼ぶ → `changes` は空、バックアップは増えず、`notifyConfigMigration([])` はダイアログを出さない。直すものがない設定（`configVersion` なし）→ バックアップなしで `configVersion: 2` だけ書く。設定のファイルが無い → 何もしない（ファイルを作らない）。`writeBridgeConfig` で保存した設定に `configVersion: 2` が入る。
- プリセット: `repeat: 2.5` のプリセットを読み込める（3 になる）。
- テンプレート: `repeat: 1.5` の行を読み込める（2 になる。今は「1〜100の整数」で止まる）。
- `app-regressions.test.cjs`: main の `whenReady` で `migrateSavedConfigOnStartup` を `createWindow()` より前に、`notifyConfigMigration` をあとに呼ぶこと（ソースの並びで確かめる。`whenReady` は loadApp では動かない）。

- [ ] **Step 2: 動かす** — Expected: FAIL。

- [ ] **Step 3: 直す**（Interfaces のとおり）。

- [ ] **Step 4: 動かす** — Run: `npm run test:app` / Expected: PASS。

- [ ] **Step 5: commit**（「fix: 保存済みの設定を更新のときに1回だけ直す（バックアップを取ってから。復元・プリセット・テンプレートも）」）

---

### Task 4: TikTok ID の確かめを1つにする（配信前チェック・LIVE の確かめ・BRIDGE・保存）

**Files:**
- Modify: `electron/preflight.cjs`（`/^[\w.]{1,24}$/` をやめる）、`electron/tiktok_live_status.cjs`、`bridge/index.js`（接続に使う ID）、`bridge/live_config.cjs`（`restartRequired` の TikTok ID の比べ方）
- Test: `electron/test/tiktok-live-status.test.cjs`、`electron/test/bridge-settings-module.test.cjs`、`electron/test/live-config.test.cjs`、配信前チェックの今のテスト、写しを探すテスト（`electron/test/config-migration.test.cjs` に足す）

**Interfaces:**
- Consumes: Task 1 の `normalizeTikTokId`・`isValidTikTokId`。

- [ ] **Step 1: テストを書く**
  - 保存: `tiktokUsername: ' @Foo_Bar '` は保存でき、書かれる値は入力のまま。`foo-bar` は保存で止まる。
  - LIVE の確かめ・配信前チェックは `foo-bar` をエラーにし、`@Foo` を受け付ける（今のテストの形に合わせる）。
  - 再起動が要るかの比べ方: `restartRequired({ tiktokUsername: '@Foo' }, { tiktokUsername: 'foo' }, base)` は `[]`。
  - BRIDGE: `tiktokUsername: '@Foo'` の設定で、接続に `foo` を使う（今の BRIDGE の起動のテストの形に合わせる。ソースで確かめるなら、接続に渡す値が `normalizeTikTokId(` を通ること）。
  - 写しを探す: `electron/preflight.cjs`・`electron/tiktok_live_status.cjs`・`bridge/index.js` に、ID の正規表現（`[\w.]{1,24}`・`[a-z0-9_.]{1,24}`）の写しが残っていない。

- [ ] **Step 2: 動かす** — Expected: FAIL。

- [ ] **Step 3: 直す**（BRIDGE は `normalizeTikTokId(config.tiktokUsername)` で接続し、ログにも整えた形を出す）。

- [ ] **Step 4: 動かす** — Run: `npm run test:app` と `npm run test:bridge` / Expected: PASS。

- [ ] **Step 5: commit**（「fix: TikTok ID の整え方と確かめを1つにする」）

---

### Task 5: 画面の回数と閾値の入力欄を整数だけにする

**Files:**
- Create: `src/lib/integerInput.ts`、`electron/test/integer-input.test.cjs`
- Modify: `src/components/EventSettingsPage.tsx:452,474`（閾値・回数）、`src/components/EventSettings2Page.tsx:68,192,334,584`、`src/components/MappingEditor.tsx`（`clampRepeat`）、`src/components/GiftCommandDialog.tsx`、`src/components/GiftSettingsPage.tsx:58,93`、`src/components/DashboardPage.tsx:547`

**Interfaces:**
- Produces: `toRepeat(value: unknown): number`（四捨五入して 1〜100、数にならなければ 1）、`toThreshold(value: unknown): number`（四捨五入して 1 以上、数にならなければ 1）。式は Task 1 の直しと同じ。

- [ ] **Step 1: テストを書く**（`electron/test/integer-input.test.cjs`。今の `gift-panel-model.test.cjs` と同じく esbuild で読む）

```js
test('入力欄の回数と閾値: 整数に丸める（保存済みの設定の直しと同じ式）', () => {
  assert.deepEqual([2.5, '3', 500, -1, 'x', 0].map(toRepeat), [3, 3, 100, 1, 1, 1]);
  assert.deepEqual([0, -5, 99.6, 'x'].map(toThreshold), [1, 1, 100, 1]);
});
test('入力欄の回数と閾値: 画面は自分の丸め方を持たず integerInput を使う', () => {
  // 上の Files の画面に「Math.min(100, Math.max(1, Number(」「Math.max(1, Math.min(100, Number(」「threshold: Number(e.target.value) || 1」が残っていない
});
```

- [ ] **Step 2: 動かす** — Expected: FAIL。

- [ ] **Step 3: 直す**（入力欄は `step={1}` を付け、値は `toRepeat`・`toThreshold` を通す）。

- [ ] **Step 4: 動かす** — Run: `node --test electron/test/integer-input.test.cjs` と `npm run typecheck` / Expected: PASS。

- [ ] **Step 5: commit**（「fix: 画面の回数と閾値の入力欄を整数だけにする」）

---

### Task 6: 全体の確かめ・HANDOFF

- [ ] **Step 1:** Run: `npm run verify` / Expected: すべて通る。
- [ ] **Step 2:** HANDOFF の「処理のコピー」に、PR2 のマージ（PR #119、5d4f32e）、PR3 でしたこと、PR の分け方を変えたこと（PR3・PR4・PR5）、次の配布のリリースノートに足すこと（「古い版で保存した設定のうち、回数が整数でないもの・100 を超えるものなどを、更新のときに1回だけ直します（直す前の設定はバックアップに残ります）」「TikTok ID は @ や大文字を整えて使います。形が正しくない ID では BRIDGE を起動しません」）、次にやること（PR4）を書く。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR3 を書く」）
