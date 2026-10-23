# 設定ファイルが壊れても消えないようにする PR2（読み上げの設定2か所・ギフト一覧の画面の設定）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 読み上げの設定（`userData/tts-settings.json` と `<BRIDGE>/tts-settings.json`）とギフト一覧の画面の設定（`userData/gv-settings.json`）を、PR1 の共通の関数で読み書きする。BRIDGE 側の読み上げの設定が壊れても、読み上げを切っていた配信者の読み上げが動き出さないようにする。

**Architecture:** PR1 の `bridge/safe_json_file.cjs` に、記録に出す名前（`label`）と、写しが使えないときに動く中身の名前（`defaultsLabel`）と、戻さずに読むだけの `peekJsonFile` を足す。main（`electron/tts_ipc.cjs`・`electron/gifts_viewer.cjs`）は共通の関数で読み書きし、記録は PR1 の `settings-recovery.log` に書く。BRIDGE（`bridge/index.js`）も共通の関数で BRIDGE 側を読み、写しも使えないときは、main が起動のときに渡す userData 側の場所を読むだけで使う。記録は BRIDGE のログに書く。

**Tech Stack:** Electron（`electron/*.cjs`）、BRIDGE（`bridge/index.js`。配布は esbuild で1つに束ねる）、node:test、BRIDGE の試験台 `electron/test/helpers/bridge-fixture.cjs`。

**Spec:** `docs/superpowers/specs/2026-10-23-settings-file-safety-design.md`（5・6.2・6.3・9）。PR1 の計画 `docs/superpowers/plans/2026-10-23-settings-file-safety-pr1.md`（マージ済み #128）とその申し送り（記録の文にどちらのフォルダーかを入れる）。

## Global Constraints

- 共通の関数・写しと壊れたファイルの名前・記録の文の形は PR1 のまま（`<名前>.last-good`・`<名前>.broken-YYYYMMDD-HHMMSS`）。
- 記録に出す名前：userData 側は「tts-settings.json（userData）」、BRIDGE 側は「tts-settings.json（BRIDGE のフォルダー）」。ギフト一覧の画面の設定はファイル名のまま（gv-settings.json）。
- BRIDGE 側で写しが使えないときの記録の文は「…ので、userData の読み上げの設定（無ければ既定値）で動く。…」（BRIDGE が userData 側の場所を受け取っていないときは今までどおり「既定値」）。
- BRIDGE の記録は BRIDGE のログに `console.warn("[設定] " + <記録の文>)` で書く（BRIDGE のログは console を写して `bridge/logs/bridge-*.log` に書く）。
- main が BRIDGE を起動するときに渡す環境変数：`TTS_SETTINGS_FALLBACK_FILE`（userData 側の `tts-settings.json` の場所）。
- 画面には何も出さない。新しい ipc の窓口は作らない。読み上げの設定の中身の形と既定値（`bridge/tts_settings.json`）は変えない。
- コメントは日本語。守っているファイルに「バックスラッシュのあとに 16 進の字」を書かない。バックスラッシュを含むものは Write か Edit で書く（Bash の heredoc は引用符付きの 'EOF' なら崩れないことを確かめてから使う）。
- 新しいテストは、直す前のコードで落ちることを確かめる（AGENTS.md）。

## 決めたこと（違っていれば直す）

