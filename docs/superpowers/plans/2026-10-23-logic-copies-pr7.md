# 処理のコピー PR7（音・粒子の ID・コマンド名の残り・ルーレットの判定・テンプレートの比べ方・Shift_JIS）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 音・粒子の ID の決まりを DisplayMOD と同じにし（設計書の 10 の最後）、PR1 のレビューから残っていた BRIDGE とアプリの食い違い（`foo.txt.txt`・`../x.txt`・ルーレットの判定の大文字小文字・テンプレートの `missing()`・Shift_JIS の txt）を直す。

**Architecture:** 音・粒子の ID は新しい `bridge/minecraft_ids.cjs` の1か所に置き、`event_rules.cjs`・`roulette.cjs` が使う。DisplayMOD は変えず、`DisplayRequest.from(...)` を呼ぶ比べ役（Parity）で同じ例の一覧を JS と Java に通す。コマンド名は `bridge/command_files.cjs` の `isBridgeCommandFile` を正本のまま強める。ルーレットの判定は `bridge/roulette.cjs` に1つ置く。txt が UTF-8 かの判定は `bridge/command_text.cjs` に1つ置き、設定のバックアップと配信前チェックが使う。

**Tech Stack:** Node.js（CommonJS、node:test）、BRIDGE の試験台、Java 17（javac だけの契約テスト）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md（10 の「音・粒子の ID の確かめ」、13）。残りの問題は HANDOFF04 の「PR1 のレビューで見つけた前からの問題」。PR の分け方（2026-10-23 ユーザーの決定）：この PR7 は BRIDGE とアプリの決まり、PR8 は画面の写し（TikTok ID・コマンドセット・イベント設定②・画像作成・読み上げの数の丸め・画面のルーレットの判定・使われていない `GiftCommandDialog.tsx` を消す）。

## Global Constraints

