# 処理のコピー PR9（設定の値と TikTok ID）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画面・preload・ギフト一覧・別のアプリ GiftsViewer に残る TikTok ID の整え方の写しと、イベント設定②の既定値・読み上げの数の丸めの写しをなくし、ユーザーの決めた既定値にそろえる。

**Architecture:** main・BRIDGE・GiftsViewer の道具（`GiftsViewer/tools`）は `bridge/tiktok_id.cjs` を直接使う。preload と GiftsViewer のアプリの main は値をそのまま渡し、整えと確かめは受け取る側に任せる。画面は bridge の CJS を読まないので、TikTok ID の整え方は `src/lib/tiktokId.ts` に写しを1つ置き、同じ例で同じ結果になることをテストで見張る（PR3 の `integerInput.ts`・PR8 の `commandFiles.ts` と同じ形）。既定値（ルーレット・デスルーレット・読み上げ）は `bridge/` の JSON に置き、BRIDGE・main・画面がそれを読む（画面は JSON を import する。PR4 の `config_defaults.json` と同じ形）。

**Tech Stack:** Electron（`electron/*.cjs`）、BRIDGE（`bridge/*.cjs`・`bridge/index.js`）、React + TypeScript（`src/`、Vite）、GiftsViewer の道具（`GiftsViewer/tools/*.cjs`、`bundle:tools` で束ねる）、node:test と esbuild（画面のテスト）。

**Spec:** `docs/superpowers/specs/2026-10-18-logic-copies-design.md`（3・9・13）。HANDOFF04 の「処理のコピー」の「ユーザーの決定（10-23）」（PR9 の範囲、写しでない不具合の読み上げのテストの音量）と、この計画の前に聞いた3つの決定（下の決めたこと 1〜3）。

## Global Constraints

- TikTok ID の決まりは `bridge/tiktok_id.cjs`（前後の空白と先頭の `@` を除き、小文字にして `[a-z0-9_.]{1,24}`）。保存する形は今のまま（入力したまま。PR3 の決定）で、比べる・表示する・使う所で整える。
- 形の正しくない TikTok ID の文は、どこでも設定の確かめと同じ「TikTok ID「<入力>」の形が正しくありません。半角英数字・_・. の24文字以内で入力してください」（`bridge/tiktok_id.cjs` の `tiktokIdProblem` から作る）。空のときの文：ギフト一覧の更新は「TikTok ID を入力してください」。
- 画面の写しは `src/lib/tiktokId.ts` の1か所だけ（`electron/test/ui-tiktok-id.test.cjs` が bridge と同じ結果になることを見張る）。
- 既定値（そのまま使う）：ルーレット `stopSound: "entity.player.levelup"`・`particle: "minecraft:totem_of_undying"`。デスルーレット `everyDeaths: 3`・`stopSound: "entity.wither.spawn"`・`particle: "minecraft:soul_fire_flame"`。`bridge/config_defaults.json` の `roulette`・`deathRoulette` に置く。
- コメントギフトの音・粒子の「なし」の選び方の文は「なし（鳴らさない）」「なし（出さない）」。
- 読み上げの既定値・範囲・エンジンのポートは `bridge/tts_settings.json` の1か所（今の値：`engine: "voicevox"`・`speakerId: 2`・`speedScale: 1.2`（0.5〜2.0）・`pitchScale: 0`（-0.15〜0.15）・`intonationScale: 1.0`（0〜2.0）・`volume: 1.0`（0〜2.0）・`enabled`・`commentEnabled`・`giftEnabled: true`・`giftTemplate: "{sender}さんから{gift}が来たよ！"`（200 文字まで）・ポート `voicevox: 50021`・`aivis: 10101`）。
- 新しい ipc の窓口は作らない。Java（BridgeMOD・DisplayMOD）は変えない。
- Edit で行の終わりの空白を落とさない。Bash の heredoc・`node -e "..."` ではバックスラッシュが崩れるので、バックスラッシュを含むものは Write か Edit で書く。

## 決めたこと（違っていれば直す）

