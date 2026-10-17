# main.cjs の分割 PR2（端の仕事）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `electron/main.cjs` から、初期セットアップ・ゲームの選択・読み上げ・BRIDGE の設定・ギフト一覧の5つの仕事を別ファイルに分ける（アプリの動きは変えない）。

**Architecture:** PR1 と同じ形。各ファイルは `createXxx(deps)` を1つだけ外に出し、関数のまとまりと `register(ipcMain)` を返す。main.cjs は operatorAuth のあとと settingsBackups のあとでモジュールを作り、今の関数名を分割代入で受ける。あとで定義されるもの（`serverStarting`・`bridgeProcRef`・`assertMapIdle` など）は「呼ばれたときに読む関数」で渡す。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（テストでは偽物の electron を vm で渡す）。

**Spec:** docs/superpowers/specs/2026-10-17-main-split-design.md

## Global Constraints

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。`electron/preload.cjs` と `src/` は変えない。ipc の窓口の一覧のテスト（116個と3個）はそのまま通ること。
- 関数の中の処理は、移すだけにする。直すのは、受け取る形を変えるのに必要な所だけ（変数を直接見ていた所を、受け取った関数で見る）。`async` の有無も変えない（`config:giftMapping:save`・`clipboard:writeText`・`bridge:commands:list` などは同期のまま。今のテストが `assert.throws` や戻り値の `.length` で確かめている）。
- `electron`・`child_process` は main.cjs だけが読み込む。`spawn`・`spawnSync` は main から渡す。
- `./process_runner.cjs` の `runProc` も main から渡す。テスト（`loadApp`）が偽物に差し替えるのは main.cjs が読み込んだものだけで、モジュールが自分で読み込むと本物が動く（ギフト更新のテストが落ちる）。
- モジュールの状態（`let` の変数）は、すべて `createXxx` の中に置く。ファイルの一番外に置くと、Node の require のキャッシュで、テストの `loadApp` ごとに作った main.cjs の間で分け合ってしまう。
- モジュールは自分の `__dirname`・`process` を使わず、main から `appDir`・`process` を受け取る。`fs`・`path`・`crypto`・`os` と、electron を読み込まない今の小さいモジュール（`./tts.cjs`・`./initial_setup.cjs`・`./game_profiles.cjs` など）は自分で読み込んでよい。
- main.cjs の一番外の `app`・`path`・`fs`・`crypto`・`getServerRoot` は消さない。`loadApp` がゲームの選択の記録を書くとき、main.cjs の中でこれらを使う。ゲームの記録の場所（`userData/game-profiles/<サーバーの場所の sha256 の先頭16文字>`）の式も変えない。
- 正規表現でコードを見ているテスト（`game-mods-after-update`）が見る名前は、移した先でも同じにする: `gameProfiles`・`gameProfileOperation`・`gamesStatus`・`readAppConfig`・`writeAppConfig`・`app`。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `refactor/main-split-2`（origin/main の 4d4dd2d から切った）。設計書 7 は Codex の作業と並行するときの決まりで、Codex の作業は終わった（ユーザー 2026-10-17「codexの作業もう終わったよ」）。
- 文書に Windows の場所を書くときは `/` 区切りにする（`\` と16進数が続くと `npm run build` が止まる）。
- git は PowerShell で行う。`git add` が Permission denied のときは先に `git hash-object -w <file>`。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない。Write でファイルにしてから実行する。
- 1つのテストファイルは `node --test electron/test/<name>.test.cjs`。全体は `npm run verify`。
- コメントは周りと同じく日本語。既存ファイルの改行（CRLF）は変えない。

## Review Focus

1. モジュールの状態を、別々に作ったもの同士で分け合わないこと（ギフトの更新中・配信前チェックの実行中・初期セットアップの実行中・ゲームの操作中） → Task 5 の「作ったものごとに更新中の状態を持つ」で確かめる。ほかは読んで確かめる。
2. 配布版（`app.isPackaged === true`）で、同梱のゲーム（採掘）と DisplayMOD の jar を `process.resourcesPath` から探すこと → Task 2 の「同梱のゲームと DisplayMOD の場所」で確かめる。
3. main が渡す「いま作業中か」の関数の取り違え（ゲームの切り替えが、初期セットアップ・サーバーの起動と停止・BRIDGE・MAP の作業のどれかを見落とす） → Task 1・Task 2 の app-regressions の配線のテストで確かめる。
4. 配信前チェックを続けて押したとき、1回だけ調べて同じ結果を返すこと → Task 4 の「同時に押しても1回だけ調べる」で確かめる。
5. 読み上げエンジンの実行ファイルの候補が、main から受け取った `process.env`（`LOCALAPPDATA`・`PROGRAMFILES`）で決まること → 入っているエンジンで結果が変わるのでテストにしない。最終レビューで `createTtsIpc` の中で候補を作っていることを読んで確かめる。

---

### Task 1: 初期セットアップ・フォルダー選択を `electron/setup_ipc.cjs` に分ける

**Files:**
- Create: `electron/setup_ipc.cjs`
- Create: `electron/test/setup-ipc-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、先頭の配線、`initialSetupRunning` を読んでいた3か所）
- Modify: `electron/test/app-regressions.test.cjs`（配線のテスト）

**移すもの**（4d4dd2d の行。すべてそのまま移す）
- 1797〜1830: `dialog:pickFolder`・`dialog:pickFile`・`folder:open`
- 1832〜1873: `initialSetupRunning`・`initialSetupState`・`server:setup:status`・`setupServerAtPath`・`server:setup:atPath`
- 1898〜1912: `server:forgeInstall`・`server:forgeInstall:atPath`・`server:forgeClientStatus`・`server:setup`
- 2252〜2314: `server:checkSetupComplete`・`setup:inspectEnvironment`
- 移さないもの（間にある）: `server:rconpassword:read`・`server:gamerules:apply`・`server:datapack:deployNightVision`（PR4）

**Interfaces:**
- Produces: `createSetupIpc({ app, dialog, shell, spawnSync, getServerRoot, getGvDataDir, assertGameProfileIdle, assertMapIdle, serverChild })` → `{ isRunning(): boolean, setupServerAtPath(folderPath): Promise, register(ipcMain) }`。`register` は上の11個の ipc を登録する。
  - `serverChild()` はサーバーの子プロセス（なければ null）。`setupServerAtPath` の `if (serverProcRef)` を `if (serverChild())` にする。
  - モジュールは `./initial_setup.cjs` を自分で読み込む。`setup:inspectEnvironment` の中の `require("./forge_version.cjs")` はそのまま。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/setup-ipc-module.test.cjs`:

```js
// 初期セットアップ・Forge インストーラー・セットアップの確認・環境の実測・フォルダー選択の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSetupIpc } = require('../setup_ipc.cjs');