- 音・粒子の ID（DisplayMOD の `DisplayRequest.resource` と同じ）: 文字列で、空でなく、200 文字以内で、`^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$` に合うもの。JS で正しくないときは、今どおり既定の音・粒子に置き換える（決めたこと 1）。
- BridgeMOD 向けのコマンド名（`isBridgeCommandFile`）: 前後の空白を除いた名前が `/`・`\` を含まず、`.txt`（大文字小文字を問わない）を1つ除いた部分が `BRIDGE_COMMAND_KEY` に合い、その部分がまた `.txt` で終わらないもの。`commandFileProblem` の文: `/`・`\` を含むとき「コマンドファイル名「<名前>」にフォルダーの区切り（/ や \）は使えません。commands/minecraft の中のファイル名だけを書いてください」、`.txt` が2つのとき「コマンドファイル名「<名前>」は終わりに .txt が2つあります。ファイル名を <名前から .txt を1つ除いたもの> に直してください」、それ以外は今の文。
- ルーレットの判定: `.txt` を除いた名前が大文字小文字を区別せず `roulette`。
- UTF-8 の判定: `new TextDecoder("utf-8", { fatal: true })` で読めるか。
- DisplayMOD・BridgeMOD の Java の本体は変えない（契約テストの比べ役だけ足す）。
- ipc の名前・画面は変えない（画面の写しは PR8）。作業は D 側の作業コピーのブランチ `fix/logic-copies-7`（main の 219bd7c から切った）。git は PowerShell、`git add` の前に `git hash-object -w <file>`（権限エラーのときは1つずつ）、日本語のファイル名は `git -c core.quotepath=false diff --name-only` で取る、commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。追跡していない `docs/soutenmon/StreamToEarn_code/` には触らない。コメントは日本語、既存ファイルの改行（CRLF）は変えない。文書にバックスラッシュと英数字の並びを書かない。Edit で値を置き換えるときは、あとに続く空白を落とさない。新しい bridge のファイルは `package.json` の `build.files` に足す（配布のテストが確かめる）。

## 決めたこと（違っていれば直す）

1. 音・粒子の ID は、受け取る側の DisplayMOD の決まりに合わせる（設計書 15）。`a:b:c`・`:x`・`x:`・201 文字以上は断り、`/` のある path（`minecraft:block/stone`）は通す。断ったときの動きは今のまま（JS は既定の音・粒子、DisplayMOD は鳴らさない）。JS が見る値は設定（コメントギフト・ルーレット）、DisplayMOD が見る値は txt の見出しで、同じ値ではないため。
2. `foo.txt.txt` と、`/`・`\` を含む名前（`../x.txt`・`sub/x.txt`）は、BridgeMOD 向けのコマンド名として断る。保存済みの設定にあれば警告（BRIDGE は起動し、その1件を送らずに記録する）、新しく足せば保存でエラー（PR3 の決まりのまま）。前は `foo.txt.txt` で BRIDGE が `foo.txt` を送り、BridgeMOD が `.txt` をもう一度除いて別のファイル `foo.txt` を動かしていた。BridgeMOD の Java は変えない（BRIDGE が送らないので、残るのはチャットの `/bridge foo.txt` だけ）。
3. RCON・Telnet の経路は、今も `resolveCommands` がフォルダーの外を読まないので変えない（HANDOFF の前の書き方「外を読む」は言い過ぎだった）。
4. Shift_JIS などの UTF-8 でない txt は自動で変換しない（文字コードを推し量れないため）。設定のバックアップはバイトのまま保って戻し、配信前チェックで「UTF-8 で保存し直してください」と知らせる。
5. テンプレートの読み込みの「見つからないコマンド」と題名の探し方は、`.txt` の有無・大文字小文字を区別しない（BRIDGE と BridgeMOD と同じ）。

## Review Focus

1. コメントギフトのカスタムの音に `block.note_block.bell` や `minecraft:entity.player.levelup` のような今までの正しい ID を書いたとき、今と同じ音が鳴ること → Task 1 のテスト。
2. 保存済みの設定に `foo.txt.txt` の割り当てがあっても BRIDGE が起動し、そのギフトは送らず、ほかのギフトは届くこと → Task 2 の BRIDGE を動かすテスト。
3. Shift_JIS の txt を含むバックアップを戻しても、ファイルのバイトが変わらないこと（前のバックアップ、つまり文字列で持っていたものも今どおり戻せること）→ Task 5 のテスト。
4. 大文字の `Roulette.TXT` を割り当てたギフトでルーレットが回ること → Task 3 のテスト。
5. テンプレートの読み込みで、大文字の `.TXT` の名前が「見つからないコマンド」に出ないこと → Task 4 のテスト。

---

### Task 1: 音・粒子の ID を DisplayMOD と同じ決まりにする

**Files:**
- Create: `bridge/minecraft_ids.cjs`（`isResourceId(value: any) => boolean`）、`bridge/test/fixtures/minecraft-ids.json`、`electron/test/minecraft-ids.test.cjs`、`DisplayMod/src/contractTest/java/jp/douma/bridgemod/DisplayIdParity.java`
- Modify: `bridge/event_rules.cjs:26-31`（`commentExtras` の `id` を `isResourceId` に）、`bridge/roulette.cjs:37`（`mcId` を `isResourceId` に）、`scripts/test-bridge-contracts.cjs`（`DisplayMod/src/main/java/jp/douma/displaymod/api/DisplayRequest.java` と比べ役をビルドに足し、例の一覧を JS と Java に通す）、`package.json`（`build.files` に `bridge/minecraft_ids.cjs`）
- 例の一覧 `minecraft-ids.json`: `[{ "id": "minecraft:flame", "ok": true }, { "id": "entity.player.levelup", "ok": true }, { "id": "block.note_block.bell", "ok": true }, { "id": "minecraft:block/stone", "ok": true }, { "id": "a..b", "ok": true }, { "id": "a:b:c", "ok": false }, { "id": ":x", "ok": false }, { "id": "x:", "ok": false }, { "id": ":", "ok": false }, { "id": "Minecraft:flame", "ok": false }, { "id": " x", "ok": false }, { "id": "", "ok": false }, { "id": "minecraft:ドラゴン", "ok": false }]` に、`"a".repeat(200)`（通す）と `"a".repeat(201)`（断る）を足す（JSON に書く）。
- 比べ役 `DisplayIdParity`: 標準入力の各行（`>` と16進の ID）を `DisplayRequest.from(Map.of("title", "t", "sound", id)).sound()` に通し、空なら `>0`、空でなければ `>1`（`CommandKeyParity` と同じ形。16進の読み書きは同じ作りの小さな関数を持つ）。

- [ ] **Step 1: テストを書く**（`electron/test/minecraft-ids.test.cjs`）

```js
test('音・粒子の ID: 例の一覧（DisplayMOD の契約テストも同じものを読む）', () => {
  for (const c of fixture('minecraft-ids.json')) assert.equal(isResourceId(c.id), c.ok, JSON.stringify(c.id));
  assert.deepEqual([isResourceId(null), isResourceId(3)], [false, false]);
});
test('コメントギフトは同じ決まりで確かめ、正しくなければ今どおり既定の音・粒子にする', () => {
  assert.equal(commentExtras({ sound: 'block.note_block.bell' })[0], 'playsound block.note_block.bell master @a ~ ~ ~ 1 1');
  assert.match(commentExtras({ particle: 'minecraft:flame' })[0], / particle minecraft:flame /);
  assert.match(commentExtras({ particle: 'minecraft:block/stone' })[0], / particle minecraft:block\/stone /, '/ のある path は DisplayMOD と同じく通す');
  assert.equal(commentExtras({ sound: 'a:b:c' })[0], 'playsound entity.experience_orb.pickup master @a ~ ~ ~ 1 1', '正しくない ID は既定の音');
});
```

  - `roulette.test.cjs` に、同じファイルの `fixture(t)` を使って足す: `prepareRoulette({ ...config, stopSound: 'a:b:c' }, dir, () => 0).stopSound` が `'entity.player.levelup'`、`stopSound: 'minecraft:block/stone'` はそのまま（直す前は既定に置き換える）。
  - `electron/test/config-defaults.test.cjs` の「既定値の写し: BRIDGE は…」に、`bridge/event_rules.cjs`・`bridge/roulette.cjs` のソースに文字の並び `[a-z0-9_.:-]` が無いこと（`source.includes('[a-z0-9_.:-]') === false`）を足す。

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/minecraft-ids.test.cjs electron/test/roulette.test.cjs electron/test/config-defaults.test.cjs` / Expected: FAIL（モジュールがない、`a:b:c` を通す、`/` のある ID を既定に置き換える）。
- [ ] **Step 3: 直す**（Files のとおり）。比べ役を足した `scripts/test-bridge-contracts.cjs` も動かす。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `node scripts/test-bridge-contracts.cjs` / Expected: PASS（「DisplayIdParity: N ids match isResourceId」）。直したあとに `isResourceId` の正規表現を一時的に前の `^[a-z0-9_.:-]+$` に戻し、契約テストが `a:b:c` などで落ちることも確かめてから戻す。
- [ ] **Step 5: commit**（「fix: 音・粒子の ID を DisplayMOD と同じ決まりで確かめる」）