1. （ユーザーの決定 10-23）デスルーレットの「何回死ぬごと」が設定に無いときは 3 にする（画面に合わせる。値を書いていない古い設定では、毎回回っていたのが3回ごとになる）。
2. （ユーザーの決定 10-23）デスルーレットの止まる音・粒子が設定に無い（または正しくない）ときは、ウィザーの音・魂の炎にする（画面に合わせる。普通のルーレットは今のまま）。
3. （ユーザーの決定 10-23）コメントギフトのルールの音・粒子は、画面で「なし」を選べるようにし、空なら「なし」と出す（BRIDGE は今どおり空なら鳴らさない）。新しく足したルールの既定は今のまま（レベルアップの音・不死のトーテム）。
4. 画面は古い設定の名前（`tiktok.username`・`tiktok.user`）を読まない。BRIDGE・設定の確かめ・配信前チェックは前から `tiktokUsername` だけを読むので、古い名前だけの設定は画面に「承認済み」と出ても動いていなかった。
5. 配信ホームは、大文字小文字だけが違う TikTok ID（保存 `foo`・入力 `Foo`）を同じ ID とみなす（BRIDGE も同じ ID として扱い、再起動の案内も出ない）。
6. ギフト一覧の画面の TikTok ID は、確かめてから保存する（今は確かめる前に保存し、正しくない ID が次に開いたときも残る）。
7. 別のアプリ GiftsViewer は、道具（`GiftsViewer/tools/fetch_gifts.cjs`。本体のアプリも束ねて使う）が `bridge/tiktok_id.cjs` を使い、GiftsViewer のアプリの main と画面は値をそのまま渡す（GiftsViewer を単独で束ねたとき、アプリの main からは `bridge/` が読めないため）。
8. ルーレットの項目の重みは、画面でも上限を設けない（BRIDGE には上限が無い。今の画面は入力で 100 に丸め、保存済みの 500 は 500 のまま出る）。読み込みの式は BRIDGE の `weightOf` と同じ（数でなければ 1、1 未満は 1）。
9. 読み上げの話者の既定は、エンジンの話者の一覧が読めないときも `bridge/tts_settings.json` の `speakerId`（2）にする（今の画面は VOICEVOX のとき 3 にしていた）。
10. 読み上げのテストは、本番と同じく音量をエンジンに渡して作り、画面では音量を掛けない（今は音量をエンジンに渡さず、画面の再生で 1 までに丸めるので、100〜200% が同じに鳴る）。

## Review Focus

1. TikTok ID に `@Foo_Bar ` と書いて承認・ギフト一覧の更新・LIVE の確かめをしたとき、どこでも `foo_bar` として動き、配信ホームが「承認済み」と出る → Task 1・Task 2 のテスト。
2. 25〜64 文字の TikTok ID でギフト一覧を更新すると、TikTok へ問い合わせる前に、設定の確かめと同じ文で止まる → Task 1 のテスト。
3. `everyDeaths` を書いていない設定で、デスルーレットは3回死ぬごとに回り、止まる音はウィザーの音（条件だけ確認・テスト発火も同じ）→ Task 3 のテスト。
4. コメントギフトのルールで音を「なし」にして保存すると、設定の `sound` は空で、開き直しても「なし」と出る → Task 3 のテスト。
5. 読み上げの設定を壊れた値（`speedScale: 9`・`"x"`）で保存しても、BRIDGE・main・画面が同じ範囲に丸める → Task 4 のテスト。

---

### Task 1: TikTok ID の決まりを main・preload・ギフト一覧・GiftsViewer の道具でそろえる

**Files:**
- Modify: `bridge/tiktok_id.cjs`（`tiktokIdProblem(value): string` を足す）、`bridge/config_schema.js:23`（その文を使う）、`electron/preload.cjs:13-16・94-97・219-222`（`normalizeUsername` をなくし、値をそのまま渡す）、`electron/gifts_viewer.cjs:48-49`（`updateGifts` は空なら「TikTok ID を入力してください」、形が正しくなければ `tiktokIdProblem`）・`:217-221`（`gv:settings:write` は確かめてから、整えた形で保存）、`electron/settings_backups.cjs:83`（一覧の `username` は整えた形）、`GiftsViewer/tools/fetch_gifts.cjs:8-10・84`（`normalizeUniqueId` をなくし `normalizeTikTokId`・`isValidTikTokId` を使う）、`GiftsViewer/electron/main.cjs:165・171-172`（値をそのまま渡す）
- Test: `electron/test/gifts-viewer-module.test.cjs`、`electron/test/config-migration.test.cjs:19-28`（写しを探す所を広げる）、`electron/test/settings-safety.test.cjs`

