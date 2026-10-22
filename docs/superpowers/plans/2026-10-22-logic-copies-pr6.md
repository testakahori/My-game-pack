# 処理のコピー PR6（ゲーム ID の一覧・ゲーム専用の判定・ゲーム MOD の ID とパックの key）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ゲーム ID の一覧を1か所に置き、「ゲーム専用のコマンドか」「ゲーム MOD の ID として使えるか」「パックの key として使えるか」を1つずつの関数にして、アプリ・BRIDGE・画面・BridgeMOD が同じ決まりで動くようにする（設計書の 6）。

**Architecture:** 一覧は `bridge/games.json`（画面も import して読む）、決まりは `bridge/game_commands.cjs` に置く。BridgeMOD（Java）はコードを分け合えないので、`CommandRouting.java` の一覧を1つにし、`GameEvents.java` に同じ決まりの `isGameModId` を足して、同じ例の一覧（`bridge/test/fixtures/*.json`）を `scripts/test-bridge-contracts.cjs` で JavaScript と Java の両方に通す。BridgeMOD は 1.8.2 に上げる。

**Tech Stack:** Node.js（CommonJS、node:test）、Java 17（javac だけの契約テスト、Forge の MOD のオフラインのビルド）、React と TypeScript（画面は JSON を import）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md（6。2・3・13 も）。PR の分け方は PR5 の計画のとおり（このあと PR7）。

## Global Constraints

- ゲームの一覧（`bridge/games.json`）: `[{ "id": "common", "name": "サバイバル", "modName": "BridgeMOD" }, { "id": "umetate", "name": "埋め立て", "modName": "UmetateMOD" }, { "id": "run", "name": "RUN", "modName": "RunMOD" }, { "id": "saikutu", "name": "採掘", "modName": "saikutuMOD" }]`（今の `electron/game_profiles.cjs` の `GAMES` と同じ。`common` は共通で、ゲームパックのゲームは残りの3つ）。
- ゲーム専用のコマンド: 名前が `game_<common 以外の一覧の ID>_` で始まるものだけ（大文字小文字を区別しない）。それ以外（`game_mode_on.txt`・`game_unknown_x.txt` など）は共通のコマンド（設計書 6・15）。
- チャットの名前（`publicCommandKey`）: `.txt`（大文字小文字を問わない）を除き、ゲーム専用の頭（`game_<id>_`、大文字小文字を問わない）を除いたもの。BridgeMOD の `CommandRouting.publicKey` と同じ結果。
- ゲーム MOD の ID: `^[a-z][a-z0-9_]{1,63}$` で、予約名（`bridgemod`・`displaymod`・`doumacmd`）でないもの。アプリ（パックの登録）・BRIDGE（txt の `# GAME_MOD:`）・BridgeMOD（`GameEvents.register`）が同じく断る。
- パックの key: `^[a-z][a-z0-9_]{0,49}$`（パックの登録だけの決まり。決めたこと 4）。
- BridgeMOD は 1.8.2（`BridgeMod/gradle.properties` の `mod_version`）。オフラインのビルド: `BridgeMod` で `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`。
- 新しい `bridge/games.json`・`bridge/game_commands.cjs` は `package.json` の `build.files` に足す。
- ipc の名前・画面の見た目は変えない（コマンド一覧の返り値に `chatKey` を足すだけ）。作業は D 側の作業コピーのブランチ `fix/logic-copies-6`（main の 18d5f40 から切った）。git は PowerShell、`git add` の前に `git hash-object -w <file>`（権限エラーのときは1つずつ）、commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。追跡していない `docs/soutenmon/StreamToEarn_code/` には触らない。コメントは日本語、既存ファイルの改行（CRLF）は変えない。文書にバックスラッシュと英数字の並びを書かない。Edit で値を置き換えるときは、あとに続く空白を落とさない。

## 決めたこと（設計書 14 で作る人に任された所。違っていれば直す）

