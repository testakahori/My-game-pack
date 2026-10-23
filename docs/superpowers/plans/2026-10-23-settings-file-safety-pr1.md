# 設定ファイルが壊れても消えないようにする PR1（共通の関数・アプリの設定・ログインの確かめ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 守るファイルの読み書きを1つの共通の関数にまとめ、まずアプリの設定（`userData/app-config.json`）を、壊れていたら前の正しい状態の写しから黙って戻し、壊れたファイルを残して記録するようにする。あわせて、ログイン状態の確かめが失敗したときに画面がログイン済みとして通すのを直す。

**Architecture:** 共通の関数は `bridge/safe_json_file.cjs` に置く（PR2 で BRIDGE も読み上げの設定に使うため。設計書 5.4）。書くのは一時ファイル＋fsync＋差し替え、書く前に今の正しい中身を `<名前>.last-good` に写す。読むときに壊れていたら `<名前>.broken-<時刻>` に残し、写しから戻す（写しも無ければ既定値）。記録は main の `electron/settings_recovery_log.cjs` が `userData/logs/settings-recovery.log` に書く。アプリの設定の既定値と項目の型は `electron/app_config_fields.json` の1か所に置き、main と型の宣言（`src/types/electron.d.ts`）がそれを使う。

**Tech Stack:** Electron（`electron/*.cjs`）、`bridge/*.cjs`（electron は `../bridge/…` から読む）、React + TypeScript（`src/`）、node:test、esbuild（画面の TS のテスト）。

**Spec:** `docs/superpowers/specs/2026-10-23-settings-file-safety-design.md`（ユーザー承認 2026-10-23）。この計画は 5（共通の決まり）・6.1（アプリの設定）・7（ログインの確かめ）・9 のうちアプリの設定の分。

## PR の分け方（設計書 10。私が決めた）

- **PR1（この計画）**：共通の関数・記録・アプリの設定・設定のバックアップがアプリの設定を読む所・ログインの確かめ。
- PR2（別の計画）：読み上げの設定（2か所。BRIDGE も）・ギフト一覧の画面の設定。
- PR3（別の計画）：ギフト設定・ゲームの切り替えの記録・6.6 の「今のゲーム」の確かめ・ギフト設定が読めなくても止まらない操作。

## Global Constraints

- 写しの名前は `<元の名前>.last-good`、壊れたファイルの名前は `<元の名前>.broken-YYYYMMDD-HHMMSS`（端末の時刻。同じ名前があれば `-2`・`-3`…と足す）。どちらも元のファイルと同じフォルダー。
- 記録は `userData/logs/settings-recovery.log`。1行 `YYYY-MM-DD HH:MM:SS.mmm <記録の文>`（時刻の形は `logs/stop-requests.log` と同じ）。256KB を超えたら後ろ半分を残す（停止の記録と同じ）。記録できなくても読み書きは止めない。
- 記録の文（`describeRecovery`。<名前> は `path.basename`）：
  - 写しから戻したとき「<名前> が壊れていた（<理由>）ので、前の正しい状態の写しから戻した。壊れたファイル: <壊れたファイルの名前>」
  - 既定値のとき「<名前> が壊れていた（<理由>）。前の正しい状態の写しが無い（または壊れている）ので、既定値で動く。壊れたファイル: <壊れたファイルの名前>」
- 理由の文（この順に確かめる）：「ファイルを読めない（<エラーの code>）」「JSON として読めない」「オブジェクトでない」、項目の型の違いは「項目 <名前> の型が違う」。
- アプリの設定の既定値は今のまま `{ "serverFolder": "", "setupComplete": false }`。項目ごとの暗黙の既定（`paths.cjs` など）も変えない。
- 画面には何も出さない（ユーザーの決定）。新しい ipc の窓口は作らない。
- 開発用のブラウザー表示（`src/lib/devApiMock.ts`）は変えない。設定のバックアップにログインを入れないことも変えない。
- コメントは周りに合わせて日本語。
- 守っているファイル（`docs-css-safe` の見張り）に「バックスラッシュのあとに 16 進の字」（例: バックスラッシュと 0、バックスラッシュと b5）を書かない。0 の並んだファイルは `Buffer.alloc(8)` で作る。
- Edit で行の終わりの空白を落とさない。Bash の heredoc・`node -e "..."` ではバックスラッシュが崩れるので、バックスラッシュを含むものは Write か Edit で書く。
- 新しいテストは、直す前のコードで落ちることを確かめる（AGENTS.md）。

