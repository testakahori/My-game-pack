# 処理のコピー PR1（コマンド名と見出し行）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** コマンド txt の見出し行（`# TITLE:` など）の読み方と、コマンド名（`.` のある名前・`.TXT`）の扱いを、アプリ・BRIDGE・BridgeMOD・SaikutuMod で1つの決まりにそろえる（設計書の 4・5）。

**Architecture:** JavaScript は見出しの読み方を `bridge/command_text.cjs` に、`.txt` の付け外しを `bridge/command_files.cjs` にまとめ、今の写し（BRIDGE・アプリの一覧・ルーレット・開発用・テスト）をすべてそれに置き換える。Java は BridgeMOD と SaikutuMod にそれぞれ Minecraft に依存しない `CommandText` を置き、BridgeMOD の `CommandRouting` が `.` のある名前と `.TXT` を受け付けるようにする。JavaScript と Java が同じ結果になることは、同じ例の一覧（JSON）を `scripts/test-bridge-contracts.cjs` で両方に通して確かめる（今の `ListenerNamesParity` と同じ形）。

**Tech Stack:** Node.js（CommonJS、node:test）、Java 17（javac だけで動く契約テスト、Forge の gradle ビルド）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md

## Global Constraints

- 見出し行の決まり（設計書 5。今の BRIDGE の読み方）:
  - 行は CRLF・LF・CR のどれでも区切る。各行の前後から「空白」を除く。空になった行は無視する。
  - 「空白」は JavaScript の `String.prototype.trim` と同じ文字: タブ・U+000B・U+000C・半角空白・U+00A0・U+1680・U+2000〜U+200A・U+2028・U+2029・U+202F・U+205F・U+3000・U+FEFF（BOM）。Java は `String.trim`・`strip`・`Character.isWhitespace` を使わず、この一覧で除く。
  - `#` で始まる行はコマンドにしない。`#`・空白・キー（英字と `_` が1文字以上）・空白・`:`・値、の形なら見出し。キーは大文字にそろえる。値は前後の空白を除き、空なら無視する（前の同じキーの値は残る）。この形でない `#` 行（`# TITLE2: x`・`# MY KEY: x`・`#!x`）は何もしない。
  - 同じキーが2つあれば後の行の値を使う。
  - `//` で始まる行はコマンドにしない。説明文は、`//` のあとを前後の空白を除いて空でない、最初の行。次の行にまたがらない。
  - それ以外の行がコマンド（前後の空白を除いたもの）。