1. 読み上げの設定は、項目の型では「壊れている」と決めない（JSON として読めない・オブジェクトでないときだけ）。古い版は画面の値をそのまま書いていて（`JSON.stringify(settings)`。2026-10-23 の処理のコピー PR9 で整えるようになった）、値の型で決めると、読み上げを切っていた配信者の設定が「壊れている」と扱われるおそれがあるため。値は今までどおり `normalizeTtsSettings` で整える。
2. ギフト一覧の画面の設定は `username`（文字列）だけを確かめる（どの版も `String(...)` で書いていた。git の履歴で確かめた）。
3. BRIDGE 側が無い（または壊れていて写しも使えない）ときは、main も BRIDGE も userData 側を使い、それも無いときだけ既定値にする。前の BRIDGE は、BRIDGE 側が無いと既定値（読み上げ「あり」）で動いた（main は前から userData 側を読んでいた）。
4. BRIDGE は userData 側を読むだけで、戻したり書いたりしない（userData は main のもの）。
5. 記録の名前にどちらのフォルダーかを入れる（`label`）。壊れたファイルの名前は今のまま（元のファイルと同じフォルダーにできる）。
6. 開発版では BRIDGE のフォルダーがリポジトリの `bridge/` なので、そこにできる写しと壊れたファイルを、git に入れず（`.gitignore`）、配布物にも入れない（`package.json` の `extraResources` の `bridge` の `filter`）。入ると配信者の PC に開発者の写しが届き、壊れたときに開発者の設定に戻るため。
7. 設定のバックアップから戻すときの読み上げの設定の書き込みは、PR1 の決めたこと 9 と同じく今のまま（写しは次の保存で更新）。

## Review Focus

1. 古い版で画面の値をそのまま書いた読み上げの設定（`"speakerId": "3"`・`"speedScale": "1.5"` など）を、壊れていると扱わず、今までどおり整えて読む → Task 2・Task 3 のテスト。
2. BRIDGE 側が壊れていて写しも無いとき、userData 側が `enabled: false` なら、BRIDGE はコメントを読み上げない → Task 3 のテスト。
3. 新しく入れた直後などで BRIDGE 側が無いときも、BRIDGE は userData 側を使う → Task 3 のテスト。
4. 開発版の `bridge/` にできた `tts-settings.json.last-good`・`.broken-…` が、git にも配布物にも入らない → Task 3 のテスト。
5. main が先に BRIDGE 側を戻したあと、BRIDGE が読むと、戻した中身で動き、BRIDGE は記録しない（同じことを2回記録しない）→ Task 3 のテスト。

---

### Task 1: 共通の関数に、記録の名前・写しが使えないときの名前・読むだけの関数を足す

**Files:**
- Modify: `bridge/safe_json_file.cjs`
- Test: Modify `electron/test/safe-json-file.test.cjs`

**Interfaces:**
- Produces:
  - `createSafeJsonFile({ …PR1 の引数, label?: string, defaultsLabel?: string })`。記録の `RecoveryEntry` に `label`・`defaultsLabel` を足す（無ければ入れない）。
  - `describeRecovery(entry)`：名前は `entry.label || path.basename(entry.file)`。既定値の文の「既定値」は `entry.defaultsLabel || "既定値"`（残せなかったときの文も同じ）。
  - `peekJsonFile(file: string, problem?: (value) => string): object | null` — PR1 と同じ決まり（BOM を外す・JSON・オブジェクト・`problem`）で読み、正しければ値、無い・壊れているときは `null`。ファイルには触らず、記録もしない。

- [ ] **Step 1: テストを書く**
  - `記録の名前: label があれば名前に使う。defaultsLabel があれば「既定値」の代わりに使う` — `describeRecovery({ file, reason: 'JSON として読めない', action: 'defaults', brokenFile, label: 'tts-settings.json（BRIDGE のフォルダー）', defaultsLabel: 'userData の読み上げの設定（無ければ既定値）' })` が「tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）。前の正しい状態の写しが無い（または壊れている）ので、userData の読み上げの設定（無ければ既定値）で動く。壊れたファイル: x.json.broken-20261023-153012」。`action: 'restored'` は名前だけ変わる。`brokenFile: ''` の文も名前と「既定値」の代わりが入る。
  - `読む: label・defaultsLabel を記録に入れる` — `createSafeJsonFile({ …, label: 'L', defaultsLabel: 'D' })` で壊れたファイルを読むと、記録に `label: 'L'`・`defaultsLabel: 'D'` が入る。
  - `読むだけ: 正しければ値、無い・壊れていれば null。ファイルには触らない` — 正しい・BOM 付き → 値。無い・`'{壊れた'`・`'null'`・`problem` に合わない → `null`。どれもフォルダーの中身が変わらない（`.broken-` も `.last-good` もできない）。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/safe-json-file.test.cjs` / Expected: FAIL（`peekJsonFile is not a function` など）。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/safe-json-file.test.cjs electron/test/app-config-module.test.cjs electron/test/settings-recovery-log.test.cjs` / Expected: PASS（PR1 の記録の文は変わらない）。
