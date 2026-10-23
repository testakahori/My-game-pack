# 設定ファイルが壊れても消えないようにする PR3（ギフト設定・ゲームの切り替えの記録）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ギフト設定（`config.minecraft.json`）とゲームの切り替えの記録（`profiles.json`・`pending-switch.json`）が壊れても、設定を失わず、アプリの操作が止まらないようにする。ギフト設定は、写しが使えなければ雛形を作らずに壊れたファイルを置いたままにし、設定のバックアップから戻せるようにする。

**Architecture:** PR1・PR2 の共通の関数 `bridge/safe_json_file.cjs` に、壊れたファイルを元の場所に置いたままにする `keepBroken`、写しを使ってよいかを決める `acceptSource`、状態だけを返す `check()`、書く前に写しと壊れたファイルを残してから書く `writeWithLastGood` などを足す。ギフト設定は `electron/bridge_settings.cjs` が持ち、起動のとき・BRIDGE を起動する前・画面が読むときに戻す。ゲームの切り替えの記録は `electron/game_profiles.cjs` が共通の関数で読み書きする。2つの「今のゲーム」（ギフト設定の `gameProfile` と記録の `active`）が合わない写しは使わない（設計書 6.6）。

**Tech Stack:** Electron（`electron/*.cjs`）、`bridge/*.cjs`、node:test。

**Spec:** `docs/superpowers/specs/2026-10-23-settings-file-safety-design.md`（5・6.4・6.5・6.6・9）。PR1・PR2 の計画（`docs/superpowers/plans/2026-10-23-settings-file-safety-pr1.md`・`-pr2.md`。マージ済み #128・#130）。

## Global Constraints

- 写し・壊れたファイルの名前、記録の形・置き場所（`userData/logs/settings-recovery.log`）は PR1・PR2 のまま。
- 新しい記録の文：
  - 戻さずに置いたまま（`action: "kept"`）：「<名前> が壊れていた（<理由>）。前の正しい状態の写しが無い（または使えない）ので、そのまま置いた。壊れたファイルの写し: <壊れたファイルの名前>」。写しも作れなかったときは「…。別の名前で残せなかったので、ファイルには触らず、そのまま置いた」。
  - 外した（`action: "set-aside"`）：「<名前> が壊れていた（<理由>）ので、別の名前で残して外した。壊れたファイル: <壊れたファイルの名前>」。
- 配信前チェックの案内（「設定を読み込めません。初期セットアップと設定バックアップを確認してください」。`electron/preflight.cjs:20-24`）は変えない。画面には何も出さない。新しい ipc の窓口は作らない。
- ギフト設定の中身の形・確かめ（`validateBridgeConfig`）・既定値は変えない。
- コメントは日本語。守っているファイルに「バックスラッシュのあとに 16 進の字」を書かない。
- 新しいテストは、直す前のコードで落ちることを確かめる（AGENTS.md）。

## 決めたこと（違っていれば直す）