---

### Task 2: `foo.txt.txt` とフォルダーの区切りのある名前を BridgeMOD 向けの名前として断る

**Files:**
- Modify: `bridge/command_files.cjs:46-53`（`isBridgeCommandFile`・`commandFileProblem`）、`bridge/index.js:2284-2285`（テスト発火の「コマンド直接」は、ファイルがあるかを見る前に `commandFileProblem` で止める）
- Test: `electron/test/command-files.test.cjs`、Create `electron/test/bridge-command-names.test.cjs`

- [ ] **Step 1: テストを書く**
  - `command-files.test.cjs`:

```js
test('BridgeMOD 向けの名前: フォルダーの区切りと、終わりの .txt が2つの名前は断る（処理のコピー PR7）', () => {
  for (const name of ['../x.txt', '..\\x.txt', 'sub/x.txt', 'foo.txt.txt', 'FOO.TXT.txt', 'foo.txt.TXT']) assert.equal(isBridgeCommandFile(name), false, name);
  for (const name of ['foo.txt', 'tnt.v2.txt', 'TNT.TXT', 'foo', 'a.txtb.txt']) assert.equal(isBridgeCommandFile(name), true, name);
  assert.match(commandFileProblem('../x.txt'), /フォルダーの区切り（\/ や \\）は使えません/);
  assert.match(commandFileProblem('foo.txt.txt'), /終わりに \.txt が2つあります。ファイル名を foo\.txt に直してください/);
});
```

  - `bridge-command-names.test.cjs`（試験台で、保存済みの `foo.txt.txt` の割り当て）:

```js
test('保存済みの foo.txt.txt の割り当て: BRIDGE は起動し、そのギフトは送らず、ほかのギフトは届く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { 'foo.txt': 'say double\n', foo: 'say wrong file\n', cod: 'say cod\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'foo.txt.txt', repeat: 1 }, { giftId: '2', name: 'ハート', commandFile: 'cod.txt', repeat: 1 }] } });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.emit('WebcastGiftMessage', { giftId: '2', gift: { name: 'ハート' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'other gift');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.key), ['cod'], '前は foo.txt を送り、BridgeMOD が別のファイル foo.txt を動かしていた');
  assert.ok(bridge.logs.some(line => line.includes('.txt が2つあります')), bridge.logs.join('\n'));
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/command-files.test.cjs electron/test/bridge-command-names.test.cjs` / Expected: FAIL（`../x.txt`・`foo.txt.txt` を通す、BRIDGE が `foo.txt` を送る）。
- [ ] **Step 3: 直す**（Global Constraints のとおり。`bridgeCommandKey` は今のまま（パスを除いて送る名前を作る）。`../x.txt` を書いた配信前チェックの「見つからないファイル」は今のまま）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:app`・`node scripts/test-bridge-contracts.cjs` / Expected: PASS（名前の例の一覧 `command-names.json` の結果は変わらない）。
- [ ] **Step 5: commit**（「fix: foo.txt.txt とフォルダーの区切りのある名前を BridgeMOD 向けの名前として断る」）

---

### Task 3: ルーレットの判定を1つにし、大文字小文字を区別しない

**Files:**
- Modify: `bridge/roulette.cjs`（`isRouletteCommand(commandFile: any) => boolean` を足す。項目から外す `/^roulette\.txt$/i`（23 行目）もこれを使う）、`bridge/index.js`（1457・2283・2299 行目の `=== "roulette"` を `isRouletteCommand`）
- Test: `electron/test/roulette.test.cjs`、`electron/test/config-defaults.test.cjs`

- [ ] **Step 1: テストを書く**
  - `roulette.test.cjs`: `['roulette.txt', 'Roulette.TXT', 'ROULETTE', ' roulette '].map(isRouletteCommand)` が全部 true、`['roulette2.txt', 'my_roulette.txt', '']` が全部 false。`Roulette.TXT` を項目に入れたルーレットは、その項目を外す。
  - `config-defaults.test.cjs` の「既定値の写し: BRIDGE は…」に、`bridge/index.js` が `=== "roulette"` を持たず `isRouletteCommand(` を使うことを足す。
  - 試験台のテスト（`electron/test/bridge-command-names.test.cjs` に足す）:

```js
test('大文字の Roulette.TXT を割り当てたギフトでも、ルーレットが回る（Roulette という名前のコマンドは送らない）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'Roulette.TXT', repeat: 1 }],
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] } } });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => Array.isArray(x.commands)), 'roulette frames');
  assert.ok(!bridge.requests.some(x => x.key === 'Roulette'), '前は Roulette という名前の要求を送っていた');
});
```
- [ ] **Step 2: 動かす** — Expected: FAIL（`isRouletteCommand` がない、`Roulette.TXT` を普通のコマンドとして送る）。
- [ ] **Step 3: 直す**。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:bridge` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: ルーレットの判定を1つにし、大文字の Roulette.TXT も同じに扱う」）

---

### Task 4: テンプレートの「見つからないコマンド」と題名の探し方

**Files:**
- Modify: `electron/gift_templates.cjs:47`（`missing`）・`:74`（題名）。同じコマンドかは `ensureTxt(name).toLowerCase()` で比べる（小さな関数を1つ置き、2か所が使う）。
- Test: `electron/test/gift-templates.test.cjs`