function setup(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  let answer;
  const setupIpc = createSetupIpc({
    app: { getVersion: () => '9.9.9', getPath: () => dir },
    dialog: { showMessageBox: () => new Promise(resolve => { answer = resolve; }) },
    shell: { openExternal: async () => {}, openPath: async () => '' },
    spawnSync: (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { stderr: 'openjdk version "17.0.8"\nmore', stdout: '' }; },
    getServerRoot: () => dir, getGvDataDir: () => path.join(dir, 'gv'),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => calls.push('mapIdle'),
    serverChild: () => null,
    ...overrides,
  });
  setupIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, calls, setupIpc, invoke: (name, ...args) => handlers.get(name)({}, ...args), answer: response => answer({ response }) };
}

test('初期セットアップ: 規約の確認を待つ間は作業中。重ねて始めず、キャンセルで終わる', async t => {
  const x = setup(t);
  assert.equal(x.setupIpc.isRunning(), false);
  const first = x.invoke('server:setup:atPath', x.dir);
  assert.equal(x.setupIpc.isRunning(), true);
  assert.deepEqual(x.calls, ['gameProfileIdle', 'mapIdle']);
  assert.equal(x.invoke('server:setup:status').state, 'running');
  await assert.rejects(x.invoke('server:setup:atPath', x.dir), /環境構築が進行中です。完了までお待ちください。/);
  x.answer(2);
  assert.equal((await first).canceled, true);
  assert.equal(x.setupIpc.isRunning(), false);
  assert.deepEqual(x.invoke('server:setup:status'), { state: 'idle', message: '環境構築をキャンセルしました。' });
});

test('初期セットアップ: サーバーが動いている間は始めない（main から受け取った子プロセスを見る）', async t => {
  const x = setup(t, { serverChild: () => ({ pid: 1 }) });
  await assert.rejects(x.invoke('server:setup:atPath', x.dir), /Minecraftサーバーを停止してから環境構築を実行してください。/);
  assert.equal(x.setupIpc.isRunning(), false);
});

test('環境の実測: java は main から受け取った spawnSync で調べ、BRIDGE の版はアプリの版', async t => {
  const x = setup(t);
  const env = await x.invoke('setup:inspectEnvironment');
  assert.deepEqual(x.calls, ['java -version']);
  assert.deepEqual(env.java, { detected: true, version: 'openjdk version "17.0.8"' });
  assert.deepEqual(env.bridge, { detected: true, version: '9.9.9' });
  assert.equal(env.tiktokApi.version, '未確認（gifts.meta.jsonなし）');
});
```

- [ ] **Step 2: main の配線のテストを足す（分ける前の動きを固定する）**

`electron/test/app-regressions.test.cjs` の「配線: サーバーの起動中は保存先を変えず…」のテストのすぐあとに足す:

```js
// 初期セットアップは setup_ipc.cjs が持つ（main.cjs の分割 PR2）。main のサーバーの起動・MAP の作業は、その「作業中」を関数で見る。
test('配線: 初期セットアップの間は、ウィンドウを閉じず、サーバーの起動と MAP の作業を止める', async t => {
  let answerEula;
  const app = loadApp(t, undefined, {}, { showMessageBox: () => new Promise(resolve => { answerEula = resolve; }) });
  const target = path.join(app.root, 'setup-target');
  fs.mkdirSync(target);
  const setup = app.invoke('server:setup:atPath', target);
  assert.equal(app.evaluate('isAppBusy()'), true);
  await assert.rejects(app.invoke('server:start'), /環境構築が完了するまでお待ちください。/);
  await assert.rejects(app.invoke('world:backup'), /サーバーの準備・停止が終わるまでお待ちください。/);
  answerEula({ response: 2 });
  assert.equal((await setup).canceled, true);
  assert.equal(app.evaluate('isAppBusy()'), false);
});
```

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/setup-ipc-module.test.cjs`
Expected: FAIL（`Cannot find module '../setup_ipc.cjs'`）。

Run: `node --test --test-name-pattern="配線" electron/test/app-regressions.test.cjs`
Expected: PASS（2件。新しい配線のテストは分ける前の main.cjs で通る）。

- [ ] **Step 4: `electron/setup_ipc.cjs` を作り、main.cjs を直す**

- 上の「移すもの」を `createSetupIpc` の中へ移す（状態の `let` 2つは `createSetupIpc` の中、`ipcMain.handle` は `register(ipcMain)` の中）。区切りのコメントも一緒に移す。
- main.cjs の `operatorAuth.register(ipcMain);` の次に足す:

```js
const { createSetupIpc } = require('./setup_ipc.cjs');
const setupIpc = createSetupIpc({
  app, dialog, shell, spawnSync, getServerRoot, getGvDataDir,
  assertGameProfileIdle: () => assertGameProfileIdle(), assertMapIdle: () => assertMapIdle(),
  serverChild: () => serverProcRef,
});
// 初期セットアップの「作業中」は setup_ipc.cjs が持つ。サーバーの起動・MAP・ゲームの切り替え・ウィンドウを閉じるときに見る。
const { isRunning: isInitialSetupRunning } = setupIpc;
setupIpc.register(ipcMain);
```

- main.cjs の `initialSetupRunning` を読んでいた所を `isInitialSetupRunning()` にする: ゲームの切り替えの `ensureStopped`、`isAppBusy`、`startServer`、`runMapOperation`。
- main.cjs の `require("./initial_setup.cjs")` の行を消す（使うのは移したものだけ）。
- 「配線: サーバーの起動中は保存先を変えず…」のテストの `for (const flag of [...])` から `'initialSetupRunning'` を消す（初期セットアップは Step 2 のテストで確かめる。main の変数ではなくなるので、書き換えても何も起きない）。

- [ ] **Step 5: 動かす**