- コマンド名（`.txt` を除いた部分）の決まり: `[A-Za-z0-9_.-]{1,200}`（今の `BRIDGE_COMMAND_KEY` と `BridgeEvent.fromJson`）。BridgeMOD がファイルを探す所も同じ。`/`・`\` を含まないので、フォルダーの外は指せない。
- `.txt` は大文字小文字を問わない（`TNT.TXT` は `TNT.txt` と同じ。Windows のファイル名は区別しない）。付け外しは `bridge/command_files.cjs` の関数だけで行う。
- MOD の版: BridgeMOD 1.8.0 → **1.8.1**、SaikutuMod 1.1.4 → **1.1.5**（どちらも直しだけで、受け付ける形は広がるだけ）。`game-packs/saikutu/game.json` の jar の名前も合わせる（AGENTS.md）。
- MOD のビルドはオフライン: `BridgeMod/` で `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`、SaikutuMod は `BridgeMod/gradlew -p SaikutuMod build` に同じ引数（AGENTS.md）。
- 新しい bridge のモジュールを electron から読むときは、`package.json` の `build.files` にも足す（足さないと配布版の main が読めない）。
- 例の一覧（JSON）は `bridge/test/fixtures/` に置く（`bridge/test/**` は配布物に入らない）。
- ipc の名前・画面は変えない。新しいテストは直す前のコードで落ちることを確かめる（AGENTS.md）。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `fix/logic-copies-1`。git は PowerShell で行い、`git add` の前に `git hash-object -w <file>` を通す。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。文書の場所は `/` 区切り。コメントは日本語、既存ファイルの改行（CRLF）は変えない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない。Write でファイルにしてから実行する。

## Review Focus

1. 配信者が手で書いた txt（BOM 付き・行頭に全角空白・小文字のキー）の1行目の `# DESTRUCTIVE: true`・`# COUNT_MODE: aggregate` を、MOD が見出しとして読み、コマンドとして実行しないこと → Task 3 の見出しの例の一覧に入れ、JavaScript と Java の両方で確かめる。
2. `.` のある名前（`..`・`.`・`a..b`・`tnt.v2`）でも、MOD がフォルダーの外のファイルを読まないこと → Task 3 の `CommandRoutingContractTest` で確かめる。
3. `TNT.TXT`（大文字の拡張子）を割り当てると、BRIDGE が MOD に送る名前は `TNT` になり、アプリの一覧と MOD のチャット候補にも出ること → Task 2 と Task 3 のテストで確かめる。
4. ルーレットの項目名・ギフト画像の題名が、空の `# TITLE:` のときに次の行を拾わず、ファイル名に戻ること → Task 1 のアプリの一覧のテストで確かめる。
5. 同じ名前のコマンドが2つのゲームにあるときのエラー（「複数ゲームに同じコマンドがあります」）は、`.` のある名前でも今のまま出ること → Task 3 の `CommandRoutingContractTest` で確かめる。

---

### Task 1: 見出し行の読み方を `bridge/command_text.cjs` にまとめる（JavaScript）

**Files:**
- Create: `bridge/command_text.cjs`
- Create: `bridge/test/fixtures/command-text.json`
- Create: `electron/test/command-text.test.cjs`
- Modify: `bridge/index.js:457-486`（`parseCommandFile`）
- Modify: `electron/bridge_settings.cjs:61-83`（`readCommandMetadata`）
- Modify: `bridge/roulette.cjs:24`（説明文）
- Modify: `vite.config.ts:127-145`（開発用の一覧）
- Modify: `electron/test/standard-commands.test.cjs:8-9`、`electron/test/tiktok-events.test.cjs:68`（テストの写し）
- Modify: `package.json`（`build.files` に `bridge/command_text.cjs`）
- Test: `electron/test/bridge-settings-module.test.cjs`（アプリの一覧）

**Interfaces:**
- Produces: `parseCommandText(text: string) => { meta: Record<string, string>, commands: string[], description: string }`（Global Constraints の見出し行の決まり。`meta` のキーは大文字）と `trimText(text: string) => string`（同じ「空白」の一覧で前後を除く）。Task 3・4 の契約テストが `parseCommandText` を Java と比べる。

- [ ] **Step 1: 例の一覧とテストを書く**

`bridge/test/fixtures/command-text.json` は `[{ "name": "…", "text": "…", "meta": {…}, "commands": […], "description": "…" }]` の配列。少なくとも次の例を入れる（`text` は JSON の文字列。BOM は `\ufeff`、全角空白は `\u3000`）:
- 見出し・説明・コマンドのふつうの形（`# TITLE: ねこ\n// 説明\nsummon cat`）
- 先頭に BOM、1行目が `# DESTRUCTIVE: true`（DESTRUCTIVE=true、コマンドにならない）
- BOM と全角空白・NBSP を行頭に付けた `# COUNT_MODE: aggregate`
- 小文字のキー（`# title: ねこ` → TITLE）、`#` とキーの間・キーと `:` の間の空白（`#  TITLE : ねこ`）
- TITLE が2行（後が勝つ）
- 空の `# TITLE:` の次の行が `say hi`（TITLE なし、`say hi` はコマンド）、空の `# TITLE:` の次の行が `# CATEGORY: 妨害`（CATEGORY=妨害）
- `# TITLE: A` のあとに空の `# TITLE:`（TITLE=A のまま）
- `# TITLE2: z`・`# MY KEY: x`・`#!x`（見出しにもコマンドにもならない）
- CRLF・CR だけの改行
- 説明文: `//` だけの行の次が `// 説明`（説明=説明）、`//` だけの行の次がコマンド（説明なし、コマンドはそのまま）、`//` が2行（最初の空でない方）

`electron/test/command-text.test.cjs`:

```js
test('見出し行の決まり: 例の一覧のとおりに読む（BRIDGE・アプリ・MOD で同じ。設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 5）', () => {
  for (const c of cases) assert.deepEqual(parseCommandText(c.text), { meta: c.meta, commands: c.commands, description: c.description }, c.name);
});
test('見出し行の決まり: BRIDGE・アプリの一覧・ルーレット・開発用の一覧は、自分の写しを持たず command_text.cjs を使う', () => {
  // bridge/index.js・electron/bridge_settings.cjs・bridge/roulette.cjs・vite.config.ts に、見出しや説明文の正規表現（/^#\s*/・/^\/\/\s*/）が残っていないこと
});
```

`electron/test/bridge-settings-module.test.cjs` に足す（`bridge:commands:readMeta` を通す。今のテストの組み立てに合わせる）:

```js
test('コマンドの一覧: 空の # TITLE: は次の行を拾わずファイル名に戻り、BOM 付き・小文字のキーの題名も読む', async t => {
  // empty.txt: "# TITLE:\n# CATEGORY: 妨害\nsay hi" → title 'empty.txt'、category '妨害'
  // bom.txt: "\ufeff# title: ねこ\n//\n// 説明\nsummon cat" → title 'ねこ'、description '説明'
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/command-text.test.cjs electron/test/bridge-settings-module.test.cjs`
Expected: FAIL（`Cannot find module '../../bridge/command_text.cjs'`）。`bridge-settings-module` の新しいテストは、モジュールを足す前に一度だけ単独で動かし、今のコードで title が `'# CATEGORY: 妨害'` になって落ちることも見る。

- [ ] **Step 3: `bridge/command_text.cjs` を作り、写しを置き換える**

- `parseCommandText`・`trimText` を書く（Global Constraints のとおり。正規表現の `\s` は JavaScript では「空白」の一覧と同じ）。
- `bridge/index.js` の `parseCommandFile` は `parseCommandText` の `meta`・`commands` を返すだけにする。
- `readCommandMetadata` は `title = meta.TITLE || name`、`category = meta.CATEGORY || ""`、`description` を使う。
- `roulette.cjs` の説明文、`vite.config.ts` の開発用の一覧（`createRequire` で読む）、2つのテストの写しも `parseCommandText` を使う。
- `package.json` の `build.files` に `bridge/command_text.cjs` を足す。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/command-text.test.cjs electron/test/bridge-settings-module.test.cjs electron/test/roulette.test.cjs electron/test/standard-commands.test.cjs electron/test/tiktok-events.test.cjs electron/test/test-fire-parity.test.cjs`
Expected: PASS。
Run: `npm run test:bridge`
Expected: PASS（BRIDGE の動きは CR だけの改行のとき以外変わらない）。

- [ ] **Step 5: commit**

```powershell
git add bridge/command_text.cjs bridge/test/fixtures/command-text.json electron/test/command-text.test.cjs bridge/index.js electron/bridge_settings.cjs bridge/roulette.cjs vite.config.ts electron/test/standard-commands.test.cjs electron/test/tiktok-events.test.cjs electron/test/bridge-settings-module.test.cjs package.json
git commit -F <メッセージのファイル>   # 「fix: コマンド txt の見出し行の読み方を1つにする（アプリの一覧・ルーレットが空の TITLE で次の行を拾っていた）」
```

---

### Task 2: `.txt` の付け外しを `bridge/command_files.cjs` にまとめる

**Files:**
- Modify: `bridge/command_files.cjs`（`ensureTxt`・`isTxtName` を足す。今の `bridgeCommandKey` を使い続ける）
- Modify: `bridge/index.js:379-384`（`ensureTxt` を消して読み込む）・`:662-665`（`commandFileToBridgeKey`）
- Modify: `bridge/test_fire.cjs:95`、`bridge/roulette.cjs:8-15`（`commandPath`）
- Modify: `electron/game_command_scope.cjs:12`、`electron/game_profiles.cjs:221`、`electron/gift_templates.cjs:19`、`electron/preflight.cjs:43`、`electron/bridge_settings.cjs:167`
- Modify: `electron/preload.cjs:319`（`/\.txt$/i` にする。preload は bridge のモジュールを読まない）
- Test: `electron/test/command-files.test.cjs`、`electron/test/game-command-scope.test.cjs`、`electron/test/gift-templates.test.cjs`、`electron/test/mod-event-delivery.test.cjs`（BRIDGE が送る名前）

**Interfaces:**
- Consumes: Task 1 なし。
- Produces: `ensureTxt(name: string) => string`（前後の空白を除き、`.txt`（大文字小文字を問わない）で終わらなければ `.txt` を足す。空なら `""`）、`isTxtName(name: string) => boolean`（`/\.txt$/i`）。`bridgeCommandKey(commandFile)`（今のまま、`.txt` を大文字小文字を問わず除く）。

- [ ] **Step 1: テストを書く**

- `command-files.test.cjs`: `ensureTxt('a') === 'a.txt'`、`ensureTxt(' A.TXT ') === 'A.TXT'`、`ensureTxt('') === ''`、`isTxtName('A.TXT') === true`、`isTxtName('a.txt.bak') === false`。
- `game-command-scope.test.cjs`: `availableGameCommands(['TNT.TXT', 'neko.txt'], 保存済みの common)` に `TNT.TXT` が入る。
- `gift-templates.test.cjs`: `commandFile: 'TNT.TXT'` の行を受け付ける。
- `mod-event-delivery.test.cjs`（または BRIDGE を動かすテストの今の形）: ギフト割り当て `commandFile: 'TNT.TXT'`（commands に `TNT.TXT` というファイルを置く）で、BridgeMOD に送る `key` が `'TNT'`。
- 「`.txt` の付け外しの写しが残っていない」: `bridge/index.js`・`bridge/test_fire.cjs`・`bridge/roulette.cjs`・`electron/*.cjs` に、`.txt` を足す・除く自前の書き方（`toLowerCase().endsWith(".txt")`・`path.basename(x, ".txt")`・`endsWith('.txt')`）が残らないことを確かめるテストを `command-files.test.cjs` に足す（`preload.cjs` は除く）。

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/command-files.test.cjs electron/test/game-command-scope.test.cjs electron/test/gift-templates.test.cjs electron/test/mod-event-delivery.test.cjs`
Expected: FAIL（`ensureTxt is not a function` と、`TNT.TXT` を除く・送る名前が `TNT.TXT` のまま）。

- [ ] **Step 3: 関数を足し、写しを置き換える**

上の Files の所を、すべて `ensureTxt`・`isTxtName`・`bridgeCommandKey` に置き換える。`commandFileToBridgeKey(file)` は `bridgeCommandKey(ensureTxt(file))`。

- [ ] **Step 4: 動かす**

Run: `npm run test:app` と `npm run test:bridge`
Expected: PASS。

- [ ] **Step 5: commit**

```powershell
git add bridge/command_files.cjs bridge/index.js bridge/test_fire.cjs bridge/roulette.cjs electron/game_command_scope.cjs electron/game_profiles.cjs electron/gift_templates.cjs electron/preflight.cjs electron/bridge_settings.cjs electron/preload.cjs electron/test/command-files.test.cjs electron/test/game-command-scope.test.cjs electron/test/gift-templates.test.cjs electron/test/mod-event-delivery.test.cjs
git commit -F <メッセージのファイル>   # 「fix: .txt の付け外しを1つにし、TNT.TXT のような大文字の拡張子も同じに扱う」
```

---

### Task 3: BridgeMOD（Java）を同じ決まりにする（1.8.1）

**Files:**
- Create: `BridgeMod/src/main/java/jp/douma/bridgemod/CommandText.java`
- Create: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/CommandRoutingContractTest.java`
- Create: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/CommandTextParity.java`
- Create: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/CommandKeyParity.java`
- Create: `bridge/test/fixtures/command-names.json`
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/CommandRouting.java`（`KEY`・`isKey`・`resolve`・`keys`）
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java:870`（`fromJson` の名前の決まり）・`:1058-1085`（`parseFile`）
- Modify: `scripts/test-bridge-contracts.cjs`
- Modify: `BridgeMod/gradle.properties`（`mod_version=1.8.1`）

**Interfaces:**
- Consumes: Task 1 の `parseCommandText`、Task 2 なし、`bridge/command_files.cjs` の `isBridgeCommandFile`。
- Produces:
  - `CommandText.parse(String text) => CommandText.Parsed`（`Map<String, String> meta`、`List<String> commands`。説明文は持たない）。Global Constraints の見出し行の決まり。Minecraft に依存しない（javac だけで通る）。
  - `CommandRouting.KEY = "[A-Za-z0-9_.-]{1,200}"`、`CommandRouting.isKey(String stem) => boolean`。`fromJson` と `resolve` の両方がこれを使う。
  - `CommandRouting.resolve` は `isKey` を通った名前だけを探し、見つけたファイルの親が `directory` と同じであることも確かめる。`keys` は `.txt` を大文字小文字を問わず受け付ける。
  - 契約テストの受け渡し: `CommandTextParity` は標準入力の各行（`>` と UTF-16 の16進4桁）を `CommandText.parse` に通し、`meta` をキーの順に `KEY\u0000VALUE` を `\u0001` でつなぎ、`\u0002` のあとに `commands` を `\u0001` でつないだ文字列を、同じ16進の形で返す。`CommandKeyParity` は各行の名前（16進）について `CommandRouting.isKey`（`.txt` を除いてから）の結果を `>1`／`>0` で返す。

- [ ] **Step 1: 契約テストを書く**

- `bridge/test/fixtures/command-names.json`: `[{ "name": "…", "ok": true|false }]`。少なくとも `neko`・`tnt.v2`・`TNT.TXT`・`game_saikutu_x.y`・`..`・`.`・`a..b`（ok）と、`a b`・`ネコ`・`../x`・`a/b`・`a\b`・空・201文字（ok でない）。
- `CommandRoutingContractTest`（一時フォルダーに作る）: `tnt.v2.txt` を `resolve(dir, "tnt.v2")` で見つける。`game_saikutu_x.y.txt` を `"x.y"` で見つける。`..`・`.`・`a..b` は `null` か `dir` の中のファイルだけ。`saikutu` と `umetate` に同じ名前があると今の文（「複数ゲームに同じコマンドがあります」）で例外。`keys(dir)` は `TNT.TXT` を `TNT` として出し、`_op.txt` は出さない。
- `scripts/test-bridge-contracts.cjs` に足す:
  - `CommandText.java`・`CommandRouting.java` と3つの新しいテストをコンパイルに入れ、`CommandRoutingContractTest` を動かす。
  - `command-text.json` の各 `text` を `CommandTextParity` に通し、JavaScript の `parseCommandText` から同じ形に作った文字列と比べる（1つでも違えば失敗。違いを入力ごとに出す）。
  - `command-names.json` の各 `name` を `CommandKeyParity` に通し、`isBridgeCommandFile(name)` と `ok` の両方と比べる。

- [ ] **Step 2: 動かす**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: FAIL（`CommandText` がない。`CommandText.java` を仮に空の `parse` で置いて動かすと、`tnt.v2` が見つからない・BOM の行がコマンドになる、で落ちることを見る）。JDK がない環境では動かせないので、そのときは ledger に書き、CI の mod-build で確かめる。

- [ ] **Step 3: Java を直す**

- `CommandText.parse` を書く（「空白」は Global Constraints の一覧。`ListenerNames.trimmed` は一覧が違うので使わない）。
- `BridgeMod.parseFile` は `Files.readString(file, UTF_8)` を `CommandText.parse` に通す（`ParsedFile` へ詰め替える）。
- `fromJson` の `key.matches(...)` を `CommandRouting.isKey(key)` に、`resolve` の `stem.matches(...)` も `isKey(stem)` にする。`resolve` で見つけたファイルの親が `base` と同じでなければ `null`。
- `keys` の `n.endsWith(".txt")` を大文字小文字を問わない形にする。
- `BridgeMod/gradle.properties` を `mod_version=1.8.1` にする。

- [ ] **Step 4: 動かす**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: PASS（見出しの例・名前の例がすべて JavaScript と一致、`CommandRoutingContractTest` が通る）。
Run（`BridgeMod/` で）: `./gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`
Expected: BUILD SUCCESSFUL、`BridgeMod/build/libs/bridgemod-1.8.1.jar` ができる。

- [ ] **Step 5: commit**

```powershell
git add BridgeMod/src/main/java/jp/douma/bridgemod/CommandText.java BridgeMod/src/main/java/jp/douma/bridgemod/CommandRouting.java BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java BridgeMod/src/contractTest/java/jp/douma/bridgemod/CommandRoutingContractTest.java BridgeMod/src/contractTest/java/jp/douma/bridgemod/CommandTextParity.java BridgeMod/src/contractTest/java/jp/douma/bridgemod/CommandKeyParity.java bridge/test/fixtures/command-names.json scripts/test-bridge-contracts.cjs BridgeMod/gradle.properties
git commit -F <メッセージのファイル>   # 「fix: BridgeMOD 1.8.1 で . のある名前のコマンドと BOM 付きの txt を読む」
```

---

### Task 4: SaikutuMod（Java）を同じ決まりにする（1.1.5）

**Files:**
- Create: `SaikutuMod/src/main/java/jp/douma/saikutumod/CommandText.java`（BridgeMOD の `CommandText` と同じ中身。パッケージだけ違う。MOD 同士は互いを読み込めないため）
- Create: `SaikutuMod/src/contractTest/java/jp/douma/saikutumod/CommandTextParity.java`
- Modify: `SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java:185-196`（`loadScripts`）
- Modify: `scripts/test-bridge-contracts.cjs`
- Modify: `SaikutuMod/gradle.properties`（`mod_version=1.1.5`）、`game-packs/saikutu/game.json`（`serverJar`・`clientJar` を `saikutumod-1.1.5.jar`）

**Interfaces:**
- Consumes: Task 3 の `CommandText` の中身と受け渡しの形。
- Produces: なし。

- [ ] **Step 1: 契約テストを書く**

`scripts/test-bridge-contracts.cjs` で、`command-text.json` の例を SaikutuMod の `CommandTextParity` にも通し、JavaScript と比べる。あわせて、SaikutuMod が jar に入れているコマンド txt（`SaikutuMod/src/main/resources/commands/*.txt`）を新旧の読み方で読み、`metadata`・`commands` が変わらないことを確かめる（同梱のファイルの動きを変えない）。

- [ ] **Step 2: 動かす**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: FAIL（SaikutuMod の `CommandText` がない）。

- [ ] **Step 3: SaikutuMod を直す**

`CommandText.java` を BridgeMOD から写し（パッケージだけ変える）、`loadScripts` の読み方をそれに置き換える。版を 1.1.5 にし、`game.json` を合わせる。

- [ ] **Step 4: 動かす**

Run: `node scripts/test-bridge-contracts.cjs`
Expected: PASS。
Run: `BridgeMod/gradlew -p SaikutuMod build --offline "-Dnet.minecraftforge.gradle.check.certs=false"` のあと `node scripts/prepare-game-packs.cjs` と `node scripts/test-game-contract.cjs`
Expected: すべて成功（`saikutumod-1.1.5.jar` ができ、ゲームパックの契約テストが通る）。

- [ ] **Step 5: commit**

```powershell
git add SaikutuMod/src/main/java/jp/douma/saikutumod/CommandText.java SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java SaikutuMod/src/contractTest/java/jp/douma/saikutumod/CommandTextParity.java scripts/test-bridge-contracts.cjs SaikutuMod/gradle.properties game-packs/saikutu/game.json
git commit -F <メッセージのファイル>   # 「fix: SaikutuMod 1.1.5 で見出し行を BRIDGE・BridgeMOD と同じ決まりで読む」
```

---

### Task 5: 全体の確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番の「処理のコピー」）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。
Run: `node scripts/test-bridge-contracts.cjs`
Expected: PASS。

- [ ] **Step 2: HANDOFF を書く**

「処理のコピー」の下に、PR1 でしたこと（見出し行の決まりを1つに、`.txt` の扱い、BridgeMOD 1.8.1・SaikutuMod 1.1.5、例の一覧で JavaScript と Java を突き合わせる）と、次のリリースノートに足すこと（「名前に `.` のあるコマンドも動く」「メモ帳などで BOM 付きで保存した txt も正しく読む」「サーバーの起動し直しで新しい BridgeMOD に入れ替わる」）、次にやること（PR2：配信中に保存した設定の反映）を書く。PR 番号は PR を出してから書き足す。

- [ ] **Step 3: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に処理のコピー PR1 を書く」
```