- [ ] **Step 5: コミット** — `git commit -m "設定ファイル: 記録にどのフォルダーかを入れる。読むだけの関数を足す"`

### Task 2: main の読み上げの設定を共通の関数で読み書きする

**Files:**
- Modify: `electron/tts_ipc.cjs:10-45`（`readTtsSettingsFile`・`readTtsSettings`・`writeTtsSettings`）、`electron/main.cjs:86`（`recordRecovery` を渡す）
- Test: Modify `electron/test/tts-ipc-module.test.cjs`

**Interfaces:**
- Consumes: `createSafeJsonFile`（`label`・`defaultsLabel`。Task 1）。
- Produces: `createTtsIpc({ …今の引数, recordRecovery?: (entry) => void, now?: () => Date })`。中で2つ作る：
  - userData 側：`file: getTtsSettingsPath`、`label: "tts-settings.json（userData）"`、`defaults: () => ({ ...TTS_DEFAULTS })`。
  - BRIDGE 側：`file: () => path.join(getBridgeBatDir(), "tts-settings.json")`、`label: "tts-settings.json（BRIDGE のフォルダー）"`、`defaults: () => userData 側の read()`、`defaultsLabel: "userData の読み上げの設定（無ければ既定値）"`。
  - `readTtsSettings()` は `normalizeTtsSettings(BRIDGE 側の read())`（今と同じく BRIDGE 側を正とする）。`writeTtsSettings(settings)` は整えた値を BRIDGE 側、userData 側の順に共通の `write` で書く。