## 決めたこと（違っていれば直す）

1. 共通の関数は `bridge/safe_json_file.cjs` に置き、`package.json` の `build.files` に足す（electron が読む bridge のモジュールは `electron/test/config-schema.test.cjs:72` が見張る）。
2. 今の `atomicWrite`（`electron/settings_backups.cjs`）は名前と export を残し、中身を共通の `writeFileDurable`（fsync 付き）にする。ギフト設定・ゲームの切り替えの記録など、`atomicWrite` を使うほかの書く所も全部 fsync 付きになる。
3. ファイルが無いときは「無い」として既定値にし、写しがあっても戻さない（配信者が自分で消したときは初めからにしたいはずなので）。
4. 「読めない」は、無いとき（ENOENT）以外の読み込みのエラーも含める（設計書 5.2）。壊れたファイルを名前を変えても写しても残せないときは、元のファイルに触らずにエラーを投げる（上書きで失わないことを優先する）。→ 最後のレビュー（重要 1）で変えた：読むのは投げずに、ファイルに触らず写しの値（または既定値）で動き、書くときだけエラーにする。戻す順も「壊れた中身を先に別の名前へ写し、そのあと元の場所を写しの中身に差し替える」にして、元の場所が空く時間をなくした。同じ壊れたファイルは、このプロセスの間は1回だけ残して記録する。
5. ファイルの先頭の BOM は外して読む（メモ帳などで保存したファイルを壊れていると扱わない）。
6. アプリの設定を読むと、既定値の上にファイルの中身を重ねたものを返す（今はファイルがあると中身だけを返す。使う所はどれも「無い」と既定値を同じに扱うので、動きは変わらない。型の宣言の `serverFolder`・`setupComplete` が必ずあるとおりになる）。
7. 項目の型の表は JSON に「その型の見本の値」（文字列は `""`、真偽は `false`）で書き、型の宣言は `typeof import(…)` でそこから型を取る。画面が書ける項目・画面に渡さない項目の名前は型の宣言にも並べ、表と同じかをテストで見張る（JSON の配列からは型の名前を取り出せないため）。
8. 表に無い項目は確かめない（そのまま残す）。過去の版で書いた項目と値は git の履歴で確かめた（どれも表の型のまま）。
9. 設定のバックアップから戻すときのアプリの設定の書き込みは、今のまま `atomicWrite` で書く（戻す処理が書いた順に元へ戻す仕組みを持つため）。そのときは写しを更新しないが、次の保存で更新される。
10. ログイン状態は、`authStatus` が `authenticated: true` を返したときだけ通す。

## Review Focus

1. 今の配信者の PC にある正しいアプリの設定（ログイン済み、今までに書いた全部の項目）を更新後に読んでも、壊れていると扱わず、戻しも記録もしない → Task 3 のテスト。
2. 更新した直後（写しがまだ無い）に壊れていた → 既定値で動き、壊れたファイルは残り、その後の保存でも上書きされない → Task 3 のテスト。
3. 同じ秒に2回壊れた → 壊れたファイルの名前が重ならず、前のものを上書きしない → Task 1 のテスト。
4. 記録のファイルを書けない（`logs` がファイルになっている）→ アプリの設定は読める → Task 2・Task 3 のテスト。
5. 一度戻したあと、アプリが何度もアプリの設定を読む（`getServerRoot` などから） → 記録は1回だけ、毎回戻したりしない → Task 3 のテスト。

---

### Task 1: 共通の関数 `bridge/safe_json_file.cjs`

