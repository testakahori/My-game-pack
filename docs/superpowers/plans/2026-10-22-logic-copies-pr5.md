# 処理のコピー PR5（コマンドの参照の数え方・無効の扱い・ギフト割り当ての整え方・小さい関数）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定の中のコマンドの参照を1つの数え方で数え、`enabled: false` のギフト割り当ては BRIDGE も動かさない。ギフト割り当ての「使う形」を1つの関数にし、`clampInt` と `boundedInt` を1つにする（設計書の 10 の前半と 3 の最後）。

**Architecture:** 参照の数え方は今の `bridge/command_files.cjs` の `commandFileRefs` を正本にし（ギフト割り当ての `enabled` を足す）、配信前チェック・ゲームの候補の確かめ・ゲームの切り替えもそれを使う。ギフト割り当ての使う形は新しい `bridge/gift_mappings.cjs` の `giftMappingOf`・`giftMappingsById` に置き、BRIDGE の起動と再読込、テンプレートが使う。範囲の丸めは `bridge/event_rules.cjs` の `boundedInt` だけにする。

**Tech Stack:** Node.js（CommonJS、node:test）、BRIDGE の試験台（`electron/test/helpers/bridge-fixture.cjs`）、React と TypeScript（画面の小さな関数は `src/lib/*.ts` に置き、テストは esbuild で読む）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md（10 の「設定の中のコマンドの参照の数え方」「ギフト割り当ての整え方」と、3 の「同じ動きの小さい関数」）。

**PR の分け方（設計書 12。2026-10-22 ユーザーの決定）:** 残りを3本に分ける。この PR5 は参照の数え方・無効の扱い・ギフト割り当て・小さい関数。PR6 はゲーム ID の一覧・ゲーム専用の判定・MOD ID とパックの key（設計書の 6。Java との契約テスト。`game_profiles.cjs` の `withoutOtherGameCommands` もここ）。PR7 は音・粒子の ID（10 の最後）と、前から残っている問題（`foo.txt.txt`・`../x.txt`・ルーレットの判定の大文字小文字・`gift_templates.cjs` の `missing()`・画面の写し・TikTok ID の画面の写し・TTS の数の丸めの重複）。

## Global Constraints

- 参照として数えるのは「BRIDGE が動かしうるもの」（`commandFileRefs` の今の決まりに、ギフト割り当ての `enabled` を足す）:
  - ギフト割り当て・いいね・シェア・フォロー・訪問・未設定ギフト・コメントギフトのルールは、項目が `enabled: false` なら数えない。
  - ルーレット・デスルーレット・コメントギフトは親の `enabled === true`、投票は `poll.enabled` が真のときだけ中を数える。
  - ルーレットとデスルーレットの項目・コンボの段・マイルストーン・コメントコマンドは、項目の `enabled` を見ない（BRIDGE も見ない）。
  - 文字列で書いたコメントコマンド・投票の選択肢（`{"!猫":"missing.txt"}`）も数える。知らない場所の `commandFile` は数えない。