- [ ] **Step 1: テストを書く**（`setup` に `recordRecovery`（配列に積む）と `now` を足す）
  - `読み上げの設定: BRIDGE 側が壊れていたら写しから戻す。写しも無ければ userData 側を使う` — 2回保存して BRIDGE 側を `'{壊れた'` にすると、写しの値で読み、記録の `label` は「tts-settings.json（BRIDGE のフォルダー）」。もう一度壊して写しも消し、userData 側を `{ enabled: false }` にすると `readTtsSettings().enabled === false`、記録の `action` は `'defaults'`、`defaultsLabel` は「userData の読み上げの設定（無ければ既定値）」。
  - `読み上げの設定: userData 側が壊れていても写しから戻す` — BRIDGE 側が無いとき、userData 側の写しの値で読み、記録の `label` は「tts-settings.json（userData）」。
  - `読み上げの設定: 古い版の、画面の値をそのまま書いたファイルは壊れていると扱わない` — `{ "speakerId": "3", "speedScale": "1.5", "enabled": false }` を BRIDGE 側に置くと、記録も壊れたファイルも無く、`speakerId: 3`・`speedScale: 1.5`・`enabled: false`。
  - `読み上げの設定: 書くと2か所とも写しを残す` — 2回保存すると、2か所とも `.last-good` が1回目の値。
  - `本文: 読み上げの設定を fs で直接読み書きしない` — `tts_ipc.cjs` に `writeFileSync`・`readFileSync` が無い（エンジンの実行ファイルを探す `existsSync` はあってよい）。`main.cjs` の `createTtsIpc(` に `recordRecovery:` がある。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/tts-ipc-module.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/tts-ipc-module.test.cjs electron/test/settings-safety.test.cjs electron/test/app-regressions.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "読み上げの設定: 壊れていたら写しから戻し、写しも無ければ userData 側を使う"`

### Task 3: BRIDGE が読み上げの設定を共通の関数で読む

**Files:**
- Modify: `bridge/index.js:187-195`（`loadTtsConfig`）、`electron/bridge_process.cjs:10-11・105-108`（`getTtsSettingsPath` を受け取り、起動のときに `TTS_SETTINGS_FALLBACK_FILE` を渡す）、`electron/main.cjs:172-177`（`getTtsSettingsPath` を渡す）、`.gitignore`（`*.last-good`・`*.broken-*`）、`package.json` の `extraResources` の `from: "bridge"` の `filter`（`"!**/*.last-good"`・`"!**/*.broken-*"`）
- Test: Create `electron/test/bridge-tts-settings-recovery.test.cjs`（`startBridgeFixture` を使う）、Modify `electron/test/bridge-process-module.test.cjs:53`

**Interfaces:**
- Consumes: `createSafeJsonFile`・`peekJsonFile`・`describeRecovery`（Task 1）。
- Produces:
  - BRIDGE：モジュールの先頭近くで `createSafeJsonFile` を1つ作る（`file: () => path.join(__dirname, "tts-settings.json")`、`label: "tts-settings.json（BRIDGE のフォルダー）"`、`defaults: () => peekJsonFile(process.env.TTS_SETTINGS_FALLBACK_FILE) || TTS_DEFAULTS のコピー`（環境変数が無いときは読まない）、`defaultsLabel`：環境変数があるときだけ「userData の読み上げの設定（無ければ既定値）」、`record: entry => console.warn("[設定] " + describeRecovery(entry))`）。`loadTtsConfig()` は `normalizeTtsConfig(<それ>.read())`。
  - `createBridgeProcess({ …今の引数, getTtsSettingsPath: () => string })`。起動の `env` に `TTS_SETTINGS_FALLBACK_FILE: getTtsSettingsPath()` を足す。

- [ ] **Step 1: テストを書く**
  - `bridge-tts-settings-recovery.test.cjs`（試験台は `enabled: false` の `tts-settings.json` で始まる。読み上げたかは、ログの「[TTS] コメントをキューへ追加」で見る）：
    - `BRIDGE: 読み上げの設定が壊れていたら写しから戻し、読み上げを切ったまま。BRIDGE のログに記録する` — `tts-settings.json.last-good` を `{ enabled: false }`、`tts-settings.json` を `'{壊れた'` にしてコメントを送ると、読み上げのログが無く、ログに「[設定] tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。」があり、`tts-settings.json` は写しの中身。
    - `BRIDGE: 写しも無ければ、userData 側の読み上げの設定を使う` — `env: { TTS_SETTINGS_FALLBACK_FILE: <一時フォルダーの tts-settings.json（{ enabled: false }）> }` で、BRIDGE 側を `'{壊れた'`（写し無し）にしてコメントを送ると、読み上げのログが無い。記録の文に「userData の読み上げの設定（無ければ既定値）で動く」。userData 側のファイルは変わらない。
    - `BRIDGE: 写しも userData 側も無ければ既定値（読み上げる）` — 環境変数なし・写しなしで BRIDGE 側を壊すと、読み上げのログが出る（上の2つが読み上げを見分けられることの確かめ）。
    - `BRIDGE: BRIDGE 側が無いときも userData 側を使う` — 環境変数あり（`{ enabled: false }`）で BRIDGE 側を消してコメントを送ると、読み上げのログが無い。
    - `BRIDGE: 古い版の、画面の値をそのまま書いた読み上げの設定は、壊れていると扱わない` — `{ "enabled": false, "speakerId": "3" }` で、記録も壊れたファイルも無く、読み上げのログも無い。
    - `BRIDGE: main が先に戻したあとは、戻した中身で動き、記録しない` — テストの側で `createSafeJsonFile`（同じ場所・写し `{ enabled: false }`）の `read()` を先に呼んでからコメントを送ると、「[設定]」のログが無く、読み上げのログも無い。
  - `bridge-process-module.test.cjs:53`：起動の `env.TTS_SETTINGS_FALLBACK_FILE` が `getTtsSettingsPath()` の値（`setup` に `getTtsSettingsPath: () => path.join(root, 'userData', 'tts-settings.json')` を足す）。
  - 配布と git：`.gitignore` に `*.last-good`・`*.broken-*` があり、`package.json` の `extraResources` の `from: "bridge"` の `filter` に `"!**/*.last-good"`・`"!**/*.broken-*"` がある（`electron/test/config-schema.test.cjs` の配布のテストの隣に足す）。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/bridge-tts-settings-recovery.test.cjs electron/test/bridge-process-module.test.cjs electron/test/config-schema.test.cjs` / Expected: FAIL（壊れた設定を既定値で読んで読み上げる・環境変数が無い・filter が無い）。