Run: `node --test electron/test/setup-ipc-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件）。

Run: `Select-String -Path electron/main.cjs -Pattern 'initialSetupRunning|initialSetupState|EULA_URL|inspectSetup|inspectForgeClient|launchForgeInstaller|prepareServerEnvironment|dialog:pick|folder:open'`
Expected: 何も出ない。

- [ ] **Step 6: commit**

```powershell
git add electron/setup_ipc.cjs electron/test/setup-ipc-module.test.cjs electron/main.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: 初期セットアップとフォルダー選択を electron/setup_ipc.cjs に分ける」
```

---

### Task 2: ゲームの選択を `electron/games_ipc.cjs` に分ける

**Files:**
- Create: `electron/games_ipc.cjs`
- Create: `electron/test/games-ipc-module.test.cjs`
- Modify: `electron/main.cjs`（56〜142 の `minecraftLocationOptions` から `games:clientFolder` まで、`gameProfileBusy` を読んでいた2か所、要らなくなった require）
- Modify: `electron/test/game-mods-after-update.test.cjs`（`gamesStatus` と `games:*` を見る所）
- Modify: `electron/test/app-regressions.test.cjs`（配線のテスト）

**Interfaces:**
- Consumes: Task 1 の `isInitialSetupRunning()`（main の中）。
- Produces: `createGamesIpc({ app, process, appDir, dialog, readAppConfig, writeAppConfig, getServerRoot, getConfigPath, getServerTemplatePath, assertMapIdle, isInitialSetupRunning, isServerStarting, isServerStopping, isBridgeActive, getServerProcessStatus, getMinecraftProcessStatus })` → `{ gameProfiles, isGameProfileBusy(): boolean, assertGameProfileIdle(), gameProfileOperation(action): Promise, gamesStatus(), register(ipcMain) }`。`register` は `games:*` の8個を登録する。
  - `gameProfiles` は `createGameProfiles(...)` の戻り値。`storage`・`bundledPackages`・`displayJar`・`bridgeJar` の中の `__dirname` を `appDir`、`process.resourcesPath` を受け取った `process` のものにする。
  - `ensureStopped` の中身はモジュールへ移し、main の変数を見ていた所を受け取った関数にする:

```js
    assertMapIdle();
    if (isInitialSetupRunning() || isServerStarting() || isServerStopping() || isBridgeActive() || (await getServerProcessStatus()).running) throw new Error('サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください');
    const minecraft = await getMinecraftProcessStatus(true);
```

  - モジュールは `./game_profiles.cjs`・`./game_mods_refresh.cjs`・`./minecraft_locations.cjs`・`./minecraft_processes.cjs`（`switchBlockedMessage`）を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/games-ipc-module.test.cjs`:

```js
// ゲームの選択・切り替え・Minecraft の保存先の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGamesIpc } = require('../games_ipc.cjs');
const { switchBlockedMessage } = require('../minecraft_processes.cjs');

function setup(t, { packaged = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'games-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDir = path.join(root, 'app', 'electron'), server = path.join(root, 'server'), resources = path.join(root, 'resources');
  fs.mkdirSync(server, { recursive: true });
  const configPath = path.join(root, 'config.minecraft.json');
  fs.writeFileSync(configPath, '{}');
  const busy = { map: '', setup: false, starting: false, stopping: false, bridge: false, serverRunning: false, minecraft: { running: false, processes: [] } };
  const handlers = new Map();
  const gamesIpc = createGamesIpc({
    app: { isPackaged: packaged, getPath: name => path.join(root, name), getVersion: () => '9.9.9' },
    process: { resourcesPath: resources }, appDir,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    readAppConfig: () => ({}), writeAppConfig: () => {},
    getServerRoot: () => server, getConfigPath: () => configPath,
    getServerTemplatePath: () => path.join(resources, 'server-template'),
    assertMapIdle: () => { if (busy.map) throw new Error(busy.map); },
    isInitialSetupRunning: () => busy.setup, isServerStarting: () => busy.starting, isServerStopping: () => busy.stopping,
    isBridgeActive: () => busy.bridge,
    getServerProcessStatus: async () => ({ running: busy.serverRunning }),
    getMinecraftProcessStatus: async strict => { assert.equal(strict, true); return busy.minecraft; },
  });
  gamesIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { appDir, resources, busy, gamesIpc, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('ゲームの操作: 進行中は作業中で、重ねず、設定の保存も止める。終われば（失敗でも）作業中でなくなる', async t => {
  const x = setup(t);
  let release;
  const running = x.gamesIpc.gameProfileOperation(() => new Promise(resolve => { release = resolve; }));
  assert.equal(x.gamesIpc.isGameProfileBusy(), true);
  await assert.rejects(x.gamesIpc.gameProfileOperation(async () => {}), /ゲームの操作が進行中です/);
  assert.throws(() => x.gamesIpc.assertGameProfileIdle(), /ゲームの切替中、または切替の復旧が必要です/);
  release('done');
  assert.equal(await running, 'done');
  assert.equal(x.gamesIpc.isGameProfileBusy(), false);
  await assert.rejects(x.gamesIpc.gameProfileOperation(async () => { throw new Error('失敗'); }), /失敗/);
  assert.equal(x.gamesIpc.isGameProfileBusy(), false);
  x.gamesIpc.assertGameProfileIdle();
});

test('ゲームの切り替え: MAP・初期セットアップ・サーバー・BRIDGE・Minecraft のどれかが動いていれば止める（main から受け取った関数で見る）', async t => {
  const x = setup(t);
  const status = await x.invoke('games:recover');
  assert.equal(status.recoveryRequired, false);
  assert.ok('modsOutdatedAfterUpdate' in status);
  x.busy.map = 'MAPを保存・読込中です。完了までお待ちください。';
  await assert.rejects(x.invoke('games:recover'), /MAPを保存・読込中です。/);
  x.busy.map = '';
  for (const key of ['setup', 'starting', 'stopping', 'bridge', 'serverRunning']) {
    x.busy[key] = true;
    await assert.rejects(x.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, key);
    x.busy[key] = false;
  }
  x.busy.minecraft = { running: true, processes: ['javaw.exe'] };
  await assert.rejects(x.invoke('games:recover'), { message: switchBlockedMessage(['javaw.exe']) });
});

test('同梱のゲームと DisplayMOD の場所: 開発版はリポジトリ、配布版は resources（main から受け取った appDir・process で決める）', async t => {
  const put = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}'); };
  const saikutu = status => status.games.find(game => game.id === 'saikutu').installed;
  const dev = setup(t);
  put(path.resolve(dev.appDir, '..', 'build', 'game-packs', 'saikutu', 'game.json'));
  put(path.resolve(dev.appDir, '..', 'DisplayMod', 'build', 'libs', 'displaymod-1.2.0.jar'));
  let status = await dev.invoke('games:list');
  assert.equal(saikutu(status), true);
  assert.equal(status.displayBundled, true);
  const packaged = setup(t, { packaged: true });
  status = await packaged.invoke('games:list');
  assert.equal(saikutu(status), false);
  assert.equal(status.displayBundled, false);
  put(path.join(packaged.resources, 'game-packs', 'saikutu', 'game.json'));
  put(path.join(packaged.resources, 'server-template', 'mods', 'displaymod-1.2.0.jar'));
  status = await packaged.invoke('games:list');
  assert.equal(saikutu(status), true);
  assert.equal(status.displayBundled, true);
});
```

