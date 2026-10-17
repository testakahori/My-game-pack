# main.cjs の分割 PR4（サーバー側）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `electron/main.cjs` からサーバー側の4つの仕事（Minecraft の稼働と起動・サーバーの起動と停止・MAP の作業・サーバーのファイル）を別ファイルに分け、テストが main の中の変数を書き換えている所をモジュールの関数に置き換える（アプリの動きは変えない）。

**Architecture:** PR1〜PR3 と同じ形。`createXxx(deps)` が関数のまとまりと `register(ipcMain)` を返す。サーバーと MAP の「いま作業中か」は持ち主のモジュールが関数で出し、main とほかのモジュールは呼ばれたときに `serverProcess.isStarting()` のようにオブジェクトから読む。テストはその関数を一時的に差し替えて main の配線を確かめる。テストがほとんどない窓口は、分ける前に main を通したテストで今の動きを固定する。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（テストでは偽物の electron を vm で渡す）。

**Spec:** docs/superpowers/specs/2026-10-17-main-split-design.md

## Global Constraints

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。`electron/preload.cjs` と `src/` は変えない。ipc の窓口の一覧のテスト（116個と3個）はそのまま通ること。
- 関数の中の処理は、移すだけにする。直すのは、受け取る形を変えるのに必要な所だけ。`async` の有無も変えない（`presets:*`・`server:logs`・`server:datapack:deployNightVision` などは同期のまま）。
- `electron`・`child_process` は main.cjs だけが読み込む。`spawn` は main から渡す（テストの `mockServerSpawn` は main の `spawn` を差し替える）。
- モジュールの状態（子プロセス・ログ・起動中・停止中・MAP の作業中）は `createXxx` の中に置く。
- モジュールは自分の `__dirname`・`process` を使わず、main から受け取る。`fs`・`path` と、electron を読み込まない今の小さいモジュール（`./minecraft_processes.cjs`・`./map_saves.cjs`・`./stop_requests.cjs`・`./config_schema.cjs`・`./bridge_mod_migration.cjs`）は自分で読み込んでよい。
- main とほかのモジュールは、サーバーと MAP の「作業中か」を、呼ばれたときにオブジェクトから読む: `serverProcess.child()`・`serverProcess.isStarting()`・`serverProcess.isStopping()`・`serverProcess.isServerPortOpen()`・`serverProcess.assertMapServerStopped()`・`mapOperations.isBusy()`・`mapOperations.assertIdle()`。これらは分割代入で受けない（テストの `pretend` が差し替えて main の配線を確かめるため）。
- `serverProcess`・`mapOperations` は main.cjs の一番外の `const` に置く（テストの `vm.runInContext` から届くようにする。設計書 6）。
- テストが main の変数を書き換えていた所はなくす: `setServer` は `serverProcess.attach(child)`、`shortenServerWait` は `serverProcess.setStopWaitMs(30)`、`serverStarting`・`serverStopping`・`mapOperationBusy` の書き換えは `pretend`。`bridgeRestartTimer`・`bridgeProcRef`・`testEventReplyMs` は PR5 で扱うので、そのまま残す。
- PR5 の範囲（BRIDGE の起動・停止、BridgeMOD との通信、`waitForBridgeMod`、操作履歴・統計）は main に残す。サーバーの変数を読んでいた所だけを、モジュールの関数に置き換える。
- 移したコードの中で見つけた前からの不具合は直さず、HANDOFF の小さい問題に書く（例: `createWorldBackup` が未定義の `reason` を返そうとする。画面からは呼ばれていない）。
- 移す行が離れているモジュールは、PR3 と同じくスクリプトで main.cjs から切り出して写す（決めた置き換え以外は1文字も変えない。複数行のテンプレート文字列があれば止める）。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `refactor/main-split-4`（origin/main の 3e10a4f から切った）。行番号はすべて 3e10a4f の `electron/main.cjs`。
- 文書に Windows の場所を書くときは `/` 区切りにする。git は PowerShell で行い、`git add` の前に `git hash-object -w <file>` を通す。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない。Write でファイルにしてから実行する。PowerShell の `Select-String` で残りを探すときは `-CaseSensitive` を付ける。
- テストに RCON のパスワード・運営のパスワードを書かない（偽の値 `fixture-rcon` を使う。運営ログインが要る道はモジュールのテストで偽の `isOperatorAuthed` を使う）。
- コメントは周りと同じく日本語。既存ファイルの改行（CRLF）は変えない。

## Review Focus

1. サーバーの起動中・停止中・子プロセスを、ゲームの切り替え・初期セットアップ・アプリ設定の保存先・ウィンドウを閉じる・MAP の作業・BRIDGE の配布のすべてが、`serverProcess` の関数で見ること（1つでも古い変数や取り違えが残ると、作業中に別の操作が通ってしまう） → Task 3・Task 4 の配線のテスト（`pretend`・`setServer`）と、今の「MAP IPC」「server stop」のテストで確かめる。
2. 実際の利用者のサーバーの停止の待ちは今のまま 120 秒で、`setStopWaitMs` はテストだけが使うこと → Task 3 のモジュールのテストで確かめ、最終レビューで既定値を読んで確かめる。
3. MAP の作業の前に止めたサーバーと BRIDGE を、作業のあと main から受け取った関数で起動し直すこと → Task 4 のモジュールのテストで確かめる。
4. Minecraft の稼働の確かめが、main の `spawn`（テストでは差し替え）と main から受け取った `process.platform` を使うこと → Task 2 のモジュールのテストで確かめる。
5. テストがほとんどなかった窓口（server.properties・RCON パスワード・配布ワールド・OP の付与・ゲームルールの古い窓口・プリセット・Minecraft の起動・コンソールの送信）の動きが、分ける前と同じであること → Task 1 の main を通したテストで固定する。

---

### Task 1: テストがほとんどない窓口の今の動きを、main を通して固定する（分ける前）

**Files:**
- Modify: `electron/test/app-regressions.test.cjs`（下の6件）

- [ ] **Step 1: テストを書く**