- [ ] **Step 3: 作る** — `main.cjs` の `createBridgeProcess` に `getTtsSettingsPath` を渡す（`ttsIpc` は先に作られている）。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/bridge-tts-settings-recovery.test.cjs electron/test/bridge-process-module.test.cjs electron/test/config-schema.test.cjs electron/test/bridge-live-events.test.cjs` と `npm run test:bridge` / Expected: PASS（`test:bridge` は 15/15）。
- [ ] **Step 5: コミット** — `git commit -m "BRIDGE: 読み上げの設定が壊れていても、写しか userData 側を使い、読み上げを切ったままにする"`

### Task 4: ギフト一覧の画面の設定を共通の関数で読み書きする

**Files:**
- Modify: `electron/gifts_viewer.cjs:10-14・211-225`、`electron/main.cjs:99`（`recordRecovery` を渡す）
- Test: Modify `electron/test/gifts-viewer-module.test.cjs`

**Interfaces:**
- Consumes: `createSafeJsonFile`（Task 1）。
- Produces: `createGiftsViewer({ …今の引数, recordRecovery?: (entry) => void, now?: () => Date })`。中で `createSafeJsonFile({ file: getGvSettingsPath, defaults: () => ({ username: "" }), problem: value => value.username !== undefined && typeof value.username !== "string" ? "項目 username の型が違う" : "", record: recordRecovery, now })` を作り、`gv:settings:read` は `read()`、`gv:settings:write` は確かめてから `write({ username: … })`。

- [ ] **Step 1: テストを書く**（`setup` に `recordRecovery` と `now` を足す）
  - `ギフト一覧の画面の設定: 壊れていたら写しから戻す。写しも無ければ TikTok ID が空` — 2回保存して `'{壊れた'` にすると、`gv:settings:read` が写しの値。写しも消して `'{"username":3}'` にすると `{ username: '' }`、記録の理由は「項目 username の型が違う」。
  - `ギフト一覧の画面の設定: 書くと写しを残す` — 2回保存すると `.last-good` が1回目の値。
  - `本文: ギフト一覧の画面の設定を fs で直接読み書きしない` — `gifts_viewer.cjs` の `gv:settings:read`・`gv:settings:write` の中に `writeFileSync`・`readFileSync` が無い。`main.cjs` の `createGiftsViewer(` に `recordRecovery:` がある。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/gifts-viewer-module.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/gifts-viewer-module.test.cjs electron/test/app-regressions.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "ギフト一覧の画面の設定: 壊れていたら写しから戻す"`

### Task 5: HANDOFF と全体の確かめ

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「設定の既定値と設定ファイルの破損」の節に PR2：計画・やったこと・決めたこと 1〜7・確かめの結果・リリースノートに足すこと・次は PR3）

リリースノートに足すこと：
- 「読み上げの設定とギフト一覧の画面の設定のファイルが壊れていたら、前の正しい状態に自動で戻します。BRIDGE の読み上げの設定が壊れていて戻せないときも、アプリ側の設定を使うので、読み上げを切っていたのに読み上げが始まることはありません」

- [ ] **Step 1: 全部を動かす** — Run: `npm run verify` / Expected: exit 0。
- [ ] **Step 2: HANDOFF を書く**
- [ ] **Step 3: コミット** — `git commit -m "HANDOFF: 設定ファイルの PR2"`