1. ギフト設定は、JSON として読めない・オブジェクトでないときだけ「壊れている」とする（項目の型では決めない）。設定の確かめのエラー（スキーマ・TikTok ID など）は今までどおり壊れているとは扱わない（設計書 5.2）。古い版の設定は形がいろいろあるため。
2. ゲームの切り替えの記録 `profiles.json` は、`active`（文字列）・`packages`・`profiles`（あればオブジェクト）を確かめる（どの版も `writeJson(stateFile(), …)` でこの形を書いていた。違う形だと `list()` が落ちる）。
3. ギフト設定の写しは、写しの `gameProfile`（無ければ `common`）が切り替えの記録の `active` と合うときだけ使う。記録が無い・読めないときは確かめずに使う（設計書 6.6）。
4. 切り替えの記録の写しは、写しの `active` がギフト設定の `gameProfile`（無ければ `common`）と合うときだけ使う。ギフト設定が読めないときは確かめずに使う。写しが無い・合わないときは、`active` をギフト設定の `gameProfile`（無ければ `common`）にした既定の記録で動く（`packages`・ゲームごとの保存済みの設定は空。同梱のゲームパックはそのまま選べ、そのほかは登録し直す）。こうすると、ゲームを選び直して保存したときに、ほかのゲームの保存済みの設定を今の割り当てで上書きしない。壊れたファイルは名前を変えて残る。
5. 切り替えの途中の記録 `pending-switch.json` は、切り替えの間だけあるので写しを作らない。壊れていたら、ホームの「復旧」で別の名前に残して外し、記録する（切り替えの前に戻すことはできないので、今の記録のまま動く。ゲームを選び直す）。
6. ギフト設定を書く所（`bridge_settings.cjs` の2か所・`command_migration.cjs`・`game_profiles.cjs` の2か所）は `writeWithLastGood` で書く（書く前の中身が正しければ写しに、壊れていればまだ残していなければ壊れたファイルとして残す）。新しいファイルだけを作る所（`paths.cjs` の `ensureConfigExists`・`bridge_sync.cjs` の初期セットアップの直後）は `atomicWrite`（fsync 付き）にする。
7. ギフト設定を戻すのは、起動のとき・BRIDGE を起動する前・初期セットアップを終えたとき（どれも `migrateSavedConfigOnStartup` を通る）と、画面がギフト設定を読むとき（`config:read`）。BRIDGE は自分では戻さない（設計書 6.4「BRIDGE を起動する前に、アプリが戻しておく」）。置いたままの壊れたギフト設定では、BRIDGE は今までどおり起動しない（エラーの文が出る）。
8. ギフト設定が読めないまま設定のバックアップから戻すとき：
   - ゲームの確かめは、ギフト設定の `gameProfile` の代わりに切り替えの記録の `active` と比べる。
   - つなぎ方（`commandsDir`・`bridgeModHost`・`bridgeModPort`・`doumaModHost`・`doumaModPort`・`commandTransport`）と `rcon` は、ギフト設定の写し（ゲームが合わなくても使う。つなぎ方はゲームによらない）、それも無ければ新しい設定の雛形（`newBridgeConfig()`。`commandTransport: "bridge_mod"`、RCON のパスワードは空）から取る。何も入れないと、BRIDGE はつなぎ方を RCON として動き、ギフトが動かないため。
   - 戻す前の安全のためのバックアップ（`before-restore`）は作らない（読めない設定は取れない。壊れたファイルは `.broken-…` に残る）。

## Review Focus

1. 確かめのエラーがある・古い形のギフト設定（`mappings` が空・TikTok ID が未承認など）を、壊れていると扱わない → Task 3 のテスト。
2. ゲームを A から B に切り替えた直後にギフト設定が壊れた → 写し（A）は記録（B）と合わないので戻さず、壊れたファイルを置いたまま。雛形を作らない。設定のバックアップから戻せる → Task 3・Task 4 のテスト。
3. 切り替えた直後に `profiles.json` が壊れた → 写し（A）はギフト設定（B）と合わないので使わず、`active: B` で動く。B を選び直して保存しても、A の保存済みの設定を B の割り当てで上書きしない → Task 2 のテスト。
4. 壊れたギフト設定を置いたままでも、アプリの設定の保存・ゲームの一覧・BRIDGE の起動の前の確かめ・設定のバックアップの一覧が、投げずに動く（BRIDGE の起動はエラーの文で止まる）→ Task 2・Task 4 のテスト。
5. 壊れた `pending-switch.json` でも、ホームの「復旧」で外せて、そのあと切り替え・登録ができる → Task 2 のテスト。

---

### Task 1: 共通の関数に、置いたままにする・写しを選ぶ・書く前に残す を足す

**Files:**
- Modify: `bridge/safe_json_file.cjs`
- Test: Modify `electron/test/safe-json-file.test.cjs`

**Interfaces:**
- Produces:
  - `createSafeJsonFile({ …今の引数, keepBroken?: boolean, acceptSource?: (value: object) => boolean })` と、メソッド `check(): { state: "ok" | "missing" | "restored" | "kept" | "defaults" | "unpreserved", reason?: string }`（`read()` と同じ流れで、値の代わりに状態を返す）。
    - `keepBroken`：戻す元が無いとき、壊れたファイルを元の場所に置いたまま（消さない・名前を変えない）。残すのは中身の写しだけ（中身が読めない（OS のエラー）ときは何もしない）。状態は `"kept"`、記録の `action` も `"kept"`。同じ壊れたファイルは、このプロセスの間は1回だけ残して記録する（PR1 と同じ）。`write()` は、置いたままの壊れたファイルを残せていれば書いてよい。
    - `acceptSource`：戻す元（`restoreSources` と写し）の値を、これが `true` を返すときだけ使う。
  - `inspectJsonFile(file: string, problem?): { missing?: true, reason?: string, value?: object, bytes?: Buffer }`（今の `inspect` を出す）。
  - `preserveBrokenCopy(file: string, options?: { problem?, now? }): string` — 今の中身が壊れていれば、同じ中身の `<名前>.broken-…` がまだ無いときだけ、中身を写して残し、その名前を返す（あればその名前。壊れていない・無い・写せないときは `""`）。元のファイルには触らない。
  - `writeWithLastGood(file: string, content: string | Buffer, options?: { problem?, now? }): void` — 今の中身が正しければ写しにし、壊れていれば `preserveBrokenCopy` で残してから、`writeFileDurable(file, content)`。
  - `setAsideBrokenFile(file: string, options?: { now? }): string` — 中身を写して残し（写せなければ名前を変えて）、元のファイルを消して、残した名前を返す（残せなければ投げる。元のファイルは触らない）。
  - `describeRecovery`：`action: "kept"`・`"set-aside"` の文（Global Constraints）。

