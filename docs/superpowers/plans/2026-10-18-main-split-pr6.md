# main.cjs の分割 PR6（仕上げ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分割の最後の PR。行数の見張りテストを足し、テストに残った「main の中の式の写し」（ゲームの選択の記録の場所）をなくし、main.cjs の残りを整え、AGENTS.md を分けたあとの形に書き直す（アプリの動きは変えない）。

**Architecture:** PR1〜PR5 で main.cjs は 218 行の配線だけになった。PR6 はコードを移さない。行数の見張りは `electron/test/` のテストにして、`npm run verify`（CI）で止める。ゲームの選択の記録の場所は `games_ipc.cjs` が関数で出し、テストの `loadApp` はそれを呼ぶ。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（テストでは偽物の electron を vm で渡す）。

**Spec:** docs/superpowers/specs/2026-10-17-main-split-design.md

## Global Constraints

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。`electron/preload.cjs` と `src/` は変えない。ipc の窓口の一覧のテスト（116個と3個）はそのまま通ること。
- 行数の上限（設計書 6）：`electron/main.cjs` は 400 行以下、`electron/*.cjs` の各ファイルは 800 行以下。超えたら CI で止まる。超えそうなときは、足す前に分ける。
- 行数は `wc -l` と同じ数え方（改行の数。最後の行に改行がなければ1を足す）。CRLF も LF も同じ数になること。
- 見張るのは `electron/` の直下の `.cjs` だけ（`electron/test/` などの下のフォルダーと、`.cjs` 以外は見ない）。ファイルの一覧は固定せず、毎回フォルダーを読む（新しいモジュールも自動で入る）。
- ゲームの選択の記録の場所の式（`userData/game-profiles/<path.resolve(サーバーの場所) の sha256 の先頭16文字>`）は変えない。変えると、更新したあと今の記録が見つからなくなる。
- 例外（設計書 2）：テストで確かめるために戻り値を足すのはよい（`games_ipc.cjs` の `getGameProfilesDir`）。分ける前から使われていない読み込み（main.cjs の `validCommand`）は消してよい。
- AGENTS.md の「巨大なファイル」の一覧から `electron/main.cjs` を外し、分けたファイルの一覧を足す（設計書 5 の 6）。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `refactor/main-split-6`（origin/main の 1121925 から切った）。行番号はすべて 1121925。
- 文書に Windows の場所を書くときは `/` 区切りにする（`\` と16進数が続くと `npm run build` が止まる）。git は PowerShell で行い、`git add` の前に `git hash-object -w <file>` を通す。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない。Write でファイルにしてから実行する。PowerShell の `Select-String` で残りを探すときは `-CaseSensitive` を付ける。
- コメントと文書は周りと同じく日本語。既存ファイルの改行（CRLF）は変えない。

## Review Focus

1. 行数の数え方が CRLF・最後の改行なしでも `wc -l` と合い、上限ちょうど（400行・800行）は通り、1行でも超えたら落ちること → Task 1 の作り物のフォルダーのテストで確かめる。
2. 見張りが `electron/` の直下の `.cjs` を毎回読み、新しく足したモジュールも見ること（一覧の固定で漏れない）。`electron/test/` の下の大きいテストファイルは見ないこと → Task 1 の作り物のフォルダーのテストで確かめる。
3. 落ちたときの文で、どのファイルが何行で上限はいくつか、どうすればよいか（足す前に分ける）が分かること → Task 1 の作り物のフォルダーのテストで、出す文を確かめる。
4. 更新したあとも、今のゲームの選択の記録が同じ場所から読まれること（式が変わっていない） → Task 2 のモジュールのテストで、式を書き下して確かめる。
5. main.cjs から消した読み込み（`validCommand`）と書き直したコメントで、起動・配線が変わらないこと → Task 4 の `npm run verify` と、本物の Electron での読むだけの確かめで確かめる。

---

### Task 1: 行数の見張りテスト

**Files:**
- Create: `electron/test/file-size-limits.test.cjs`

**Interfaces:**
- Consumes: なし。
- Produces: テストファイルの中の `lineCount(text): number` と `oversizedFiles(dir): Array<{ file: string, lines: number, limit: number }>`（`dir` の直下の `.cjs` を名前の順に見て、上限を超えたものだけを返す。上限は `main.cjs` が 400、ほかが 800）。Task 3 の AGENTS.md と main.cjs の冒頭のコメントが、このファイルの名前を書く。

- [ ] **Step 1: テストを書く**

`electron/test/file-size-limits.test.cjs`（`lineCount`・`oversizedFiles` もこのファイルの中に書く）:

```js
// main.cjs を分けたあとの行数の見張り（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md の 6）。
// main.cjs は 400 行以下、electron/ の直下のほかの .cjs は各 800 行以下。超えそうなときは、足す前に分ける（AGENTS.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// lineCount・oversizedFiles をここに書く（Interfaces のとおり）。