**Files:**
- Create: `bridge/safe_json_file.cjs`
- Modify: `electron/settings_backups.cjs:19-26`（`atomicWrite` を `writeFileDurable` にする）、`package.json` の `build.files`（`"bridge/safe_json_file.cjs"` を足す）
- Test: Create `electron/test/safe-json-file.test.cjs`

**Interfaces:**
- Produces:
  - `writeFileDurable(file: string, content: string | Buffer): void` — 親のフォルダーを作り、`<file>.<uuid>.tmp` に書いて `fs.fsyncSync` してから閉じ、`fs.renameSync` で差し替える。失敗したら一時ファイルを消して投げる。`fs` の関数は `fs.fsyncSync(…)` の形で呼ぶ（テストで差し替えるため。分割代入しない）。
  - `lastGoodPath(file: string): string` — `${file}.last-good`。
  - `describeRecovery(entry: RecoveryEntry): string` — Global Constraints の文。
  - `createSafeJsonFile({ file, defaults, problem, record, now }): { read(): object, write(value: object): void }`
    - `file: () => string`、`defaults: () => object`（呼ぶたびに新しいオブジェクト）、`problem?: (value: object) => string`（正しければ `""`）、`record?: (entry: RecoveryEntry) => void`（投げても読み書きは止めない）、`now?: () => Date`（既定は今の時刻）。
  - `RecoveryEntry = { file: string; reason: string; action: "restored" | "defaults"; brokenFile: string }`（`file`・`brokenFile` は絶対パス）。
- 決まり（`read`）：
  1. 無い（ENOENT）→ `defaults()`。記録しない。
  2. 先頭の BOM を外して `JSON.parse` し、Global Constraints の順に理由を決める（`problem` は最後）。理由が無ければその値を返す。
  3. 壊れていたら、壊れたファイルを `<file>.broken-…` に `fs.renameSync` する。できなければ読めたバイトをその名前へ `writeFileDurable` する。どちらもできなければ `Error("<名前> が壊れていて、別の名前で残せません（<理由>）")` を投げる（元のファイルは触らない）。（最後のレビューで変えた：決めたこと 4 の矢印のあと）
  4. 写し（`lastGoodPath`）を同じ決まりで読む（写しが無い・壊れているときは、写しの名前を変えず消さない）。正しければ、そのバイトを `writeFileDurable(file, …)` で書き戻し、`action: "restored"` を記録して、その値を返す。
  5. 写しが使えなければ `action: "defaults"` を記録して `defaults()` を返す（元の場所は空いたまま）。
- 決まり（`write`）：今のファイルを `read` と同じ決まりで調べる（壊れていれば `read` と同じく残して戻し、記録する）。今のファイルが初めから正しかったときだけ、そのバイトを `writeFileDurable(lastGoodPath(file), …)` で写しにする。そのあと `writeFileDurable(file, JSON.stringify(value, null, 2))`。