- [ ] **Step 1: テストを書く**
  - `置いたまま: 戻す元が無ければ壊れたファイルを元の場所に置き、中身の写しを残して記録する。何度読んでも1回だけ` — `keepBroken: true`、写し無しで `'{壊れた'`。`check()` が `{ state: 'kept', reason: 'JSON として読めない' }`、`x.json` は元のバイトのまま、`x.json.broken-20261023-153012` も同じバイト、記録は `action: 'kept'` で1つ。3回 `check()` しても記録・壊れたファイルは増えない。
  - `置いたまま: 写しがあれば今までどおり戻す` — `keepBroken: true`、写し `{"a":"good"}` なら `check()` が `{ state: 'restored' }`、`x.json` は写しの中身。
  - `写しを選ぶ: acceptSource が false の写しは使わない` — `acceptSource: v => v.a === 'ok'`。写し `{"a":"other"}` は使わず `'kept'`（`keepBroken`）／`'defaults'`（`keepBroken` なし）。写し `{"a":"ok"}` は使う。
  - `書く前に残す: 正しければ写しに、壊れていれば壊れたファイルとして1回だけ残してから書く` — 正しい `{"a":"1"}` に `writeWithLastGood(file, '{"a":"2"}')` → 写しは `{"a":"1"}`。`'{壊れた'` に書く → 写しは変わらず、`.broken-…` に `'{壊れた'`、`x.json` は新しい中身。同じ壊れた中身にもう一度書いても `.broken-…` は増えない（`preserveBrokenCopy` が同じ名前を返す）。
  - `外す: 壊れたファイルを別の名前に残して消す` — `setAsideBrokenFile(file)` のあと、`x.json` が無く、`.broken-…` が元のバイト。
  - `記録の文: kept・set-aside` — Global Constraints の文（写しを作れなかった `kept` も）。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/safe-json-file.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/safe-json-file.test.cjs electron/test/app-config-module.test.cjs electron/test/tts-ipc-module.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "設定ファイル: 置いたままにする・写しを選ぶ・書く前に残す"`

### Task 2: ゲームの切り替えの記録を共通の関数で読み書きし、壊れたギフト設定でも一覧を止めない

**Files:**
- Modify: `electron/game_profiles.cjs:16-17・94-117・141-166・204・241-262`（ギフト設定の2か所の書き込み（`restore`・`activate`）も `writeWithLastGood` にする）、`electron/games_ipc.cjs:12-30`（`createGamesIpc` が `recordRecovery`・`now` を受け取り、`createGameProfiles` に渡す）、`electron/main.cjs`（`createGamesIpc` に `recordRecovery` を渡す）
- Test: Modify `electron/test/game-profiles.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `createSafeJsonFile`（`acceptSource`）・`peekJsonFile`・`inspectJsonFile`・`setAsideBrokenFile`・`writeWithLastGood`。
- Produces:
  - `createGameProfiles({ …今の引数, recordRecovery?, now? })` が返すものに `peekActive(): string | null`（`profiles.json` を読むだけ。無い・壊れていれば `null`）を足す。
  - `profiles.json` は `createSafeJsonFile({ file: stateFile, problem, acceptSource, defaults, record, now })`：`problem` は決めたこと 2、`acceptSource: value => { const config = peekJsonFile(configPath()); return !config || value.active === (config.gameProfile || "common"); }`、`defaults: () => ({ format: 1, active: (peekJsonFile(configPath())?.gameProfile) || "common", packages: {}, profiles: {} })`。`state()` は `read()`、`profiles.json` を書く所（`install`・`restore`・`activate`）は `write()`。
  - `list()` はギフト設定を `peekJsonFile(configPath()) || {}` で読む（壊れていても投げない。`applied` は `false` になる）。
  - `recover()`：`pending-switch.json` が壊れていたら（`inspectJsonFile` の `reason`）、`setAsideBrokenFile` で外し、`action: "set-aside"` を記録して、`list()` を返す。