**Interfaces:**
- Produces: `tiktokIdProblem(value: unknown): string`（正しければ空。空の値も空を返す（空の扱いは呼ぶ側）。正しくなければ Global Constraints の文で、「」の中は `String(value).trim()`）。

- [ ] **Step 1: テストを書く**
  - `gifts-viewer-module.test.cjs`：`gifts:update` に `'a'.repeat(25)` を渡すと、道具を動かす前に Global Constraints の文で断る（道具の呼び出しが0回）。`' @Foo_Bar '` は `foo_bar` で道具を呼ぶ（今のテストのまま）。空・`'@'` は「TikTok ID を入力してください」。`gv:settings:write` に `{ username: ' @Foo ' }` を渡すと `foo` で保存し、`{ username: 'foo-bar' }` は断って保存しない。
  - `config-migration.test.cjs` の写しを探すテストに、`electron/preload.cjs`・`electron/gifts_viewer.cjs`・`GiftsViewer/tools/fetch_gifts.cjs`・`GiftsViewer/electron/main.cjs` を足す：`.replace(/^@/` と `[\w.]{1,64}` を持たない。`gifts_viewer.cjs`・`fetch_gifts.cjs` は `normalizeTikTokId(` を使う。
  - `settings-safety.test.cjs`：保存済みの `tiktokUsername: ' @Foo '` のバックアップの一覧の `username` は `foo`。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/gifts-viewer-module.test.cjs electron/test/config-migration.test.cjs electron/test/settings-safety.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**（preload は文字列でなければ空の文字列にして渡す。`GiftsViewer/tools-bundled` は git に入っていないので、`cd GiftsViewer && npm run bundle:tools` で束ね直してから確かめる）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:app` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: TikTok ID の整え方と確かめを main・preload・ギフト一覧・GiftsViewer の道具で1つにする」）

---

### Task 2: 画面の TikTok ID の整え方を1つにする

**Files:**
- Create: `src/lib/tiktokId.ts`
- Modify: `src/components/DashboardPage.tsx:323-330・346・444・556-563・848-853・867`、`src/components/GiftsViewerPage.tsx:118・137-140`、`src/components/GiftsGridSection.tsx:70-74`、`src/components/GiftSettingsPage.tsx:79`、`src/lib/devApiMock.ts`（`configValidate` は TikTok ID も確かめる）、`GiftsViewer/src/App.tsx:122・213-214`（値をそのまま渡し、空の文を日本語に）
- Test: Create `electron/test/ui-tiktok-id.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `tiktokIdProblem`（bridge 側。比べる相手）。
- Produces: `src/lib/tiktokId.ts`：`normalizeTikTokId(value: unknown): string`、`isValidTikTokId(value: unknown): boolean`、`tiktokIdProblem(value: unknown): string`、`sameTikTokId(a: unknown, b: unknown): boolean`（整えた形が同じで空でない）。

- [ ] **Step 1: テストを書く**（`ui-tiktok-id.test.cjs`。`transformSync` で読む）
  - 同じ例で bridge と同じ：`[' @Foo_Bar ', 'foo-bar', '@', '', 'a'.repeat(24), 'a'.repeat(25), 'ＦＯＯ', 'foo.bar', null, 3, '　foo　']` のそれぞれで `normalizeTikTokId`・`isValidTikTokId`・`tiktokIdProblem` が bridge と同じ。`sameTikTokId('foo', 'Foo')` true、`('foo', '@foo ')` true、`('', '')` false。
  - 写しを探す：上の `src/components/` の4つと `GiftsViewer/src/App.tsx` は `.replace(/^@/`・`cfg?.tiktok?.username`・`tiktok?.user` を持たず、`src/components/` の4つは `../lib/tiktokId` を使う。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/ui-tiktok-id.test.cjs` / Expected: FAIL（`tiktokId.ts` がない）。ファイルだけ先に作ると、写しを探すテストが落ちることも確かめる。
- [ ] **Step 3: 直す**（配信ホーム：読み込み・LIVE の確かめ・「承認済み／非承認」・承認・表示はどれも整えた形で比べる。入力が空か `@` だけなら「未設定」。LIVE の確かめが返す理由（`accountLive.error`）を出す。承認の前の空の確かめの文は設定の確かめと同じにする）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run typecheck`・`npm run test:app` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: 画面の TikTok ID の整え方を1つにし、古い設定の名前を読まない」）