- [ ] **Step 1: テストを書く**（`electron/test/safe-json-file.test.cjs`。一時フォルダーに `x.json`、`now: () => new Date(2026, 9, 23, 15, 30, 12)`、`problem: v => typeof v.a === 'number' ? '項目 a の型が違う' : ''`、`record` は配列に積む）
  - `書く: 一時ファイルに書いて fsync してから差し替え、一時ファイルを残さない` — `fs.fsyncSync`・`fs.renameSync` を包んで呼んだ順を積み、`['fsync', 'rename']`。中身が書いたとおり。フォルダーに `.tmp` が残らない（finally で元に戻す）。
  - `atomicWrite は writeFileDurable と同じもの` — `require('../settings_backups.cjs').atomicWrite === require('../../bridge/safe_json_file.cjs').writeFileDurable`。
  - `読む: 無いときは既定値で、写しがあっても使わず、記録しない`
  - `読む: 正しいファイルはそのまま。先頭に BOM があっても読める`
  - `読む: 壊れた中身ごとに、写しから戻し、壊れたファイルを名前を変えて残し、1行記録する` — 写しは `{"a":"good"}`。`''`・`'{"a":'`・`Buffer.alloc(8)` →「JSON として読めない」、`'null'`・`'[]'`・`'3'`・`'"x"'` →「オブジェクトでない」、`'{"a":1}'` →「項目 a の型が違う」。それぞれ `read()` が `{ a: 'good' }`、`x.json` の中身が写しと同じバイト、`x.json.broken-20261023-153012` が元のバイト、記録は1つで `{ file, reason, action: 'restored', brokenFile }`。
  - `読む: 写しが無い・写しも壊れているときは既定値。壊れたファイルは残し、写しは消さない` — 記録の `action` は `'defaults'`、`x.json` は無い、壊れた写しはそのまま。
  - `読む: 同じ秒に2回壊れても、前の壊れたファイルを上書きしない` — 2つ目は `x.json.broken-20261023-153012-2`、1つ目の中身はそのまま。
  - `読む: 名前を変えられないときは中身を写して残す。それもできなければ投げて、元のファイルを触らない` — `fs.renameSync` を1回だけ EPERM にすると、壊れたファイルは写しで残る。いつも EPERM にすると `/別の名前で残せません/` で投げ、`x.json` は元のバイトのまま。
  - `書く: 正しく読めた中身だけを写しにする` — `write({a:'1'})`（前は無い）→ 写し無し。`write({a:'2'})` → 写しは `{a:'1'}`。`x.json` を `'{壊れた'` にして `write({a:'3'})` → 壊れたファイルが残り、写しは `{a:'1'}` のまま（壊れた中身で上書きしない）、`x.json` は `{a:'3'}`。
  - `記録が投げても、読み書きは止めない`
  - `記録の文` — 2つの `action` の文が Global Constraints のとおり。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/safe-json-file.test.cjs` / Expected: FAIL（`Cannot find module '../../bridge/safe_json_file.cjs'`）。
- [ ] **Step 3: 作る** — `bridge/safe_json_file.cjs` を作り、`settings_backups.cjs` の `atomicWrite` を `const { writeFileDurable: atomicWrite } = require("../bridge/safe_json_file.cjs")` にする（export の名前は今のまま）。`build.files` に足す。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/safe-json-file.test.cjs electron/test/settings-safety.test.cjs electron/test/config-schema.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git add bridge/safe_json_file.cjs electron/settings_backups.cjs package.json electron/test/safe-json-file.test.cjs` / `git commit -m "設定ファイル: 壊れても消えない読み書きの共通の関数"`

### Task 2: 記録 `electron/settings_recovery_log.cjs`

**Files:**
- Create: `electron/settings_recovery_log.cjs`
- Modify: `electron/stop_requests.cjs:77`（`localTime`・`trimToRecentHalf` を export に足す）
- Test: Create `electron/test/settings-recovery-log.test.cjs`

**Interfaces:**
- Consumes: `describeRecovery`（Task 1）、`localTime`・`trimToRecentHalf`（`stop_requests.cjs`）。
- Produces: `createSettingsRecoveryLog({ file: () => string, now?: () => Date, maxBytes?: number }): { record(entry: RecoveryEntry): void }` — `maxBytes` の既定は `256 * 1024`。フォルダーを作り、切り詰めてから1行書き足す。投げない。

- [ ] **Step 1: テストを書く**
  - `1行に時刻と記録の文を書き足す` — `now: () => new Date(2026, 9, 23, 15, 30, 12)` で2回記録すると2行。1行目は `2026-10-23 15:30:12.000 app-config.json が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。壊れたファイル: app-config.json.broken-20261023-153012`。
  - `書けなくても投げない` — `logs` を同じ名前のファイルにしておく。
  - `大きくなったら古い行を切る` — `maxBytes: 200` で何回も記録すると、ファイルは 200 バイト以下になり、最後の行が残る。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/settings-recovery-log.test.cjs` / Expected: FAIL（モジュールが無い）。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/settings-recovery-log.test.cjs electron/test/stop-requests.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "設定ファイル: 壊れていたことを logs/settings-recovery.log に残す"`

### Task 3: アプリの設定を共通の関数で読み書きする