- 参照の名前は `ensureTxt(前後の空白を除いたもの)` にしてから、ファイル名と大文字小文字を区別せずに比べる（BRIDGE と BridgeMOD と同じ）。
- 無効のギフト割り当て（2026-10-22 ユーザーの決定）: そのギフトが届いたら割り当てのコマンドを動かさず、未設定ギフトにも回さない。クールダウン・連打の数え方・ゲームの数え方（上位者・コンボ・時限倍率）は今のとおり通す。コンボの段にコマンドが書いていなければ何も撃たない（前は割り当てのコマンドを撃っていた）。コマンドを書いたコンボの段は今どおり撃つ。RANDOM の抽選はしない。
- ギフト割り当ての使う形 `giftMappingOf(raw)`: giftId は前後の空白を除いた文字列（空なら `null`）、名前は前後の空白を除き空なら `gift:<giftId>`、コマンドは `ensureTxt(前後の空白を除いたもの)`、回数は `boundedInt(raw.repeat ?? 1, 1, 100, 1)`、`enabled` は `raw.enabled !== false`。同じ giftId は後のものを使う（今の BRIDGE と同じ）。
- 範囲の丸めは `boundedInt(value, min, max, fallback = min)` の1つ。`clampInt` はなくす（今の呼び出しはどれも fallback を渡すので結果は同じ）。
- 新しい `bridge/gift_mappings.cjs` は `package.json` の `build.files` に足す（electron が読む。配布のテストが確かめる）。
- ipc の名前・画面の見た目は変えない。作業は D 側の作業コピーのブランチ `fix/logic-copies-5`（main の d2b79a8 から切った）。git は PowerShell、`git add` の前に `git hash-object -w <file>`、commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。追跡していない `docs/soutenmon/StreamToEarn_code/` には触らない。コメントは日本語、既存ファイルの改行（CRLF）は変えない。複数行のスクリプトは Write でファイルにしてから実行する。文書にバックスラッシュと英数字の並び（Windows の場所など）を書かない。Edit で値を置き換えるときは、あとに続く空白を落とさない（PR4 の書き損じ）。

## 決めたこと（設計書 14 で作る人に任された所。違っていれば直す）

1. 有効にしていないルーレット・コメントギフト・投票の中の参照は、配信前チェック・保存・ゲームの切り替えで確かめない（BRIDGE も動かさない）。有効にして保存すると、そのとき確かめる。
2. 参照の名前は `.txt` の有無・前後の空白・大文字小文字を区別しない（`cod`・` cod.txt `・`COD.txt` は `cod.txt` があれば通る）。前の保存とゲームの切り替えは、ファイル名と1文字も違わなければエラーにしていた。
3. エラーの文の場所は、`mappings.0` のような点つなぎから `ギフト割り当て（バラ）` のような名前に変わる（`commandFileRefs` の名前）。
4. テスト発火で無効の割り当てのギフトを試すと「このギフトの割り当ては無効です（enabled: false）。コマンドは動かさず、ゲームの数え方にだけ入ります。」と出す（本番と同じく数えるだけ）。未設定ギフトのテストでは今どおり「設定済み」として断る。
5. 保存の形は今のまま（画面が送る名前など）。ただし、ギフト設定の画面とテンプレートは `enabled: false` を落とさない。1件の保存（`updateGiftMapping` と画面の `GiftCommandDialog.tsx`）は、giftId の前後の空白を除いて同じギフトとみなす（前は空白の付いた行を別のギフトとして、もう1行足していた）。テンプレートの名前が空なら `gift:<giftId>`（前は giftId）。画面の入力の既定（名前が空ならギフト ID）と、配信ホームの localStorage からの古い道はそのまま。
6. `bridge/index.js` の同じ計算の二重（いいねの閾値・デスルーレットの回数を `boundedInt` の前にもう一度丸めている所）は、ログだけなのでそのまま。

## Review Focus

1. 手で `enabled: false` にしたギフト割り当てのギフトが届いても、そのコマンドも未設定ギフトのコマンドも撃たず、コンボの回数には入ること（コマンドのないコンボの段は撃たず、コマンドのある段は撃つ）→ Task 3 の BRIDGE を動かすテスト。
2. ギフト設定の画面で別のギフトを足しても、手で書いた `enabled: false` が消えないこと → Task 5 のテスト。
3. 文字列で書いたコメントコマンド（`{"!猫":"missing.txt"}`）が、配信前チェックで「見つからないファイル」として出て、ほかのゲームのコマンドなら保存で止まること → Task 1・Task 2 のテスト。
4. 有効にしていないルーレットの項目が、配信前チェックのエラーにならないこと → Task 1 のテスト。
5. giftId の前後に空白がある保存済みの割り当てを画面で直しても、同じギフトの行がもう1つできないこと → Task 5 のテスト。