- [ ] **Step 2: main の配線のテストを足す（分ける前の動きを固定する）**

Task 1 で足したテストのあとに足す:

```js
// ゲームの切り替えは games_ipc.cjs が持つ（main.cjs の分割 PR2）。止める判定は、main が渡す各作業の「作業中」の関数で見る。
test('配線: ゲームの切り替えは、初期セットアップ・サーバーの起動と停止・BRIDGE の再起動待ち・MAP の作業の間は止める', async t => {
  let answerEula;
  const app = loadApp(t, undefined, {}, { showMessageBox: () => new Promise(resolve => { answerEula = resolve; }) });
  for (const [set, reset] of [['serverStarting = true', 'serverStarting = false'], ['serverStopping = true', 'serverStopping = false'], ['bridgeRestartTimer = 1', 'bridgeRestartTimer = null']]) {
    app.evaluate(set);
    await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, set);
    app.evaluate(reset);
  }
  app.evaluate('mapOperationBusy = true');
  await assert.rejects(app.invoke('games:recover'), /MAPを保存・読込中です。/);
  app.evaluate('mapOperationBusy = false');
  const target = path.join(app.root, 'setup-target');
  fs.mkdirSync(target);
  const setup = app.invoke('server:setup:atPath', target);
  await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/);
  answerEula({ response: 2 });
  await setup;
});

test('配線: ゲームの操作の間（パックのフォルダーを選んでいる間）は、ウィンドウを閉じない', async t => {
  let answerFolder;
  const app = loadApp(t, undefined, {}, { showOpenDialog: () => new Promise(resolve => { answerFolder = resolve; }) });
  const install = app.invoke('games:install');
  assert.equal(app.evaluate('isAppBusy()'), true);
  answerFolder({ canceled: true, filePaths: [] });
  assert.equal((await install).canceled, true);
  assert.equal(app.evaluate('isAppBusy()'), false);
});
```

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/games-ipc-module.test.cjs`
Expected: FAIL（`Cannot find module '../games_ipc.cjs'`）。

Run: `node --test --test-name-pattern="配線" electron/test/app-regressions.test.cjs`
Expected: PASS（4件）。

- [ ] **Step 4: `electron/games_ipc.cjs` を作り、main.cjs とテストを直す**

- main.cjs の 56〜142（`function minecraftLocationOptions()` から `games:clientFolder` の ipc まで）を `createGamesIpc` の中へ移す。`let gameProfileBusy` も中へ。中の名前（`gameProfiles`・`gameProfileOperation`・`gamesStatus`・`readAppConfig`・`writeAppConfig`・`app`）は変えない。足すのは `function isGameProfileBusy() { return gameProfileBusy; }` だけ。
- main.cjs の同じ場所（setupIpc の配線のあと）に足す:

```js
const { createGamesIpc } = require('./games_ipc.cjs');
const gamesIpc = createGamesIpc({
  app, process, appDir: __dirname, dialog, readAppConfig, writeAppConfig, getServerRoot, getConfigPath, getServerTemplatePath,
  assertMapIdle: () => assertMapIdle(),
  isInitialSetupRunning: () => isInitialSetupRunning(),
  isServerStarting: () => serverStarting,
  isServerStopping: () => serverStopping,
  isBridgeActive: () => Boolean(bridgeProcRef || bridgeRestartTimer),
  getServerProcessStatus: () => getServerProcessStatus(),
  getMinecraftProcessStatus: strict => getMinecraftProcessStatus(strict),
});
// ゲームの切り替え中かは games_ipc.cjs が持つ。設定の保存・バックアップの復元・ウィンドウを閉じるときに見る。
const { gameProfiles, isGameProfileBusy, assertGameProfileIdle, gameProfileOperation } = gamesIpc;
gamesIpc.register(ipcMain);
```

- main.cjs の `gameProfileBusy` を読んでいた2か所（`settingsBackups` の `isRunning`、`isAppBusy`）を `isGameProfileBusy()` にする。
- main.cjs の require から、使わなくなったものを消す: `createGameProfiles`、`gameModsOutdated`（`refreshGameModsAfterUpdate` は `refreshGameModsOnStartup` が使うので残す）、`./minecraft_locations.cjs` の行、`switchBlockedMessage`。
- `electron/test/game-mods-after-update.test.cjs`: `gamesStatus`・`games:list`・`games:activate`・`games:refreshMods` を見る所（196〜204行）は `read('electron/games_ipc.cjs')` を見るようにする。中の正規表現は変えない。`scheduleBridgeSync`・`refreshGameModsOnStartup` は main.cjs のまま。コメントを1行足す: `// games:* は electron/games_ipc.cjs へ移した（2026-10-17 main.cjs の分割 PR2）。`
- 「配線: サーバーの起動中は保存先を変えず…」のテストの `for (const flag of [...])` から `'gameProfileBusy'` を消す（Step 2 の2つ目のテストで確かめる）。テスト名の「（5つのどれか）」は残す（5つの作業は変わらない）。

- [ ] **Step 5: 動かす**

Run: `node --test electron/test/games-ipc-module.test.cjs electron/test/game-mods-after-update.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件）。

Run: `Select-String -Path electron/main.cjs -Pattern 'gameProfileBusy|createGameProfiles|gameModsOutdated|minecraftLocationOptions|discoverMinecraftLocations|switchBlockedMessage|ipcMain.handle\(.games:'`
Expected: 何も出ない。

- [ ] **Step 6: commit**

```powershell
git add electron/games_ipc.cjs electron/test/games-ipc-module.test.cjs electron/main.cjs electron/test/game-mods-after-update.test.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: ゲームの選択を electron/games_ipc.cjs に分ける」
```

---

### Task 3: 読み上げを `electron/tts_ipc.cjs` に分ける

**Files:**
- Create: `electron/tts_ipc.cjs`
- Create: `electron/test/tts-ipc-module.test.cjs`
- Modify: `electron/main.cjs`（2316〜2489 の TTS の区切り全部、配線、tts.cjs の require）

**Interfaces:**
- Produces: `createTtsIpc({ app, process, shell, spawn, getBridgeBatDir, getConfigPath, settingsBackups })` → `{ getTtsSettingsPath(), readTtsSettings(), writeTtsSettings(settings), normalizeTtsSettings(settings), register(ipcMain) }`。`register` は `tts:*` の6個を登録する。
  - `TTS_DEFAULTS`・`ENGINE_EXE_PATHS` は `createTtsIpc` の中で作る（`ENGINE_EXE_PATHS` は受け取った `process.env` を使う）。
  - モジュールは `./tts.cjs`（`ENGINE_PORTS`・`checkEngine`・`getSpeakers`・`flattenSpeakers`・`synthesize`）を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/tts-ipc-module.test.cjs`:

```js
// 読み上げの設定とエンジンの ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTtsIpc } = require('../tts_ipc.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'userData'), bridge = path.join(root, 'bridge');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(bridge, 'config.minecraft.json'), '{}');
  const backups = [], handlers = new Map();
  const ttsIpc = createTtsIpc({
    app: { getPath: () => userData }, process: { env: {} },
    shell: { openPath: async () => '' }, spawn: () => { throw new Error('起動しない'); },
    getBridgeBatDir: () => bridge, getConfigPath: () => path.join(bridge, 'config.minecraft.json'),
    settingsBackups: { create: kind => backups.push(kind) },
  });
  ttsIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { userData, bridge, backups, ttsIpc, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('読み上げの設定: BRIDGE と userData の両方へ整えた値で書き、変わったときだけ自動バックアップを作る', t => {
  const x = setup(t);
  assert.deepEqual(x.invoke('tts:settings:read'), x.ttsIpc.normalizeTtsSettings({}));
  const saved = x.invoke('tts:settings:write', { engine: 'aivis', speedScale: 9 });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.engine, 'aivis');
  assert.equal(saved.settings.speedScale, 2);
  for (const file of [path.join(x.bridge, 'tts-settings.json'), path.join(x.userData, 'tts-settings.json')]) {
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved.settings);
  }
  assert.deepEqual(x.backups, ['automatic']);
  x.invoke('tts:settings:write', saved.settings);
  assert.deepEqual(x.backups, ['automatic'], '同じ設定ではバックアップを作らない');
});

test('読み上げの設定: BRIDGE の設定を正とし、なければ userData を読む', t => {
  const x = setup(t);
  fs.writeFileSync(path.join(x.userData, 'tts-settings.json'), JSON.stringify({ speakerId: 7 }));
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 7);
  fs.writeFileSync(path.join(x.bridge, 'tts-settings.json'), JSON.stringify({ speakerId: 3 }));
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 3);
  assert.equal(x.ttsIpc.getTtsSettingsPath(), path.join(x.userData, 'tts-settings.json'));
});

test('読み上げエンジンの起動: 知らないエンジンは起動しない', async t => {
  const x = setup(t);
  assert.deepEqual(await x.invoke('tts:launchEngine', 'unknown'), { ok: false, message: '未対応の読み上げエンジンです: unknown' });
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/tts-ipc-module.test.cjs`
Expected: FAIL（`Cannot find module '../tts_ipc.cjs'`）。

- [ ] **Step 3: `electron/tts_ipc.cjs` を作り、main.cjs を直す**

- main.cjs の 2316〜2489（`// TTS (読み上げ)` の区切りからファイルの最後まで）を `createTtsIpc` の中へ移す。
- main.cjs の `const settingsBackups = createSettingsBackups({ ... });` の次に足す（settingsBackups の中の `getTtsSettingsPath()`・`readTtsSettings()` は、呼ばれたときに読むのでこの順でよい）:

```js
const { createTtsIpc } = require('./tts_ipc.cjs');
const ttsIpc = createTtsIpc({ app, process, shell, spawn, getBridgeBatDir, getConfigPath, settingsBackups });
const { getTtsSettingsPath, readTtsSettings } = ttsIpc;
ttsIpc.register(ipcMain);
```

- main.cjs の `require("./tts.cjs")` の行は、`checkEngine` だけを残す（配信前チェックが使う。Task 4 で行ごと消す）。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/tts-ipc-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件）。

Run: `Select-String -Path electron/main.cjs -Pattern 'TTS_DEFAULTS|ENGINE_EXE_PATHS|normalizeTtsSettings|writeTtsSettings|synthesize|tts:'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/tts_ipc.cjs electron/test/tts-ipc-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: 読み上げを electron/tts_ipc.cjs に分ける」
```

---

### Task 4: BRIDGE の設定を `electron/bridge_settings.cjs` に分ける

**Files:**
- Create: `electron/bridge_settings.cjs`
- Create: `electron/test/bridge-settings-module.test.cjs`
- Modify: `electron/main.cjs`（207〜305 の設定の区切り、2168〜2239 のコマンド txt の区切り、配線、要らなくなった require）
- Modify: `electron/test/app-regressions.test.cjs`（配線のテスト）

**移すもの**（4d4dd2d の行）
- 207〜305: `config:read`・`readSavedBridgeConfig`・`writeBridgeConfig`・`config:write`・`config:mappings:write`・`config:giftMapping:save`・`giftTemplates` と `giftTemplate:*` の4個・`config:path`・`settings:backups:*` の3個・`preflightTask` と `preflight:run`・`config:validate`・`bridge:root`・`bridge:dir`
- 2168〜2239: `selectableCommandNames`・`bridge:commands:list`・`readCommandMetadata`・`bridge:commands:readMeta`・`bridge:commands:write`・`bridge:commands:openFolder`
- 移さないもの: 306行目の `bridge:syncStatus`（PR3。その場所に残す）