1. ゲーム専用の判定は大文字小文字を区別しない（Windows のファイル名と BridgeMOD は区別しない）。`GAME_RUN_X.TXT` は RUN のコマンドとして扱い、TXT の書き込みでは止め、ゲームの切り替えでは消す（前はどの判定も素通りし、同じ名前の `game_run_x.txt` を上書きできた）。BridgeMOD の `publicKey` も同じく区別しない。
2. 既定のゲームとしての `'common'` の直書き（`game_command_scope.cjs` の `config?.gameProfile || 'common'` など）は残す（一覧ではなく既定値）。
3. 予約名の `# GAME_MOD: bridgemod` などは BRIDGE も送らない（今は BRIDGE と BridgeMOD が通し、BridgeMOD が「Game MOD is not loaded」で捨てていた）。
4. パックの key の決まりは JavaScript（パックの登録）だけに置き、Java とは合わせない。設計書は「GameEvents.java と合わせる」としていたが、今の Java には key の決まりがなく（txt の `# GAME_KEY:` を確かめずにゲーム MOD へ渡す）、足すと大文字の `GAME_KEY`（契約テストと結合テストの `AquaTower`、手で書いた txt）を断ることになるため。key はファイル名 `game_<id>_<key>.txt` にしか出ず、それはパックの登録で確かめている。
5. `game_profiles.cjs` の `withoutOtherGameCommands`（採掘のプロフィールを初めて作るとき）は、文字列の値（コメントコマンド・投票の選択肢）で書いたほかのゲームのコマンドも外す（PR5 の最終レビューの申し送り。切り替えの確かめはそれを数えるので、外さないと止まる）。
6. コマンド一覧のチャットの名前は、アプリがコマンドの一覧に足す `chatKey` を画面が使う（画面に決まりの写しを持たない。設計書 3）。開発用のモック（`devApiMock.ts`）と開発用のサーバー（`vite.config.ts`）も同じ形にする。

## Review Focus

1. `game_mode_on.txt` のような共通のコマンドを使う設定を、バックアップから戻せること（前は復元の確かめが `game_` で始まる名前を使える名前から外し、「選択したゲームでは使えないコマンドです」で止まった）→ Task 2 のテスト。
2. 採掘のプロフィールを初めて作るとき、`game_mode_on.txt` の割り当てを外さないこと（前は「ほかのゲームのもの」として外した）→ Task 2 のテスト。
3. ほかのゲームの `GAME_RUN_X.TXT` を TXT の書き込みで作れないこと → Task 2 のテスト。
4. BridgeMOD 1.8.2 が、今のゲームパック（採掘）を今までどおり登録して受け取れること（予約名の確かめで採掘の `saikutumod` を断らない）→ Task 4 の契約テストと、`scripts/test-game-contract.cjs`。
5. 開発用の画面（`npm run dev`）のコマンド一覧で、採掘のコマンドのチャットの名前が `/bridge <key> 1` のままであること → Task 3 のテスト。

---

### Task 1: ゲームの一覧と決まりを1か所に置く

**Files:**
- Create: `bridge/games.json`、`bridge/game_commands.cjs`、`bridge/test/fixtures/game-commands.json`、`bridge/test/fixtures/game-mod-ids.json`、`electron/test/game-commands.test.cjs`
- Modify: `package.json`（`build.files` に `bridge/games.json`・`bridge/game_commands.cjs`）