---

### Task 1: 参照の数え方を1つにする（ギフト割り当ての無効・配信前チェック）

**Files:**
- Modify: `bridge/command_files.cjs:55-90`（`commandFileRefs` のギフト割り当てに `{ honorsEnabled: true }`。コメントを今の決まりに合わせる）
- Modify: `electron/preflight.cjs:39-47`（`collect` をなくし、`commandFileRefs(cfg)` の `commandFile` の集合を使う）
- Test: `electron/test/command-files.test.cjs:42-58`、`electron/test/settings-safety.test.cjs`

**Interfaces:**
- Produces: `commandFileRefs(config) => Array<{ where: string, commandFile: string }>`（形は今と同じ。ギフト割り当ての `enabled: false` を数えない）。Task 2 も使う。

- [ ] **Step 1: テストを書く**
  - `command-files.test.cjs` の「無効にしてある設定は…」（42行）の、`enabled: false` のギフト割り当てを数える期待を「数えない」に直す（ルーレットの項目・コンボは今どおり数える）。
  - `settings-safety.test.cjs` の「配信前チェック: 接続・一覧の新鮮さ・コマンド・音声を独立判定」に足す:

```js
  // 参照の数え方は command_files.cjs の commandFileRefs の1か所（処理のコピー PR5）。BRIDGE が動かすものだけを数える。
  write(p.config, { ...cfg, options: { gameplay: { commentCommands: { '!猫': 'missing.txt' } } } });
  assert.match((await runPreflight(deps)).checks.find(row => row.id === 'commands').detail, /missing\.txt/, '文字列で書いたコメントコマンドも数える');
  write(p.config, { ...cfg, mappings: [{ giftId: '1', commandFile: 'missing.txt', enabled: false }, ...cfg.mappings], roulette: { items: [{ commandFile: 'missing.txt' }] } });
  assert.equal((await runPreflight(deps)).checks.find(row => row.id === 'commands').status, 'ok', '無効の割り当て・有効にしていないルーレットは数えない');
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/command-files.test.cjs electron/test/settings-safety.test.cjs` / Expected: FAIL（無効の割り当てを数える、文字列のコメントコマンドを見ない、有効にしていないルーレットを数える）。
- [ ] **Step 3: 直す**（Files のとおり。配信前チェックの文「N種類の参照コマンドを確認しました」の N は、今と同じく前後の空白を除いた名前の種類の数）。
- [ ] **Step 4: 動かす** — Expected: PASS。
- [ ] **Step 5: commit**（「fix: 参照の数え方を1つにし、無効のギフト割り当てと有効にしていない設定を数えない（配信前チェックも）」）

---

### Task 2: ゲームの候補の確かめと切り替えも同じ数え方を使う

