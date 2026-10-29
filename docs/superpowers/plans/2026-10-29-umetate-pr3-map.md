# 埋め立て PR3（マップの入れ替えと「マップを初期化」）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ほかのゲームから「埋め立て」に切り替えると、研究室マップを初期の状態から使うようにし、TOP に「マップを初期化」のボタンを付ける。

**Architecture:**
- 初期マップ（`map/umetate_lab_map`）は、配る物のゲームパックのフォルダーに `maps/umetate_lab_map` として入れる。
- アプリは、それをサーバーの `map_backup/umetate/umetate_lab_map` に写して持つ。埋め立てに切り替えたときと、初期化のボタンを押したときに、そこから `haihu_world/umetate_lab_map` へ写して、`level-name` をそこにする。
- どのゲームがどのマップを持つかは `bridge/games.json` の `maps` の1か所に書く。
- 写す・入れ替える処理は新しい `electron/game_maps.cjs` に置く。今のゲームの切り替え（`electron/game_profiles.cjs` の `activate`）と同じ途中の記録（`pending-switch.json`）で、失敗やアプリの強制終了のときも元に戻す。

**Tech Stack:** Node（electron/*.cjs・scripts/*.cjs・node:test）、React（`src/components/GameSelector.tsx`）。MOD は変えない。

**Spec:** `docs/superpowers/specs/2026-10-26-umetate-game-design.md`（3.3。4 の「map_backup と初期化は、ゲームごとに複数のマップを持てる形」）

## Global Constraints

- 初期マップの元は `map/umetate_lab_map`（git の外）。配る物には、一番上の `playerdata`・`stats`・`advancements` と `session.lock` を入れない。`umetate_lab_map.json`（研究室の見分け）は入れる。元が無ければ、配る物を作る手順がはっきり止まる。
- サーバーの中の置き場：
  - バックアップ：`<サーバー>/map_backup/<ゲームID>/<マップ名>/`
  - 使う場所：`<サーバー>/haihu_world/<マップ名>`。`level-name` は `haihu_world/<マップ名>`
- マップを写すのは、ほかのゲームから埋め立てに切り替えたときだけ（2026-10-26 ユーザーの決定「ゲームが変わったときだけ」）。埋め立てを選んだまま「保存」を押しても、マップに触らない。
- 採掘・サバイバルに切り替えたときは、マップに触らない。`level-name` は、埋め立ての前に使っていたワールドに戻す。記録が無いときは `haihu_world/world` に戻す。
- サーバーのフォルダーの直下にある `umetate_lab_map`（ユーザーの配信サーバーに Codex が手で入れたもの）は消さない。
- 「マップを初期化」は、今のゲームが埋め立てのときだけ出す。サーバーが動いている間は押せない（理由を出す）。押したら確かめの画面を出す。置き場所は TOP のゲームを選ぶ所。
- 切り替えも初期化も、サーバーが止まっているときだけ行う。途中で失敗したら元に戻す（MOD・コマンドの入れ替えと同じ記録で戻す）。
- ゲームの名前（`'umetate'`）を、electron・scripts・bridge・src のコードに書かない（設計書 13。`electron/test/game-commands.test.cjs` が見張る）。どのゲームにマップがあるかは `games.json` の `maps` から読む。
- 本物の配信サーバー（`server/Douma_Craft`）とふだんの設定は、テストや確かめで書き換えない。
- `.bat`・`.cmd` は英語だけ。画面の文は日本語。

## 決めたこと（Ruling。ユーザーに見せる）

1. どのゲームがどのマップを持つかは、`bridge/games.json` の埋め立ての項目に `"maps": ["umetate_lab_map"]` と書く（PR2 の `modDir` と同じく、ゲームの一覧の1か所）。1つ目が、切り替えと初期化で使うマップ。
2. 配る物の中の置き場は、ゲームパックのフォルダーの `maps/<マップ名>`（`build/game-packs/umetate/maps/umetate_lab_map`）。electron-builder の設定は増やさない。
3. 準備の手順は、ゲームパックとは別の `npm run prepare:game-maps`（`scripts/prepare-game-maps.cjs`）にする。CI の mod-build はゲームパックの準備を動かすが、マップ（git の外）を持たないので、分けないと CI が止まる。`npm run release:win` と `npm run dev:refresh` は、パックの次にこれを動かす。
4. `map_backup` はアプリが持つものとして扱う。使う前に、配った物と中身（ファイルごとの SHA-256）を照らし、違えば配った物から写し直す。これで、アプリの更新でマップが変わったときと、`map_backup` が壊れたときの両方に効く（`map_backup` を手で直しても、配った物に戻る）。配った物が無い（開発版でまだ作っていない）ときは、`map_backup` にあるものをそのまま使う。両方無ければ、何も変えずに止まる。
5. 「埋め立ての前に使っていたワールド」は、切り替えの記録（`profiles.json`）の `mapReturnLevel` に残す。埋め立てのマップと同じ名前のワールド（`haihu_world/umetate_lab_map` も、直下の `umetate_lab_map` も）は記録しない。記録したワールドに `level.dat` が無ければ `haihu_world/world` に戻す。
6. 埋め立てから出るときに `level-name` を戻すのは、今の `level-name` が埋め立てのマップのときだけ。配信者がダッシュボードで別のワールドを選んでいたら、それには触らない。
7. 埋め立てを選んだまま「保存」を押したとき：使う場所にマップ（`level.dat`）があれば写さず、`level-name` だけをそこに合わせる。無いときだけ写す。
8. 古いマップは、切り替え・初期化が終わってから消す。消せなかったとき（ほかのアプリがファイルをつかんでいるなど）も、切り替えは成功にする。残った分は、次の切り替え・初期化の始めに消す。
9. 「マップを初期化」は、サーバーだけが止まっていればよい（BRIDGE と Minecraft は動いていてよい。マップを読むのはサーバーだけなので）。押すと、先にサーバーの状態を見る。動いていれば理由だけを出し、確かめの画面は出さない。
10. PR2 で手順書に書いた「PR3 まで配布用を作らない」を外す（この PR で揃うため）。

## Review Focus

1. ユーザーの配信サーバーのように、`level-name=umetate_lab_map`（直下。手で入れたもの）のときに埋め立てへ切り替え、そのあと採掘へ切り替える：直下の `umetate_lab_map` は残り、採掘は `haihu_world/world` で遊ぶ（`umetate_lab_map` に戻らない）。→ Task 2 のテスト。
2. `map_backup` のファイルが一部消えていた・書き換わっていた：使う前に、配った物から写し直してから使う。→ Task 2 のテスト。
3. マップをよけたところでアプリが落ちた（途中の記録が残る）：ホームの「切替前の状態に戻す」で、前のマップと `level-name` が戻る。→ Task 2 のテスト。
4. 埋め立てで遊んだあと、埋め立てのまま「保存」を押し直す：マップはそのまま（遊んだ跡が残る）。→ Task 2 のテスト。
5. 古いマップを消せなかった：切り替えは成功し、次の切り替えのときに消える。→ Task 2 のテスト（消す関数を差し替える）。

---

## ファイルの分担

- Create `scripts/prepare-game-maps.cjs`：配る物にゲームの初期マップを入れる。
- Create `electron/server_properties.cjs`：`server.properties` の書き換え（`initial_setup.cjs` の `mergeProperties` を移す）と `level-name` の読み取り。
- Create `electron/game_maps.cjs`：マップの置き場、`map_backup` の用意、使う場所への写し。
- Create tests：`electron/test/game-maps-prepare.test.cjs`、`electron/test/game-maps.test.cjs`。
- Modify：
  - `bridge/games.json`、`package.json`（scripts）
  - `scripts/release-windows.cjs`（`RELEASE_STEPS`）、`scripts/refresh-dev.cjs`
  - `electron/map_saves.cjs`（`copyVerified` を外に出す）、`electron/initial_setup.cjs`
  - `electron/game_profiles.cjs`、`electron/games_ipc.cjs`、`electron/preload.cjs`
  - `src/types/electron.d.ts`、`src/lib/devApiMock.ts`、`src/components/GameSelector.tsx`
- Modify tests：`release-command.test.cjs`、`refresh-dev.test.cjs`、`games-ipc-module.test.cjs`。
- Modify docs：`docs/手動配布とアプリ更新.md`、`AGENTS.md`、`map/README.md`、`HANDOFF/HANDOFF04.md`。

---

### Task 1: 初期マップを配る物に入れる

**Files:**
- Create: `scripts/prepare-game-maps.cjs`、`electron/test/game-maps-prepare.test.cjs`
- Modify: `bridge/games.json`、`package.json`、`scripts/release-windows.cjs:15`、`scripts/refresh-dev.cjs:19-22`、`electron/test/release-command.test.cjs:274`、`electron/test/refresh-dev.test.cjs:10-23`

**Interfaces:**
- Produces:
  - `games.json` の埋め立ての `maps: ["umetate_lab_map"]`
  - `prepareGameMaps(repoRoot: string = root) -> string[]`：作ったマップのフォルダーの一覧
  - `MAP_EXCLUDES = ['playerdata', 'stats', 'advancements']`
  - 配る物の置き場 `build/game-packs/<id>/maps/<name>`

- [ ] **Step 1: 失敗するテストを書く** — `game-maps-prepare.test.cjs`：
  - `games.json`：`maps` のあるゲームは埋め立てだけで、`["umetate_lab_map"]`。マップ名はどれも `/^[a-z0-9_]+$/`。
  - 偽のリポジトリ：`map/umetate_lab_map/` に `level.dat`・`umetate_lab_map.json`・`region/r.0.0.mca`・`playerdata/x.dat`・`stats/x.json`・`advancements/x.json`・`session.lock`・`data/playerdata/keep.dat` を置く。`prepareGameMaps(dir)`：
    - 戻り値が `[<dir>/build/game-packs/umetate/maps/umetate_lab_map]`
    - その中に `level.dat`・`umetate_lab_map.json`・`region/r.0.0.mca`・`data/playerdata/keep.dat` があり、`playerdata`・`stats`・`advancements`・`session.lock` が無い（外すのは一番上だけ）。
  - 2回目に動かしたとき、元から消したファイルが、作った物からも消える（毎回作り直す）。
  - `map/umetate_lab_map` が無い、または `level.dat` が無い：`/map\/umetate_lab_map/` を含むエラーで止まる。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test electron/test/game-maps-prepare.test.cjs` Expected: `prepare-game-maps.cjs` が無くて FAIL。
- [ ] **Step 3: 書く** — `games.json` に `maps` を足す。`scripts/prepare-game-maps.cjs` を書く。
  - 中身：`GAMES.filter(g => g.maps?.length)` の各マップについて、写し先を消してから `fs.cpSync`（filter で除く）で写し、`level.dat` を確かめる。
  - エラーの文：`初期マップ map/<name> がありません（<ゲームの名前>の初期マップ。git の外なので、手元に置いてから動かしてください）`
  - `require.main === module` のときに動かす。
- [ ] **Step 4: 手順に入れる**
  - `package.json`：`"prepare:game-maps": "node scripts/prepare-game-maps.cjs"`
  - `RELEASE_STEPS` の最後に `prepare:game-maps`
  - `refresh-dev.cjs` のゲームパックの次に、題名 `ゲームの初期マップ（埋め立て）` の手順
  - `release-command.test.cjs:274` と `refresh-dev.test.cjs` の期待を合わせる。
- [ ] **Step 5: 通ることを確かめる** — Run: `node --test electron/test/game-maps-prepare.test.cjs electron/test/release-command.test.cjs electron/test/refresh-dev.test.cjs electron/test/game-commands.test.cjs electron/test/umetate-pack.test.cjs` Expected: 全部 PASS。
- [ ] **Step 6: 本物で作る** — Run: `node scripts/prepare-game-maps.cjs` Expected: `build/game-packs/umetate/maps/umetate_lab_map` ができる。`playerdata`・`stats`・`advancements` が無く、`umetate_lab_map.json` がある（`map/` の元は変わらない）。
- [ ] **Step 7: Commit** — `feat(umetate): 研究室マップを配る物に入れる（prepare:game-maps）`

### Task 2: 切り替えでマップを入れ替える

**Files:**
- Create: `electron/server_properties.cjs`、`electron/game_maps.cjs`、`electron/test/game-maps.test.cjs`
- Modify:
  - `electron/initial_setup.cjs:28-37`（`mergeProperties` を新しいモジュールから読む）
  - `electron/map_saves.cjs:142`（`copyVerified` も出す）
  - `electron/game_profiles.cjs`（`activate`・`restore`・新しい依存）

**Interfaces:**
- Consumes: Task 1 の `games.json` の `maps`、配る物の置き場 `<パックのフォルダー>/maps/<name>`。
- Produces:
  - `server_properties.cjs`：
    - `mergeProperties(text: string, updates: object) -> string`（今のまま移す）
    - `levelNameOf(text: string) -> string`（無ければ `'world'`）
  - `game_maps.cjs`：
    - `MAP_SWITCH_DIR = '.mygamepack-map-switch'`
    - `mapPlaces(serverRoot, gameId, name) -> { backup, use, level }`：`map_backup/<gameId>/<name>`・`haihu_world/<name>`。`map_saves.cjs` の `safePath` で、リンクを通らないことを確かめる。
    - `async ensureMapBackup({ serverRoot, gameId, name, bundled: string|null }) -> files`：決めたこと 4。写すときは `map_backup/<gameId>/.staging-<uuid>` に `copyVerified` してから入れ替える。始めに残った `.staging-*` を消す。
    - `async stageMap({ serverRoot, gameId, name, files, operation }) -> string`：`<サーバー>/.mygamepack-map-switch/<operation>/next` へ `copyVerified` し、そのフォルダーを返す。
  - `createGameProfiles` の新しい依存：
    - `removeTree = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })`
    - `ensureServerStopped = ensureStopped`（Task 3 で使う）
  - 切り替えの記録 `profiles.json` の新しい項目 `mapReturnLevel?: string`
  - 途中の記録 `pending-switch.json` の新しい項目 `map?: { slot, use, fresh, hadUse, propertiesFile, propertiesBefore }`
  - Task 3 が使う中の関数：`prepareMapStep(current, id, operation, { reset })`・`applyMapStep(step)`・`finishMapStep(step)`

- [ ] **Step 1: 失敗するテストを書く** — `game-maps.test.cjs`。
  - fixture は `game-profiles.test.cjs` の形（サーバーのフォルダー名は日本語の `サーバー`）に、次を足す。
    - サーバーに `server.properties`（`level-name=haihu_world/world`）と `haihu_world/world/level.dat`
    - 同梱の埋め立てのパック（リポジトリの game.json と偽の jar。umetate-pack.test.cjs の `bundle` と同じ作り）と、その `maps/umetate_lab_map`（`level.dat`・`umetate_lab_map.json`・`region/r.0.0.mca` の小さな見本）
  - テスト（名前と確かめること）：
    1. `ほかのゲームから埋め立てに切り替えると、初期マップを map_backup に用意し、haihu_world/umetate_lab_map に写して level-name をそこにする`
       - `map_backup/umetate/umetate_lab_map` と `haihu_world/umetate_lab_map` の中身が、見本と同じ。
       - `server.properties` の `level-name=haihu_world/umetate_lab_map`。ほかの行は残る。
       - `.mygamepack-map-switch` の下に何も残らない。
    2. `埋め立てで遊んだマップは、ほかのゲームから切り替え直すと初期の状態に戻り、遊んだマップは消える`：使う場所に `region/played.mca` を足す → 採掘 → 埋め立て。`played.mca` が無く、見本と同じ。
    3. `埋め立てのまま保存し直しても、マップに触らない`（Review Focus 4）：`played.mca` が残る。`level-name` を手で `haihu_world/world` にしてから保存し直すと、写さずに `level-name` だけ戻る。
    4. `埋め立てから採掘に切り替えると、マップに触らずに前のワールドへ戻す`：`level-name=haihu_world/world`。`haihu_world/umetate_lab_map` は残る。
    5. `ダッシュボードで別のワールドを選んでいたら、埋め立てから出るときに level-name に触らない`：埋め立て中に `level-name=haihu_world/sakura` → 採掘 → `haihu_world/sakura` のまま。
    6. `直下の umetate_lab_map を使っていたサーバー（手で入れたもの）でも、それを消さず、出るときは haihu_world/world に戻す`（Review Focus 1）：始めを `level-name=umetate_lab_map`＋直下の `umetate_lab_map/level.dat` にする → 埋め立て → 採掘。直下のフォルダーが残り、`level-name=haihu_world/world`。
    7. `map_backup が壊れていたら、配った物から写し直してから使う`（Review Focus 2）：`map_backup` の `region/r.0.0.mca` を消し、`level.dat` を書き換える → 切り替え直す。`map_backup` も使う場所も見本と同じ。
    8. `配った物が無ければ map_backup を使い、両方無ければ何も変えずに止まる`：パックの `maps` を消す → 切り替えは通る。`map_backup` も消す → `/初期マップがありません/` で止まる。mods・設定・`server.properties`・今のゲームが前のまま。
    9. `切り替えが途中で失敗したら、マップと level-name も元に戻す`：`beforeStep: i => { if (i === 1) throw … }` で、`played.mca` のある埋め立てのマップを使っているときに、採掘 → 埋め立て。`/元へ戻しました/`、`played.mca` が戻り、`level-name` は採掘のとき（`haihu_world/world`）のまま。
    10. `マップをよけたところでアプリが落ちても、「切替前の状態に戻す」でマップと level-name が戻る`（Review Focus 3）：
        - `game-profiles.test.cjs:106` の形で、`map` 付きの `pending-switch.json` を手で作る。
        - 状態：使う場所のマップを `slot/previous` へよけ、新しいマップが使う場所にあり、`server.properties` が書き換わっている。
        - `recover()` のあと、前のマップが使う場所に戻り、新しいマップは `slot/interrupted-*` に移り、`server.properties` が前の中身。
    11. `古いマップを消せなくても切り替えは成功し、次の切り替えのときに消える`（Review Focus 5）：1回目は `removeTree` が投げる → `activate` は成功し、`.mygamepack-map-switch/<id>` が残る。2回目（ふつうの `removeTree`）のあと、`.mygamepack-map-switch` の下が空。
  - `server_properties.cjs`：
    - `mergeProperties('a=1\r\nlevel-name=world\r\n# c\r\n', { 'level-name': 'haihu_world/x' })` は `'a=1\nlevel-name=haihu_world/x\n# c\n'`（今の `initial_setup.cjs` の結果と同じ。無いキーは最後に足す）。
    - `levelNameOf('')` は `'world'`。`levelNameOf('level-name=haihu_world/x\r\n')` は `'haihu_world/x'`。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test electron/test/game-maps.test.cjs` Expected: モジュールが無くて FAIL。
- [ ] **Step 3: `server_properties.cjs` と `game_maps.cjs` を書き、`map_saves.cjs` から `copyVerified` を出す。**
- [ ] **Step 4: `game_profiles.cjs` に入れる**
  - `prepareMapStep(current, id, operation, { reset = false })`：記録を書く前（ゆっくりな写しをここで済ませる）。決めたこと 5〜7 で次のどれかを返す。
    - 入る（`id` のゲームに `maps` がある）：`{ fresh, slot, use, hadUse, propertiesFile, propertiesBefore, propertiesAfter, returnLevel }`
      - `fresh = reset || id !== current.active || 使う場所に level.dat が無い`
      - `fresh` のときだけ `ensureMapBackup` と `stageMap` を通す。
    - 出る（前のゲームに `maps` があり、今の `level-name` の名前がそのマップ）：`level-name` を戻す step
    - 何もしない：`null`
  - `activate`：
    - 始めに、`.mygamepack-map-switch` に残ったものを `removeTree` で消す（失敗しても続ける）。
    - `prepareMapStep` → 途中の記録に `map` を入れる。
    - `try` の始めに `applyMapStep`：使う場所 → `slot/previous`、`slot/next` → 使う場所、`beforeStep('map')`、`server.properties` を `atomicWrite`。`beforeStep('map')` はテストが失敗を起こすための所（今のテストの `beforeStep` は数の `1` だけを見るので、影響しない）。
    - 成功の終わりに、`profiles.json` の `mapReturnLevel` を、入るときは書き、出るときは消す。
    - 記録を消したあと `finishMapStep`：`removeTree(slot)`。投げたら `console.warn` だけにする。
  - `restore(journal)`：`journal.map` があれば、マップを戻して `server.properties` を前の中身に書く。
    - `slot` と `use` がサーバーのフォルダーの中かを確かめる。外なら投げる。
    - `slot/previous` があれば、使う場所にあるものを `slot/interrupted-<uuid>` へよけてから、`previous` を戻す。
    - `previous` が無く、`fresh` で `hadUse` が false なら、使う場所の新しいマップを `interrupted-<uuid>` へよける。
  - `game_profiles.cjs` は 800 行を超えないこと（`file-size-limits.test.cjs`）。
- [ ] **Step 5: 通ることを確かめる** — Run: `node --test electron/test/game-maps.test.cjs electron/test/game-profiles.test.cjs electron/test/umetate-pack.test.cjs electron/test/game-mods-after-update.test.cjs electron/test/initial-setup.test.cjs electron/test/game-commands.test.cjs electron/test/file-size-limits.test.cjs` Expected: 全部 PASS。
- [ ] **Step 6: Commit** — `feat(umetate): 埋め立てに切り替えたとき研究室マップを初期の状態から使う`

### Task 3: 「マップを初期化」のボタン

**Files:**
- Modify:
  - アプリ側：`electron/game_profiles.cjs`（`resetMap`）、`electron/games_ipc.cjs`（`ensureServerStopped`・`games:resetMap`）、`electron/preload.cjs`
  - 画面側：`src/types/electron.d.ts`、`src/lib/devApiMock.ts`、`src/components/GameSelector.tsx`
- Test: `electron/test/game-maps.test.cjs`、`electron/test/games-ipc-module.test.cjs`

**Interfaces:**
- Consumes: Task 2 の `prepareMapStep(current, id, operation, { reset: true })`・`applyMapStep`・`finishMapStep`・`removeTree`・`ensureServerStopped`。
- Produces:
  - `gameProfiles.resetMap() -> Promise<list()>`
  - ipc `games:resetMap`、preload `gamesResetMap: () => ipcRenderer.invoke('games:resetMap')`
  - 型：`gamesResetMap: () => Promise<GameStatus>`。`GameStatus.games` の項目に `maps?: string[]`

- [ ] **Step 1: 失敗するテストを書く**
  - `game-maps.test.cjs`：
    - `マップを初期化すると、今の埋め立てのマップが初期の状態に戻り、遊んだマップは消える`：`played.mca` が消え、見本と同じ。`level-name` は使う場所。mods・設定・コマンドのファイル・今のゲームは変わらない。
    - `マップを初期化できないとき：保存前・マップの無いゲーム・途中の記録があるときは、何も変えずに止まる`：
      - 保存前：`/保存してから/`
      - 採掘：`/初期化できるマップがありません/`
      - 途中の記録がある：`/復旧/`
    - `マップの初期化が途中で失敗したら元に戻す`：`beforeStep: step => { if (step === 'map' && failMap) throw new Error('map locked') }` で、埋め立てに切り替えたあとに `failMap = true` にして初期化する。`/元へ戻しました.*map locked/`、`played.mca` が戻り、`level-name` も前のまま。
    - `マップの初期化はサーバーの止まりだけを見る`：埋め立てに切り替えたあとで、`ensureStopped` を投げるようにする。`ensureServerStopped` が投げなければ初期化は通る。`ensureServerStopped` が投げれば、そのエラーで止まり、マップは変わらない。
  - `games-ipc-module.test.cjs`：
    - `マップの初期化: サーバーが動いている・準備中・止まる途中・MAP の作業中・初期セットアップ中なら止め、BRIDGE と Minecraft が動いていても止めない`：`games:resetMap` を、1つずつ立てて呼ぶ。
      - `busy.serverRunning`・`busy.starting`・`busy.stopping`・`busy.setup` → `/サーバーを止めてから/`
      - `busy.map = 'MAPを保存・読込中です'` → そのエラー
      - `busy.bridge = true` と `busy.minecraft.running = true` だけなら、サーバーの止まりのエラーにならず、次の確かめ（保存前なので `/保存してから/`）まで進む。
  - 画面（`game-maps.test.cjs` の中で、ソースの文字を読む。今のテストと同じ書き方）：
    - `preload.cjs` に `gamesResetMap: () => ipcRenderer.invoke('games:resetMap'),`
    - `electron.d.ts` に `gamesResetMap: () => Promise<GameStatus>;` と `maps?: string[]`
    - `GameSelector.tsx`：
      - 文字 `マップを初期化` がある。
      - `resetMap` の中で `serverProcessStatus` が `window.confirm(` より前にある。
      - `api.gamesResetMap()` を呼ぶ。
      - ボタンは `applied` と今のゲームの `maps?.length` のときだけ出る。
    - `devApiMock.ts` に `gamesResetMap:`
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test electron/test/game-maps.test.cjs electron/test/games-ipc-module.test.cjs` Expected: 新しいテストが FAIL（`resetMap` が無い）。
- [ ] **Step 3: アプリ側を書く**
  - `resetMap()`（`game_profiles.cjs`）。確かめはこの順（サーバーの止まりを先に見る。画面がサーバーの理由を先に出せるように）：
    - 途中の記録がある → `前回の切替を復旧してから初期化してください`
    - `await ensureServerStopped()`
    - `list().applied` でない → `ゲームを「保存」してから初期化してください`
    - 今のゲームに `maps` が無い → `このゲームには初期化できるマップがありません`
    - `targets()` → 残りものを消す → `prepareMapStep(..., { reset: true })`
    - 途中の記録を書く。中身は `activate` と同じ形で、mods は動かさないので `commandBefore: {}`。
    - `applyMapStep` → `mapReturnLevel` を書く → 記録を消す → `finishMapStep`
    - 失敗したら `restore` して `マップを初期化できなかったため元へ戻しました: …`
  - `games_ipc.cjs`：
    - `ensureServerStopped`：`assertMapIdle()` のあと、初期セットアップ中・サーバーの準備中・止まる途中・`(await getServerProcessStatus()).running` のどれかなら `サーバーが動いています。サーバーを止めてから「マップを初期化」を押してください` を投げる。
    - `ipcMain.handle('games:resetMap', () => gameProfileOperation(async () => { await gameProfiles.resetMap(); return gamesStatus(); }))`
  - `preload.cjs` に `gamesResetMap` を足す。
- [ ] **Step 4: 画面を書く**（`GameSelector.tsx`・`electron.d.ts`・`devApiMock.ts`）
  - 今のゲーム `activeGame = status?.games.find(g => g.id === status.active)` が `maps?.length` を持ち、`status.applied` のとき、「適用済み」の行の下に出す：
    - ボタン `マップを初期化`
    - 説明 `{activeGame.name}のマップを、初期の状態に戻します（サーバーを止めてから）。`
  - 押したとき：
    1. `api.serverProcessStatus()` を見る。`running` なら、エラーの欄に `サーバーが動いています。サーバーを止めてから「マップを初期化」を押してください。` を出して終わる。
    2. `window.confirm` の文：`{name}のマップを初期の状態に戻します。\n今のマップは消え、元に戻せません。残したいときは、先に「MAPセーブ・ロード」で保存してください。\n初期化しますか？`
    3. `api.gamesResetMap()` を呼ぶ。成功したら `{name}のマップを初期の状態に戻しました。`、失敗したらエラーの欄。
  - 「保存」の前の知らせ（`dirty`）：選んだゲームに `maps` があり、今のゲームと違うとき、`{name}に切り替えると、{name}のマップは初期の状態から始まります（前に遊んだ{name}のマップは消えます）。` を足す。
  - 下の説明 `ゲーム切替では現在のMODを削除せず退避します。MAPは変更しません。` を、次のように直す：`ゲーム切替では現在のMODを削除せず退避します。MAPは変更しません（専用マップのあるゲーム（{マップのあるゲームの名前を「・」でつないだもの}）に切り替えたときだけ、そのゲームのマップを初期の状態から使います）。`
  - `devApiMock.ts` に `gamesResetMap: async () => previewGameStatus()` を足す。
- [ ] **Step 5: 通ることを確かめる** — Run: `node --test electron/test/game-maps.test.cjs electron/test/games-ipc-module.test.cjs electron/test/game-profiles.test.cjs` と `npx tsc --noEmit -p .` Expected: 全部 PASS、型エラーなし。
- [ ] **Step 6: Commit** — `feat(umetate): TOP に「マップを初期化」のボタンを付ける`

### Task 4: 文書と、開発版で見る

**Files:**
- Modify: `docs/手動配布とアプリ更新.md`、`AGENTS.md`、`map/README.md:18`、`HANDOFF/HANDOFF04.md`

- [ ] **Step 1: 文書**
  - `手動配布とアプリ更新.md`：
    - 「PR3 まで配布用を作らない」の段落を消す（決めたこと 10）。
    - 「配る物を作る PC には `map/umetate_lab_map`（git の外）が要る。無ければ準備の手順で止まる」と書く。
    - 準備の手順の一覧に、ゲームの初期マップを足す。
  - `AGENTS.md`：
    - 36 行目の配布の止めの文を消す。
    - 初期マップの準備（`prepare:game-maps`）と、切り替えでマップを写す処理（`electron/game_maps.cjs`）を1〜2行で書く。
  - `map/README.md:18`：埋め立てに切り替えたときの動き（`map_backup`・`haihu_world/umetate_lab_map`・初期化のボタン）に直す。
- [ ] **Step 2: verify** — Run: `npm run verify` と `node scripts/test-bridge-contracts.cjs` Expected: 全部 PASS。
- [ ] **Step 3: 開発版で見る（ユーザーと）**
  - やり方：PR2 の Task 3 と同じ（一時の userData・空の一時サーバー・一時の Minecraft フォルダー。`ELECTRON_RUN_AS_NODE` を外す）。一時サーバーは `level-name=haihu_world/world` と、その `level.dat` を持つ。
  - 先に `node scripts/prepare-game-maps.cjs` を動かしておく。
  - ユーザーに見てもらうこと：
    1. 採掘 → 埋め立てで、保存の前の知らせが出る。保存できる。
    2. 「マップを初期化」が出て、確かめの画面が出て、初期化できる。
    3. 採掘に戻すと、ボタンが消える。
  - こちらで見ること：一時サーバーの `map_backup/umetate/umetate_lab_map`・`haihu_world/umetate_lab_map`・`level-name` の移り変わり。
  - 終わったら：リポジトリの `bridge/config.minecraft.json` は `git restore` で戻す。`game_*.txt` は採掘に戻す。
  - Expected: ユーザーが「出た」と言う。
- [ ] **Step 4: Commit** — `docs(umetate): マップの入れ替えと初期化を手順書・README に書く`