**Files:**
- Create: `electron/app_config_fields.json`
- Modify: `electron/app_config.cjs:6-35`（項目の表・読む・書く）、`electron/main.cjs:8-27`（記録を作り、`recordRecovery` を渡す）
- Test: Modify `electron/test/app-config-module.test.cjs:42-54` と新しいテスト

**Interfaces:**
- Consumes: `createSafeJsonFile`（Task 1）、`createSettingsRecoveryLog`（Task 2）。
- Produces:
  - `electron/app_config_fields.json`（この中身。`fields` の値は型の見本で、既定値ではない）：
    ```json
    {
      "defaults": { "serverFolder": "", "setupComplete": false },
      "fields": {
        "serverFolder": "", "setupComplete": false, "setupRequiredByInstall": false, "setupRequiredAt": "",
        "minecraftPlayerName": "", "minecraftLauncherPath": "", "minecraftGameFolder": "", "autoBackupOnServerStart": false,
        "bridgeVersion": "", "gameModsVersion": "", "gameModsRefreshFailed": "", "gameModsRefreshError": "",
        "authEmail": "", "authToken": "", "authLoginAt": ""
      },
      "rendererWritable": ["serverFolder", "setupComplete", "setupRequiredByInstall", "minecraftPlayerName", "minecraftLauncherPath", "autoBackupOnServerStart"],
      "private": ["authEmail", "authToken", "authLoginAt"]
    }
    ```
  - `appConfigProblem(value: object): string` — `fields` の順に、ある項目（`undefined` でない）の型が見本と違えば「項目 <名前> の型が違う」（`null` も違う）。`module.exports` に足す。
  - `createAppConfig({ …今の引数, recordRecovery?: (entry) => void, now?: () => Date })`。`readAppConfig()` は `{ ...defaults, ...ファイルの中身 }`。`writeAppConfig(data)` は今のとおり重ねて `serverFolder` を絶対パスにし、共通の `write` で書く。`RENDERER_APP_CONFIG_FIELDS` は `rendererWritable`、`sanitizeRendererAppConfigUpdate` の真偽の項目は `fields` の見本が真偽のもの、`readPublicAppConfig` が外す項目は `private` から作る。

- [ ] **Step 1: テストを書く**（`app-config-module.test.cjs`。`setup` に `recordRecovery` を配列に積むものと `now` を足す）
  - 今の `読み込み: ファイルがない・壊れているときは既定値…` を直す：壊れたファイル（`'{壊れた'`）は既定値で読み、`app-config.json.broken-…` が元の中身で残り、そのあと `writeAppConfig` しても壊れたファイルは残る（今のテストは上書きを決めていた。設計書 9）。
  - `壊れていたら、前の正しい状態の写しから戻す。ログインも戻る` — ログイン（`authEmail`・`authToken`・`authLoginAt`）と `serverFolder` を保存し、もう1回保存してから壊すと、読んだ値はログインと `serverFolder` を持ち、記録は1つ（`action: 'restored'`）。
  - `壊れている: 中身が null・配列、表の項目の型の違い。表に無い項目は確かめない` — `'null'`・`'[]'`・`'{"serverFolder":3}'`・`'{"setupComplete":"yes"}'`・`'{"authToken":1}'`・`'{"minecraftPlayerName":null}'` は壊れている（記録の理由が「オブジェクトでない」か「項目 <名前> の型が違う」）。`'{"serverFolder":"x","somethingElse":3}'` は壊れていない。
  - `今まで書いたことのある形のファイルは、壊れていると扱わない` — `fields` の全部の項目に本物らしい値（`serverFolder` は一時フォルダー、`setupComplete: true`、`setupRequiredAt` は ISO の時刻、`bridgeVersion: '1.0.50'`、`gameModsRefreshFailed: ''`、ログイン済みなど）を入れたファイルを読むと、中身がそのまま返り、記録も壊れたファイルも無い。
  - `一度戻したら、次に読むときは戻さず、記録しない` — 壊してから3回読むと、記録は1つ。
  - `中身が null でも、ログインの確かめは「ログインしていない」` — `createOperatorAuth({ readAppConfig, writeAppConfig })` の `auth:status` が `{ authenticated: false, email: '' }`（今は投げる）。
  - `記録のファイルを書けなくても、アプリの設定は読める` — `recordRecovery` が投げても `readAppConfig()` は写しの値。
  - `本文: アプリの設定を fs で直接読み書きせず、既定値は表の1か所` — `app_config.cjs` に `writeFileSync`・`readFileSync`・`serverFolder: ""` が無く、`require("./app_config_fields.json")` と `createSafeJsonFile(` がある。`main.cjs` に `createSettingsRecoveryLog(`・`"settings-recovery.log"`・`recordRecovery:` がある。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/app-config-module.test.cjs` / Expected: FAIL（壊れたファイルが残らない・写しから戻らない・`auth:status` が投げる など）。
- [ ] **Step 3: 作る** — `main.cjs` は `stopRequests` の隣に `const settingsRecovery = createSettingsRecoveryLog({ file: () => path.join(app.getPath("userData"), "logs", "settings-recovery.log") });` を置き、`createAppConfig` に `recordRecovery: entry => settingsRecovery.record(entry)` を渡す。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/app-config-module.test.cjs electron/test/operator-auth-module.test.cjs electron/test/file-size-limits.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "アプリの設定: 壊れていたら前の正しい状態の写しから戻し、壊れたファイルを残す"`