**Files:**
- Modify: `electron/game_command_scope.cjs:18-32`（`walk` をなくし、`commandFileRefs(config)` の各参照を `ensureTxt(ref.commandFile).toLowerCase()` で、候補の名前を小文字にした集合と比べる。エラーの文は `選択したゲームでは使えないコマンドです: <名前>（<ref.where>）。TOPでゲームを確認してください。`）
- Modify: `electron/game_profiles.cjs:224-232`（`checkCommands` を同じ形にする。文は今の「保存済みの設定で使うコマンドがありません: <名前>。…」のまま）
- Test: `electron/test/game-command-scope.test.cjs`、`electron/test/game-profiles.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `commandFileRefs`、`ensureTxt`（`bridge/command_files.cjs`）。

- [ ] **Step 1: テストを書く**
  - `game-command-scope.test.cjs` の 20 行目の例のうち、ルーレット・デスルーレット・コメントギフトを `enabled: true` にし、`commentCommands: { '!x': file.commandFile }`（文字列）と `poll: { enabled: true, options: { 1: file.commandFile } }` を足す。28 行目の例は設定の一番上の `commandFile` ではなく `mappings: [{ commandFile }]` に書く。次のテストを足す:

```js
test('BRIDGE が動かさない設定は確かめず、名前は .txt・前後の空白・大文字小文字を区別しない（処理のコピー PR5）', () => {
  const other = 'game_saikutu_get_ender_pearl.txt';
  for (const value of [{ mappings: [{ commandFile: other, enabled: false }] }, { roulette: { items: [{ commandFile: other }] } }, { likeEvents: [{ commandFile: 'missing.txt', enabled: false }] }]) {
    assert.doesNotThrow(() => assertGameCommands(value, names, status('common')), JSON.stringify(value));
  }
  for (const commandFile of ['cod', ' cod.txt ', 'COD.txt']) assert.doesNotThrow(() => assertGameCommands({ mappings: [{ giftId: '1', commandFile }] }, names, status('common')), commandFile);
  assert.throws(() => assertGameCommands({ mappings: [{ giftId: '1', name: 'バラ', commandFile: other }] }, names, status('common')), /使えないコマンドです: game_saikutu_get_ender_pearl\.txt（ギフト割り当て（バラ））/);
});
```

  - `game-profiles.test.cjs` に、切り替え先のプロフィールに文字列のコメントコマンド `{ '!x': 'missing.txt' }` があれば「保存済みの設定で使うコマンドがありません: missing.txt」で止まり、`enabled: false` の割り当ての `missing.txt` では止まらないテストを足す（83 行目「ゲーム更新で保存済みのコマンドが欠ける場合は切替を止める」と同じ下準備を使う）。

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/game-command-scope.test.cjs electron/test/game-profiles.test.cjs` / Expected: FAIL（文字列のコメントコマンドを見ない、無効の割り当てで止まる、`cod` で止まる）。
- [ ] **Step 3: 直す**（Files のとおり）。
- [ ] **Step 4: 動かす** — Run: `npm run test:app` / Expected: `ℹ fail 0`（`app-regressions` のゲームの選択の ipc のテストも含む）。
- [ ] **Step 5: commit**（「fix: ゲームの候補の確かめと切り替えも同じ参照の数え方を使う（文字列のコメントコマンド・.txt・大文字小文字）」）

---

### Task 3: BRIDGE のギフト割り当てを1つの関数で作り、無効の割り当ては数えるだけにする

**Files:**
- Create: `bridge/gift_mappings.cjs`、`electron/test/gift-mappings.test.cjs`、`electron/test/bridge-disabled-mapping.test.cjs`
- Modify: `bridge/index.js`（1166〜1178 行目と 1194〜1204 行目の割り当ての作り方を `giftMappingsById` に。`handleGift` の 1772〜1800 行目。2331 行目のテスト発火に無効の ID を渡す）、`bridge/test_fire.cjs:24-45`、`package.json`（`build.files` に `bridge/gift_mappings.cjs`）
- Test: `electron/test/test-fire-actions.test.cjs`

**Interfaces:**
- Produces（`bridge/gift_mappings.cjs`）:
  - `giftMappingOf(raw: any) => null | { giftId: string, name: string, commandFile: string, repeat: number, enabled: boolean }`（Global Constraints のとおり）。
  - `giftMappingsById(list: any) => Map<string, ReturnType<typeof giftMappingOf>>`（配列でなければ空。`null` は飛ばす。同じ giftId は後のもの）。
- Produces（`bridge/test_fire.cjs`）: `testEventActions(input, { mappedGiftIds = new Set(), disabledGiftIds = new Set() } = {})`。`mapped_gift`・`combo` で ID が `disabledGiftIds` にあれば、actions は今どおり作り、notes に決めたこと 4 の文を足す。

- [ ] **Step 1: テストを書く**

`electron/test/gift-mappings.test.cjs`:

```js
test('ギフト割り当ての使う形: giftId・名前・コマンドを整え、回数を 1〜100 に収め、enabled:false だけを無効にする', () => {
  assert.deepEqual(giftMappingOf({ giftId: ' 5655 ', name: ' ', commandFile: ' zombie ', repeat: 500, enabled: false }), { giftId: '5655', name: 'gift:5655', commandFile: 'zombie.txt', repeat: 100, enabled: false });
  assert.deepEqual(giftMappingOf({ giftId: 7, name: 'バラ', commandFile: 'TNT.TXT' }), { giftId: '7', name: 'バラ', commandFile: 'TNT.TXT', repeat: 1, enabled: true });
  assert.deepEqual([giftMappingOf({ giftId: '  ' }), giftMappingOf(null)], [null, null]);
  const byId = giftMappingsById([{ giftId: '1', commandFile: 'a.txt' }, null, { giftId: '1 ', commandFile: 'b.txt' }]);
  assert.deepEqual([...byId.keys()], ['1']);
  assert.equal(byId.get('1').commandFile, 'b.txt', '同じ giftId は後のもの');
  assert.equal(giftMappingsById(undefined).size, 0);
});
```

`electron/test/bridge-disabled-mapping.test.cjs`:

```js
test('無効のギフト割り当て: そのコマンドも未設定ギフトも撃たず、コンボの回数には入る（コマンドのない段は撃たない）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say z\n', cod: 'say cod\n', boom: 'say boom\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1, enabled: false }, { giftId: '2', name: 'ハート', commandFile: 'cod.txt', repeat: 1 }],
      unmappedGiftEvent: { enabled: true, commandFile: 'cod.txt', repeat: 1 },
      options: { gameplay: { combo: { windowMs: 10000, levels: [{ count: 2, repeat: 1 }, { count: 3, commandFile: 'boom.txt', repeat: 1 }] } } } } });
  for (let i = 1; i <= 3; i++) await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: i, repeatEnd: i === 3 ? 1 : 0 });
  await bridge.emit('WebcastGiftMessage', { giftId: '2', gift: { name: 'ハート' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'enabled gift');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.key).sort(), ['boom', 'cod']);
});
```

`electron/test/test-fire-actions.test.cjs` に足す:

```js
test('無効の割り当てのギフトは、本番と同じく通したうえで「割り当ては無効です」と知らせる（処理のコピー PR5）', () => {
  const result = testEventActions({ type: 'mapped_gift', giftId: '1', count: 2 }, { mappedGiftIds: new Set(['1']), disabledGiftIds: new Set(['1']) });
  assert.equal(result.actions.length, 2);
  assert.match(result.notes.join(''), /割り当ては無効です（enabled: false）/);
});
```

`electron/test/config-defaults.test.cjs` の「既定値の写し: BRIDGE は…」に足す（同じ式を自分で持たない）:

```js
  const index = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  // 送る列の名前（`gift:${giftId}`）には当てず、名前の既定（|| `gift:${…}`）だけを探す。
  assert.doesNotMatch(index, /\|\|\s*`gift:\$\{/, 'ギフト割り当ての名前の既定を自分で作らない');
  assert.equal(index.split('giftMappingsById(').length - 1, 2, '起動と再読込の両方で使う');
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/gift-mappings.test.cjs electron/test/bridge-disabled-mapping.test.cjs electron/test/test-fire-actions.test.cjs electron/test/config-defaults.test.cjs` / Expected: FAIL（モジュールがない、無効の割り当てが `zombie` を撃つ、知らせがない、写しがある）。
- [ ] **Step 3: 直す**
  - `bridge/gift_mappings.cjs`（Interfaces のとおり。`ensureTxt` は `command_files.cjs`、`boundedInt` は `event_rules.cjs` から）。
  - `bridge/index.js`: 起動と再読込で `giftMappingsById(...)` を使う。`handleGift` は、割り当てが無効なら RANDOM の抽選をせず（`resolveRandomizedMapping` を呼ばない）、クールダウン・連打の差分・`recordGift` は今どおり通し、`recordGift` には `commandFile: ""` を渡す（コマンドのないコンボの段は `emitFeature` が飛ばす）。`recordGift` のあと、無効なら `ctx.log("[Gift] (disabled) id=… name=… from=…")` を出して return する。テスト発火には `disabledGiftIds`（無効の割り当ての ID の集合）も渡す。
  - `bridge/test_fire.cjs`: Interfaces のとおり。
  - `package.json` の `build.files` に `bridge/gift_mappings.cjs`。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:bridge` / Expected: PASS、`=== done: 15 passed, exitCode=0 ===`。