test('行数の見張り: electron/main.cjs は 400 行以下、electron/ の直下のほかの .cjs は各 800 行以下', () => {
  const over = oversizedFiles(path.resolve(__dirname, '..'));
  assert.deepEqual(over, [], over.map(x => `electron/${x.file} は ${x.lines} 行（上限 ${x.limit} 行）。足す前に、仕事ごとのファイルに分けてください（AGENTS.md）。`).join('\n'));
});

test('行数の見張り: 数え方は wc -l と同じ（CRLF・最後の改行なしも）。上限ちょうどは通し、超えたファイルだけを名前の順に出す。下のフォルダーと .cjs 以外は見ない', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-size-limits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lines = (n, eol = '\r\n', last = true) => Array.from({ length: n }, (_, i) => `// ${i}`).join(eol) + (last ? eol : '');
  assert.equal(lineCount(lines(3)), 3);
  assert.equal(lineCount(lines(3, '\n')), 3);
  assert.equal(lineCount(lines(3, '\r\n', false)), 3);
  assert.equal(lineCount(''), 0);
  fs.writeFileSync(path.join(dir, 'main.cjs'), lines(401));
  fs.writeFileSync(path.join(dir, 'big.cjs'), lines(801, '\n', false));
  fs.writeFileSync(path.join(dir, 'edge.cjs'), lines(800));
  fs.writeFileSync(path.join(dir, 'new_module.cjs'), lines(900));
  fs.writeFileSync(path.join(dir, 'notes.md'), lines(5000));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'huge.test.cjs'), lines(5000));
  assert.deepEqual(oversizedFiles(dir), [
    { file: 'big.cjs', lines: 801, limit: 800 },
    { file: 'main.cjs', lines: 401, limit: 400 },
    { file: 'new_module.cjs', lines: 900, limit: 800 },
  ]);
  fs.writeFileSync(path.join(dir, 'main.cjs'), lines(400));
  assert.equal(oversizedFiles(dir).some(x => x.file === 'main.cjs'), false, '400 行ちょうどは通す');
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/file-size-limits.test.cjs`
Expected: PASS（2件。今の main.cjs は 218 行、いちばん大きい `bridge_sync.cjs` は 664 行）。

- [ ] **Step 3: 本物のファイルで落ちることを確かめる**

scratchpad の `pr6-guard/electron/` に、作業コピーの `electron/*.cjs` と `electron/test/file-size-limits.test.cjs`（`test/` の下へ）を写し、写した `main.cjs` の最後に `// pad` の行を 200 行足して `node --test <scratchpad>/pr6-guard/electron/test/file-size-limits.test.cjs` を動かす。
Expected: 1件目が FAIL し、文に `electron/main.cjs は 418 行（上限 400 行）。足す前に、仕事ごとのファイルに分けてください（AGENTS.md）。` が出る。作業コピーは変えない。

- [ ] **Step 4: commit**

```powershell
git add electron/test/file-size-limits.test.cjs
git commit -F <メッセージのファイル>   # 「test: main.cjs は 400 行、electron/*.cjs は 800 行を超えたら止める」
```

---

### Task 2: ゲームの選択の記録の場所を `games_ipc.cjs` から出す

設計書 6 の「テストが中の変数を書き換えている所」の5つ目。今のテストの `loadApp` は、記録の場所の式（sha256 の先頭16文字）を main の `path`・`crypto` で写して計算している。式の持ち主（`games_ipc.cjs`）から読むようにする。

**Files:**
- Modify: `electron/games_ipc.cjs:20-21`（`storage` の式を名前のある関数にする）・`:111`（戻り値）
- Modify: `electron/test/games-ipc-module.test.cjs`（`setup` の戻り値に `root`・`server` を足す、テスト1件）
- Modify: `electron/test/app-regressions.test.cjs:72`（`loadApp` の `fixtureGameState`）

**Interfaces:**
- Consumes: なし。
- Produces: `createGamesIpc(...)` の戻り値に `getGameProfilesDir(): string` を足す（`userData/game-profiles/<path.resolve(getServerRoot()) の sha256 の先頭16文字>`）。`createGameProfiles` の `storage` にはこの関数を渡す。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/games-ipc-module.test.cjs` の `setup` の戻り値に `root`・`server` を足し、テストを足す:

```js
test('ゲームの選択の記録の場所: userData/game-profiles/<サーバーの場所の sha256 の先頭16文字>（式を変えると、更新したあと今の記録が見つからなくなる）', t => {
  const x = setup(t);
  const hash = require('node:crypto').createHash('sha256').update(path.resolve(x.server)).digest('hex').slice(0, 16);
  assert.equal(x.gamesIpc.getGameProfilesDir(), path.join(x.root, 'userData', 'game-profiles', hash));
});
```

- [ ] **Step 2: 動かす**

Run: `node --test --test-name-pattern="^ゲームの選択の記録の場所" electron/test/games-ipc-module.test.cjs`
Expected: FAIL（`x.gamesIpc.getGameProfilesDir is not a function`）。

- [ ] **Step 3: `getGameProfilesDir` を足し、`loadApp` をそれで書く**

- `games_ipc.cjs`：`storage` に書いていた式をそのまま `const getGameProfilesDir = () => ...` にして（コメント「ゲームの選択の記録の場所。テストが記録を用意するときにも使う」）、`storage: getGameProfilesDir` を渡し、戻り値に足す。
- `app-regressions.test.cjs` の `loadApp`：`context.fixtureGameState = path.join(vm.runInContext('gamesIpc.getGameProfilesDir()', context), 'profiles.json');` にする（`appliedRoots` はそのまま）。上のコメントは「場所は games_ipc が出し、書くのはテストの fs で行う」にする。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/games-ipc-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件）。
Run: `Select-String -CaseSensitive -Path electron/test/app-regressions.test.cjs -Pattern 'createHash'`
Expected: 何も出ない（テストに記録の場所の式の写しが残らない）。

- [ ] **Step 5: commit**

```powershell
git add electron/games_ipc.cjs electron/test/games-ipc-module.test.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: ゲームの選択の記録の場所を games_ipc から出し、テストの式の写しをなくす」
```

---

### Task 3: main.cjs の残りを整え、AGENTS.md を書き直す

**Files:**
- Modify: `electron/main.cjs:1`（冒頭のコメント）・`:10`（`validCommand`）・`:175-176`（`isAppBusy` のコメント）
- Modify: `AGENTS.md:39-43`（「書き方」の巨大なファイルの一覧）

**Interfaces:**
- Consumes: Task 1 のテストファイルの名前 `electron/test/file-size-limits.test.cjs`。
- Produces: なし。

- [ ] **Step 1: main.cjs を整える**

- 1行目 `// electron/main.cjs` を次の2行にする:
  ```js
  // electron/main.cjs：アプリの起動と終了、各モジュールを作って必要なものを渡す配線だけを持つ（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
  // 仕事の処理は electron/ の各モジュールに置く。main.cjs は 400 行以下、ほかの electron/*.cjs は各 800 行以下（electron/test/file-size-limits.test.cjs が見張る）。
  ```
- 10行目の `validCommand` を外す（分ける前から main で使われていない）: `const { createSettingsBackups } = require("./settings_backups.cjs");`
- `isAppBusy` の上のコメントの2行目（PR2 で後回しにした書き直し）を次にする:
  ```js
  // 名前のある関数にして、テストから作業ごとに確かめる（MAP・サーバーの起動と停止は差し替えて、初期セットアップ・ゲームの操作は本当に作業中にして）。
  ```

- [ ] **Step 2: AGENTS.md の「書き方」の1つ目を書き直す**

今の5行（「巨大なファイルに追記しません。…対象は次のファイルです。」と4つの一覧）を次にする（`bridge/index.js` の行数は今の 2,409 行に合わせる）:

```markdown
- 巨大なファイルに追記しません。新しい処理は小さなモジュールに分け、テストを付けます（例：`bridge/command_files.cjs`、`src/lib/*.ts`）。対象は次のファイルです。
  - `bridge/index.js`（約2,400行）
  - `src/components/DashboardPage.tsx`（約1,100行）
  - `src/index.css`（約7,500行）
- `electron/main.cjs` は、アプリの起動と終了、各モジュールの配線だけを持ちます（2026-10-17〜18 に分けました。設計書 `docs/superpowers/specs/2026-10-17-main-split-design.md`）。新しい ipc や処理は、その仕事を持つモジュールに足します。
  - 行数の上限：`electron/main.cjs` は 400 行、ほかの `electron/*.cjs` は各 800 行です。超えると `electron/test/file-size-limits.test.cjs` が落ち、CI で止まります。超えそうなときは、足す前に分けます。
  - モジュールは `createXxx(deps)` を1つだけ外に出し、ipc は `register(ipcMain)` で自分で登録します。`electron`・`child_process` は main だけが読み込んで渡します（テストの `loadApp` が偽物に差し替えるため）。
  - 作業中かを読む関数（`serverProcess.isStarting()`・`bridgeProcess.isActive()` など）は、分割代入で受けず、呼ばれたときにオブジェクトから読みます（テストが差し替えて配線を確かめるため）。
  - 分けたファイル（`electron/`）：
    - `paths.cjs`：配置の場所
    - `app_config.cjs`：アプリ設定と更新
    - `operator_auth.cjs`：運営ログイン
    - `window.cjs`：画面のウィンドウと CSP
    - `setup_ipc.cjs`：初期セットアップ・Forge・環境の実測・フォルダー選択
    - `games_ipc.cjs`：ゲームの選択・切り替え・Minecraft の保存先
    - `tts_ipc.cjs`：読み上げ
    - `bridge_settings.cjs`：BRIDGE の設定・ギフトの割り当て・テンプレート・配信前チェック・コマンド txt
    - `gifts_viewer.cjs`：ギフト一覧
    - `bridge_sync.cjs`：BRIDGE の配布・サーバーテンプレートのコピー・BRIDGE の展開
    - `server_process.cjs`：サーバーの起動・停止・ログ・状態
    - `map_operations.cjs`：MAP の保存・読込・プリセット
    - `server_files.cjs`：server.properties・RCON パスワード・配布ワールド・OP の付与・ゲームルール
    - `minecraft_client.cjs`：Minecraft の起動と稼働の確かめ
    - `bridge_process.cjs`：BRIDGE の起動・停止・再起動・ログ・状態、Euler の鍵、TikTok LIVE の確かめ
    - `bridge_mod_client.cjs`：BridgeMOD との通信・一時停止と再開・テスト発火の受け渡し
    - `operations_stats.cjs`：操作履歴・統計・配信の記録・ギフト案内画像
```

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/app-regressions.test.cjs electron/test/file-size-limits.test.cjs electron/test/docs-css-safe.test.cjs`
Expected: PASS（全件）。
Run: `Select-String -CaseSensitive -Path electron/main.cjs,AGENTS.md -Pattern 'validCommand|約2,900行|5つの作業ごと'`
Expected: 何も出ない。

- [ ] **Step 4: commit**

```powershell
git add electron/main.cjs AGENTS.md
git commit -F <メッセージのファイル>   # 「docs: main.cjs を配線だけにした仕上げと、AGENTS.md の分けたファイルの一覧」
```

---

### Task 4: 全体の確かめ・本物の Electron での確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番の「main.cjs の大きさ」）
- Create（git に入れない）: scratchpad の `e2e-pr6.cjs`（`e2e-pr5.cjs` を写し、冒頭のコメントだけ PR6 にする）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。test:app は 476件（473件＋この PR の3件）。

- [ ] **Step 2: 開発版を本物の Electron で起動し、画面の中から呼ぶ（読むだけ）**

- 先に electron と MyGamePack が動いていないかを見る。動いていたら、止めてよいかをユーザーに聞く。
- `e2e-pr6.cjs` で PR2〜PR5 で移した ipc 35個を呼ぶ（BRIDGE の起動・停止・テスト発火・一時停止は呼ばない）。
- Expected: どれも OK。閉じるボタンでアプリが終わる。アプリ設定・BRIDGE の設定は変わらず、バックアップも増えない。終わったら `git status --short` で作業コピーに変わったファイルがないことを見る。

- [ ] **Step 3: HANDOFF を書く**

9番の「main.cjs の大きさ」を、ほかの済んだ項目と同じく取り消し線にし（`~~main.cjs の大きさ~~（10-17〜18 直した。…）`）、PR5 の行のあとに足す（PR 番号は PR を出してから書き足す）:

```markdown
     - PR5 は CI のあと、ユーザーの許可を得てマージした（PR #115、マージコミット 1121925）。
     - PR6（仕上げ）：行数の見張りテスト（`electron/test/file-size-limits.test.cjs`。main.cjs 400行・`electron/*.cjs` 各800行を超えたら CI で止まる）、ゲームの選択の記録の場所を `games_ipc.cjs` の `getGameProfilesDir` から読む（テストに式の写しを残さない）、main.cjs の使われていない `validCommand` と古いコメント、AGENTS.md の分けたファイルの一覧。ブランチ `refactor/main-split-6`。
     - 分割はこれで終わり。main.cjs は 2,954行 → （Step 1 のあとの行数）行、ipc の窓口116個は1つも変えていない。
```

PR5 の「次にやること」の行は、PR6 の CI とマージ、そのあとは「9番の残りの大きい問題（P8 運営ログインの偽造など）からユーザーに選んでもらう」に書き換える。

- [ ] **Step 4: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に main.cjs の分割 PR6（仕上げ）を書く」
```
