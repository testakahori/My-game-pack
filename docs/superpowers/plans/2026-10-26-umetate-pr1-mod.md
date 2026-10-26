# 埋め立て PR1（UmetateMod）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UmetateMod を、アプリのギフトから埋め立てを遊べる形にする（ギフトの数どおりに起こす・`umetate` で13個・イベント開始時の表示・研究室のアリーナを Y 64 まで・勝ちの判定）。

**Architecture:** ギフトは採掘と同じ道で届く：BridgeMOD がゲームのコマンドファイルの `# GAME_MOD: stackinggame_events` と `# GAME_KEY: <key>` を見て、名前・回数・送った人の名前を UmetateMod の受け口（`BridgeGameApiIntegration.receive`）へ1回で渡す（PR2 のゲームパックは `bridgeEventApi: 1`・`modId: stackinggame_events` にする）。受け口は、13個のイベントなら回数の分だけ待ち行列に入れ、研究室の5つ（otasuke・mofumofu・stamp・atamahuttou・zigoku）なら回数の分だけその場で動かす。勝ちの判定は研究室マップの処理（`LabStageService`）の毎 tick に足す。判断の部分（回数の分け方・カウントダウン・表示の中身・名前の一覧）は Forge なしのクラスに置き、`scripts/test-soutenmon-contracts.cjs` の javac の確かめで試す。Forge の上での動きは、研究室マップの使い捨てのコピーで動く実サーバーの検証（`LabIntegrationProbe`）で試す。

**Tech Stack:** Java 17 / Forge 1.20.1-47.4.10（UmetateMod、Gradle は `BridgeMod/gradlew -p UmetateMod`）、Node（`scripts/test-soutenmon-contracts.cjs`・`electron/test/soutenmon-mods.test.cjs`）。

**Spec:** `docs/superpowers/specs/2026-10-26-umetate-game-design.md`（3.1 と、2 のゲームの決まり）

## Global Constraints

- 枠の内側：X・Z が −6〜6、Y が 49〜64（13×13×16＝2704マス）。勝ちは、2704マスがすべて `minecraft:gold_block` か `minecraft:diamond_block` のとき。
- カウントダウンは 10 から。途中で1マスでも金・ダイヤでなくなったら止まる。0 で花火・キラキラのパーティクル・タイトル「congratulation」（色は `ChatFormatting.GREEN`）を出し、2704マスを空気にする。
- `umetate` で動かすイベントは、`events.master.json` で `implementationStatus: "implemented"` の13個だけ：aquatower・magmatower・aquarium・voidbomb・voidbomb_rain・megablast・nether_army・void_singularity・meteor_shower・meteor_purge・tornado・orbital_laser・shockwave_collapse。`candidate` の10個は作らない・登録しない。
- 今ある `stackgame run`・`stackgame bridge` などの形と、`umetate` の6つ（otasuke・mofumofu・stamp・atamahuttou・zigoku・reset）の動きは変えない。
- 強さに上限を付けない：ギフトの数どおりに起こす（2026-10-10 のユーザーの決定）。待ち行列の上限（`EventManager.MAX_QUEUE_SIZE`＝500）に当たったら捨てずに WAIT で待たせる。
- ギフトの表示は、イベントが実際に始まったとき（`EventManager` の開始の所。`notifyObsStart` のすぐあと）に、`announce` が true の要求だけ。DisplayMOD は `jp.douma.displaymod.api.DisplayApi.show(Object, Map)` をリフレクションで呼ぶ（採掘の `SaikutuMod/.../OptionalDisplay.java` と同じ形）。DisplayMOD が無くても、ゲームは止めない。
- 版は 2.6.23。`.bat`・`.cmd` は英語だけ。画面・ゲーム内の文は日本語（「congratulation」はユーザーの言葉どおり英語）。
- 本物の配信サーバー（`server/Douma_Craft`）の mods・ワールド・設定は書き換えない。実サーバーの検証は `UmetateMod/tools/run-lab-probe.ps1` が作る使い捨てのフォルダーで行う（libraries は読むだけ）。