**Interfaces:**
- Produces（`bridge/game_commands.cjs`）:
  - `GAMES`（`games.json` を中まで凍らせたもの）、`GAME_IDS: string[]`（4つ）、`PACK_GAME_IDS: string[]`（`common` 以外の3つ）、`RESERVED_MOD_IDS: string[]`（`['bridgemod', 'displaymod', 'doumacmd']`）。
  - `gameOfCommand(name: any) => string | null`（ゲーム専用なら小文字のゲーム ID、そうでなければ `null`。文字列でなければ `null`）。
  - `isGameCommandFile(name: any) => boolean`（`isTxtName(name)`・`isBridgeCommandFile(name)`（`/` と `\` を含まない）・`gameOfCommand(name) !== null` のすべて）。
  - `publicCommandKey(name: string) => string`（Global Constraints のとおり）。
  - `isGameModId(id: any) => boolean`、`isGamePackKey(key: any) => boolean`。
- 例の一覧:
  - `game-commands.json`: `[{ "name": "game_saikutu_dig.txt", "game": "saikutu", "publicKey": "dig" }, { "name": "GAME_RUN_X.TXT", "game": "run", "publicKey": "X" }, { "name": "game_mode_on.txt", "game": null, "publicKey": "game_mode_on" }, { "name": "game_unknown_x.txt", "game": null, "publicKey": "game_unknown_x" }, { "name": "game_umetate_fill.v2.txt", "game": "umetate", "publicKey": "fill.v2" }, { "name": "zombie.txt", "game": null, "publicKey": "zombie" }, { "name": "game_common_x.txt", "game": null, "publicKey": "game_common_x" }]`
  - `game-mod-ids.json`: `[{ "id": "saikutumod", "ok": true }, { "id": "gameprobe", "ok": true }, { "id": "a", "ok": false }, { "id": "Saikutu", "ok": false }, { "id": "bridgemod", "ok": false }, { "id": "displaymod", "ok": false }, { "id": "doumacmd", "ok": false }, { "id": "a1234567890123456789012345678901234567890123456789012345678901234", "ok": false }, { "id": "game-mod", "ok": false }]`（最後から2つ目は 65 文字）

- [ ] **Step 1: テストを書く**（`electron/test/game-commands.test.cjs`）

```js
const fixture = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../bridge/test/fixtures', name), 'utf8'));
test('ゲームの一覧は games.json の1か所（common と、ゲームパックの3つ）', () => {
  assert.deepEqual(GAME_IDS, ['common', 'umetate', 'run', 'saikutu']);
  assert.deepEqual(PACK_GAME_IDS, ['umetate', 'run', 'saikutu']);
  assert.ok(Object.isFrozen(GAMES) && Object.isFrozen(GAMES[0]));
});
test('ゲーム専用の判定とチャットの名前: 例の一覧（Java の契約テストも同じものを読む）', () => {
  for (const c of fixture('game-commands.json')) {
    assert.equal(gameOfCommand(c.name), c.game, c.name);
    assert.equal(publicCommandKey(c.name), c.publicKey, c.name);
  }
  assert.deepEqual([isGameCommandFile('game_run_x.txt'), isGameCommandFile('game_run_x'), isGameCommandFile('../game_run_x.txt'), isGameCommandFile('game_mode_on.txt')], [true, false, false, false]);
});
test('ゲーム MOD の ID とパックの key', () => {
  for (const c of fixture('game-mod-ids.json')) assert.equal(isGameModId(c.id), c.ok, c.id);
  assert.deepEqual(['dig', 'a', 'a'.repeat(50), 'Dig', '1x', 'a'.repeat(51), 'a-b'].map(isGamePackKey), [true, true, true, false, false, false, false]);
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/game-commands.test.cjs` / Expected: FAIL（モジュールがない）。
- [ ] **Step 3: 作る**（Interfaces のとおり。`build.files` に足す）。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/game-commands.test.cjs electron/test/config-schema.test.cjs` / Expected: PASS。
- [ ] **Step 5: commit**（「refactor: ゲームの一覧と、ゲーム専用の判定・ゲーム MOD の ID・パックの key の決まりを1か所に置く」）

---

### Task 2: アプリと BRIDGE が同じ一覧と決まりを使う

**Files:**
- Modify: `electron/game_profiles.cjs`（12〜14 行目の `GAMES` を `games.json` から。23 行目の `withoutOtherGameCommands` を `gameOfCommand` にし、文字列の値（`isTxtName` で、ほかのゲームのもの）も外す。154 行目と 207 行目の正規表現を `isGameCommandFile`。66 行目を `isGameModId`。79 行目を `isGamePackKey`）
- Modify: `electron/game_command_scope.cjs`（4 行目の `GAME_IDS`、14 行目の判定を `gameOfCommand`）、`electron/bridge_settings.cjs:202`（`gameOfCommand(filename)` なら止める）、`electron/main.cjs:69`（`!name.startsWith('game_')` を `!gameOfCommand(name)`）、`bridge/mod_event_delivery.cjs:159`（`isGameModId`）
- Modify: `electron/bridge_settings.cjs` の `readCommandMetadata`（返す行に `chatKey: publicCommandKey(name)`）
- Test: `electron/test/game-command-scope.test.cjs`、`electron/test/game-profiles.test.cjs`、`electron/test/bridge-settings-module.test.cjs`、`electron/test/mod-event-delivery.test.cjs`、`electron/test/game-commands.test.cjs`

- [ ] **Step 1: テストを書く**
  - `game-command-scope.test.cjs`: 候補の名前に `game_mode_on.txt`・`GAME_RUN_X.TXT` を足し、サバイバルでは `game_mode_on.txt` を候補に出して `GAME_RUN_X.TXT` を出さず、RUN では両方を出すこと。
  - `game-profiles.test.cjs`: 251 行目「埋め立て・RUN のプロフィールから採掘のプロフィールを初めて作るとき…」と同じ下準備で、`game_mode_on.txt` の割り当ては残り、`{ '!x': 'game_umetate_fill.txt' }`（文字列のコメントコマンド）は外れること。
  - `bridge-settings-module.test.cjs`: TXT の書き込みで `GAME_RUN_X.TXT`・`game_saikutu_dig.txt` は「ゲームパックのコマンドはパックを再登録して更新してください」で止まり、`game_mode_on.txt` は書けること。コマンドの一覧（`bridge:commands:readMeta`）の行に `chatKey` があり、`game_saikutu_dig.txt` は `dig`。
  - `mod-event-delivery.test.cjs`: `# GAME_MOD: bridgemod` は「Invalid game MOD ID」で断ること（`captureGameEvent` の今のテストの下準備を使う）。
  - `game-commands.test.cjs` に写しを探すテストを足す:

```js
test('ゲームの一覧と判定の写し: アプリ・BRIDGE・画面は自分の一覧や正規表現を持たない', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const files = [...fs.readdirSync(path.resolve(__dirname, '..')).filter(n => n.endsWith('.cjs')).map(n => 'electron/' + n),
    ...['bridge/index.js', 'bridge/mod_event_delivery.cjs', 'vite.config.ts'],
    ...fs.readdirSync(path.resolve(__dirname, '../../src/components')).filter(n => n.endsWith('.tsx')).map(n => 'src/components/' + n),
    ...fs.readdirSync(path.resolve(__dirname, '../../src/lib')).filter(n => n.endsWith('.ts')).map(n => 'src/lib/' + n)];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /(umetate|saikutu)\|(umetate|run|saikutu)|startsWith\(['"]game_['"]\)|\^game_\[a-z0-9\]/, file + ' にゲームの一覧・判定の写しがある');
    assert.doesNotMatch(source, /\{1,63\}|\{0,49\}|['"]doumacmd['"]/, file + ' に MOD の ID・パックの key の写しがある');
  }
});
```

  （今これに当たるのは `game_profiles.cjs`・`game_command_scope.cjs`・`bridge_settings.cjs`・`main.cjs`・`mod_event_delivery.cjs`・`CommandsListPage.tsx`・`devApiMock.ts`。`game_profiles.cjs:279` の自分の MOD の見分けの `new Set(['bridgemod', 'doumacmd', 'displaymod', …])` は予約名と同じ値なので `RESERVED_MOD_IDS` を使う。`bridge_mod_migration.cjs`・`games_ipc.cjs` の jar の名前の正規表現（`bridgemod-…\.jar`）は当たらない。画面は Task 3 で直すので、このテストは Task 3 の終わりで通る）

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/game-command-scope.test.cjs electron/test/game-profiles.test.cjs electron/test/bridge-settings-module.test.cjs electron/test/mod-event-delivery.test.cjs` / Expected: FAIL（`game_mode_on.txt` を外す、`GAME_RUN_X.TXT` を書ける、`chatKey` がない、`bridgemod` を通す）。
- [ ] **Step 3: 直す**（Files のとおり）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:app` / Expected: PASS（写しを探すテストだけは、画面が残っているので Task 3 まで FAIL のまま。ほかは `ℹ fail` が 1）。
- [ ] **Step 5: commit**（「fix: アプリと BRIDGE がゲームの一覧とゲーム専用の判定を1か所から使う（game_mode_on・大文字・予約名）」）

---

### Task 3: 画面と開発用のサーバーも同じ一覧と名前を使う

**Files:**
- Modify: `src/components/CommandsListPage.tsx:9・37-39`（`CommandMeta` に `chatKey?: string`。`chatCommandOf` は `/bridge ${meta.chatKey ?? meta.name} 1`）
- Modify: `vite.config.ts:128-150`（開発用のコマンド一覧にも `chatKey: publicCommandKey(name)`。`load("./bridge/game_commands.cjs")`）
- Modify: `src/lib/devApiMock.ts`（204〜208 行目の一覧を `import GAMES from "../../bridge/games.json"` から（`installed` は今の値のまま）。66 行目の `startsWith("game_")` を games.json の ID から作る判定に。採掘のコマンドの行に `chatKey: command.key`）
- Test: `electron/test/game-commands.test.cjs`（Task 2 の写しを探すテスト）、`electron/test/ui-visual-regressions.test.cjs`（`devApiMock.ts` を読むテストが通ること）

- [ ] **Step 1: テストを書く**（`game-commands.test.cjs` に足す）

```js
test('画面: コマンド一覧のチャットの名前はアプリが付ける chatKey を使い、開発用のモックの一覧は games.json から', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  assert.match(read('src/components/CommandsListPage.tsx'), /meta\.chatKey \?\? meta\.name/);
  assert.match(read('src/lib/devApiMock.ts'), /from "\.\.\/\.\.\/bridge\/games\.json"/);
  assert.match(read('vite.config.ts'), /publicCommandKey\(name\)/);
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/game-commands.test.cjs` / Expected: FAIL（このテストと、Task 2 の写しを探すテスト）。
- [ ] **Step 3: 直す**（Files のとおり）。
- [ ] **Step 4: 動かす** — Run: `npm run verify` / Expected: typecheck・test:bridge・test:app（`ℹ fail 0`）・build が通る。
- [ ] **Step 5: commit**（「fix: 画面と開発用のサーバーもゲームの一覧とチャットの名前を1か所から使う」）

---

### Task 4: BridgeMOD の一覧と MOD の ID の決まりを同じにし、契約テストで確かめる（BridgeMOD 1.8.2）

**Files:**
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/CommandRouting.java`（`static final List<String> GAME_IDS = List.of("saikutu", "umetate", "run");` を足し、`publicKey` の正規表現（`(?i)^game_(?:` + `String.join("|", GAME_IDS)` + `)_`）と `resolve` の一覧（49 行目）がそれを使う）
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/api/GameEvents.java`（`public static final Set<String> RESERVED_MOD_IDS = Set.of("bridgemod", "displaymod", "doumacmd");`、`public static boolean isGameModId(String id)`（null は false）。`register` はそれを使う）
- Create: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/GameCommandParity.java`（標準入力の各行 `>` + 16進の名前に、`>` + 16進の `CommandRouting.publicKey(name)` を返す。1行目に `>` + 16進の `String.join(",", GAME_IDS)` を返す）、`GameModIdParity.java`（各行に `>1`/`>0`）
- Modify: `BridgeMod/src/contractTest/java/jp/douma/bridgemod/GameContractTest.java:10`・`CommandRoutingContractTest.java:20-21`（自分の一覧の写しをやめ `CommandRouting.GAME_IDS`）
- Modify: `scripts/test-bridge-contracts.cjs`（`api/GameEvents.java` と2つの Parity をビルドに足し、`game-commands.json` の `publicKey` と `game-mod-ids.json` の `ok` を JavaScript（`publicCommandKey`・`isGameModId`）と Java の両方に通し、Java の一覧が `PACK_GAME_IDS` と同じ集合であることを確かめる。今の `CommandKeyParity` と同じ形）
- Modify: `BridgeMod/gradle.properties`（`mod_version=1.8.2`）

- [ ] **Step 1: テストを書く**（`scripts/test-bridge-contracts.cjs` に足す）。直す前の Java では、`GAME_RUN_X.TXT` の `publicKey` が `GAME_RUN_X`（JavaScript は `X`）、`bridgemod` を通す、で落ちる。
- [ ] **Step 2: 動かす** — Run: `node scripts/test-bridge-contracts.cjs` / Expected: FAIL（`GameCommandParity`・`GameModIdParity` がない、のあと直す前の Java の結果が違う）。手元に javac が無ければ、JAVA_HOME の JDK を使う（CI の mod-build と同じ）。
- [ ] **Step 3: 直す**（Files のとおり）。
- [ ] **Step 4: 動かす** — Run: `node scripts/test-bridge-contracts.cjs`、`node scripts/test-game-contract.cjs`、`BridgeMod` で `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"` / Expected: PASS、`BridgeMod/build/libs/bridgemod-1.8.2.jar` ができる。
- [ ] **Step 5: commit**（「fix: BridgeMOD のゲームの一覧と MOD の ID の決まりをアプリと同じにする（BridgeMOD 1.8.2）」）

---

### Task 5: 記録

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「処理のコピー」の PR6 の節：やったこと・決めたこと 1〜6・`npm run verify` と契約テストとビルドの結果・リリースノートに足すこと）

リリースノートに足すこと:
- バックアップを戻すとき、`game_mode_on.txt` のように `game_` で始まる共通のコマンドを使う設定でも止まらなくなりました。
- 採掘に初めて切り替えるとき、共通のコマンド（`game_` で始まるもの）の割り当てを外さなくなりました。
- 新しい BridgeMOD（1.8.2）はサーバーを起動し直すと入れ替わります。

- [ ] **Step 1: HANDOFF を書く**
- [ ] **Step 2: `npm run verify`** — Expected: すべて通る。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR6 を書く」）
