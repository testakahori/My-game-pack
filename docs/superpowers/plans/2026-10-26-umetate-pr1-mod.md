# 埋め立て PR1（UmetateMod）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UmetateMod のギフトで動くものを、すべて `umetate <名前> [回数] [送った人]` の1つの形にそろえ（例 `umetate mofumofu 1`）、イベント開始時の表示・研究室のアリーナを Y 64 まで・勝ちの判定を足す。

**Architecture:** 採掘の `saikutu <名前> [回数] [送った人]` と同じ形のコマンドを `umetate` に作る。ギフトは、BridgeMOD がゲームのコマンドファイルに書かれた `umetate <名前> {Count} {ListenerName}` を、回数を入れて1回だけ打つ形で届く（PR2 のゲームパックは `bridgeEventApi` を使わない。`{Count}` があるので BridgeMOD は回数をまとめて1回で渡す）。UmetateMod は、そうてんもんさんの13個なら待ち行列に1つ入れて回数の分だけ続けて起こし、研究室の5つなら回数の分だけその場で動かす。BridgeMOD の受け口（`BridgeGameApiIntegration`）は変えない。勝ちの判定は研究室マップの処理（`LabStageService`）の毎 tick に足す。判断の部分（コマンドの名前の一覧・カウントダウン・表示の題名）は Forge なしのクラスに置いて javac の確かめで試し、Forge の上での動きは研究室マップの使い捨てのコピーで動く実サーバーの検証（`LabIntegrationProbe`）で試す。

**Tech Stack:** Java 17 / Forge 1.20.1-47.4.10（UmetateMod、Gradle は `BridgeMod/gradlew -p UmetateMod`）、Node（`scripts/test-soutenmon-contracts.cjs`・`electron/test/soutenmon-mods.test.cjs`）。

**Spec:** `docs/superpowers/specs/2026-10-26-umetate-game-design.md`（3.1 と、2 のゲームの決まり）

## Global Constraints

- コマンドの形：`umetate <名前> [回数] [送った人]`。回数は 1〜100000（採掘と同じ）、省けば 1。送った人は残り全部（空白・日本語・絵文字を含んでよい）。省けば手で打ったものとする。
- 名前は18個：そうてんもんさんの13個（aquatower・magmatower・aquarium・voidbomb・voidbomb_rain・megablast・nether_army・void_singularity・meteor_shower・meteor_purge・tornado・orbital_laser・shockwave_collapse。`events.master.json` で `implementationStatus: "implemented"` のもの）と、研究室の5つ（otasuke・mofumofu・stamp・atamahuttou・zigoku）。`candidate` の10個は登録しない。`umetate reset` は今のまま（回数を取らない）。
- 枠の内側：X・Z が −6〜6、Y が 49〜64（13×13×16＝2704マス）。勝ちは、2704マスがすべて `minecraft:gold_block` か `minecraft:diamond_block` のとき。
- カウントダウンは 10 から。途中で1マスでも金・ダイヤでなくなったら止まる。0 で花火・キラキラのパーティクル・タイトル「congratulation」（色は `ChatFormatting.GREEN`）を出し、2704マスを空気にする。
- 今ある `stackgame run`・`stackgame bridge`・BridgeMOD の受け口の動きは変えない。
- 強さに上限を付けない：回数どおりに起こす（2026-10-10 のユーザーの決定）。13個は回数がいくつでも待ち行列の1つ分しか使わない（待ち行列の上限 500 は、コマンドの数に掛かる）。
- ギフトの表示は、送った人の名前があるときだけ、実際に始まったときに出す（13個は1回目の開始のとき、研究室の5つは動いたとき。どちらも1回だけで、回数を一緒に渡す）。DisplayMOD は `jp.douma.displaymod.api.DisplayApi.show(Object, Map)` をリフレクションで呼ぶ（採掘の `SaikutuMod/.../OptionalDisplay.java` と同じ形）。DisplayMOD が無くても止めない。
- 版は 2.6.23。`.bat`・`.cmd` は英語だけ。ゲーム内の文は日本語（「congratulation」はユーザーの言葉どおり英語）。
- 本物の配信サーバー（`server/Douma_Craft`）の mods・ワールド・設定は書き換えない。実サーバーの検証は `UmetateMod/tools/run-lab-probe.ps1` の使い捨てのフォルダーで行う（libraries は読むだけ）。