## 決めたこと（Ruling。ユーザーに見せる）

- 回数の届き方：設計書 3.2 の「ギフトの数はアプリの繰り返しで送る」は、採掘と同じ道（GAME_MOD）では当たらない。BridgeMOD は回数を1回で渡すので、UmetateMod の受け口が回数の分だけ起こす。この計画の Task 6 で設計書の該当行を直す。間違っていたときの損：PR2 でゲームパックの作りを変えるだけ。
- 回数の分け方：要求の番号（requestId）が `R` で回数が N（2以上）なら、`R#1`〜`R#N` の N 個の要求にする（1なら `R` のまま）。待ち行列がいっぱいで途中までしか入らなかったら WAIT を返す。BridgeMOD が同じ要求を送り直したとき、入れ済みの番号は「二重」として飛ばし、残りだけ入れる。
- 研究室の5つの回数：その場で N 回続けて動かす。`zigoku` は2回目から「実行中」で断られる（Codex の作りどおり、同時には動かさない）。研究室の処理中（`lab.blocksEvents()`）は WAIT で待たせる。動かして断られた（0 が返った）分は捨てる（送り直さない）。
- 研究室の5つの相手：BridgeMOD から来たときは、今の13個と同じ相手（`TargetPlayerResolver`。プレイヤー1人）を実行者にする。
- 表示の題名：13個は `events.master.json` の `displayName`、5つは「お助け」「もふもふ」「黒曜石スタンプ」「頭沸騰」「地獄」。回数が N のときは、1つ始まるたびに1回ずつ出す。
- 勝ちの判定を止める時：研究室の処理中（`blocksEvents()`）と、地獄の間（phase が IDLE でない）は、埋まっていないものとして扱う（数えていれば止める）。
- 名前のぶつかり：`umetate` の下では、今ある6つを先に登録し、同じ名前のイベントは登録しない（今は13個とぶつからない）。

## Review Focus

1. 大きな回数（例 502）：待ち行列 500 で途中まで入り WAIT。送り直しで残りだけ入り、合計がちょうど 502 になる（二重に起きない）。→ Task 1 の実サーバーの検証に入れる。
2. 勝ちのカウントダウン中に `/umetate reset`・`zigoku`：カウントダウンが止まり、枠は消えない。→ Task 5 の検証に入れる。
3. 枠に羊毛など金・ダイヤ以外が1マスでもある、上の段（Y 57〜64）が空いている：数え始めない。→ Task 5 の検証に入れる。
4. `announce` が false の要求（手で打った `umetate nether_army` など）と、DisplayMOD が無いサーバー：表示を呼ばない／例外を出さない。→ Task 3 の検証に入れる。
5. `stamp` で相手が3階にいない：断られて捨てられ、BridgeMOD が送り直し続けない。→ Task 1 の検証に入れる。

---

## ファイルの分担

- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/BridgeRequestUnits.java` — 回数を要求に分ける（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabActionKeys.java` — 研究室の5つの名前の一覧（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabActions.java` — 名前から動きへの振り分け（Forge）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/UmetateTitles.java` — 表示の題名（18個）と表示の中身（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/OptionalDisplay.java` — DisplayMOD をリフレクションで呼ぶ。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabVictoryCountdown.java` — カウントダウンの決まり（Forge なし）。
- Create `UmetateMod/src/main/java/jp/streamtorearn/stackinggame/lab/LabVictoryService.java` — 枠を見て、カウントダウンと勝ちの演出を出す（Forge）。
- Modify `integration/BridgeGameApiIntegration.java`・`integration/IntegrationService.java`・`event/EventManager.java`・`command/StackGameCommand.java`・`command/UmetateCommand.java`・`world/ArenaService.java`・`lab/LabLayout.java`・`lab/LabStageService.java`。
- Tests：`UmetateMod/src/contractTest/java/`（新しい4つ）、`scripts/test-soutenmon-contracts.cjs`（suites に足す）、`UmetateMod/src/integrationProbe/java/example/labprobe/LabIntegrationProbe.java`（実サーバーの検証を足す）、`UmetateMod/src/integrationProbe/java/jp/douma/displaymod/api/DisplayApi.java`（検証用の偽の DisplayMOD。製品の jar には入らない）。