`electron/test/app-regressions.test.cjs` の「配線: BridgeMOD の jar の入れ替えは…」のテストのあとに足す:

```js
// サーバー側の窓口は server_files・map_operations・minecraft_client・server_process へ移す（main.cjs の分割 PR4）。分ける前の動きをここで固定する。
test('サーバーのファイル: server.properties の読み書き・RCON パスワード・配布ワールドの一覧は、サーバーフォルダーの中を見る', async t => {
  const app = loadApp(t);
  const server = path.join(app.root, 'srv');
  fs.mkdirSync(path.join(server, 'haihu_world', 'stage1'), { recursive: true });
  fs.writeFileSync(path.join(server, 'haihu_world', 'note.txt'), '');
  await app.invoke('app:config:write', { serverFolder: server });
  await assert.rejects(app.invoke('server:props:read'), /server\.properties not found/);
  const props = path.join(server, 'server.properties');
  fs.writeFileSync(props, '#comment\r\nlevel-name=world\r\nmotd=hello \r\n');
  assert.deepEqual(plainJson(await app.invoke('server:props:read')), { 'level-name': 'world', motd: 'hello ' });
  assert.deepEqual(plainJson(await app.invoke('server:props:write', { motd: 'changed', 'allow-flight': 'true' })), { ok: true });
  assert.equal(fs.readFileSync(props, 'utf8'), '#comment\nlevel-name=world\nmotd=changed\n\nallow-flight=true');
  assert.deepEqual(plainJson(await app.invoke('server:rconpassword:read')), { found: false, password: '' });
  fs.writeFileSync(path.join(server, 'RCON_password.txt'), ' fixture-rcon \n');
  assert.deepEqual(plainJson(await app.invoke('server:rconpassword:read')), { found: true, password: 'fixture-rcon' });
  assert.deepEqual(plainJson(await app.invoke('server:worlds:list')), ['stage1']);
});

test('OP の付与: マイクラID の形を確かめ、サーバーが止まっていれば、ログインしたことのある ID を ops.json に直接書く', async t => {
  const app = loadApp(t);
  const server = path.join(app.root, 'srv');
  fs.mkdirSync(server);
  await app.invoke('app:config:write', { serverFolder: server, minecraftPlayerName: 'x' });
  await assert.rejects(app.invoke('minecraft:grantOp'), /マイクラIDが未設定か形式が不正です/);
  await app.invoke('app:config:write', { minecraftPlayerName: 'Steve_01' });
  fs.writeFileSync(path.join(server, 'usercache.json'), JSON.stringify([{ name: 'Steve_01', uuid: 'uuid-1' }]));
  // BridgeMOD にはつながらない（空いているポートを向ける）。
  const closed = require('node:net').createServer();
  await new Promise(resolve => closed.listen(0, '127.0.0.1', resolve));
  const port = closed.address().port;
  await new Promise(resolve => closed.close(resolve));
  const cfg = JSON.parse(fs.readFileSync(app.configPath)); cfg.options.bridgeModPort = port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  const result = await app.invoke('minecraft:grantOp');
  assert.equal(result.offline, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(server, 'ops.json'), 'utf8')), [{ uuid: 'uuid-1', name: 'Steve_01', level: 4, bypassesPlayerLimit: false }]);
  assert.equal(fs.readFileSync(path.join(app.root, 'bridge', 'commands', 'minecraft', '_op.txt'), 'utf8'), '# TITLE: OP付与\nop Steve_01\n');
});

test('ゲームルールの古い窓口: BridgeMOD が固定環境に対応していれば ok、そうでなければ止める', async t => {
  const app = loadApp(t);
  let fixed = true;
  await bridgeModStatus(t, app, () => ({ ok: true, environmentFixed: fixed }));
  assert.deepEqual(plainJson(await app.invoke('server:gamerules:apply')), { ok: true, transport: 'bridge_mod' });
  fixed = false;
  await assert.rejects(app.invoke('server:gamerules:apply'), /固定環境に対応したBridgeMODが必要です/);
  assert.deepEqual(plainJson(await app.invoke('server:datapack:deployNightVision')), { ok: true, managedBy: 'BridgeMOD' });
});

test('プリセット: 設定を名前を付けて保存し、一覧に出し、読み込むと設定へ戻す（名前の使えない文字は _ にする）', async t => {
  const app = loadApp(t);
  assert.deepEqual(plainJson(app.invoke('presets:save', 'a/b:c')), { ok: true });
  assert.deepEqual(plainJson(app.invoke('presets:list')), ['a_b_c.json']);
  await app.invoke('config:write', { ...(await app.invoke('config:read')), tiktokUsername: 'other_id' });
  assert.equal(app.invoke('presets:load', 'a_b_c.json').config.tiktokUsername, 'akahoridouma');
  assert.equal((await app.invoke('config:read')).tiktokUsername, 'akahoridouma');
  assert.throws(() => app.invoke('presets:save', '  '), /プリセット名が空です/);
  assert.throws(() => app.invoke('presets:load', 'missing.json'), /プリセットがありません/);
});

test('Minecraft の起動: アプリ設定で指定したランチャーを、切り離した子プロセスで開く', async t => {
  const app = loadApp(t);
  const launcher = path.join(app.root, 'MyLauncher.exe');
  fs.writeFileSync(launcher, '');
  await app.invoke('app:config:write', { minecraftLauncherPath: launcher });
  const spawned = [];
  app.mockServerSpawn((cmd, args, options) => { spawned.push([cmd, args, options]); return { unref() {} }; });
  assert.deepEqual(plainJson(await app.invoke('minecraft:launch')), { ok: true, path: launcher });
  assert.deepEqual(plainJson(spawned), [[launcher, [], { detached: true, stdio: 'ignore' }]]);
});

test('コンソールの送信: 運営ログインしていなければ、動いているサーバーにも送らない', async t => {
  const app = loadApp(t);
  const written = [];
  app.setServer({ pid: 1, exitCode: null, signalCode: null, stdin: { writable: true, write: text => written.push(text) } });
  await assert.rejects(app.invoke('server:command', '/say hi'), /運営ログインが必要です/);
  assert.deepEqual(written, []);
  app.setServer(null);
});
```