- [ ] **Step 5: commit**（「fix: BRIDGE のギフト割り当てを1つの関数で作り、無効の割り当ては数えるだけにする」）

---

### Task 4: `clampInt` をなくし `boundedInt` の1つにする

**Files:**
- Modify: `bridge/index.js`（383〜387 行目の `clampInt` を消す。呼ぶ所（1532・1544・1709・1785・1790・1920・2042・2108・2164・2220・2260 行目など。`grep -n "clampInt(" bridge/index.js` で全部）を `boundedInt` にする。2395 行目のテスト用の書き出しから `clampInt` を消す）、`bridge/roulette.cjs:31`（回数を `boundedInt(item.repeat ?? 1, 1, 100, 1)` に）
- Test: `electron/test/bridge-minor-fixes.test.cjs`

- [ ] **Step 1: テストを書く**
  - `bridge-minor-fixes.test.cjs` に足す（このファイルの `read` を使う）:

```js
// 同じ動きの小さい関数は1つ（設計書 3。処理のコピー PR5）。
test('範囲の丸めは event_rules.cjs の boundedInt の1つ（BRIDGE とルーレットに写しを持たない）', () => {
  for (const file of ['bridge/index.js', 'bridge/roulette.cjs']) assert.doesNotMatch(read(file), /clampInt|Math\.max\(1, Math\.min\(100, Math\.floor/, file);
});
```

  - `roulette.test.cjs` に足す（1つ目のテストと同じ `fixture(t)` を使う。直す前も後も同じ結果になることを見張る）:

```js
test('ルーレットの回数の丸めは前と同じ（0・空・数でない値は 1、小数は切り捨て、100 を超えたら 100）', t => {
  const { dir } = fixture(t);
  const repeats = [0, '', 'x', 2.9, 500].map(repeat => prepareRoulette({ items: [{ commandFile: 'zombie.txt', repeat }] }, dir, () => 0).winner.repeat);
  assert.deepEqual(repeats, [1, 1, 1, 2, 100]);
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/bridge-minor-fixes.test.cjs electron/test/roulette.test.cjs` / Expected: 写しのテストが FAIL（回数の丸めは今も同じ結果なので PASS。直したあとも同じであることを見張る）。
- [ ] **Step 3: 直す**（Files のとおり。`boundedInt` は `bridge/index.js` の `event_rules.cjs` の読み込みに足す）。
- [ ] **Step 4: 動かす** — Run: `npm run test:bridge` と Step 2 / Expected: PASS。
- [ ] **Step 5: commit**（「refactor: clampInt をなくし、範囲の丸めを boundedInt の1つにする」）

---

### Task 5: アプリと画面がギフト割り当ての `enabled` と giftId の空白を落とさない