---

### Task 0: 実サーバーの検証の台本が、本物のサーバーへのジャンクションを残さないようにする

今の `UmetateMod/tools/run-lab-probe.ps1` は、使い捨てのフォルダー（`UmetateMod/run-server/lab-probe-<id>`）に、`-Libraries` で渡したフォルダー（今までは本物の配信サーバー `server/Douma_Craft/libraries`）へのジャンクションを作り、終わっても残す。フォルダーをまとめて消すと、ジャンクションの先の本物の libraries まで消えるおそれがある（2026-10-26 に、いつもの作業コピーで9つ残っているのを見つけた）。

**Files:**
- Modify: `UmetateMod/tools/run-lab-probe.ps1`（`finally` で、テストのフォルダーの `libraries` がジャンクションなら、ジャンクションだけを外す。中身は消さない）
- Test: `electron/test/soutenmon-mods.test.cjs`

- [ ] **Step 1: 失敗するテストを書く** — `soutenmon-mods.test.cjs` に：台本の `finally` の中で、`libraries` のジャンクションを外す行があること（`LinkType` が `Junction` のときだけ、`Remove-Item` に `-Recurse` を付けずに外すか、`[IO.Directory]::Delete(<path>, $false)`）。台本のどこにも `Remove-Item` に `-Recurse` を付けて `libraries` かテストのフォルダーを消す行が無いこと。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node --test electron/test/soutenmon-mods.test.cjs` Expected: 新しいテストが FAIL。
- [ ] **Step 3: 台本を直す** — ジャンクションを外したあとも、テストのフォルダー（ログ・結果）は残す（調べるため）。結果の行に、外したことを1行出す。
- [ ] **Step 4: 通ることを確かめる** — Run: 同じ。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "fix(umetate): 実サーバーの検証のあとに libraries のジャンクションを外す"`

### Task 1: ギフトの数どおりに起こす・研究室の5つを受け口で受ける

**Files:**
- Create: `integration/BridgeRequestUnits.java`、`lab/LabActionKeys.java`、`lab/LabActions.java`
- Modify: `integration/BridgeGameApiIntegration.java:68-114`（`receive`）
- Test: `UmetateMod/src/contractTest/java/BridgeRequestUnitsTest.java`、`scripts/test-soutenmon-contracts.cjs`、`LabIntegrationProbe.java`

**Interfaces:**
- Produces: `BridgeRequestUnits.ids(String requestId, int count) -> List<String>`（count が1なら `[requestId]`、2以上なら `requestId#1`〜`requestId#count`、1未満は `IllegalArgumentException`）。
- Produces: `LabActionKeys.GIFT_KEYS : List<String>`（`otasuke, mofumofu, stamp, atamahuttou, zigoku` の順）、`LabActionKeys.isGiftKey(String key) -> boolean`（大文字小文字を区別しない）。Forge の型を使わない（javac の確かめで使う）。
- Produces: `LabActions.run(String key, CommandSourceStack source, StackingRuntime runtime) -> int`（`UmetateCommand` の各コマンドと同じ処理を呼ぶ。0 は断られた）。`UmetateCommand` も、この5つはここを呼ぶ形にそろえる。