## 決めたこと（Ruling。ユーザーに見せる）

- 回数の届き方（2026-10-26 ユーザー「umetate mofumofu 1 のように」）：ゲームパックは採掘と違って `bridgeEventApi` を使わず、BridgeMOD にコマンドを打たせる。設計書 3.2 の「ギフトの数はアプリの繰り返しで送る」の行を、この形に直す（Task 5）。
- 13個の回数：待ち行列には1つで入り、終わるたびに同じものをすぐもう一度始めて、回数の分だけ続ける。別の人のギフトはそのあと（AAA BBB の順。ルーレットと同じ考え）。`/umetate reset` と `stackgame cancel` は、残りの回数ごと止める。
- 研究室の5つの回数：その場で回数の分だけ続けて動かす。`zigoku` は2回目から「実行中」で断られる（同時には動かさない今の決まりどおり）。断られた分は、まとめて1行だけ知らせる。
- 表示の題名：13個は `events.master.json` の `displayName`、5つは「お助け」「もふもふ」「黒曜石スタンプ」「頭沸騰」「地獄」。
- 勝ちの判定を止める時：研究室の処理中（`blocksEvents()`）と、地獄の間（phase が IDLE でない）は、埋まっていないものとして扱う（数えていれば止める）。
- 名前のぶつかり：`reset` と研究室の5つを先に登録し、同じ名前のイベントは登録しない（今は13個とぶつからない）。

## Review Focus

1. 大きな回数（例 `umetate nether_army 100000 視聴者`）：待ち行列は1つしか使わず、ほかのギフトはそのあとに回る。`/umetate reset` で残りごと止まる。→ Task 1 の検証に入れる。
2. 勝ちのカウントダウン中に `/umetate reset`・`zigoku`：止まり、枠は消えない。→ Task 4 の検証に入れる。
3. 枠に羊毛など金・ダイヤ以外が1マスでもある、上の段（Y 57〜64）が空いている：数え始めない。→ Task 4 の検証に入れる。
4. 送った人の名前が無い（手で打った）・DisplayMOD が無いサーバー：表示を呼ばない／例外を出さない。→ Task 2 の検証に入れる。
5. 送った人の名前に空白・日本語・絵文字・`"` がある：受け付けて、そのまま表示に渡る。→ Task 1・2 の検証に入れる。

---

## ファイルの分担

- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/command/UmetateKeys.java` — `umetate` で動かす18個の名前と種類（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/UmetateTitles.java` — 表示の題名と表示の中身（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/OptionalDisplay.java` — DisplayMOD をリフレクションで呼ぶ。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabVictoryCountdown.java` — カウントダウンの決まり（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabVictoryService.java` — 枠を見て、カウントダウンと勝ちの演出を出す（Forge）。
- Modify `command/UmetateCommand.java`・`command/StackGameCommand.java`・`event/EventManager.java`・`event/EventRequest.java`・`integration/IntegrationService.java`・`world/ArenaService.java`・`lab/LabLayout.java`・`lab/LabStageService.java`・`UmetateMod/tools/run-lab-probe.ps1`。
- Tests：`UmetateMod/src/contractTest/java/`（新しい3つと `LabLayoutTest` の追加）、`scripts/test-soutenmon-contracts.cjs`（suites に足す）、`electron/test/soutenmon-mods.test.cjs`、`UmetateMod/src/integrationProbe/java/example/labprobe/LabIntegrationProbe.java`（実サーバーの検証を足す）、`UmetateMod/src/integrationProbe/java/jp/douma/displaymod/api/DisplayApi.java`（検証用の偽の DisplayMOD。製品の jar には入らない）。

---

### Task 0: 実サーバーの検証の台本が、本物のサーバーへのジャンクションを残さないようにする

今の `UmetateMod/tools/run-lab-probe.ps1` は、使い捨てのフォルダー（`UmetateMod/run-server/lab-probe-<id>`）に、`-Libraries` で渡したフォルダー（今までは本物の配信サーバー `server/Douma_Craft/libraries`）へのジャンクションを作り、終わっても残す。フォルダーをまとめて消すと、ジャンクションの先の本物の libraries まで消えるおそれがある（2026-10-26 に、いつもの作業コピーで9つ見つけ、ユーザーの許しでジャンクションを外して消した）。

**Files:**
- Modify: `UmetateMod/tools/run-lab-probe.ps1`（`finally` で、テストのフォルダーの `libraries` がジャンクションなら、ジャンクションだけを外す。中身は消さない）
- Test: `electron/test/soutenmon-mods.test.cjs`

- [ ] **Step 1: 失敗するテストを書く** — 台本の `finally` の中に、`libraries` のジャンクションを外す行があること（`LinkType` が `Junction` のときだけ、`[IO.Directory]::Delete(<path>, $false)` で外す）。台本のどこにも、`-Recurse` で `libraries` かテストのフォルダーを消す行が無いこと。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test electron/test/soutenmon-mods.test.cjs` Expected: 新しいテストが FAIL。
- [ ] **Step 3: 台本を直す** — ジャンクションを外したあとも、テストのフォルダー（ログ・結果）は残す。外したことを1行出す。
- [ ] **Step 4: 通ることを確かめる** — Run: 同じ。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "fix(umetate): 実サーバーの検証のあとに libraries のジャンクションを外す"`

### Task 1: `umetate <名前> [回数] [送った人]` で18個を動かす

**Files:**
- Create: `command/UmetateKeys.java`
- Modify: `command/UmetateCommand.java`、`command/StackGameCommand.java:74-107`（13個の受け付けを共通にする）、`event/EventRequest.java`・`event/EventManager.java`（回数の分だけ続けて起こす）
- Test: `UmetateMod/src/contractTest/java/UmetateKeysTest.java`、`scripts/test-soutenmon-contracts.cjs`、`LabIntegrationProbe.java`

**Interfaces:**
- Produces: `UmetateKeys.EVENTS : List<String>`（13個。上の順）、`UmetateKeys.LAB : List<String>`（`otasuke, mofumofu, stamp, atamahuttou, zigoku`）、`UmetateKeys.isEvent(String) -> boolean`、`UmetateKeys.isLab(String) -> boolean`（どちらも大文字小文字を区別しない）、`UmetateKeys.MAX_COUNT = 100000`。
- Produces: `StackGameCommand.submitEvent(CommandSourceStack source, StackingRuntime runtime, String eventKey, int count, String listenerName) -> int`（package-private。`listenerName` が null なら手で打ったもの）。
- Produces: `EventRequest` に残りの回数（`repeatsLeft()`）。`EventManager` は実行中のものが終わったら、残りがあれば同じ要求をすぐ始め直す。`resetRound` と `cancel` は残りも捨てる。

- [ ] **Step 1: 失敗するテストを書く** — `UmetateKeysTest`：`EVENTS.size()==13`、`LAB.size()==5`、両方に同じ名前が無い、`isEvent("NETHER_ARMY")` が true、`isEvent("gift_spawn_zombie")` が false、`isLab("reset")` が false。`events.master.json` のパスを引数で受け、`implementationStatus` が `implemented` の id の集まりが `EVENTS` と同じ（正規表現で取り出す）。
- [ ] **Step 2: 落ちることを確かめる** — `scripts/test-soutenmon-contracts.cjs` の `suites` に足す。今の suites は `java` に引数を渡さないので、`args` を持てるようにする（`UmetateMod/src/main/resources/event-master/events.master.json` を渡す）。Run: `node scripts/test-soutenmon-contracts.cjs` Expected: javac が `UmetateKeys` を見つけられずに失敗。
- [ ] **Step 3: `UmetateKeys` を書いて通す** — Run: 同じ。Expected: PASS。
- [ ] **Step 4: 実サーバーの検証を書く（失敗する）** — `LabIntegrationProbe` に `checkUmetateCommands`：
  - コマンドの木で `umetate` の下に18個と `reset` があり、`gift_spawn_zombie` が無い。
  - `umetate nether_army 3 視聴者 A` が受け付けられ、待ち行列には1つ（`events.waitingCount()` が増えるのは1）。3回続けて始まり、そのあいだに入れた `umetate tornado 1` はそのあとに始まる（開始の順を `runtime.events` の状態か開始のログで数える）。
  - `umetate nether_army 5` のあと `/umetate reset` で、残りの回数ごと消える。
  - `umetate otasuke 2` で Y 49〜56 が金。`umetate zigoku 2` は1回目だけ受け付け、2回目は断られて1行知らせる。
  - `umetate mofumofu`（回数なし）も動く。`umetate nether_army 0` と `100001` は受け付けない。
  - Run: Task 5 の Step 2 のビルドと、`UmetateMod/tools/run-lab-probe.ps1 -Libraries <libraries>`。Expected: `checkUmetateCommands` で FAIL。
- [ ] **Step 5: 作る** — `UmetateCommand` に、18個それぞれ `literal(名前)` → `executes(回数1)` → `argument("count", integer(1, MAX_COUNT))` → `argument("listener", greedyString())`（採掘の `SaikutuMod.java:79-86` と同じ形）。13個は `submitEvent`、研究室の5つは今の処理（`otasuke`・`MofumofuCommand.execute`・`runtime.stamps.start`・`HeadLavaCommand.execute`・`runtime.lab.zigoku`）を回数の分だけ呼ぶ。13個の名前は `UmetateKeys.EVENTS` のうち `runtime.registry` に登録済みのものだけを登録する。
- [ ] **Step 6: 通ることを確かめる** — 同じ Run。Expected: `checkUmetateCommands` PASS、前からの検証も全部 PASS。
- [ ] **Step 7: Commit** — `git commit -m "feat(umetate): umetate <名前> [回数] [送った人] で18個を動かす"`

### Task 2: 始まったときにギフトを表示する

**Files:**
- Create: `integration/OptionalDisplay.java`、`integration/UmetateTitles.java`
- Modify: `integration/IntegrationService.java`（`hasDisplay`・`testDisplay`、`showStarted` を足す）、`event/EventManager.java:232`（`notifyObsStart` のあと。1回目の開始だけ）、`command/UmetateCommand.java`（研究室の5つが動いたとき）
- Test: `UmetateMod/src/contractTest/java/UmetateTitlesTest.java`、`scripts/test-soutenmon-contracts.cjs`、`UmetateMod/src/integrationProbe/java/jp/douma/displaymod/api/DisplayApi.java`（偽物）、`LabIntegrationProbe.java`

**Interfaces:**
- Consumes: `UmetateKeys.EVENTS`・`UmetateKeys.LAB`（Task 1）。
- Produces: `UmetateTitles.title(String key) -> String`（18個。知らない名前はその名前を返す）、`UmetateTitles.payload(String key, String listenerName, int count) -> Map<String,Object>`（`title`、`subtitle`=`"{ListenerName}"`、`listenerName`、`count`）。
- Produces: `OptionalDisplay.available() -> boolean`、`OptionalDisplay.show(Object server, Map<String,?> payload) -> boolean`。
- Produces: `IntegrationService.showStarted(MinecraftServer server, String key, String listenerName, int count) -> boolean`（`listenerName` が null か空なら呼ばずに false）。

- [ ] **Step 1: 失敗するテストを書く** — `UmetateTitlesTest`：`events.master.json` から `implemented` の13個の `id` と `displayName` を取り出し、すべて `UmetateTitles.title(id)` と同じ。`title("otasuke")`＝「お助け」、`title("mofumofu")`＝「もふもふ」、`title("stamp")`＝「黒曜石スタンプ」、`title("atamahuttou")`＝「頭沸騰」、`title("zigoku")`＝「地獄」。`title("gift_spawn_zombie")` はそのまま。`payload("nether_army","視聴者 A",3)` の `listenerName` が `"視聴者 A"`、`count` が 3、`subtitle` が `"{ListenerName}"`。
- [ ] **Step 2: 落ちることを確かめる** — suites に足して Run: `node scripts/test-soutenmon-contracts.cjs` Expected: javac 失敗。
- [ ] **Step 3: 作る** — `OptionalDisplay` は採掘の写しの形に `available()` を足す。`IntegrationService.hasDisplay()` は `OptionalDisplay.available()` にして `giftsdisplay` の文字を消し、`testDisplay` も `OptionalDisplay.show` を使う。`EventManager` の開始の所で、1回目の開始だけ `showStarted(server, key, listenerName, 回数)`。研究室の5つは、1回でも動いたら `showStarted`。
- [ ] **Step 4: 通ることを確かめる** — Run: `node scripts/test-soutenmon-contracts.cjs` Expected: PASS。
- [ ] **Step 5: 実サーバーの検証** — 偽の `DisplayApi`（`show` の呼び出しを静的な一覧に残し true を返す）を検証用の jar に入れる（`labProbeJar` の中身に `jp/douma/displaymod/**` を足す）。`checkDisplayOnStart`：`umetate nether_army 2 Alice 😀` で、1回目の開始で「ネザー軍団」・`Alice 😀`・count 2 が1回だけ。2回目の開始では呼ばれない。`umetate nether_army 1`（名前なし）では呼ばれない。`umetate otasuke 1 Bob` で「お助け」。Expected: PASS。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): 始まったときに DisplayMOD でギフトを表示する"`

### Task 3: 研究室マップのアリーナを Y 64 まで広げる

**Files:**
- Modify: `lab/LabLayout.java`（枠の定数）、`world/ArenaService.java:34-42`（`bounds`）、`lab/LabStageService.java:60-73`（`started`）
- Test: `UmetateMod/src/contractTest/java/LabLayoutTest.java`、`LabIntegrationProbe.java`

**Interfaces:**
- Produces: `LabLayout.FRAME_MIN_X=-6, FRAME_MAX_X=6, FRAME_MIN_Z=-6, FRAME_MAX_Z=6, FRAME_MIN_Y=49, FRAME_MAX_Y=64`、`LabLayout.FRAME_VOLUME=2704`、`LabLayout.inFrame(int x, int y, int z) -> boolean`。
- Produces: `ArenaService.useLabFrame(boolean on)`（on のあいだ `bounds()` は枠の範囲を返す。ディメンションは今のまま）。

- [ ] **Step 1: 失敗するテストを書く** — `LabLayoutTest` に：`FRAME_VOLUME==2704`、`inFrame(-6,49,-6)` と `inFrame(6,64,6)` が true、`inFrame(7,50,0)`・`inFrame(0,48,0)`・`inFrame(0,65,0)` が false。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node scripts/test-soutenmon-contracts.cjs` Expected: `LabLayoutTest` が javac で失敗。
- [ ] **Step 3: 作る** — `LabStageService.started` で、研究室マップと見分けたら `runtime.arena.useLabFrame(true)`、見分けなければ `false`。設定ファイル（`stackinggame-common.toml`）の値は変えない。
- [ ] **Step 4: 実サーバーの検証** — `checkLabFrame`：`runtime.arena.bounds()` の max-y が 64。新しいコピーで枠の内側 2704マスがすべて空気。枠の外側の壁（x=±7 か z=±7、Y 49〜64）がすべて空気でない。**これが落ちたら、作業を止めてユーザーに枠の範囲を聞く**（設計書 3.1）。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat(umetate): 研究室マップではアリーナを枠の Y 64 まで広げる"`

### Task 4: 勝ちの判定（カウントダウンと演出）

**Files:**
- Create: `lab/LabVictoryCountdown.java`（Forge なし）、`lab/LabVictoryService.java`
- Modify: `lab/LabStageService.java`（`tick` から呼ぶ）
- Test: `UmetateMod/src/contractTest/java/LabVictoryCountdownTest.java`、`scripts/test-soutenmon-contracts.cjs`、`LabIntegrationProbe.java`

**Interfaces:**
- Consumes: `LabLayout.inFrame`・`FRAME_*`（Task 3）。
- Produces: `LabVictoryCountdown`：`enum Signal { NONE, START, SECOND, STOP, WIN }`、`Signal update(boolean filled, long tick)`、`int secondsLeft()`。20 tick を1秒とする。
- Produces: `LabVictoryService.tick(ServerLevel level, long tick, boolean allowed)`（allowed が false なら埋まっていないものとして扱う）。

- [ ] **Step 1: 失敗するテストを書く** — `LabVictoryCountdownTest`：埋まらないあいだは NONE。埋まった tick で START（`secondsLeft()==10`）。そこから 20 tick ごとに SECOND で 9,8,…,1。200 tick 目に WIN。途中で `filled=false` なら STOP、また埋まると START で 10 から。WIN のあとは、`filled=false` を1回見るまで START しない。
- [ ] **Step 2: 落ちることを確かめる** — suites に足して Run: `node scripts/test-soutenmon-contracts.cjs` Expected: javac 失敗。
- [ ] **Step 3: `LabVictoryCountdown` を書いて通す** — Run: 同じ。Expected: PASS。
- [ ] **Step 4: `LabVictoryService` を書く** — 5 tick ごとに枠の 2704マスを見て `filled` を出す。START・SECOND：枠の近くのプレイヤーにタイトルで残りの秒数と音。STOP：アクションバーで「カウントダウン中止」。WIN：花火を5発以上（色はいくつか）、キラキラのパーティクル（`TOTEM_OF_UNDYING` など）、タイトル「congratulation」（`ChatFormatting.GREEN`）、そのあと枠の 2704マスを空気にする（物を落とさない）。`LabStageService.tick` から、`allowed = failure==null && restore==null && phase==IDLE` で呼ぶ。研究室マップでないときは呼ばない。
- [ ] **Step 5: 実サーバーの検証** — `checkVictory`（前の検証の後片付けのあと）：1. 金とダイヤを混ぜて 2704マスを埋め、10秒あまり進めると枠がすべて空気。2. 埋めて3秒後に1マスを空気にし、15秒進めても残りの 2703マスは消えない。3. 1マスを白の羊毛にして埋めても数え始めない。4. 下の8段だけ金（`umetate otasuke`）では数え始めない。5. 数えているあいだに `/umetate reset` で止まる。Expected: PASS。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): 枠が金とダイヤで埋まったら10からのカウントダウンで勝ちにする"`

### Task 5: 版・説明・設計書の直し・全部の確かめ

**Files:**
- Modify: `UmetateMod/gradle.properties`（`mod_version=2.6.23`）、`electron/test/soutenmon-mods.test.cjs`（2.6.22 の参照）、`map/README.md`（`umetate <名前> [回数] [送った人]`・勝ち・表示）、`docs/superpowers/specs/2026-10-26-umetate-game-design.md`（3.2 の「回数」の行を「ゲームパックのコマンドは `umetate <名前> {Count} {ListenerName}`。`bridgeEventApi` は使わない。回数は MOD が受け取って、その数だけ起こす」に）、`HANDOFF/HANDOFF04.md`、jar の印（`<jar>.inputs.json`）

- [ ] **Step 1: 版と参照を直す** — `grep -rn "2\.6\.22"` で出る所を、記録（HANDOFF の過去の節・`map/visual-check-2026-10-25.md`）を除いて 2.6.23 にする。
- [ ] **Step 2: ビルド** — Run: `BridgeMod/gradlew -p UmetateMod build labProbeJar --offline "-Dnet.minecraftforge.gradle.check.certs=false"` Expected: BUILD SUCCESSFUL、`UmetateMod/build/libs/stackinggame_events-2.6.23.jar` と `UmetateMod/build/qa/umetate-lab-probe.jar`。製品の jar に `jp/douma/displaymod` と `example/labprobe` が入っていない（`jar tf` で確かめる）。
- [ ] **Step 3: 確かめを全部流す** — Run: `node scripts/test-soutenmon-contracts.cjs`、`node scripts/check-jar-inputs.cjs`、`npm run verify`。Expected: すべて通る。
- [ ] **Step 4: 実サーバーの検証** — Run: `UmetateMod/tools/run-lab-probe.ps1 -Libraries <libraries>`（libraries は読むだけ。どこを使ったかを HANDOFF に書く）。Expected: 結果が PASS で、テストのフォルダーに `libraries` のジャンクションが残っていない（Task 0）。
- [ ] **Step 5: 壊す試し** — 直した所を1か所ずつ戻して（回数の続け方・表示の呼び出し・アリーナの Y 64・カウントダウンの止まり方・18個の登録・ジャンクションの外し方）、それぞれ確かめか検証が落ちることを見る。
- [ ] **Step 6: Commit** — `git commit -m "chore(umetate): 2.6.23 にし、説明と設計書を合わせる"`

---

## 終わったら

- 最後のレビュー（opus。報告は日本語）→ 重大・重要は直す、軽いものはユーザーが決める → PR → CI → ユーザーの許しでマージ → HANDOFF04 の docs PR。
- 本物の配信サーバーへの入れ替えと、本体での見た目の確かめ（花火・タイトル）は、PR3 までできたあとに、アプリのゲームの切り替えを通して行う（この PR では入れない）。