- [ ] **Step 2: 分ける前の main.cjs で通ることを確かめる**

Run: `node --test --test-name-pattern="^(サーバーのファイル|OP の付与|ゲームルールの古い窓口|プリセット|Minecraft の起動|コンソールの送信):" electron/test/app-regressions.test.cjs`
Expected: PASS（6件）。

- [ ] **Step 3: わざと壊して、どのテストも本当に落ちることを確かめる**

main.cjs を1か所ずつ書き換えて Step 2 を動かし、`git restore electron/main.cjs` で戻す（先に `git status --short` で main.cjs に変更がないことを確かめる）。
- `text = updated.join("\n");` → `text = updated.join("\r\n");` … Expected: 「サーバーのファイル」が FAIL。
- `level: 4, bypassesPlayerLimit: false` → `level: 3, bypassesPlayerLimit: false` … Expected: 「OP の付与」が FAIL。
- `if (status.environmentFixed !== true)` → `if (false)` … Expected: 「ゲームルールの古い窓口」が FAIL。
- `writeBridgeConfig(value, { alsoKnown: [value] });` を消す … Expected: 「プリセット」が FAIL。
- `const found = candidates.find((p) => fs.existsSync(p));` → `const found = null;` … Expected: 「Minecraft の起動」が FAIL。
- `if (!isOperatorAuthed())` → `if (false)` … Expected: 「コンソールの送信」が FAIL。
- 戻したあと Step 2 を動かす … Expected: PASS（6件）。

- [ ] **Step 4: commit**

```powershell
git add electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「test: サーバー側の窓口の今の動きを固定する（main.cjs の分割 PR4 の前に）」
```

---

### Task 2: Minecraft の稼働と起動を `electron/minecraft_client.cjs` に分ける

**Files:**
- Create: `electron/minecraft_client.cjs`
- Create: `electron/test/minecraft-client-module.test.cjs`
- Modify: `electron/main.cjs`（390〜417、975〜1011、配線、`./minecraft_processes.cjs` の require）

**Interfaces:**
- Produces: `createMinecraftClient({ process, spawn, readAppConfig, assertGameProfileIdle })` → `{ getMinecraftProcessStatus(strict = false): Promise<{ running, processes }>, register(ipcMain) }`。`register` は `minecraft:status`・`minecraft:launch` を登録する。
  - モジュールは `./minecraft_processes.cjs`（`tasklistNames`・`minecraftProcesses`・`readJavaCommandLines`）を自分で読み込む。`readJavaCommandLines()` は今と同じく引数なしで呼ぶ。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/minecraft-client-module.test.cjs`:

```js
// Minecraft のランチャー・ゲーム本体の稼働の確かめと、Minecraft の起動（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createMinecraftClient } = require('../minecraft_client.cjs');

function setup(t, { platform = 'win32', csv = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-client-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], spawned = [], config = {}, handlers = new Map();
  // tasklist.exe の代わり。渡した CSV を出して終わる。ランチャーの起動は unref だけ受ける。
  const spawn = (cmd, args, options) => {
    spawned.push([cmd, args, options]);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {}, unref() {} });
    setImmediate(() => { if (csv) child.stdout.emit('data', Buffer.from(csv)); child.emit('close', 0); });
    return child;
  };
  const client = createMinecraftClient({ process: { platform, env: {} }, spawn, readAppConfig: () => config, assertGameProfileIdle: () => calls.push('gameProfileIdle') });
  client.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, calls, spawned, config, client, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('Minecraft の稼働: Windows 以外は調べない。Windows では main から受け取った spawn で tasklist を読み、ランチャーとゲーム本体を数える', async t => {
  const other = setup(t, { platform: 'linux' });
  assert.deepEqual(await other.client.getMinecraftProcessStatus(), { running: false, processes: [] });
  assert.equal(other.spawned.length, 0);
  const win = setup(t, { csv: '"MinecraftLauncher.exe","100","Console","1","10,000 K"\r\n"javaw.exe","200","Console","1","10,000 K"\r\n"notepad.exe","300","Console","1","1,000 K"\r\n' });
  assert.deepEqual(await win.invoke('minecraft:status'), { running: true, processes: ['minecraftlauncher.exe', 'javaw.exe'] });
  assert.deepEqual(win.spawned[0].slice(0, 2), ['tasklist.exe', ['/FO', 'CSV', '/NH']]);
  const empty = setup(t);
  await assert.rejects(empty.client.getMinecraftProcessStatus(true), /Minecraftの停止状態を確認できません。切替を中止しました/);
});