**Files:**
- Modify: `electron/gift_mapping.cjs:5-18`（同じギフトかを `String(row.giftId).trim() === giftId.trim()` で決め、書く giftId と名前は前後の空白を除いたもの。ほかの項目は今どおり残す）
- Modify: `electron/gift_templates.cjs:11-31`（`enabled: false` の行は `enabled: false` を残す。名前は `giftMappingOf(row).name`）
- Create: `src/lib/giftMappingRows.ts`（`fromConfigMappings(cfg: any, makeId: () => string): GiftMapping[]`・`toConfigMappings(list: GiftMapping[]): object[]`。今の `GiftSettingsPage.tsx` の `configToGiftMappings`（48〜62 行目）と `persistMappingsToConfig` の中の形（90〜95 行目）を移し、`enabled === false` を残す）
- Modify: `src/components/GiftSettingsPage.tsx`（上の2つを使う）、`src/types.ts`（`GiftMapping` に `enabled?: boolean`）、`src/components/GiftCommandDialog.tsx:39`（`String(row.giftId).trim() === giftId`）
- Test: `electron/test/gift-mapping.test.cjs`、`electron/test/gift-templates.test.cjs`、Create `electron/test/gift-mapping-rows.test.cjs`

- [ ] **Step 1: テストを書く**
  - `gift-mapping.test.cjs`:

```js
test('giftId の前後に空白がある保存済みの行も同じギフトとして直し、もう1行足さない（処理のコピー PR5）', () => {
  const spaced = { giftId: ' 5655 ', name: 'バラ', commandFile: 'heal.txt', repeat: 1, enabled: false };
  const next = updateGiftMapping({ ...config, mappings: [spaced, other] }, { ...request, expected: [spaced] }, commands);
  assert.deepEqual(next.mappings, [{ ...spaced, giftId: '5655', commandFile: 'zombie.txt', repeat: 50 }, other]);
});
```

  - `gift-templates.test.cjs`: `parseTemplate` に `enabled: false` の行と名前の空の行を通し、`enabled: false` が残り、名前が `gift:<giftId>` になること。保存（`save`）でも `enabled: false` が残ること（今の保存のテストの下準備を使う）。
  - `gift-mapping-rows.test.cjs`（`ui-safety.test.cjs` の `loadTs` と同じく esbuild の `transformSync` で `src/lib/giftMappingRows.ts` を読む）:

```js
test('ギフト設定の画面: 設定から読んで書き戻しても enabled:false を落とさない（処理のコピー PR5）', () => {
  const rows = fromConfigMappings({ mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: 2, enabled: false }, { giftId: '2', name: '', commandFile: 'b.txt' }] }, () => 'id');
  assert.deepEqual(toConfigMappings(rows), [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: 2, enabled: false }, { giftId: '2', name: '2', commandFile: 'b.txt', repeat: 1 }]);
});
```

  - `GiftCommandDialog.tsx` は、`electron/test/config-defaults.test.cjs` の画面のテストに `assert.match(read('src/components/GiftCommandDialog.tsx'), /String\(row\.giftId\)\.trim\(\) === giftId/)` を足す。

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/gift-mapping.test.cjs electron/test/gift-templates.test.cjs electron/test/gift-mapping-rows.test.cjs electron/test/config-defaults.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**（Files のとおり）。
- [ ] **Step 4: 動かす** — Run: `npm run verify` / Expected: typecheck・test:bridge・test:app（`ℹ fail 0`）・build が通る。
- [ ] **Step 5: commit**（「fix: アプリと画面がギフト割り当ての enabled と giftId の空白を落とさない」）

---

### Task 6: 記録

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「処理のコピー」の PR5 の節：やったこと・決めたこと 1〜6・`npm run verify` の数・リリースノートに足すこと）

リリースノートに足すこと:
- 設定で `enabled: false` にしたギフト割り当ては、そのギフトが届いてもコマンドを動かさず、未設定ギフトにも回しません（ギフトの上位者やコンボの回数には入ります）。
- コメントコマンドや投票に書いたコマンドがないとき、配信前チェックで知らせます。
- ギフト設定の画面で保存しても、手で書いた `enabled: false` が消えなくなりました。

- [ ] **Step 1: HANDOFF を書く**
- [ ] **Step 2: `npm run verify`** — Expected: すべて通る。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR5 を書く」）