**Interfaces:**
- Consumes: Task 2 の `gameProfiles`・`assertGameProfileIdle`、Task 3 の `readTtsSettings`（main の中）。
- Produces: `createBridgeSettings({ app, dialog, shell, getConfigPath, ensureConfigExists, getBridgeBatDir, getServerRoot, getGiftsMinPath, getGiftsMetaPath, getInstalledBridgeRoot, getBridgeDir, gameProfiles, assertGameProfileIdle, settingsBackups, readTtsSettings, requestBridgeMod, isBridgeRunning })` → `{ readSavedBridgeConfig(), writeBridgeConfig(nextConfig, { alsoKnown }), selectableCommandNames(), readCommandMetadata(), register(ipcMain) }`。`register` は上の20個の ipc を登録する。
  - `preflight:run` の `bridgeStatus` の `running: Boolean(bridgeProcRef)` を `running: isBridgeRunning()` にする。`modStatus` は受け取った `requestBridgeMod` を呼ぶ。
  - モジュールは `./config_schema.cjs`・`./gift_mapping.cjs`・`./gift_templates.cjs`・`./preflight.cjs`・`./settings_backups.cjs`（`atomicWrite`）・`../bridge/command_files.cjs`（`commandFileProblem`）・`./game_command_scope.cjs`・`./tts.cjs`（`checkEngine`）を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/bridge-settings-module.test.cjs`:

```js
// BRIDGE の設定・ギフトの割り当て・テンプレート・設定のバックアップ・配信前チェック・コマンド txt の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridgeSettings } = require('../bridge_settings.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), commands = path.join(bridge, 'commands', 'minecraft');
  fs.mkdirSync(commands, { recursive: true });
  const source = path.resolve(__dirname, '../../bridge/commands/minecraft');
  for (const name of fs.readdirSync(source).filter(name => name.endsWith('.txt'))) fs.copyFileSync(path.join(source, name), path.join(commands, name));
  fs.writeFileSync(path.join(commands, 'game_saikutu_dig.txt'), 'say dig\n');
  const configPath = path.join(bridge, 'config.minecraft.json');
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../bridge/config.minecraft.json'), 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...config, tiktokUsername: 'akahoridouma', mappings: [] }));
  const calls = [], state = { bridgeRunning: false }, handlers = new Map();
  const settings = createBridgeSettings({
    app: { getVersion: () => '9.9.9' }, dialog: {}, shell: { openPath: async () => '' },
    getConfigPath: () => configPath, ensureConfigExists: () => {}, getBridgeBatDir: () => bridge, getServerRoot: () => root,
    getGiftsMinPath: () => path.join(root, 'gifts.min.json'), getGiftsMetaPath: () => path.join(root, 'gifts.meta.json'),
    getInstalledBridgeRoot: () => root, getBridgeDir: () => bridge,
    gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    settingsBackups: { create: kind => calls.push('backup:' + kind), list: () => [], restore: id => calls.push('restore:' + id) },
    readTtsSettings: () => ({ enabled: false, engine: 'voicevox' }),
    requestBridgeMod: async (...args) => { calls.push('mod:' + args.join(' ')); return { ok: true }; },
    isBridgeRunning: () => state.bridgeRunning,
  });
  settings.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, configPath, calls, state, settings, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BRIDGE の設定の保存: 先にゲームの切り替え中でないかを確かめ、中身が変わったときだけ自動バックアップを作る', async t => {
  const x = setup(t);
  await x.invoke('config:write', await x.invoke('config:read'));
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).options.commandsDir, path.join(x.bridge, 'commands', 'minecraft'));
  x.calls.length = 0;
  await x.invoke('config:write', await x.invoke('config:read'));
  assert.deepEqual(x.calls, ['gameProfileIdle'], '同じ中身ではバックアップを作らない');
  await x.invoke('config:write', { ...(await x.invoke('config:read')), tiktokUsername: 'another_id' });
  assert.deepEqual(x.calls, ['gameProfileIdle', 'gameProfileIdle', 'backup:automatic']);
  x.calls.length = 0;
  x.invoke('settings:backups:restore', 'b1');
  assert.deepEqual(x.calls, ['gameProfileIdle', 'restore:b1']);
});

test('コマンド txt: 選んでいるゲームのコマンドだけを出し、ゲームパックのものは書かず、書く前にバックアップを作る', async t => {
  const x = setup(t);
  const names = x.invoke('bridge:commands:list').map(row => row.name);
  assert.ok(names.includes('zombie.txt'));
  assert.ok(!names.includes('game_saikutu_dig.txt'), 'サバイバルではゲームパックのコマンドを出さない');
  await assert.rejects(x.invoke('bridge:commands:write', { filename: 'game_saikutu_dig.txt', content: '' }), /ゲームパックのコマンドはパックを再登録して更新してください/);
  x.calls.length = 0;
  await x.invoke('bridge:commands:write', { filename: 'my_cmd.txt', content: '# TITLE: 自作\nsay hi\n' });
  assert.deepEqual(x.calls, ['gameProfileIdle', 'backup:automatic']);
  assert.equal(x.invoke('bridge:commands:readMeta').find(row => row.name === 'my_cmd.txt').title, '自作');
});

test('配信前チェック: BRIDGE の稼働・BridgeMOD の応答・読み上げは main から受け取った関数で見る。同時に押しても1回だけ調べる', async t => {
  const x = setup(t);
  const first = x.invoke('preflight:run'), second = x.invoke('preflight:run');
  assert.equal(first, second);
  const report = await first;
  const check = (result, id) => result.checks.find(row => row.id === id);
  assert.equal(check(report, 'bridge').detail, 'Bridgeを起動し、TikTok LIVE接続後に再チェックしてください。');
  assert.equal(check(report, 'mod').status, 'ok');
  assert.equal(check(report, 'tts').status, 'skip');
  assert.deepEqual(x.calls.filter(call => call.startsWith('mod:')), ['mod:GET /bridge/status']);
  x.state.bridgeRunning = true;
  fs.writeFileSync(path.join(x.bridge, 'runtime-status.json'), JSON.stringify({ tiktok: { state: 'connected', username: 'akahoridouma' } }));
  assert.equal(check(await x.invoke('preflight:run'), 'bridge').status, 'ok');
});
```

- [ ] **Step 2: main の配線のテストを足す（分ける前の動きを固定する）**

Task 2 で足したテストのあとに足す:

```js
// 配信前チェックは bridge_settings.cjs が持つ（main.cjs の分割 PR2）。BRIDGE の子プロセス・BridgeMOD の通信・読み上げの設定は main から受け取る。
test('配線: 配信前チェックは、main の BRIDGE の子プロセス・BridgeMOD・読み上げの設定を見る', async t => {
  const app = loadApp(t);
  await bridgeModStatus(t, app);
  app.invoke('tts:settings:write', { enabled: false });
  app.setBridge(fakeBridge(() => undefined).child);
  fs.writeFileSync(path.join(app.root, 'bridge', 'runtime-status.json'), JSON.stringify({ tiktok: { state: 'connected', username: 'akahoridouma' } }));
  const report = await app.invoke('preflight:run');
  const status = id => report.checks.find(row => row.id === id).status;
  assert.equal(status('bridge'), 'ok');
  assert.equal(status('mod'), 'ok');
  assert.equal(status('tts'), 'skip');
});
```

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/bridge-settings-module.test.cjs`
Expected: FAIL（`Cannot find module '../bridge_settings.cjs'`）。

Run: `node --test --test-name-pattern="配線" electron/test/app-regressions.test.cjs`
Expected: PASS（5件）。

- [ ] **Step 4: `electron/bridge_settings.cjs` を作り、main.cjs を直す**

- 上の「移すもの」を `createBridgeSettings` の中へ移す（`preflightTask`・`giftTemplates` も中へ）。区切りのコメント（`// IPC: config read/write` など、`bridge:root` の前の「✅ preload側の…」）も一緒に移す。
- main.cjs の `ttsIpc.register(ipcMain);` の次に足す:

```js
const { createBridgeSettings } = require('./bridge_settings.cjs');
const bridgeSettings = createBridgeSettings({
  app, dialog, shell, getConfigPath, ensureConfigExists, getBridgeBatDir, getServerRoot, getGiftsMinPath, getGiftsMetaPath,
  getInstalledBridgeRoot, getBridgeDir, gameProfiles, assertGameProfileIdle, settingsBackups, readTtsSettings,
  requestBridgeMod: (...args) => requestBridgeMod(...args),
  isBridgeRunning: () => Boolean(bridgeProcRef),
});
const { readSavedBridgeConfig, writeBridgeConfig, selectableCommandNames } = bridgeSettings;
bridgeSettings.register(ipcMain);
```

- main.cjs の require から、使わなくなったものを消す: `./tts.cjs` の行、`./preflight.cjs` の行、`atomicWrite`（`./settings_backups.cjs`）、`commandFileProblem`（`../bridge/command_files.cjs`）、`availableGameCommands`（`./game_command_scope.cjs`）。`validateBridgeConfig` は `presets:load` が使うので残す。

- [ ] **Step 5: 動かす**

Run: `node --test electron/test/bridge-settings-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件）。

Run: `Select-String -Path electron/main.cjs -Pattern 'preflightTask|giftTemplates|readCommandMetadata|updateGiftMapping|atomicWrite|commandFileProblem|availableGameCommands|checkEngine|ipcMain.handle\("(config:|settings:backups|preflight|bridge:commands|bridge:root|bridge:dir|giftTemplate)'`
Expected: 何も出ない。

- [ ] **Step 6: commit**

```powershell
git add electron/bridge_settings.cjs electron/test/bridge-settings-module.test.cjs electron/main.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: BRIDGE の設定とコマンド txt を electron/bridge_settings.cjs に分ける」
```

---

### Task 5: ギフト一覧を `electron/gifts_viewer.cjs` に分ける

**Files:**
- Create: `electron/gifts_viewer.cjs`
- Create: `electron/test/gifts-viewer-module.test.cjs`
- Modify: `electron/main.cjs`（308〜339、1914〜2086、配線）

**移すもの**（4d4dd2d の行）
- 308〜339: `gifts:read`・`gifts:openFolder`・`gifts:openHtml`
- 1914〜2086: `gifts:update`・`autoUpdateGiftsIfStale`・`gv:gifts:read`・`giftUpdateTask` と `giftUpdateUsername`・`updateGifts`・`performGiftUpdate`・`gv:gifts:update`・`gv:gifts:openFolder`・`gv:gifts:openHtml`・`gv:gifts:fetchImageBase64`（`require("./gift_image.cjs")` も）・`clipboard:writeText`・`gv:gifts:copyPngDataUrl`・`gv:settings:read`・`gv:settings:write`

**Interfaces:**
- Produces: `createGiftsViewer({ BrowserWindow, shell, net, clipboard, nativeImage, runProc, eulerCredentials, getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath, ensureDir, getGvDataDir, getGvSettingsPath, getGvToolPath, getNodeCommand, ensureNodeRuntimeAvailable })` → `{ autoUpdateGiftsIfStale(): Promise, updateGifts(username): Promise, register(ipcMain) }`。`register` は上の13個の ipc を登録する。
  - `ensureNodeRuntimeAvailable()` は Promise（main の BRIDGE の配布の関数。PR3 で `bridge_sync` へ移る）。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/gifts-viewer-module.test.cjs`:

```js
// ギフト一覧（UI タブ・GiftsViewer）の読み込み・更新・画像・コピーの ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGiftsViewer } = require('../gifts_viewer.cjs');

function setup(t, { username = 'akahoridouma' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gifts-viewer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gv = path.join(root, 'gv'), tools = path.join(root, 'tools');
  fs.mkdirSync(gv); fs.mkdirSync(tools);
  for (const file of ['fetch_gifts.cjs', 'gifts_to_html.cjs']) fs.writeFileSync(path.join(tools, file), '');
  const configPath = path.join(root, 'config.minecraft.json');
  fs.writeFileSync(configPath, JSON.stringify({ tiktokUsername: username }));
  const log = [], calls = [], sent = [], handlers = new Map();
  // 取得の道具の代わり。--out のフォルダーに、取得したギフトと HTML を書く。
  const runProc = async (cmd, args, _cwd, options = {}) => {
    log.push({ cmd, tool: path.basename(args[0]), env: options.env });
    const out = args[args.indexOf('--out') + 1];
    if (args[0].endsWith('fetch_gifts.cjs')) {
      await new Promise(resolve => setTimeout(resolve, 20));
      const gifts = [{ id: 5655, name: 'バラ', diamond_count: 1 }];
      for (const file of ['gifts.min.json', 'gifts.full.json']) fs.writeFileSync(path.join(out, file), JSON.stringify(gifts));
      fs.writeFileSync(path.join(out, 'gifts.meta.json'), JSON.stringify({ username: args[1], count: 1, generatedAt: new Date().toISOString() }));
    } else fs.writeFileSync(path.join(out, 'gifts.html'), '<html></html>');
    return { out: '' };
  };
  const viewer = createGiftsViewer({
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => sent.push(args) } }] },
    shell: { openPath: async () => '' }, net: { fetch: async () => { throw new Error('通信しない'); } },
    clipboard: { writeText: () => {}, writeImage: () => {} }, nativeImage: { createFromDataURL: () => ({ isEmpty: () => false }) },
    runProc, eulerCredentials: { runtime: () => ({ env: { SIGN_API_KEY: 'fixture-key' } }) },
    getConfigPath: () => configPath, getGiftsDir: () => gv, getGiftsMinPath: () => path.join(gv, 'gifts.min.json'),
    getGiftsMetaPath: () => path.join(gv, 'gifts.meta.json'), getGiftsHtmlPath: () => path.join(gv, 'gifts.html'), ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
    getGvDataDir: () => gv, getGvSettingsPath: () => path.join(gv, 'settings.json'), getGvToolPath: name => path.join(tools, name),
    getNodeCommand: () => 'node-fixture', ensureNodeRuntimeAvailable: async () => calls.push('node-ready'),
  });
  viewer.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { gv, configPath, log, calls, sent, viewer, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('ギフトの更新: main から受け取った node・runProc・Euler の鍵で取得して画面へ知らせる。作ったものごとに更新中の状態を持つ', async t => {
  const a = setup(t), b = setup(t);
  const [first, second] = await Promise.all([a.invoke('gv:gifts:update', 'user_a'), b.invoke('gv:gifts:update', 'user_b')]);
  assert.equal(first.meta.username, 'user_a');
  assert.equal(second.meta.username, 'user_b', '別のアカウントの更新中として止めない');
  assert.deepEqual(a.log.map(call => [call.cmd, call.tool]), [['node-fixture', 'fetch_gifts.cjs'], ['node-fixture', 'gifts_to_html.cjs']]);
  assert.equal(a.log[0].env.SIGN_API_KEY, 'fixture-key');
  assert.deepEqual(a.calls, ['node-ready']);
  assert.deepEqual(a.sent.map(args => args[0]), ['gifts:updated']);
  assert.equal((await a.invoke('gv:gifts:read')).gifts[0].name, 'バラ');
});

test('起動時の自動更新: TikTok ID がなければ取らず、同じ ID で24時間以内に取ってあれば取らない', async t => {
  const x = setup(t, { username: '' });
  assert.deepEqual(await x.viewer.autoUpdateGiftsIfStale(), { skipped: 'username' });
  fs.writeFileSync(x.configPath, JSON.stringify({ tiktokUsername: '@akahoridouma' }));
  fs.writeFileSync(path.join(x.gv, 'gifts.min.json'), '[]');
  fs.writeFileSync(path.join(x.gv, 'gifts.meta.json'), JSON.stringify({ username: 'akahoridouma', count: 1, generatedAt: new Date().toISOString() }));
  assert.deepEqual(await x.viewer.autoUpdateGiftsIfStale(), { skipped: 'fresh' });
  assert.equal(x.log.length, 0);
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/gifts-viewer-module.test.cjs`
Expected: FAIL（`Cannot find module '../gifts_viewer.cjs'`）。