---

### Task 3: イベント設定②の既定値を BRIDGE と画面で1つにする

**Files:**
- Modify: `bridge/config_defaults.json`（`roulette`・`deathRoulette`）、`bridge/roulette.cjs:24-48`（`prepareRoulette(config, commandsDir, random, defaults = CONFIG_DEFAULTS.roulette)`）、`bridge/event_rules.cjs:18`（`everyDeaths` の既定）、`bridge/index.js:1437・1473・1525`（デスルーレットは `CONFIG_DEFAULTS.deathRoulette` を渡す）、`src/components/EventSettings2Page.tsx:68・204・292-327・605-612`（既定値は `config_defaults.json` から、重みは上限なし、コメントギフトの音・粒子の「なし」、ルーレットの有効は BRIDGE と同じく真の値なら有効）、`src/lib/integerInput.ts`（`toWeight` を足す）
- Test: `electron/test/roulette.test.cjs`、`electron/test/event-tests.test.cjs`、`electron/test/integer-input.test.cjs`、`electron/test/config-defaults.test.cjs`

**Interfaces:**
- Produces: `CONFIG_DEFAULTS.roulette = { stopSound, particle }`、`CONFIG_DEFAULTS.deathRoulette = { everyDeaths: 3, stopSound, particle }`。`prepareRoulette(config, commandsDir, random?, defaults?)`。`toWeight(value: unknown): number`（`weightOf` と同じ結果）。

- [ ] **Step 1: テストを書く**
  - `event-tests.test.cjs`：`deathRouletteMatches({ enabled: true }, 3)` true、`(…, 1)`・`(…, 2)` false（前は毎回）。
  - `roulette.test.cjs`：`prepareRoulette({ items, stopSound: 'a:b:c' }, dir, () => 0, CONFIG_DEFAULTS.deathRoulette).stopSound` は `entity.wither.spawn`、`particle` は `minecraft:soul_fire_flame`。既定を渡さなければ今どおり（レベルアップ・不死のトーテム）。
  - 試験台（`electron/test/bridge-command-names.test.cjs` と同じ形、または `test-fire-parity.test.cjs` に足す）：`deathRoulette: { enabled: true, items: [...] }`（`everyDeaths` なし）で、死亡を2回送ってもルーレットを回さず、3回目で回す。
  - `integer-input.test.cjs`：`toWeight` は `[0, 0.5, 1, 2.5, 500, -3, 'x', '', null]` で bridge の `weightOf` と同じ。
  - `config-defaults.test.cjs`：`bridge/roulette.cjs`・`bridge/event_rules.cjs`・`bridge/index.js`・`EventSettings2Page.tsx` は `"entity.wither.spawn"`・`"entity.player.levelup"`・`everyDeaths ?? 1`・`everyDeaths ?? 3` を持たず、画面は `config_defaults.json` を読む。`EventSettings2Page.tsx` は重みを 100 に丸めない（`Math.min(100`）。コメントギフトの「なし（鳴らさない）」「なし（出さない）」がある。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/event-tests.test.cjs electron/test/roulette.test.cjs electron/test/integer-input.test.cjs electron/test/config-defaults.test.cjs` と試験台のテスト / Expected: FAIL。
- [ ] **Step 3: 直す**（`IdPicker` に「なし」の選び方を足すのはコメントギフトのルールだけ。値が空なら「なし」を選んだ形で出す。ルーレットの項目の重みの入力欄は 1 以上で上限なし）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:bridge`・`npm run typecheck`・`npm run test:app` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: デスルーレットの既定値（3回ごと・ウィザーの音）とコメントギフトの「なし」を BRIDGE と画面で1つにする」）

---