- [ ] **Step 1: テストを書く**（`game-profiles.test.cjs`）
  - `切り替えの記録: 壊れていたら写しから戻す` — 切り替えたあと（記録が書かれたあと）`profiles.json` を `'{壊れた'` にすると、`list().active` が写しの `active`（ギフト設定の `gameProfile` と合うとき）、記録は `restored`。
  - `切り替えの記録: 写しのゲームがギフト設定と合わなければ使わず、ギフト設定のゲームで動く。選び直して保存しても、ほかのゲームの保存済みの設定を上書きしない` — `common` → `saikutu` に切り替えた直後、`profiles.json` を壊し、写しを `active: 'common'` の中身にしておく（ギフト設定は `gameProfile: 'saikutu'`）。`list().active` は `'saikutu'`。そのあと `activate('saikutu')` しても、`profiles.json` の `profiles.common` に採掘の割り当てが入らない。
  - `切り替えの記録: 形の違う記録（active が数）は壊れていると扱う` — `{ "active": 3 }` で記録の理由は「項目 active の型が違う」。
  - `一覧: ギフト設定が壊れていても投げない` — `config.minecraft.json` が `'{壊れた'` でも `list()` が投げず、`applied` は `false`、`recoveryRequired` は `false`。
  - `復旧: 壊れた途中の記録は外して記録し、そのあと切り替えられる` — `pending-switch.json` を `'{壊れた'` にすると、`list().recoveryRequired` は `true`、`recover()` のあと `false`、`.broken-…` が残り、記録は `set-aside`。`activate('common')` が「前回の切替を復旧してから」で止まらない。
  - `本文: 切り替えの記録を readJson・writeJson で読み書きせず、ギフト設定は writeWithLastGood で書く` — `game_profiles.cjs` に `readJson(stateFile()`・`writeJson(stateFile()`・`readJson(configPath()`・`atomicWrite(configPath()` が無く、`writeWithLastGood(configPath()` がある。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/game-profiles.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/game-profiles.test.cjs electron/test/games-ipc-module.test.cjs electron/test/game-mods-after-update.test.cjs electron/test/bridge-settings-module.test.cjs electron/test/app-regressions.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "ゲームの切り替えの記録: 壊れていたら写しから戻し、ギフト設定が読めなくても一覧を止めない"`

### Task 3: ギフト設定を、起動のとき・BRIDGE の前・画面が読むときに戻し、写しを残して書く

**Files:**
- Modify: `electron/bridge_settings.cjs:19-62・125-132`（ギフト設定の `createSafeJsonFile`・`recoverGiftConfig`・2か所の書き込み）、`electron/command_migration.cjs:40`、`electron/paths.cjs:77`、`electron/bridge_sync.cjs:607`、`electron/main.cjs`（`bridgeSettings` に `recordRecovery` を渡す）
- Test: Modify `electron/test/bridge-settings-module.test.cjs`、`electron/test/command-migration.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `keepBroken`・`acceptSource`・`check()`・`writeWithLastGood`。Task 2 の `gameProfiles.peekActive(): string | null`。
- Produces: `createBridgeSettings({ …今の引数, recordRecovery?, now? })` が返すものに `recoverGiftConfig(): { state, reason? }` を足す。`migrateSavedConfigOnStartup()` の初めに `recoverGiftConfig()` を呼ぶ。`config:read` も、読む前に呼ぶ。