- [ ] **Step 3: `electron/gifts_viewer.cjs` を作り、main.cjs を直す**

- 上の「移すもの」を `createGiftsViewer` の中へ移す（`giftUpdateTask`・`giftUpdateUsername` も中へ）。区切りのコメントも一緒に移す。
- main.cjs の `bridgeSettings.register(ipcMain);` の次に足す:

```js
const { createGiftsViewer } = require('./gifts_viewer.cjs');
const giftsViewer = createGiftsViewer({
  BrowserWindow, shell, net, clipboard, nativeImage, runProc, eulerCredentials,
  getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath, ensureDir,
  getGvDataDir, getGvSettingsPath, getGvToolPath, getNodeCommand,
  ensureNodeRuntimeAvailable: () => ensureNodeRuntimeAvailable(),
});
const { autoUpdateGiftsIfStale } = giftsViewer;
giftsViewer.register(ipcMain);
```

- `app.whenReady()` の中の `autoUpdateGiftsIfStale()` はそのまま（上で受け取った名前を使う）。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/gifts-viewer-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。app-regressions の「ギフト更新」2件と「テキストコピー」「Euler IPC」も通る）。

Run: `Select-String -Path electron/main.cjs -Pattern 'giftUpdateTask|performGiftUpdate|function updateGifts|fetchGiftImage|ipcMain.handle\("(gifts:|gv:|clipboard:)'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/gifts_viewer.cjs electron/test/gifts-viewer-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: ギフト一覧を electron/gifts_viewer.cjs に分ける」
```

---

### Task 6: 全体の確かめ・本物の Electron での確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番「main.cjs の大きさ」の PR2 の行）
- Create（git に入れない）: scratchpad の `e2e-pr2.cjs`（PR1 の `e2e-pr1.cjs` をもとにする）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。test:app の件数は 408 に、この PR で足した件数（モジュール 14件・配線 4件）を足した数。

- [ ] **Step 2: 大きさを確かめる**

Run: `(Get-Content electron/main.cjs).Count` と、新しい5つのファイルの行数
Expected: main.cjs はおよそ 1,750 行（2,489 行から約 740 行減る）。新しいファイルはどれも 800 行以下。

- [ ] **Step 3: 開発版を本物の Electron で起動し、移した ipc を画面の中から呼ぶ（読むだけ）**

- 先に `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"` と、インストール版の MyGamePack が動いていないかを見る。動いていたら、止めてよいかをユーザーに聞く（2つ目の起動は1つ目に譲って終わるため）。
- `e2e-pr2.cjs` は PR1 と同じ起動のしかた（`ELECTRON_RUN_AS_NODE`・`ELECTRON_DEV` を外す、`--inspect`・`--remote-debugging-port`、終わる前に CDP の接続を閉じる、app-config.json と `bridge/config.minecraft.json` を退避して戻す）。ログインはしない。
- 画面の中から呼ぶもの（どれも読むだけ）: `gamesList`・`gamesClientFolders`・`configRead`・`configPath`・`bridgeRoot`・`settingsBackupsList`・`preflightRun`・`bridgeCommandsList`・`bridgeCommandsReadMeta`・`ttsSettingsRead`・`giftsRead`・`gvGiftsRead`・`gvSettingsRead`・`serverSetupStatus`・`serverCheckSetupComplete`・`serverForgeClientStatus`・`setupInspectEnvironment`。
- Expected: どれも例外にならず、形が合う（`gamesList` に `games` の配列と `modsOutdatedAfterUpdate`、`preflightRun` に `checks` の配列、`bridgeCommandsList` に1件以上、`ttsSettingsRead` に `engine`、`serverSetupStatus.state` が `idle`、`setupInspectEnvironment` に `java`・`bridge`）。閉じるボタンでアプリが終わる。
- 終わったら `git status --short` で、作業コピーに変わったファイルがないことを見る（`bridge/` が変わっていたら `git restore bridge/`）。

- [ ] **Step 4: HANDOFF を書く**

`HANDOFF/HANDOFF04.md` の「main.cjs の大きさ」の PR1 の行の次に足す（PR 番号は PR を出してから書き足す）:

```markdown
     - PR2（端の仕事）：`setup_ipc.cjs`・`games_ipc.cjs`・`tts_ipc.cjs`・`bridge_settings.cjs`・`gifts_viewer.cjs`。ブランチ `refactor/main-split-2`。main.cjs は 2,489行 → （Step 2 の行数）行。
     - PR2 から D 側の作業コピーで進めている（Codex の UI の作業が終わったため）。開発版を本物の Electron で起動し、移した ipc を読むだけで確かめた。
```

あわせて、PR1 の行のうち「Codex が D 側の作業コピーで UI/UX を直しているので、分割は scratchpad の worktree（`wt-split`）で進めている。」は「PR1 は」で始まる過去の記録に直す。

- [ ] **Step 5: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に main.cjs の分割 PR2 を書く」
```