- [ ] **Step 1: 失敗するテストを書く** — `BridgeRequestUnitsTest`：`ids("R", 1)` が `["R"]`、`ids("R", 3)` が `["R#1","R#2","R#3"]`、`ids("R", 502).size()==502` で重複なし、`ids("R", 0)` と `ids("R", -1)` が例外。`LabActionKeysTest`（同じファイルでよい）：`isGiftKey("ZIGOKU")` が true、`isGiftKey("reset")` が false、一覧がちょうど5つ。
- [ ] **Step 2: suites に足して、落ちることを確かめる** — `scripts/test-soutenmon-contracts.cjs` の `suites` に `{ name:'BridgeRequestUnitsTest', files:[...BridgeRequestUnits.java, ...LabActionKeys.java, ...BridgeRequestUnitsTest.java] }` を足す。Run: `node scripts/test-soutenmon-contracts.cjs` Expected: javac が `BridgeRequestUnits` を見つけられずに失敗。
- [ ] **Step 3: `BridgeRequestUnits`・`LabActionKeys`・`LabActions` を書き、`receive` を直す** — `LabActionKeys.isGiftKey(key)` なら：`runtime.lab.blocksEvents()` なら `GameEvents.WAIT`。相手のプレイヤーを `TargetPlayerResolver` で決め（いなければ WAIT）、`server.createCommandSourceStack().withEntity(player).withPermission(2)` で `LabActions.run` を count 回。1回でも >0 なら ACCEPTED、全部 0 なら DISCARDED。13個なら：`BridgeRequestUnits.ids` の番号ごとに `rawCount=1` の `EventRequest` を作り、`checkDuplicateOnly` で入れ済みを飛ばして `submit`。どれかが WAIT なら WAIT、知らない名前で DISCARDED なら DISCARDED、ほかは ACCEPTED。
- [ ] **Step 4: 確かめが通ることを見る** — Run: `node scripts/test-soutenmon-contracts.cjs` Expected: `BridgeRequestUnitsTest` を含め全部 PASS。
- [ ] **Step 5: 実サーバーの検証を足す** — `LabIntegrationProbe` に `checkBridgeCounts`：`GameEvents.offer("stackinggame_events", data)` で `key=nether_army, count=3, announce=false` を送り、待ち行列と実行中の合計が3。`count=502` で WAIT が返り、実行中のイベントを `cancel` で進めて送り直すと、合計がちょうど502（二重なし）。`key=otasuke, count=1` で Y 49〜56 が金。プレイヤーが3階にいないときの `key=stamp` は DISCARDED。`/umetate reset` の直後（復元中）の `key=otasuke` は WAIT。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): ギフトの数どおりに起こし、研究室の5つを受け口で受ける"`

### Task 2: `umetate <イベント>` で13個を動かす

**Files:**
- Modify: `command/StackGameCommand.java:74-107`（`submit` を共通にする）、`command/UmetateCommand.java`
- Test: `LabIntegrationProbe.java`

**Interfaces:**
- Produces: `StackGameCommand.submitEvent(CommandSourceStack source, StackingRuntime runtime, String eventKey, String tail) -> int`（package-private。`stackgame run` と同じ受け方。`tail` は空でよい。`--sender 名前` を受ける）。
- Consumes: `LabActionKeys.GIFT_KEYS`（Task 1）と `reset` を、イベントより先に登録する。

- [ ] **Step 1: 失敗する検証を書く** — `LabIntegrationProbe` に `checkUmetateEvents`：`umetate nether_army` が 1 を返し `runtime.events.activeKey()` か次の要求が `nether_army`。`umetate nether_army --sender Probe` も受ける。コマンドの木で、`umetate` の下に13個がすべてあり、`gift_spawn_zombie` が無い（`dispatcher.getRoot().getChild("umetate").getChild(...)`）。
- [ ] **Step 2: 落ちることを確かめる** — Run: ビルド（Task 6 の Step 2 のコマンド）と `UmetateMod/tools/run-lab-probe.ps1 -Libraries <libraries>`。Expected: `checkUmetateEvents` で FAIL（`umetate nether_army` が無い）。
- [ ] **Step 3: 作る** — 13個の名前は `events.master.json` を読まずに、`runtime.registry` に登録済みの名前から取る（`registry` に一覧を返す口が無ければ足す）。各名前に `literal(key).executes(空の tail)` と `.then(argument("tail", greedyString()))`。
- [ ] **Step 4: 通ることを確かめる** — 同じ Run。Expected: `checkUmetateEvents` PASS、前からの検証も全部 PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat(umetate): umetate からそうてんもんさんの13個のイベントを動かす"`