### Task 4: 型の宣言を表に合わせる

**Files:**
- Modify: `src/types/electron.d.ts:200-217`
- Test: Modify `electron/test/app-config-module.test.cjs`（新しいテスト）

**Interfaces:**
- Consumes: `electron/app_config_fields.json`（Task 3）。
- Produces（`electron.d.ts`）：
  - `type AppConfigTable = typeof import("../../electron/app_config_fields.json");`
  - `export type AppConfigFields = AppConfigTable["fields"];`
  - `type AppConfigPrivateKey = "authEmail" | "authToken" | "authLoginAt";`
  - `type AppConfigWritableKey = "serverFolder" | "setupComplete" | "setupRequiredByInstall" | "minecraftPlayerName" | "minecraftLauncherPath" | "autoBackupOnServerStart";`
  - `appConfigRead: () => Promise<AppConfigTable["defaults"] & Partial<Omit<AppConfigFields, AppConfigPrivateKey>>>;`
  - `appConfigWrite: (data: Partial<Pick<AppConfigFields, AppConfigWritableKey>>) => Promise<{ ok: true }>;`

- [ ] **Step 1: テストを書く** — `型の宣言は表を使い、画面が書ける項目・画面に渡さない項目が main と同じ`：`electron.d.ts` に `typeof import("../../electron/app_config_fields.json")` がある。`AppConfigWritableKey` と `AppConfigPrivateKey` の `"…"` の並びを取り出すと、表の `rendererWritable`・`private` と同じ集まり。`appConfigRead` から `appConfigWrite` の終わりまでに、手で書いた `serverFolder: string;`・`setupRequiredAt: string;` が無い。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/app-config-module.test.cjs` / Expected: FAIL（`typeof import` が無い）。
- [ ] **Step 3: 作る** — 今の手で書いた2つの型を、上の形に置き換える。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/app-config-module.test.cjs` と `npm run typecheck` / Expected: どちらも PASS（型のエラーが出たら、使う側の書き方を直す。型を `any` にして逃げない）。
- [ ] **Step 5: コミット** — `git commit -m "アプリの設定: 型の宣言を項目の表から取る"`

### Task 5: 設定のバックアップがアプリの設定を共通の読み方で読む

**Files:**
- Modify: `electron/settings_backups.cjs:49・137`（`fs.existsSync(p.app) ? read(p.app) : {}` を `deps.readApp()` にする）、`electron/main.cjs:71-80`（`readApp: () => readAppConfig()` を渡す）
- Test: Modify `electron/test/settings-safety.test.cjs:21`（`fixture` の `deps` に `readApp: () => fs.existsSync(p.app) ? read(p.app) : {}`）と新しいテスト