### Task 4: 読み上げの既定値・範囲・ポートを1か所にし、テストの音量を本番と同じにする

**Files:**
- Create: `bridge/tts_settings.json`、`bridge/tts_settings.cjs`（`TTS_SETTINGS`（JSON）・`normalizeTtsSettings(value)`）
- Modify: `bridge/index.js:183-217・281・296-299`（`TTS_DEFAULTS`・`ttsNumber`・`normalizeTtsConfig`・`TTS_PORTS`・既定の写しをなくす）、`electron/tts_ipc.cjs:11-43`（`TTS_DEFAULTS`・`clampNumber`・`normalizeTtsSettings` をなくす）・`:165-180`（`tts:test` は音量も渡す）、`electron/tts.cjs:6-9・82-99`（ポートは JSON、`synthesize(engine, text, speakerId, speedScale, pitchScale, intonationScale, volumeScale = 1)`）、`vite.config.ts:10-13`（ポートは JSON）、`src/components/TTSSettingsPage.tsx:23-34・200・394・614-617`（既定値・範囲は JSON、話者の既定は `speakerId`、テストの再生で音量を掛けない、左端の目盛りは範囲の下限）、`src/lib/devApiMock.ts:121-132`（既定値は JSON）、`package.json` の `build.files`
- Test: `electron/test/tts-ipc-module.test.cjs`、`bridge/test/simulate_events.js:186-195`、Create `electron/test/tts-settings.test.cjs`

**Interfaces:**
- Produces: `bridge/tts_settings.json` = `{ defaults: {...}, ranges: { speedScale: [0.5, 2], pitchScale: [-0.15, 0.15], intonationScale: [0, 2], volume: [0, 2] }, ports: { voicevox: 50021, aivis: 10101 }, giftTemplateMax: 200 }`。`normalizeTtsSettings(value: unknown): TtsSettings`（今の2つと同じ結果）。

- [ ] **Step 1: テストを書く**
  - `tts-settings.test.cjs`：`normalizeTtsSettings` は今の `tts_ipc.cjs` の式と同じ結果（`{ speedScale: 9, pitchScale: 'x', volume: -1, speakerId: 2.7, engine: 'aivis', giftTemplate: 'a'.repeat(300) }` など）。`bridge/index.js`・`electron/tts_ipc.cjs`・`electron/tts.cjs`・`vite.config.ts`・`TTSSettingsPage.tsx`・`devApiMock.ts` は `50021`・`10101`・`speedScale: 1.2`・`function clampNumber`・`function ttsNumber` を持たない。`TTSSettingsPage.tsx` は `tts_settings.json` を読み、`Math.min(1, Math.max(0, settings.volume))` を持たない。
  - `tts-ipc-module.test.cjs`：`tts:test` で `volume: 1.8` のとき、エンジンへの `synthesis` の問い合わせの中身の `volumeScale` が 1.8（今のテストの偽のエンジンで、送られた本文を見る）。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/tts-settings.test.cjs electron/test/tts-ipc-module.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**（`bridge/index.js` は `normalizeTtsSettings` の結果をそのまま使い、`?? 2`・`?? 1.2` などを付け直さない）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:bridge`・`npm run typecheck`・`npm run test:app` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: 読み上げの既定値・範囲・ポートを1か所にし、テストの音量を本番と同じにする」）

---

### Task 5: 記録

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「処理のコピー」の PR9 の節：やったこと・決めたこと 1〜10・`npm run verify` と契約テストの結果・リリースノートに足すこと。処理のコピーの残り（あれば）と次にやること）

リリースノートに足すこと:
- デスルーレットの「何回死ぬごと」を設定していない場合、3回死ぬごとに回ります（画面の表示どおり。前は毎回回っていました）。止まる音もウィザーの音になります。
- コメントギフトのルールで、音と粒子を「なし」にできます。
- ギフト一覧の更新で、TikTok ID の形が正しくないときはすぐに理由を出します。
- 読み上げのテストの音量が、配信中と同じになります（前は 100% より大きくしても同じ音量でした）。

- [ ] **Step 1: HANDOFF を書く**
- [ ] **Step 2: `npm run verify`・`node scripts/test-bridge-contracts.cjs`** — Expected: すべて通る。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR9 を書く」）