### Task 3: イベントが始まったときにギフトを表示する

**Files:**
- Create: `integration/OptionalDisplay.java`、`integration/UmetateTitles.java`
- Modify: `integration/IntegrationService.java`（`hasDisplay`・`testDisplay`、`showStarted` を足す）、`event/EventManager.java:232`（`notifyObsStart` のあと）、Task 1 の研究室の5つの実行（動いたら表示）
- Test: `UmetateMod/src/contractTest/java/UmetateTitlesTest.java`、`scripts/test-soutenmon-contracts.cjs`、`UmetateMod/src/integrationProbe/java/jp/douma/displaymod/api/DisplayApi.java`（偽物）、`LabIntegrationProbe.java`

**Interfaces:**
- Produces: `UmetateTitles.title(String key) -> String`（18個。知らない名前はその名前を返す）、`UmetateTitles.payload(String key, String listenerName) -> Map<String,Object>`（`title`、`subtitle`=`"{ListenerName}"`、`listenerName`（空なら `"viewer"`）、`count`=1）。
- Produces: `OptionalDisplay.available() -> boolean`、`OptionalDisplay.show(Object server, Map<String,?> payload) -> boolean`。
- Produces: `IntegrationService.showStarted(MinecraftServer server, String key, String listenerName, boolean announce) -> boolean`（announce が false なら呼ばずに false）。

- [ ] **Step 1: 失敗するテストを書く** — `UmetateTitlesTest`：`events.master.json` の場所を引数で受け、`"id"` と `"displayName"` の組を正規表現で取り出し、`implemented` の13個すべてで `UmetateTitles.title(id)` が同じ。`title("otasuke")` が「お助け」、`title("zigoku")` が「地獄」、`candidate` の10個は `title` がその名前のまま（題名を持たない）。`payload("nether_army","")` の `listenerName` が `"viewer"`、`subtitle` が `"{ListenerName}"`。
- [ ] **Step 2: 落ちることを確かめる** — suites に足し（`java` の引数に `UmetateMod/src/main/resources/event-master/events.master.json` を渡す。今の `suites` は引数を持たないので、`args` を足す）、Run: `node scripts/test-soutenmon-contracts.cjs` Expected: javac 失敗。
- [ ] **Step 3: 作る** — `OptionalDisplay` は採掘の写しの形（`available()` を足す）。`IntegrationService.hasDisplay()` は `OptionalDisplay.available()` にし、`giftsdisplay` の文字を消す。`testDisplay` も `OptionalDisplay.show` を使う。`EventManager` の開始の所で `showStarted(server, request.eventKey(), request.listenerName(), request.announce())`。研究室の5つは、受け口で動いた（>0）ときに同じく呼ぶ。
- [ ] **Step 4: 通ることを確かめる** — Run: `node scripts/test-soutenmon-contracts.cjs` Expected: PASS。
- [ ] **Step 5: 実サーバーの検証** — 偽の `DisplayApi`（`show` の呼び出しを静的な一覧に残し true を返す）を検証用の jar に入れる（`labProbeJar` の中身に `jp/douma/displaymod/**` を足す）。`checkDisplayOnStart`：`announce=true, listenerName=Alice` の `nether_army` を2つ送ると、1つめの開始で「ネザー軍団」・Alice の1回だけ。1つめを `cancel` して2つめが始まると2回目。`announce=false` では呼ばれない。`key=otasuke, announce=true` で「お助け」。Expected: PASS。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): イベントが始まったときに DisplayMOD でギフトを表示する"`

### Task 4: 研究室マップのアリーナを Y 64 まで広げる