**Interfaces:**
- Consumes: `createSafeJsonFile`・`lastGoodPath`（Task 1）。
- Produces: `createSettingsBackups(deps)` の `deps.readApp: () => object`（なくてはならない）。

- [ ] **Step 1: テストを書く** — `アプリの設定が壊れていても、写しから戻して、バックアップを取れて戻せる。ログインは残る`：`const appFile = createSafeJsonFile({ file: () => p.app, defaults: () => ({}) })` を作って `deps.readApp` を `() => appFile.read()` にし、`lastGoodPath(p.app)` に今の `p.app` の中身を写してから `p.app` を `'{壊れた'` にする。`store.create()` が成り立ち、その `preferences.autoBackupOnServerStart` は `true`。`store.restore(id)` のあと、`p.app` は `authToken: 'private-login'` を持つ。本文：`settings_backups.cjs` に `read(p.app)` が無い。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/settings-safety.test.cjs` / Expected: FAIL（`create` が JSON のエラーで投げる）。
- [ ] **Step 3: 作る**
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/settings-safety.test.cjs electron/test/app-config-module.test.cjs` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "設定のバックアップ: アプリの設定を、壊れていたら戻す読み方で読む"`

### Task 6: ログイン状態の確かめが失敗したらログイン画面を出す

**Files:**
- Create: `src/lib/authState.ts`
- Modify: `src/App.tsx:116-126`
- Test: Create `electron/test/ui-auth-state.test.cjs`（`ui-tiktok-id.test.cjs` と同じく esbuild の `transformSync` で TS を読む）

**Interfaces:**
- Produces: `readAuthState(api: { authStatus?: () => Promise<{ authenticated?: unknown } | undefined> } | undefined): Promise<"authed" | "unauthed">` — `authenticated === true` のときだけ `"authed"`。投げたとき・窓口が無いときは `"unauthed"`。

- [ ] **Step 1: テストを書く**
  - `ログイン状態: 確かめが失敗したらログイン画面` — `authStatus` が reject すると `'unauthed'`。
  - `ログイン状態: authenticated が true のときだけ通す` — `true` は `'authed'`、`'yes'`・`1`・`undefined`・状態そのものが `undefined` は `'unauthed'`。
  - `ログイン状態: 窓口が無いときもログイン画面` — `api` が `undefined`・`{}` は `'unauthed'`。
  - `本文: App.tsx は readAuthState を使い、ログイン済みにするのはログインに成功したときだけ` — `App.tsx` に `readAuthState(` があり、`setAuthState("authed")` は1回だけ（`onLoginSuccess`）。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/ui-auth-state.test.cjs` / Expected: FAIL（`src/lib/authState.ts` が無い）。
- [ ] **Step 3: 作る** — `App.tsx` の確かめは `setAuthState(await readAuthState(api))` にし、「旧preload等ではブロックせず通す」の catch を消す。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/ui-auth-state.test.cjs` と `npm run typecheck` / Expected: PASS。
- [ ] **Step 5: コミット** — `git commit -m "ログイン: 状態を確かめられないときはログイン画面を出す"`

### Task 7: HANDOFF と全体の確かめ

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「次の大きい問題」の「設定の既定値と設定ファイルの破損」に、設計書・この計画・PR1 のやったこと・決めたこと 1〜10・確かめの結果・リリースノートに足すこと・次は PR2 を書く）

リリースノートに足すこと：
- 「アプリの設定（ログイン・サーバーのフォルダーなど）のファイルが壊れていたら、前の正しい状態に自動で戻します。壊れたファイルは別の名前で残し、logs/settings-recovery.log に記録します」
- 「ログイン状態を確かめられないときは、ログイン画面を出します」

- [ ] **Step 1: 全部を動かす** — Run: `npm run verify` / Expected: exit 0（typecheck・test:bridge・test:app・build がすべて通る）。
- [ ] **Step 2: HANDOFF を書く**
- [ ] **Step 3: コミット** — `git commit -m "HANDOFF: 設定ファイルの PR1"`