test('Minecraft の起動: アプリ設定のランチャーを main から受け取った spawn で開く', async t => {
  const x = setup(t);
  const launcher = path.join(x.dir, 'MyLauncher.exe');
  fs.writeFileSync(launcher, '');
  x.config.minecraftLauncherPath = launcher;
  assert.deepEqual(await x.invoke('minecraft:launch'), { ok: true, path: launcher });
  assert.deepEqual(x.spawned.at(-1), [launcher, [], { detached: true, stdio: 'ignore' }]);
  assert.deepEqual(x.calls, ['gameProfileIdle']);
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/minecraft-client-module.test.cjs`
Expected: FAIL（`Cannot find module '../minecraft_client.cjs'`）。

- [ ] **Step 3: `electron/minecraft_client.cjs` を作り、main.cjs を直す**

- main.cjs の 390〜417（`// IPC: Minecraft ランチャー/ゲーム本体の稼働検知` の区切りから `minecraft:status` まで）と 975〜1011（`// IPC: Minecraft 起動` の区切りから `minecraft:launch` まで）を `createMinecraftClient` の中へ移す（`ipcMain.handle` は `register` の中へ）。中の処理は変えない（`process`・`spawn` は受け取ったもの）。
- main.cjs の `bridgeSync.register(ipcMain);` の次に足す:

```js
const { createMinecraftClient } = require('./minecraft_client.cjs');
const minecraftClient = createMinecraftClient({ process, spawn, readAppConfig, assertGameProfileIdle });
minecraftClient.register(ipcMain);
```

- gamesIpc の `getMinecraftProcessStatus: strict => getMinecraftProcessStatus(strict),` を `getMinecraftProcessStatus: strict => minecraftClient.getMinecraftProcessStatus(strict),` にする。
- main.cjs の `./minecraft_processes.cjs` の require の行を消す。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/minecraft-client-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern 'tasklistNames|minecraftProcesses|readJavaCommandLines|getMinecraftLauncherCandidates|async function getMinecraftProcessStatus|ipcMain.handle\("minecraft:(status|launch)'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/minecraft_client.cjs electron/test/minecraft-client-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: Minecraft の稼働と起動を electron/minecraft_client.cjs に分ける」
```

---

### Task 3: サーバーの起動と停止を `electron/server_process.cjs` に分ける

**Files:**
- Create: `electron/server_process.cjs`
- Create: `electron/test/server-process-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線、サーバーの変数を読んでいた所）
- Modify: `electron/test/app-regressions.test.cjs`（`loadApp` の `setServer`・`shortenServerWait`、`pretend` を足す、配線のテスト）

**移すもの**（3e10a4f の行。スクリプトで切り出して写す）
- 168〜174: `// IPC: サーバー起動 (run.bat)` の区切りと `serverPid`・`serverProcRef`・`SERVER_LOG_LIMIT`・`serverLogBuffer`（175〜181 の BRIDGE の変数は main に残す）
- 222〜239: `appendServerLog`・`pipeServerStream`
- 241〜364: `startServer`・`server:start`・`server:stop`・`server:logs`・`server:command`・`getServerProcessStatus`・`server:processStatus`
- 837〜838: `serverStarting`・`serverStopping`（836 の `mapOperationBusy` は Task 4）
- 842〜864: `portIsOpen`・`assertMapServerStopped`・`isServerPortOpen`
- 866〜887: `waitChildExit`・`stopMapServer`

**Interfaces:**
- Consumes: main の `assertGameProfileIdle`・`isInitialSetupRunning()`・`isOperatorAuthed()`・`stopRequests`、`mapSaves`・`assertMapIdle`（Task 4 までは main、そのあと `mapOperations`）、`requestBridgeMod`・`BRIDGE_MOD_AUTH_FAILED`（PR5 までは main）。
- Produces: `createServerProcess({ app, process, spawn, getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, assertMapIdle, isInitialSetupRunning, recoverMapSaves, requestBridgeMod, authFailedMessage, isOperatorAuthed, stopRequests })` → `{ child(), isStarting(): boolean, isStopping(): boolean, attach(child), appendLog(message), startServer(resumeAfterMap = false): Promise, stopMapServer(origin): Promise, assertMapServerStopped(): Promise, getServerProcessStatus(): Promise, isServerPortOpen(): Promise<boolean>, waitChildExit(child, timeoutMs): Promise<boolean>, setStopWaitMs(ms), register(ipcMain) }`。`register` は `server:start`・`server:stop`・`server:logs`・`server:command`・`server:processStatus` の5個を登録する。
  - `attach(child)`: `serverProcRef = child || null; serverPid = child?.pid || null;` だけを行う（テストの偽の子プロセスは `on` を持たないことがある）。`startServer` も子プロセスを持たせるときは `attach(proc)` を使う。
  - `setStopWaitMs(ms)`: `stopMapServer` の保存の完了の待ち（既定 120000 ミリ秒）を変える。テストで待ちを短くするためにだけ使う（コメントにそう書く）。
  - 中で変えるのは: `await mapSaves.recover();` → `await recoverMapSaves();`、`BRIDGE_MOD_AUTH_FAILED` → `authFailedMessage()`、`stopMapServer` の `waitChildExit(child, 120000)` → `waitChildExit(child, stopWaitMs)`、`startServer` の `serverProcRef = proc; serverPid = proc.pid;` → `attach(proc);`。`isConsoleStop` はモジュールが `./stop_requests.cjs` から読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/server-process-module.test.cjs`:

```js
// Minecraft サーバーの起動・停止・ログ・稼働の確かめ（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createServerProcess } = require('../server_process.cjs');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-process-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'run.bat'), '');
  const calls = [], spawned = [], handlers = new Map();
  let release;
  const child = Object.assign(new EventEmitter(), { pid: 777, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  const serverProcess = createServerProcess({
    app: { isPackaged: true }, process: { env: {}, platform: 'win32' },
    spawn: (cmd, args, options) => { spawned.push([cmd, args, options]); return child; },
    getServerRoot: () => dir, getBridgeBatDir: () => path.join(dir, 'bridge'), getConfigPath: () => path.join(dir, 'config.json'),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'), assertMapIdle: () => calls.push('mapIdle'),
    isInitialSetupRunning: () => false,
    // MAP の保存の後始末の代わり。release() するまで返さない（その間は起動の準備中）。
    recoverMapSaves: () => new Promise(resolve => { release = resolve; }),
    requestBridgeMod: async () => { throw new Error('使わない'); },
    authFailedMessage: () => 'auth failed', isOperatorAuthed: () => true,
    stopRequests: { record: (kind, origin) => { calls.push(`record:${kind}:${origin}`); return '出どころ'; } },
  });
  serverProcess.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, calls, spawned, child, serverProcess, release: () => release(), invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('サーバーの起動: 準備の間は isStarting() が true で、重ねて起動・停止しない。起動した子プロセスは child() で見え、出力はログに入る', async t => {
  const x = setup(t);
  const starting = x.invoke('server:start');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.serverProcess.isStarting(), true);
  await assert.rejects(x.invoke('server:start'), /サーバーを起動・停止中です。完了までお待ちください。/);
  await assert.rejects(x.invoke('server:stop'), /サーバーを起動・停止中です。完了までお待ちください。/);
  x.release();
  assert.deepEqual(await starting, { ok: true });
  assert.equal(x.serverProcess.isStarting(), false);
  assert.equal(x.serverProcess.child(), x.child);
  assert.deepEqual(x.spawned.map(([cmd, args, options]) => [cmd, args, options.cwd, options.env.NO_PAUSE]), [['cmd.exe', ['/c', path.join(x.dir, 'run.bat')], x.dir, '1']]);
  x.child.stdout.emit('data', Buffer.from('Done (1.0s)!\n'));
  assert.ok(x.invoke('server:logs').lines.some(line => line.endsWith('Done (1.0s)!')));
});

test('サーバーの停止: 保存の完了を待つ間は isStopping() が true。setStopWaitMs で待ちを短くすると、止まらないときは強制終了せずに知らせる', async t => {
  const x = setup(t);
  const written = [];
  const server = Object.assign(new EventEmitter(), { pid: 888, exitCode: null, signalCode: null, stdin: { writable: true, write: text => written.push(text) } });
  x.serverProcess.attach(server);
  x.serverProcess.setStopWaitMs(30);
  const stopping = x.invoke('server:stop', 'home:stop');
  assert.equal(x.serverProcess.isStopping(), true);
  await assert.rejects(stopping, /強制終了せずに待機しています/);
  assert.deepEqual(written, ['stop\n']);
  assert.ok(x.calls.includes('record:server:home:stop'));
  assert.equal(x.serverProcess.isStopping(), false);
  assert.equal(x.serverProcess.child(), server, '止まらなかったサーバーは持ったまま');
  x.serverProcess.attach(null);
  assert.equal(x.serverProcess.child(), null);
});
```

- [ ] **Step 2: テストの偽の環境と、配線のテストを直す**

`electron/test/app-regressions.test.cjs` の `loadApp` の戻り値:
- `setServer` を `setServer: child => { context.fixtureChild = child; vm.runInContext('serverProcess.attach(fixtureChild);', context); },` にする。
- `shortenServerWait` を `shortenServerWait: () => vm.runInContext('serverProcess.setStopWaitMs(30);', context),` にする。
- 次を足す:

```js
    // モジュールが外に出す関数を、確かめる間だけ差し替える（main の配線の確かめ用。main.cjs の分割 PR4）。元に戻す関数を返す。
    pretend: (target, replacement) => {
      const original = vm.runInContext(target, context);
      context.__pretendValue = replacement;
      vm.runInContext(`${target} = __pretendValue;`, context);
      return () => { context.__pretendValue = original; vm.runInContext(`${target} = __pretendValue;`, context); };
    },
```

配線のテストを直す（main の変数ではなくなるので、書き換えても何も起きない）:
- 「配線: サーバーの起動中は保存先を変えず…」: `app.evaluate('serverStarting = true;')` 〜 `app.evaluate('serverStarting = false;')` は `const restore = app.pretend('serverProcess.isStarting', () => true);` 〜 `restore();` にする。`for (const flag of [...])` は、`mapOperationBusy` だけを `evaluate` のまま残し、`serverStarting`・`serverStopping` は `for (const target of ['serverProcess.isStarting', 'serverProcess.isStopping']) { const back = app.pretend(target, () => true); assert.equal(app.evaluate('isAppBusy()'), true, target); back(); }` にする。
- 「配線: ゲームの切り替えは、初期セットアップ・サーバーの起動と停止…」: `['serverStarting = true', ...]`・`['serverStopping = true', ...]` の2つは、同じく `pretend('serverProcess.isStarting' / 'serverProcess.isStopping', () => true)` で確かめる。`bridgeRestartTimer` と `mapOperationBusy` の行は残す。
- `app.evaluate('serverProcRef = null; serverPid = null;')` の2か所（「BRIDGE やサーバーが動いている間」と「BridgeMOD の jar の入れ替え」）は `app.setServer(null);` にする。

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/server-process-module.test.cjs`
Expected: FAIL（`Cannot find module '../server_process.cjs'`）。

- [ ] **Step 4: `electron/server_process.cjs` を作り、main.cjs を直す**

- 上の「移すもの」をスクリプトで切り出して `createServerProcess` の中へ写し、Interfaces の置き換えだけをする。`let stopWaitMs = 120000;` と `attach`・`setStopWaitMs`・`child`・`isStarting`・`isStopping` を足す。
- main.cjs の `minecraftClient.register(ipcMain);` の次に足す:

```js
const { createServerProcess } = require('./server_process.cjs');
const serverProcess = createServerProcess({
  app, process, spawn, getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, isOperatorAuthed, stopRequests,
  assertMapIdle: () => assertMapIdle(),
  isInitialSetupRunning: () => isInitialSetupRunning(),
  recoverMapSaves: () => mapSaves.recover(),
  requestBridgeMod: (...args) => requestBridgeMod(...args),
  authFailedMessage: () => BRIDGE_MOD_AUTH_FAILED,
});
// サーバーの子プロセス・起動中・停止中は server_process.cjs が持つ。main とほかのモジュールは、呼ばれたときに serverProcess.xxx() で読む
// （テストが差し替えて配線を確かめるので、分割代入で受けない）。
const { appendLog: appendServerLog, startServer, stopMapServer, getServerProcessStatus, waitChildExit } = serverProcess;
serverProcess.register(ipcMain);
```

- main.cjs に残る所の置き換え（スクリプトで、置き換えた数を確かめる）:
  - `serverProcRef` → `serverProcess.child()`（setupIpc・bridgeSync の配線、`waitForBridgeMod`、`minecraft:grantOp`、`server:gamerules:apply`、`runMapOperation`）
  - `serverStarting` → `serverProcess.isStarting()`、`serverStopping` → `serverProcess.isStopping()`（appConfig・gamesIpc の配線、settingsBackups の `isRunning`、`isAppBusy`、`runMapOperation`）
  - bridgeSync の `isServerPortOpen: () => isServerPortOpen(),` → `isServerPortOpen: () => serverProcess.isServerPortOpen(),`
  - mapSaves の `assertStopped: assertMapServerStopped` → `assertStopped: () => serverProcess.assertMapServerStopped()`
- main.cjs の `require("./stop_requests.cjs")` からは `isConsoleStop` を外す（`server:command` と一緒に移るので、main では使わなくなる）。

- [ ] **Step 5: 動かす**

Run: `node --test electron/test/server-process-module.test.cjs electron/test/bridge-sync-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。今の「MAP IPC」「server startup」「server stop」「停止の記録」も通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern '\bserverProcRef\b|\bserverPid\b|serverLogBuffer|\bserverStarting\b|\bserverStopping\b|function portIsOpen|function isServerPortOpen|function waitChildExit|function stopMapServer|function startServer|ipcMain.handle\("server:(start|stop|logs|command|processStatus)"'`
Expected: 何も出ない。

Run: `Select-String -CaseSensitive -Path electron/test/app-regressions.test.cjs -Pattern 'serverProcRef|serverStarting|serverStopping|waitChildExit'`
Expected: 何も出ない。

- [ ] **Step 6: commit**

```powershell
git add electron/server_process.cjs electron/test/server-process-module.test.cjs electron/main.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: サーバーの起動と停止を electron/server_process.cjs に分ける」
```

---

### Task 4: MAP の作業とプリセットを `electron/map_operations.cjs` に分ける

**Files:**
- Create: `electron/map_operations.cjs`
- Create: `electron/test/map-operations-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線、MAP の変数と `assertMapIdle` を読んでいた所）
- Modify: `electron/test/app-regressions.test.cjs`（配線のテストの `mapOperationBusy`）

**移すもの**（3e10a4f の行）
- 836: `mapOperationBusy`、839〜841: `assertMapIdle`、865: `mapSaves` を作る行
- 888〜940: `runMapOperation`・`world:saves:*` の3個・`createWorldBackup`・`world:backup`・`getPresetDir`・`presets:*` の3個

**Interfaces:**
- Consumes: Task 3 の `serverProcess`（`startServer`・`stopMapServer`・`child()`・`isStarting()`・`isStopping()`・`assertMapServerStopped()`）、main の `stopBridge`・`launchBridge`・`bridgeProcRef`・`bridgeRestartTimer`（PR5 までは main）、PR2 の `readSavedBridgeConfig`・`writeBridgeConfig`。
- Produces: `createMapOperations({ getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, isInitialSetupRunning, isServerStarting, isServerStopping, serverChild, startServer, stopMapServer, assertMapServerStopped, isBridgeActive, stopBridge, launchBridge, readSavedBridgeConfig, writeBridgeConfig })` → `{ isBusy(): boolean, assertIdle(), mapSaves, register(ipcMain) }`。`register` は `world:saves:list`・`world:saves:save`・`world:saves:load`・`world:backup`・`presets:list`・`presets:save`・`presets:load` の7個を登録する。
  - `isBusy()` は今の `mapOperationBusy` そのもの（`mapSaves.isBusy()` は含めない。`isAppBusy`・設定のバックアップの `isRunning` が今読んでいるのはこの変数だけ）。`assertIdle()` は今の `assertMapIdle` の中身。
  - 中で変えるのは `runMapOperation` の `serverProcess.isStarting()` → `isServerStarting()`、`serverProcess.isStopping()` → `isServerStopping()`、`Boolean(serverProcess.child())` → `Boolean(serverChild())`、`Boolean(bridgeProcRef || bridgeRestartTimer)` → `isBridgeActive()`。`createWorldBackup` の未定義の `reason` はそのまま（HANDOFF に書く）。モジュールは `./map_saves.cjs`・`./config_schema.cjs` を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/map-operations-module.test.cjs`:

```js
// MAP の保存・読込とプリセット（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMapOperations } = require('../map_operations.cjs');

function setup(t, { serverRunning = false, bridgeActive = false, holdStop = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-operations-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'world'));
  fs.writeFileSync(path.join(root, 'world', 'level.dat'), 'world');
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=world\n');
  const calls = [], state = { starting: false }, handlers = new Map();
  let releaseStop;
  const mapOperations = createMapOperations({
    getServerRoot: () => root, getBridgeBatDir: () => path.join(root, 'bridge'), getConfigPath: () => path.join(root, 'config.json'),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    isInitialSetupRunning: () => false, isServerStarting: () => state.starting, isServerStopping: () => false,
    serverChild: () => (serverRunning ? { pid: 1 } : null),
    startServer: async resume => { calls.push(`startServer:${resume}`); },
    // サーバーの保存・停止の代わり。holdStop なら releaseStop() まで返さない（その間は MAP の作業中）。
    stopMapServer: origin => { calls.push(`stopMapServer:${origin}`); return holdStop ? new Promise(resolve => { releaseStop = resolve; }) : Promise.resolve(); },
    assertMapServerStopped: async () => {},
    isBridgeActive: () => bridgeActive,
    stopBridge: async origin => { calls.push(`stopBridge:${origin}`); },
    launchBridge: async () => { calls.push('launchBridge'); },
    readSavedBridgeConfig: () => null, writeBridgeConfig: () => ({ ok: true }),
  });
  mapOperations.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { calls, state, mapOperations, releaseStop: () => releaseStop(), invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('MAP の作業: 作業の間は isBusy() が true で assertIdle() が止める。サーバーの準備・停止中は始めない（main から受け取った関数で見る）', async t => {
  const x = setup(t, { holdStop: true });
  x.state.starting = true;
  await assert.rejects(x.invoke('world:saves:save', 'first'), /サーバーの準備・停止が終わるまでお待ちください。/);
  x.state.starting = false;
  const saving = x.invoke('world:saves:save', 'first');
  assert.equal(x.mapOperations.isBusy(), true);
  assert.throws(() => x.mapOperations.assertIdle(), /MAPを保存・読込中です。完了までお待ちください。/);
  x.releaseStop();
  const result = await saving;
  assert.equal(result.saved.name, 'first');
  assert.equal(result.restarted, false);
  assert.equal(x.mapOperations.isBusy(), false);
  x.mapOperations.assertIdle();
});

test('MAP の作業: 動いていたサーバーと BRIDGE は、止めて作業したあと main から受け取った関数で起動し直す', async t => {
  const x = setup(t, { serverRunning: true, bridgeActive: true });
  const result = await x.invoke('world:saves:save', 'second');
  assert.equal(result.restarted, true);
  assert.equal(result.restartError, '');
  assert.deepEqual(x.calls, ['gameProfileIdle', 'stopBridge:map:save', 'stopMapServer:map:save', 'startServer:true', 'launchBridge']);
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/map-operations-module.test.cjs`
Expected: FAIL（`Cannot find module '../map_operations.cjs'`）。

- [ ] **Step 3: `electron/map_operations.cjs` を作り、main.cjs とテストを直す**

- 上の「移すもの」をスクリプトで切り出して `createMapOperations` の中へ写し、Interfaces の置き換えだけをする。`isBusy`・`assertIdle`（今の `assertMapIdle` の名前で中に置き、外へは `assertIdle` として返す）を足す。
- main.cjs の `serverProcess.register(ipcMain);` の次に足す:

```js
const { createMapOperations } = require('./map_operations.cjs');
const mapOperations = createMapOperations({
  getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, readSavedBridgeConfig, writeBridgeConfig, startServer, stopMapServer,
  isInitialSetupRunning: () => isInitialSetupRunning(),
  isServerStarting: () => serverProcess.isStarting(),
  isServerStopping: () => serverProcess.isStopping(),
  serverChild: () => serverProcess.child(),
  assertMapServerStopped: () => serverProcess.assertMapServerStopped(),
  isBridgeActive: () => Boolean(bridgeProcRef || bridgeRestartTimer),
  stopBridge: origin => stopBridge(origin),
  launchBridge: () => launchBridge(),
});
// MAP の作業中は map_operations.cjs が持つ。main とほかのモジュールは、呼ばれたときに mapOperations.xxx() で読む。
mapOperations.register(ipcMain);
```

- main.cjs に残る所の置き換え（スクリプトで、置き換えた数を確かめる）:
  - `assertMapIdle()` → `mapOperations.assertIdle()`（appConfig・setupIpc・gamesIpc・serverProcess の配線の `() => assertMapIdle()` も、BRIDGE の ipc の中も）
  - `mapOperationBusy` → `mapOperations.isBusy()`（settingsBackups の `isRunning`、`isAppBusy`）
  - serverProcess の `recoverMapSaves: () => mapSaves.recover(),` → `recoverMapSaves: () => mapOperations.mapSaves.recover(),`
- `electron/test/app-regressions.test.cjs`:
  - 「配線: サーバーの起動中は保存先を変えず…」の `mapOperationBusy` の行は、`for` の差し替えの一覧に `'mapOperations.isBusy'` を足して確かめる。
  - 「配線: ゲームの切り替えは…」の `mapOperationBusy` の行は `const back = app.pretend('mapOperations.assertIdle', () => { throw new Error('MAPを保存・読込中です。完了までお待ちください。'); });` 〜 `back();` にする。

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/map-operations-module.test.cjs electron/test/server-process-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。今の「MAP IPC」2件と、Task 1 の「プリセット」も通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern '\bmapOperationBusy\b|function assertMapIdle|\bassertMapIdle\(\)|createMapSaves|function runMapOperation|function createWorldBackup|function getPresetDir|ipcMain.handle\(.(world:|presets:)'`
Expected: 何も出ない。

Run: `Select-String -CaseSensitive -Path electron/test/app-regressions.test.cjs -Pattern 'mapOperationBusy'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/map_operations.cjs electron/test/map-operations-module.test.cjs electron/main.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: MAP の作業とプリセットを electron/map_operations.cjs に分ける」
```

---

### Task 5: サーバーのファイルを `electron/server_files.cjs` に分ける

**Files:**
- Create: `electron/server_files.cjs`
- Create: `electron/test/server-files-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線）

**移すもの**（3e10a4f の行）
- 732〜735: `// IPC: マイクラIDへ OP 権限を付与` の区切り（そのあとの `waitForBridgeMod` は PR5 なので main に残す）
- 780〜830: `grantOpOffline`・`minecraft:grantOp`
- 1013〜1097: `server:props:read`・`server:props:write`・`server:rconpassword:read`・`server:gamerules:apply`・`server:datapack:deployNightVision`・`server:worlds:list`

**Interfaces:**
- Consumes: Task 3 の `serverProcess.child()`、Task 4 の `mapOperations.assertIdle()`、main の `waitForBridgeMod`・`requestBridgeMod`（PR5 までは main）。
- Produces: `createServerFiles({ getServerRoot, getBridgeBatDir, readAppConfig, assertMapIdle, serverChild, waitForBridgeMod, requestBridgeMod })` → `{ register(ipcMain) }`。`register` は上の7個を登録する。
  - 中で変えるのは `serverProcess.child()` → `serverChild()`、`mapOperations.assertIdle()` → `assertMapIdle()`。`waitForBridgeMod()`・`requestBridgeMod(...)` は受け取った関数を呼ぶ。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/server-files-module.test.cjs`:

```js
// server.properties・RCON パスワード・配布ワールド・OP の付与・ゲームルールの古い窓口（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServerFiles } = require('../server_files.cjs');

function setup(t, { running = false, mapBusy = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), calls = [], config = {}, handlers = new Map();
  createServerFiles({
    getServerRoot: () => root, getBridgeBatDir: () => bridge, readAppConfig: () => config,
    assertMapIdle: () => { if (mapBusy) throw new Error('MAPを保存・読込中です。完了までお待ちください。'); },
    serverChild: () => (running ? { pid: 1 } : null),
    waitForBridgeMod: async () => { calls.push('wait'); return true; },
    requestBridgeMod: async (...args) => { calls.push(args); return { ok: true, environmentFixed: true }; },
  }).register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, bridge, calls, config, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('OP の付与と古いゲームルールの窓口: サーバーが動いていれば BridgeMOD の応答を待ってから、main から受け取った通信で送る', async t => {
  const x = setup(t, { running: true });
  x.config.minecraftPlayerName = 'Steve_01';
  assert.deepEqual(await x.invoke('minecraft:grantOp'), { ok: true, name: 'Steve_01' });
  assert.deepEqual(x.calls, ['wait', ['POST', '/bridge/event', { type: 'other', key: '_op', count: 1, listenerName: 'system', announce: false }]]);
  assert.equal(fs.readFileSync(path.join(x.bridge, 'commands', 'minecraft', '_op.txt'), 'utf8'), '# TITLE: OP付与\nop Steve_01\n');
  x.calls.length = 0;
  assert.deepEqual(await x.invoke('server:gamerules:apply'), { ok: true, transport: 'bridge_mod' });
  assert.deepEqual(x.calls, ['wait', ['GET', '/bridge/status']]);
});

test('server.properties の書き込み: 先に MAP の作業中でないかを確かめる', async t => {
  const x = setup(t, { mapBusy: true });
  fs.writeFileSync(path.join(x.root, 'server.properties'), 'motd=old\n');
  await assert.rejects(x.invoke('server:props:write', { motd: 'new' }), /MAPを保存・読込中です/);
  assert.equal(fs.readFileSync(path.join(x.root, 'server.properties'), 'utf8'), 'motd=old\n');
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/server-files-module.test.cjs`
Expected: FAIL（`Cannot find module '../server_files.cjs'`）。

- [ ] **Step 3: `electron/server_files.cjs` を作り、main.cjs を直す**

- 上の「移すもの」をスクリプトで切り出して `createServerFiles` の中へ写し、Interfaces の置き換えだけをする。
- main.cjs の `mapOperations.register(ipcMain);` の次に足す:

```js
const { createServerFiles } = require('./server_files.cjs');
const serverFiles = createServerFiles({
  getServerRoot, getBridgeBatDir, readAppConfig,
  assertMapIdle: () => mapOperations.assertIdle(),
  serverChild: () => serverProcess.child(),
  waitForBridgeMod: () => waitForBridgeMod(),
  requestBridgeMod: (...args) => requestBridgeMod(...args),
});
serverFiles.register(ipcMain);
```

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/server-files-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。Task 1 の「サーバーのファイル」「OP の付与」「ゲームルールの古い窓口」も通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern 'function grantOpOffline|ipcMain.handle\("(minecraft:grantOp|server:props:|server:rconpassword:read|server:gamerules:apply|server:datapack:deployNightVision|server:worlds:list)'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/server_files.cjs electron/test/server-files-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: サーバーのファイルを electron/server_files.cjs に分ける」
```

---

### Task 6: 全体の確かめ・本物の Electron での確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番「main.cjs の大きさ」の PR4 の行と、見つけた前からの不具合）
- Create（git に入れない）: scratchpad の `e2e-pr4.cjs`（`e2e-pr3.cjs` をもとにする）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。test:app は 449件（435件＋この PR の14件）。

- [ ] **Step 2: 大きさを確かめる**

Run: main.cjs と新しい4つのファイルの行数
Expected: main.cjs はおよそ 690 行。新しいファイルはどれも 800 行以下（server_process はおよそ 240 行）。

- [ ] **Step 3: 開発版を本物の Electron で起動し、画面の中から呼ぶ（読むだけ）**

- 先に electron と MyGamePack が動いていないかを見る。動いていたら、止めてよいかをユーザーに聞く。
- `e2e-pr4.cjs` は `e2e-pr3.cjs` を写し、PR4 で移した読むだけの ipc を足す。preload の名前は `electron/preload.cjs` で確かめてから書く: サーバーの稼働（`running` が真偽）・サーバーのログ（`lines` が配列）・Minecraft の稼働（`processes` が配列）・MAP の一覧（`saves` が配列）・プリセットの一覧（配列）・server.properties の読み込み（オブジェクト）・RCON パスワード（`found` だけを表示し、パスワードは出さない）・配布ワールドの一覧（配列）。
- Expected: どれも OK。閉じるボタンでアプリが終わる。アプリ設定・BRIDGE の設定は変わらず、バックアップも増えない。終わったら `git status --short` で作業コピーに変わったファイルがないことを見る。

- [ ] **Step 4: HANDOFF を書く**

`HANDOFF/HANDOFF04.md` の「main.cjs の大きさ」の PR3 の行のあとに足す（PR 番号は PR を出してから書き足す）:

```markdown
     - PR4（サーバー側）：`minecraft_client.cjs`・`server_process.cjs`・`map_operations.cjs`・`server_files.cjs`（ipc 21個）。ブランチ `refactor/main-split-4`。main.cjs は 1,097行 → （Step 2 の行数）行。
     - テストが main の変数（`serverProcRef`・`serverStarting`・`serverStopping`・`mapOperationBusy`・`waitChildExit`）を書き換えていた所は、`serverProcess.attach`・`setStopWaitMs` と、モジュールの関数を一時的に差し替える `pretend` に置き換えた。
     - テストがほとんどなかった窓口（server.properties・RCON パスワード・配布ワールド・OP の付与・ゲームルールの古い窓口・プリセット・Minecraft の起動・コンソールの送信）は、分ける前に main を通したテスト6件で固定した。
```

小さい問題（このPRでは直さない）に足す:

```markdown
       - `world:backup` は MAP を保存したあと、未定義の `reason` を返そうとして ReferenceError になる（MAP の名前付き保存の PR #21 から）。画面からは呼ばれていない（preload にはある）。
```

PR3 の「次にやること」の行は、PR #113 のマージ（3e10a4f）を書いて、PR4 の次にやること（PR5：`bridge_process`・`bridge_mod_client`・`operations_stats`。テストの `setBridge`・`shortenTestEventReply`・`bridgeRestartTimer` を置き換える）に書き換える。

- [ ] **Step 5: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に main.cjs の分割 PR4 を書く」
```