**Files:**
- Modify: `lab/LabLayout.java`（枠の定数）、`world/ArenaService.java:34-42`（`bounds`）、`lab/LabStageService.java:60-73`（`started`）
- Test: `UmetateMod/src/contractTest/java/LabLayoutTest.java`、`LabIntegrationProbe.java`

**Interfaces:**
- Produces: `LabLayout.FRAME_MIN_X=-6, FRAME_MAX_X=6, FRAME_MIN_Z=-6, FRAME_MAX_Z=6, FRAME_MIN_Y=49, FRAME_MAX_Y=64`、`LabLayout.FRAME_VOLUME=2704`、`LabLayout.inFrame(int x, int y, int z) -> boolean`。
- Produces: `ArenaService.useLabFrame(boolean on)`（on のあいだ `bounds()` は枠の範囲を返す。ディメンションは今のまま）。

- [ ] **Step 1: 失敗するテストを書く** — `LabLayoutTest` に：`FRAME_VOLUME==2704`、`inFrame(-6,49,-6)` と `inFrame(6,64,6)` が true、`inFrame(7,50,0)`・`inFrame(0,48,0)`・`inFrame(0,65,0)` が false。
- [ ] **Step 2: 落ちることを確かめる** — Run: `node scripts/test-soutenmon-contracts.cjs` Expected: `LabLayoutTest` が javac で失敗（定数が無い）。
- [ ] **Step 3: 作る** — `LabStageService.started` で、研究室マップと見分けたら `runtime.arena.useLabFrame(true)`、見分けなければ `false`。設定ファイル（`stackinggame-common.toml`）の値は変えない。
- [ ] **Step 4: 実サーバーの検証** — `checkLabFrame`：使い捨てのコピーで、`runtime.arena.bounds()` の max-y が 64。新しいマップの枠の内側 2704マスがすべて空気。枠の外側の壁（x=±7 か z=±7、Y 49〜64）がすべて空気でない。**この検証が落ちたら、作業を止めてユーザーに枠の範囲を聞く**（設計書 3.1 の「作る前に実物で確かめる」）。Expected: PASS。
- [ ] **Step 5: Commit** — `git commit -m "feat(umetate): 研究室マップではアリーナを枠の Y 64 まで広げる"`

### Task 5: 勝ちの判定（カウントダウンと演出）

**Files:**
- Create: `lab/LabVictoryCountdown.java`（Forge なし）、`lab/LabVictoryService.java`
- Modify: `lab/LabStageService.java`（`tick` から呼ぶ。止める条件を渡す）
- Test: `UmetateMod/src/contractTest/java/LabVictoryCountdownTest.java`、`scripts/test-soutenmon-contracts.cjs`、`LabIntegrationProbe.java`

**Interfaces:**
- Produces: `LabVictoryCountdown`：`enum Signal { NONE, START, SECOND, STOP, WIN }`、`Signal update(boolean filled, long tick)`、`int secondsLeft()`。20 tick を1秒とする。
- Produces: `LabVictoryService.tick(ServerLevel level, long tick, boolean allowed)`（allowed が false なら埋まっていないものとして扱う）。