- [ ] **Step 1: テストを書く**: 今の「import preview…」と同じ `harness` で、テンプレートの行の `commandFile` を `HEAL.TXT` にしたとき、`preview.missingCommands` が空で、題名が `回復！` であること。
- [ ] **Step 2: 動かす** — Expected: FAIL（`HEAL.TXT` を見つからないコマンドに出す）。
- [ ] **Step 3: 直す**。
- [ ] **Step 4: 動かす** — Expected: PASS。
- [ ] **Step 5: commit**（「fix: テンプレートの見つからないコマンドと題名を .txt・大文字小文字を区別せずに探す」）

---

### Task 5: Shift_JIS などの UTF-8 でない txt をバックアップで壊さず、配信前チェックで知らせる

**Files:**
- Modify: `bridge/command_text.cjs`（`isUtf8Text(buffer: Buffer) => boolean` を足す）
- Modify: `electron/settings_backups.cjs`（`capture` は UTF-8 でない txt を `payload.binaryCommands`（`{ <名前>: <base64> }`）に入れる。`validate` は `binaryCommands` があればオブジェクトで、名前は `validCommand`、値は文字列。`restore` は `binaryCommands` をバイトのまま書き、`deps.validateRestore` には両方の名前を渡す。`summary` の `commands` は両方の数。前のバックアップ（`binaryCommands` がない）は今どおり）
- Modify: `electron/preflight.cjs`（参照しているコマンドのうち、UTF-8 でないものがあれば、`commands` の行を `error` にして「UTF-8 で保存されていないファイル: <名前>。メモ帳などで UTF-8 で保存し直してください」）
- Test: `electron/test/settings-safety.test.cjs`

- [ ] **Step 1: テストを書く**（`settings-safety.test.cjs`）
  - バックアップ: コマンドのフォルダーに Shift_JIS の `sjis.txt`（`Buffer.from([0x23, 0x20, 0x54, 0x49, 0x54, 0x4c, 0x45, 0x3a, 0x20, 0x83, 0x6c, 0x83, 0x52, 0x0a, 0x73, 0x61, 0x79, 0x20, 0x68, 0x69, 0x0a])`。「# TITLE: ネコ」と「say hi」）を置いてバックアップを取り、ファイルを書き換えてから戻すと、バイトが元と同じであること。今のテストと同じ下準備（`createSettingsBackups`）を使う。
  - 前の形のバックアップ（`binaryCommands` がない）も今どおり戻せること（今のテストがそのまま通ること）。
  - 配信前チェック: 割り当てが `sjis.txt` を参照しているとき、`commands` の行が `error` で、文に「UTF-8 で保存されていないファイル: sjis.txt」があること。
- [ ] **Step 2: 動かす** — Expected: FAIL（戻したファイルに U+FFFD が入る、配信前チェックが ok）。
- [ ] **Step 3: 直す**。
- [ ] **Step 4: 動かす** — Run: `npm run verify` / Expected: すべて通る。
- [ ] **Step 5: commit**（「fix: UTF-8 でない txt をバックアップで壊さず、配信前チェックで知らせる」）

---

### Task 6: 記録

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「処理のコピー」の PR7 の節：やったこと・決めたこと 1〜5・`npm run verify` と契約テストの結果・リリースノートに足すこと。「PR1 のレビューで見つけた前からの問題」の行に、直したものと、言い過ぎだった `../x.txt` の書き方を直したことを書く）

リリースノートに足すこと:
- 名前の終わりに .txt が2つあるコマンドファイル（foo.txt.txt）を割り当てたとき、別のファイル（foo.txt）を動かさなくなりました（配信前チェックと保存で知らせます）。
- 大文字の Roulette.TXT を割り当てても、ルーレットとして動きます。
- メモ帳などで Shift_JIS で保存したコマンドファイルは、配信前チェックで「UTF-8 で保存し直してください」と知らせます。設定のバックアップを戻しても、そのファイルは壊れません。

- [ ] **Step 1: HANDOFF を書く**
- [ ] **Step 2: `npm run verify`・`node scripts/test-bridge-contracts.cjs`** — Expected: すべて通る。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR7 を書く」）