- [ ] **Step 1: テストを書く**（`bridge-settings-module.test.cjs`。`setup` に `recordRecovery` と `now` を足す）
  - `ギフト設定: 壊れていたら起動のときに写しから戻す` — 2回保存（`config:write`）してから `'{壊れた'` にし、`migrateSavedConfigOnStartup()` のあと、ギフト設定は写しの中身、記録は `action: 'restored'`。
  - `ギフト設定: 写しが無ければ、雛形を作らずに壊れたファイルを置いたまま` — 写し無しで壊し、`migrateSavedConfigOnStartup()` と `config:read`（これは今までどおり投げる）のあと、`config.minecraft.json` は元のバイト、`.broken-…` があり、記録は `action: 'kept'` で1つ。
  - `ギフト設定: 写しのゲームが今のゲームと合わなければ戻さない（設計書 6.6）` — `gameProfiles.peekActive` が `'run'` を返すようにし、写しの `gameProfile` が `'saikutu'` なら戻さず置いたまま。`'run'` なら戻す。
  - `ギフト設定: 確かめのエラーがあっても壊れているとは扱わない` — `{ "tiktokUsername": "foo-bar", "mappings": [] }` で記録も `.broken-` も無い。
  - `ギフト設定: 書くと写しを残す` — `config:write` を2回すると `.last-good` が1回目の中身。
  - `本文: ギフト設定を書く所は writeWithLastGood、新しいファイルを作る所は atomicWrite` — `bridge_settings.cjs`・`command_migration.cjs` に `atomicWrite(configPath` と `atomicWrite(getConfigPath()` が無く `writeWithLastGood(` がある。`paths.cjs`・`bridge_sync.cjs` に `fs.writeFileSync(configPath` と `fs.writeFileSync(dstConfigPath` が無い。
  - `command-migration.test.cjs`：直したあと `.last-good` が直す前の中身。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/bridge-settings-module.test.cjs electron/test/command-migration.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 作る** — ギフト設定の `createSafeJsonFile` は `keepBroken: true`、`defaults: () => ({})`、`acceptSource: value => { const active = gameProfiles.peekActive(); return !active || (value.gameProfile || "common") === active; }`（テストの偽物の `gameProfiles` にも `peekActive` を足す）。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/bridge-settings-module.test.cjs electron/test/command-migration.test.cjs electron/test/paths-module.test.cjs electron/test/app-regressions.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "ギフト設定: 壊れていたら写しから戻し、写しが使えなければ壊れたファイルを置いたままにする"`

### Task 4: ギフト設定が読めなくても設定のバックアップから戻せる

**Files:**
- Modify: `electron/settings_backups.cjs:42・127-150`（`capture`・`restore`）、`electron/main.cjs:71-83`（`activeGame`・`readConfigCopy` を渡す）
- Test: Modify `electron/test/settings-safety.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `peekJsonFile`・`lastGoodPath`・`preserveBrokenCopy`。Task 2 の `gameProfiles.peekActive()`。
- Produces: `createSettingsBackups(deps)` の `deps.activeGame?: () => string | null`（main は `() => gameProfiles.peekActive()`）。
  - `restore(id)`：今のギフト設定が読めなければ（`peekJsonFile(p.config)` が `null`）、ゲームの確かめは `deps.activeGame?.() || "common"` と比べ、つなぎ方と `rcon` は `peekJsonFile(lastGoodPath(p.config)) || newBridgeConfig()` から取る（決めたこと 8）。`before-restore` のバックアップは作らない。書く前に `preserveBrokenCopy(p.config)` で壊れたファイルを残す。
  - `create()`：今のギフト設定が読めなければ、今までどおり投げる（取れるものが無い）。

- [ ] **Step 1: テストを書く**（`settings-safety.test.cjs`）
  - `設定バックアップ: ギフト設定が壊れていて写しも無くても戻せる。つなぎ方は雛形、壊れたファイルは残る` — バックアップを取ってから `p.config` を `'{壊れた'`（写し無し）にし、`restore` が成り立つ。戻したギフト設定の `mappings` はバックアップのまま、`options.commandTransport` は `'bridge_mod'`、`.broken-…` に `'{壊れた'`。`before-restore` のバックアップは増えない。
  - `設定バックアップ: ギフト設定が読めないときは、切り替えの記録の今のゲームと比べる` — `deps.activeGame` が `'run'` を返すとき、`gameProfile` の無いバックアップ（common）は「このバックアップのゲームを選択してから復元してください」で止まる。`'common'` なら戻る。
  - `設定バックアップ: ギフト設定が読めないときは、つなぎ方を写しから取る` — 写しに `commandTransport: 'rcon'`・`rcon.password: 'p'` があると、戻した設定はそれを持つ。
  - `設定バックアップ: ギフト設定が壊れていても一覧は出る` — `store.list()` が投げない。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/settings-safety.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/settings-safety.test.cjs electron/test/app-regressions.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "設定のバックアップ: ギフト設定が読めなくても戻せる"`

### Task 5: HANDOFF と全体の確かめ

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「設定の既定値と設定ファイルの破損」の節に PR3：計画・やったこと・決めたこと 1〜8・確かめの結果・リリースノートに足すこと・次にやること）

リリースノートに足すこと：
- 「ギフト設定とゲームの切り替えの記録のファイルが壊れていたら、前の正しい状態に自動で戻します。戻せないときは、ギフト設定を空にせず、壊れたファイルを残したまま、配信前チェックの案内どおり設定のバックアップから戻せます」

- [ ] **Step 1: 全部を動かす** — Run: `npm run verify` / Expected: exit 0。
- [ ] **Step 2: HANDOFF を書く**
- [ ] **Step 3: コミット** — `git commit -m "HANDOFF: 設定ファイルの PR3"`