- [ ] **Step 1: 失敗するテストを書く** — `LabVictoryCountdownTest`：埋まらないあいだは NONE。埋まった tick で START（`secondsLeft()==10`）。そこから20 tickごとに SECOND で 9,8,…,1。200 tick 目に WIN。途中で `filled=false` になると STOP、その後また埋まると START で 10 から。WIN のあと、埋まったままでも次の START は `filled=false` を1回見てから（枠を消したあとに数え直さない）。
- [ ] **Step 2: 落ちることを確かめる** — suites に足して Run: `node scripts/test-soutenmon-contracts.cjs` Expected: javac 失敗。
- [ ] **Step 3: `LabVictoryCountdown` を書き、通す** — Run: 同じ。Expected: PASS。
- [ ] **Step 4: `LabVictoryService` を書く** — 5 tick ごとに枠の2704マスを見て `filled` を出す（`LabLayout.inFrame` の範囲。金かダイヤだけ）。START・SECOND：枠の近くのプレイヤーにタイトルで残りの秒数と音。STOP：アクションバーで「カウントダウン中止」。WIN：花火を5発以上（色はいくつか）、キラキラのパーティクル（`TOTEM_OF_UNDYING` など）、タイトル「congratulation」（`ChatFormatting.GREEN`）、そのあと枠の2704マスを空気にする（物を落とさない）。`LabStageService.tick` から、`allowed = failure==null && restore==null && phase==IDLE` で呼ぶ。研究室マップでないときは呼ばない。
- [ ] **Step 5: 実サーバーの検証** — `checkVictory`（使い捨てのコピー。前の検証の後片付けのあと）：1. 金とダイヤを混ぜて2704マスを埋め、10秒あまり進めると枠がすべて空気になる。2. 埋めて3秒後に1マスを空気にし、15秒進めても残りの2703マスは消えない。3. 1マスを白の羊毛にして埋めても数え始めない。4. 下の8段だけ金（otasuke）では数え始めない。5. 埋めて数えているあいだに `/umetate reset` で止まる。Expected: PASS。
- [ ] **Step 6: Commit** — `git commit -m "feat(umetate): 枠が金とダイヤで埋まったら10からのカウントダウンで勝ちにする"`

### Task 6: 版・説明・設計書の直し・全部の確かめ

**Files:**
- Modify: `UmetateMod/gradle.properties`（`mod_version=2.6.23`）、`electron/test/soutenmon-mods.test.cjs`（2.6.22 の参照）、`map/README.md`（`umetate <イベント>`・勝ち・表示）、`docs/superpowers/specs/2026-10-26-umetate-game-design.md`（3.2 の「回数」の行を、決めたことの1つめに合わせる）、`HANDOFF/HANDOFF04.md`、jar の印（`<jar>.inputs.json`）

- [ ] **Step 1: 版と参照を直す** — `grep -rn "2\.6\.22"` で出る所を、記録（HANDOFF の過去の節・`map/visual-check-2026-10-25.md`）を除いて 2.6.23 にする。
- [ ] **Step 2: ビルド** — Run: `BridgeMod/gradlew -p UmetateMod build labProbeJar --offline "-Dnet.minecraftforge.gradle.check.certs=false"` Expected: BUILD SUCCESSFUL、`UmetateMod/build/libs/stackinggame_events-2.6.23.jar` と `UmetateMod/build/qa/umetate-lab-probe.jar`。製品の jar に `jp/douma/displaymod` と `example/labprobe` が入っていない（`jar tf` で確かめる）。
- [ ] **Step 3: 確かめを全部流す** — Run: `node scripts/test-soutenmon-contracts.cjs`、`node scripts/check-jar-inputs.cjs`、`npm run verify`。Expected: すべて通る。
- [ ] **Step 4: 実サーバーの検証** — Run: `UmetateMod/tools/run-lab-probe.ps1 -Libraries <libraries>`（libraries は読むだけ。どこを使ったかを HANDOFF に書く）。Expected: 結果が PASS で、テストのフォルダーに `libraries` のジャンクションが残っていない（Task 0）。
- [ ] **Step 5: 壊す試し** — 直した所を1か所ずつ戻して（回数の展開・表示の呼び出し・アリーナの Y 64・カウントダウンの止まり方・13個の登録）、それぞれ確かめか検証が落ちることを見る。
- [ ] **Step 6: Commit** — `git commit -m "chore(umetate): 2.6.23 にし、説明と設計書を合わせる"`

---

## 終わったら

- 最後のレビュー（opus。報告は日本語）→ 重大・重要は直す、軽いものはユーザーが決める → PR → CI → ユーザーの許しでマージ → HANDOFF04 の docs PR。
- 本物の配信サーバーへの入れ替えと、本体での見た目の確かめ（花火・タイトル）は、PR3 までできたあとに、アプリのゲームの切り替えを通して行う（この PR では入れない）。
