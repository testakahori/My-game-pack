# 埋め立て PR2（ゲームパックと配り方）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TOP で「埋め立て」を選ぶと、UmetateMod がサーバーと Minecraft 本体の両方に入り、ギフトの割り当てに埋め立ての18個が並ぶようにする（アプリと一緒に配る）。

**Architecture:** 採掘と同じゲームパックの形（`game-packs/<id>/game.json` と jar）で `game-packs/umetate/` を足す。採掘と違い `bridgeEventApi` を使わず、BridgeMOD にコマンド `umetate <名前> {Count} {ListenerName}` を打たせる（PR1 で作ったコマンドの形）。配り方は、jar の場所の決まり（`scripts/mod_jars.cjs`）・パックを作る台本（`scripts/prepare-game-packs.cjs`）・アプリが同梱のパックを見つける所（`electron/games_ipc.cjs`）の3か所を、採掘だけの決め打ちから2つのパックに広げる。

**Tech Stack:** Node（electron/*.cjs・scripts/*.cjs・node:test）。MOD のコードは変えない。

**Spec:** `docs/superpowers/specs/2026-10-26-umetate-game-design.md`（3.2）

## Global Constraints

- `game-packs/umetate/game.json`：`format: 1`、`id: "umetate"`、`modId: "stackinggame_events"`、`serverJar` と `clientJar` は `stackinggame_events-<UmetateMod/gradle.properties の mod_version>.jar`（今は 2.6.23）。`bridgeEventApi` は書かない。
- コマンドは18個。`UmetateKeys.EVENTS`（13個）と `UmetateKeys.LAB`（5つ）と同じ名前・同じ順で、`command` は `umetate <名前> {Count} {ListenerName}`。`reset` は載せない。
- 題名（`title`）は `UmetateMod/.../integration/UmetateTitles.java` の題名と同じ（ギフトの割り当ての一覧と、ゲームの中の表示を合わせる）。
- `destructive` は、どのコマンドにも付けない（2026-10-29 ユーザーの決定「妨害マイクラなんだからマップボッコボコにしていい」）。保護エリア（印の付いたギフトを、決めた範囲の中では動かさない BridgeMOD の仕組み）は、今は BRIDGE がいつもオフで送っていて働いていないが、将来オンにしても埋め立ては止めない。
- 表示は今の既定（`commonDisplay` を書かない ＝ `DISPLAY_OWNER: game`）。UmetateMod が始まったときに出す（PR1）。
- UmetateMod の jar は、サーバーと Minecraft 本体の両方に入れる（白い光と揺れの描画のため）。サーバーのひな形（`scripts/prepare-server-template.cjs`）には入れない（ゲームを選んだときに入る。採掘と同じ）。
- MOD のコード・版は変えない（2.6.23 のまま）。

## 決めたこと（Ruling。ユーザーに見せる）

- 「作るが同梱しない MOD」（`buildOnlyModJars`）は、埋め立てMOD が同梱に移ると空になるので、関数ごと消す（呼ぶ所は `scripts/check-jar-inputs.cjs` とテスト）。
- 同梱のパックを見つける所は、新しい小さなモジュール `electron/bundled_game_packs.cjs` にして、テストできるようにする。
- 送った人の名前が空でも、コマンドの最後に空白は残らない。BridgeMOD は `{ListenerName}` に入れる前に `ListenerNames.display` を通し、前後の空白を削って、空なら `viewer` にする（`BridgeMod/src/main/java/jp/douma/bridgemod/ListenerNames.java`。レビューで確かめた。2026-10-29 に直した記述）。

## Review Focus

1. 送った人の名前が空のギフト：コマンドが「引数が正しくない」で失敗しないか。→ レビューで確かめた。BridgeMOD の `ListenerNames.display` が空を `viewer` にし、後ろの空白も削るので、空になる道は無い（テストは足さない）。
2. 採掘を選んでいる人がアプリを更新したとき：採掘のパックとゲームの切り替えが今までどおり動く。→ Task 2 のテストに入れる。
3. 埋め立てのパックの jar が無いまま `npm run release:win` を流したとき：はっきり止まる（埋め立てMOD を作って、と言う）。→ Task 2 のテストに入れる。
4. game.json と UmetateMod の名前・題名・版がずれたとき（MOD だけ直した）：テストが落ちる。→ Task 1 のテストに入れる。
5. 埋め立てを選んで保存したとき：サーバーにも Minecraft 本体にも UmetateMod が入り、OBSMOD はサーバーにだけ入る。→ Task 1 のテストに入れる。

---

## ファイルの分担

- Create `game-packs/umetate/game.json` — 埋め立てのゲームパックの中身。
- Create `electron/bundled_game_packs.cjs` — 同梱のゲームパック（採掘・埋め立て）の場所を返す。
- Create `electron/test/helpers/fake_jar.cjs` — テスト用の偽の jar（今は `electron/test/game-profiles.test.cjs` の中にある `jar()` を移す）。
- Create `electron/test/umetate-pack.test.cjs` — 埋め立てのパックの確かめ。
- Modify `scripts/mod_jars.cjs`、`scripts/check-jar-inputs.cjs`、`scripts/prepare-game-packs.cjs`、`scripts/refresh-dev.cjs`、`electron/games_ipc.cjs`。
- Modify tests：`electron/test/game-profiles.test.cjs`（偽の jar の手助けを使う形に）、`electron/test/release-command.test.cjs`、`electron/test/soutenmon-mods.test.cjs`、`electron/test/refresh-dev.test.cjs`。
- Modify docs：`HANDOFF/HANDOFF04.md`、`map/README.md`（「アプリのゲーム一覧への登録は別作業です」の行）、`AGENTS.md`（UmetateMod は同梱する MOD になった）。

---

### Task 1: 埋め立てのゲームパック（game.json）

**Files:**
- Create: `game-packs/umetate/game.json`、`electron/test/helpers/fake_jar.cjs`、`electron/test/umetate-pack.test.cjs`
- Modify: `electron/test/game-profiles.test.cjs:9-15`（`jar()` を手助けから読む）

**Interfaces:**
- Produces: `electron/test/helpers/fake_jar.cjs` の `fakeJar(modId: string) -> Buffer`（今の `jar()` と同じ中身）。

- [ ] **Step 1: 手助けを移す** — `jar()` を `fakeJar` として移し、`game-profiles.test.cjs` は `const { fakeJar: jar } = require('./helpers/fake_jar.cjs')` で使う。Run: `node --test electron/test/game-profiles.test.cjs` Expected: 前と同じ数が全部 PASS。
- [ ] **Step 2: 失敗するテストを書く** — `umetate-pack.test.cjs`：
  - `UmetateKeys.java` の `EVENTS`・`LAB` の `List.of(...)` の文字を正規表現で取り出し、game.json の key がその18個と同じ順。`reset` が無い。
  - `UmetateTitles.java` の `Map.entry("k", "v")` を取り出し、18個すべてで title が同じ。
  - command がすべて `umetate ${key} {Count} {ListenerName}`。
  - `format`・`id`・`modId` が Global Constraints の値。`bridgeEventApi` が無い。`serverJar`・`clientJar` が `stackinggame_events-${mod_version}.jar`。
  - どのコマンドにも `destructive` が無い。
  - 一時フォルダーに game.json と `fakeJar('stackinggame_events')` を置き、`inspectPackage` が通る。正規化された commands の `category` が `UmetateMOD`。
  - `createGameProfiles`（`game-profiles.test.cjs` の fixture と同じ作り。`bundledPackages` にこのフォルダーを渡す）で `activate('umetate')`：サーバーと本体の両方の mods に UmetateMod の jar。`obsJar` を渡したときは OBSMOD はサーバーにだけ。コマンドのフォルダーの `game_umetate_voidbomb.txt` が `# TITLE: ボイドボム`・`# CATEGORY: UmetateMOD`・`# DISPLAY_OWNER: game`・`# COUNT_MODE: aggregate` を持ち、`# GAME_MOD:` と `# DESTRUCTIVE:` が無く、最後の行が `umetate voidbomb {Count} {ListenerName}`。
- [ ] **Step 3: 落ちることを確かめる** — Run: `node --test electron/test/umetate-pack.test.cjs` Expected: game.json が無くて FAIL。
- [ ] **Step 4: `game-packs/umetate/game.json` を書く** — 18個を `UmetateKeys` の順で。
- [ ] **Step 5: 通ることを確かめる** — Run: 同じ。Expected: PASS。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): 埋め立てのゲームパック（game.json）を足す"`

### Task 2: 配り方（jar の決まり・パックを作る台本・同梱のパック・開発版の作り直し）

**Files:**
- Create: `electron/bundled_game_packs.cjs`
- Modify: `scripts/mod_jars.cjs`、`scripts/check-jar-inputs.cjs`、`scripts/prepare-game-packs.cjs`、`scripts/refresh-dev.cjs`、`electron/games_ipc.cjs:29-32`
- Test: `electron/test/release-command.test.cjs`、`electron/test/soutenmon-mods.test.cjs`、`electron/test/refresh-dev.test.cjs`、`electron/test/umetate-pack.test.cjs`

**Interfaces:**
- Produces: `scripts/mod_jars.cjs` の `modJars(root)` に `{ name: "埋め立てMOD", dir: "UmetateMod", jar: <UmetateMod/build/libs/<game-packs/umetate/game.json の serverJar>>, uses: { name: "BridgeMOD", dir: "BridgeMod" } }` を採掘MOD のあと・OBSMOD の前に足す。`buildOnlyModJars` は消す。
- Produces: `scripts/prepare-game-packs.cjs` の `GAME_PACKS = [{ id: "saikutu", dir: "SaikutuMod", modId: "saikutumod" }, { id: "umetate", dir: "UmetateMod", modId: "stackinggame_events" }]` と `prepareGamePacks(repoRoot = root) -> string[]`（作った `build/game-packs/<id>` の一覧）。jar が無い・MOD ID が違うときは、どの MOD を作ればよいかを言って止める。
- Produces: `electron/bundled_game_packs.cjs` の `bundledGamePacks({ packaged: boolean, resourcesPath: string, appDir: string }) -> Array<{ id: string, folder: string }>`（`GAME_PACKS` の id の順。game.json があるものだけ。packaged なら `<resourcesPath>/game-packs/<id>`、そうでなければ `<appDir>/../build/game-packs/<id>`）。

- [ ] **Step 1: 失敗するテストを書く**
  - `release-command.test.cjs`：`modJars` の一覧が BridgeMOD・DisplayMOD・採掘MOD・埋め立てMOD・OBSMOD の順で、埋め立てMOD の jar が `UmetateMod/build/libs/stackinggame_events-2.6.16.jar`（このテストの偽のリポジトリの版。偽の `game-packs/umetate/game.json` を足す）。`check-jar-inputs` の名前の一覧も同じ5つで、埋め立てMOD は BridgeMod の分も照らす（今のテストをこの形に直す）。埋め立てMOD の jar が無いときに、リリースの準備が「埋め立てMOD」の名前を出して止まる。
  - `soutenmon-mods.test.cjs`：「作るが同梱しない MOD」のテストを、`modJars` に埋め立てMOD があり `uses` が BridgeMod である、に直す。`mod_jars.cjs` に `buildOnlyModJars` が無い。
  - `refresh-dev.test.cjs`：jar を作る手順に `UmetateMod の jar` がある。パックの手順の名前が「ゲームパック（採掘・埋め立て）」で、`prepare-game-packs.cjs` を呼ぶ。手順の順番（UmetateMod の jar のあとにパック）。
  - `umetate-pack.test.cjs`：偽のリポジトリ（BridgeMod 以外の MOD の jar と game.json だけ）で `prepareGamePacks(dir)` が `build/game-packs/saikutu` と `build/game-packs/umetate` を作り、それぞれ `inspectPackage` が通る。UmetateMod の jar が無いと「UmetateMod」を含む言葉で止まる。`bundledGamePacks` が、両方あるときは2つ（saikutu・umetate の順）、片方だけのときはそれだけを返す（packaged と開発版の両方の場所）。`games_ipc.cjs` が `bundledGamePacks` を使い、`'saikutu'` を決め打ちしていない。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test electron/test/release-command.test.cjs electron/test/soutenmon-mods.test.cjs electron/test/refresh-dev.test.cjs electron/test/umetate-pack.test.cjs` Expected: 新しい・直したテストが FAIL。
- [ ] **Step 3: 作る** — 上の Interfaces のとおり。`refresh-dev.cjs` の MOD の一覧に `UmetateMod` を足し、パックの手順の名前を変える。`check-jar-inputs.cjs` は `modJars` だけを見る。
- [ ] **Step 4: 通ることを確かめる** — Run: 同じ。Expected: PASS。
- [ ] **Step 5: 全体を流す** — Run: `npm run verify` Expected: 型チェック・BRIDGE・アプリの全テスト・ビルドが通る。Run: `node scripts/prepare-game-packs.cjs`（いつもの作業コピーで。UmetateMod 2.6.23 の jar がある）Expected: 2つのパックができる。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): 埋め立てのゲームパックをアプリと一緒に配る"`

### Task 3: 文書と、開発版での見た目の確かめ

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`、`map/README.md`、`AGENTS.md`

- [ ] **Step 1: 文書を直す** — `map/README.md` の「アプリのゲーム一覧への登録は別作業です」を「TOP で埋め立てを選ぶと、UmetateMod がサーバーと本体に入る（マップの入れ替えは PR3）」に。`AGENTS.md` の UmetateMod の説明に「ゲームパック `game-packs/umetate/` で同梱する（2026-10-29）」を足す。HANDOFF04 に PR2 の節（やったこと・決めたこと・次にやること＝PR3）。
- [ ] **Step 2: 開発版で見る（ユーザーと）** — 一時の設定・空の一時サーバー（HANDOFF04 の OBS 連携の節のやり方）で本物のアプリを開き、TOP のゲームの一覧に「埋め立て」が出て選べること、ギフトの割り当ての一覧に埋め立ての18個（題名が日本語）が出ることを、ユーザーに見てもらう。本物の配信サーバーとふだんの設定には触らない。Expected: ユーザーが「出ている」と言う。
- [ ] **Step 3: Commit** — `git commit -m "docs(umetate): 埋め立てのゲームパックの配り方を書く"`

---

## 終わったら

- 最後のレビュー（opus。報告は日本語）→ 重大・重要は直す、軽いものはユーザーが決める → PR → CI → ユーザーの許しでマージ → HANDOFF04 の docs PR。
- このあと PR3（マップの入れ替え・「マップを初期化」）。PR3 までできるまで、配る物（`npm run release:win`）は作らない（埋め立てを選んでも、マップがまだ研究室マップにならないため）。
