# main.cjs の分割 PR3（配布）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `electron/main.cjs` から BRIDGE の配布（差分同期・同梱 node の準備・BridgeMOD の jar・ゲーム MOD の入れ替え・サーバーテンプレートのコピー・BRIDGE の展開）を `electron/bridge_sync.cjs` に分ける（アプリの動きは変えない）。

**Architecture:** PR1・PR2 と同じ形。`createBridgeSync(deps)` が関数のまとまりと `register(ipcMain)` を返し、main.cjs は gifts_viewer の配線のあとで作って、今の関数名を分割代入で受ける。配布の処理はテストがほとんどないので、分ける前に main を通したテストで今の動きを固定してから移す。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（テストでは偽物の electron を vm で渡す）。

**Spec:** docs/superpowers/specs/2026-10-17-main-split-design.md

## Global Constraints

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。`electron/preload.cjs` と `src/` は変えない。ipc の窓口の一覧のテスト（116個と3個）はそのまま通ること。
- 関数の中の処理は、移すだけにする。直すのは、受け取る形を変えるのに必要な所だけ。`async` の有無も変えない（`bridge:syncStatus`・`server:copyTemplateStatus` は同期のまま）。
- `electron`・`child_process` は main.cjs だけが読み込む。`./process_runner.cjs` の `runProc` も main から渡す（テストの `loadApp` が偽物に差し替えるのは main が読み込んだものだけ）。
- モジュールの状態（`bridgeSyncState`・`copyTemplateState`）は `createBridgeSync` の中に置く（Node の require のキャッシュで、`loadApp` ごとの main の間で分け合わないため）。
- モジュールは自分の `__dirname`・`process` を使わず、main から `appDir`・`process` を受け取る。`fs`・`path`・`crypto` と、electron を読み込まない今の小さいモジュール（`./command_migration.cjs`・`./game_mods_refresh.cjs`・`./saikutu_commands.cjs`・`./bridge_mod_migration.cjs`）は自分で読み込んでよい。
- 正規表現でコードを見ているテスト（`game-mods-after-update`）が見る名前と並びは、移した先でも同じにする: `scheduleBridgeSync` → `refreshGameModsOnStartup` → `ensureBridgeExtracted` の順に並べ、中の `app`・`readAppConfig`・`writeAppConfig`・`gameProfiles`・`gameProfileOperation`・`win` の名前も変えない。
- main.cjs の一番外の `app`・`path`・`fs`・`crypto`・`getServerRoot` は消さない（`loadApp` がゲームの選択の記録を書くときに使う）。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `refactor/main-split-3`（origin/main の d97ccbd から切った）。
- 文書に Windows の場所を書くときは `/` 区切りにする（`\` と16進数が続くと `npm run build` が止まる）。
- git は PowerShell で行う。`git add` の前に `git hash-object -w <file>` を通す（D 側で Permission denied が続いたため）。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない。Write でファイルにしてから実行する。
- 1つのテストファイルは `node --test electron/test/<name>.test.cjs`。全体は `npm run verify`。PowerShell の `Select-String` で残りを探すときは `-CaseSensitive` を付ける。
- コメントは周りと同じく日本語。既存ファイルの改行（CRLF）は変えない。

## Review Focus

1. 配布版（`app.isPackaged === true`）で、同梱の BRIDGE・実行環境の manifest と zip・テンプレートを `process.resourcesPath` から、開発版でコマンド txt を `appDir` の1つ上から探すこと → Task 1 の「BRIDGE の展開」「テンプレートのコピー」と Task 2 の2つのモジュールのテストで確かめる。
2. BridgeMOD の jar を入れ替える前に、サーバーの子プロセスとポートの稼働の両方で止めること（PR4 でこの2つの持ち主が変わる） → Task 1 の「配線: BridgeMOD の jar の入れ替え」で確かめる。
3. zip の展開に main から受け取った `runProc` を使うこと（自分で読み込むと、テストの偽物が効かない） → Task 2 の「BRIDGE の実行環境」で確かめる。
4. 同期の状態・テンプレートのコピーの状態を、別々に作ったもの同士で分け合わないこと → Task 2 の「アプリ更新後の BRIDGE の同期」で確かめる（同期の状態）。テンプレートのコピーの状態は読んで確かめる。
5. アプリ更新後のゲーム MOD の入れ替え（`refreshGameModsOnStartup`）が、main から受け取った `gameProfiles`・`gameProfileOperation`・`BrowserWindow` を使うこと → 正規表現のテスト（`game-mods-after-update`）と、最終レビューで読んで確かめる（本物の入れ替えを動かすテストは重いので足さない）。

---

### Task 1: 配布の今の動きを main を通して固定する（分ける前）

**Files:**
- Modify: `electron/test/app-regressions.test.cjs`（下の3件と、手伝いの関数1つ）

**Interfaces:**
- Produces: `packagedBridgeResources(app): string`（`app.root/resources/bridge` に、同梱の BRIDGE の代わりを置いて、その場所を返す）。Task 2 は使わない。

- [ ] **Step 1: テストを書く**

`electron/test/app-regressions.test.cjs` の「配線: 配信前チェックは、main の BRIDGE の子プロセス…」のテストのあとに足す:

```js
// 配布版の同梱 BRIDGE（resources/bridge）の代わり。bundle の実行環境（node.exe 4バイト）・設定・コマンド txt を置く。
function packagedBridgeResources(app) {
  const src = path.join(app.root, 'resources', 'bridge');
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  fs.mkdirSync(path.join(src, 'commands', 'minecraft'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.js'), '// bridge');
  fs.writeFileSync(path.join(src, 'index.bundle.cjs'), '// bundle');
  fs.writeFileSync(path.join(src, 'node', 'node.exe'), 'node');
  fs.writeFileSync(path.join(src, 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'bundle', nodeExeBytes: 4 }));
  fs.writeFileSync(path.join(src, 'config.minecraft.json'), JSON.stringify({ tiktokUsername: 'template_user', rcon: { password: 'template-pass' }, mappings: [] }));
  fs.writeFileSync(path.join(src, 'commands', 'minecraft', 'zombie.txt'), 'say zombie\n');
  return src;
}

// BRIDGE の配布は bridge_sync.cjs へ移す（main.cjs の分割 PR3）。分ける前の動きをここで固定する。
test('配布: 初期セットアップの BRIDGE の展開は、同梱の BRIDGE を写し、新しい設定からアカウントを消し、2回目は利用者の設定を残す（配布版）', async t => {
  const app = loadApp(t);
  app.usePackagedPaths();
  packagedBridgeResources(app);
  assert.deepEqual(plainJson(await app.invoke('bridge:syncStatus')), { state: 'idle', phase: '', error: '', stats: null, updatedAt: null });
  const target = path.join(app.root, 'target');
  const dst = path.join(target, 'bridge');
  const first = await app.invoke('bridge:extractTo', target);
  assert.equal(first.dst, dst);
  assert.equal(first.stats.runtime.reason, 'adopt-existing');
  for (const file of ['index.js', 'index.bundle.cjs', path.join('node', 'node.exe'), path.join('commands', 'minecraft', 'zombie.txt')]) assert.ok(fs.existsSync(path.join(dst, file)), file);
  assert.ok(!fs.existsSync(path.join(dst, 'bridge-runtime-manifest.json')), '同梱の作業用ファイルは写さない');
  const config = JSON.parse(fs.readFileSync(path.join(dst, 'config.minecraft.json'), 'utf8'));
  assert.equal(config.tiktokUsername, '');
  assert.equal(config.rcon.password, '');
  assert.equal((await app.invoke('app:config:read')).bridgeVersion, 'test');
  fs.writeFileSync(path.join(dst, 'config.minecraft.json'), JSON.stringify({ ...config, tiktokUsername: 'my_account' }));
  fs.writeFileSync(path.join(dst, 'commands', 'minecraft', 'giant.txt'), 'say old\n');
  const second = await app.invoke('bridge:extractTo', target);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dst, 'config.minecraft.json'), 'utf8')).tiktokUsername, 'my_account');
  assert.ok(!fs.existsSync(path.join(dst, 'commands', 'minecraft', 'giant.txt')), '廃止したコマンドは消す');
  assert.equal(second.stats.removedFiles, 1);
});

test('配布: サーバーテンプレートのコピーは、今あるファイルを上書きせず、コマンド txt も置き、進み具合を返す（開発版）', async t => {
  const app = loadApp(t);
  const template = path.join(app.root, 'server', 'Douma_Craft');
  fs.mkdirSync(path.join(template, 'world'), { recursive: true });
  fs.writeFileSync(path.join(template, 'run.bat'), 'new');
  fs.writeFileSync(path.join(template, 'world', 'level.dat'), 'world');
  const target = path.join(app.root, 'target');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'run.bat'), 'old');
  assert.deepEqual(plainJson(await app.invoke('server:copyTemplate', target)), { ok: true });
  assert.equal(fs.readFileSync(path.join(target, 'run.bat'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(target, 'world', 'level.dat'), 'utf8'), 'world');
  assert.ok(fs.existsSync(path.join(target, 'bridge', 'commands', 'minecraft', 'zombie.txt')));
  const total = 2 + fs.readdirSync(path.join(app.root, 'bridge', 'commands', 'minecraft')).length;
  assert.deepEqual(plainJson(await app.invoke('server:copyTemplateStatus')), { state: 'done', copied: total, total, error: '' });
});

// BridgeMOD の jar の入れ替えは、サーバーの子プロセスとポートの稼働を見て止める（PR4 でこの2つの持ち主が変わる）。
test('配線: BridgeMOD の jar の入れ替えは、サーバーが動いている間（子プロセス・ポートのどちらでも）は止める', async t => {
  const app = loadApp(t);
  app.usePackagedPaths();
  packagedBridgeResources(app);
  const mods = path.join(app.root, 'resources', 'server', 'Douma_Craft', 'mods');
  fs.mkdirSync(mods, { recursive: true });
  fs.writeFileSync(path.join(mods, 'bridgemod-9.9.9.jar'), 'jar');
  const target = path.join(app.root, 'target');
  app.setServer({ pid: 4321, exitCode: null, signalCode: null });
  await assert.rejects(app.invoke('bridge:extractTo', target), /BridgeMODを入れ替える前にMinecraftサーバーを停止してください/, 'child');
  app.evaluate('serverProcRef = null; serverPid = null;');
  const listener = require('node:net').createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const running = path.join(app.root, 'running-server');
  fs.mkdirSync(running);
  fs.writeFileSync(path.join(running, 'server.properties'), `server-port=${listener.address().port}\n`);
  await app.invoke('app:config:write', { serverFolder: running });
  await assert.rejects(app.invoke('bridge:extractTo', target), /BridgeMODを入れ替える前にMinecraftサーバーを停止してください/, 'port');
});
```

- [ ] **Step 2: 分ける前の main.cjs で通ることを確かめる**

Run: `node --test --test-name-pattern="配布:|BridgeMOD の jar" electron/test/app-regressions.test.cjs`
Expected: PASS（3件）。

- [ ] **Step 3: わざと壊して、どのテストも本当に落ちることを確かめる**

main.cjs を1か所ずつ書き換えて Step 2 と同じコマンドを動かし、`git restore electron/main.cjs` で戻す（main.cjs に commit していない変更がないことを先に `git status --short` で確かめる）。
- `fresh.tiktokUsername = "";` を消す → Expected: 「BRIDGE の展開」が FAIL。
- `copyRecursiveAsync` の `if (!(await pathExists(dstPath))) {` を `if (true) {` にする → Expected: 「テンプレートのコピー」が FAIL。
- `refreshBridgeModJar` の `if (serverProcRef || (await isServerPortOpen())) {` を `if (await isServerPortOpen()) {` にする → Expected: 「BridgeMOD の jar」が FAIL（`Missing expected rejection: child`）。
- `if (serverProcRef || false) {` にする → Expected: 同じテストが FAIL（`Missing expected rejection: port`）。
- 戻したあと Step 2 をもう一度動かす → Expected: PASS（3件）。

- [ ] **Step 4: commit**

```powershell
git add electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「test: BRIDGE の配布とテンプレートのコピーの今の動きを固定する（main.cjs の分割 PR3 の前に）」
```

---

### Task 2: 配布を `electron/bridge_sync.cjs` に分ける

**Files:**
- Create: `electron/bridge_sync.cjs`
- Create: `electron/test/bridge-sync-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線、要らなくなった require）
- Modify: `electron/test/game-mods-after-update.test.cjs`（`scheduleBridgeSync`・`refreshGameModsOnStartup` を見る所）

**移すもの**（d97ccbd の行。すべてそのまま移す）
- 160: `ipcMain.handle("bridge:syncStatus", ...)`
- 162〜719: `// Bridge: resources → serverFolder/bridge へ差分同期` から `bridge:extractTo` の ipc まで（定数、`bridgeSyncState`・`setBridgeSyncState`、ファイルの手伝い、実行環境の準備、`ensureNodeRuntimeAvailable`、`getBridgeEntryPoint`、差分コピー、`writeBridgeSyncMarker`、`refreshBridgeModJar`、`scheduleBridgeSync`、`refreshGameModsOnStartup`、`ensureBridgeExtracted`、`bridge:extractTo`）
- 1641〜1719: `// IPC: サーバーテンプレートをコピー（空フォルダ対応）` から `server:copyTemplateStatus` まで

**Interfaces:**
- Consumes: main の `gameProfiles`・`gameProfileOperation`・`assertGameProfileIdle`（PR2 の games_ipc）、`runProc`、`isServerPortOpen()`（main。PR4 で server_process へ移る）。
- Produces: `createBridgeSync({ app, process, appDir, BrowserWindow, runProc, readAppConfig, writeAppConfig, getBridgeBatDir, getServerTemplatePath, gameProfiles, gameProfileOperation, assertGameProfileIdle, serverChild, isServerPortOpen })` → `{ ensureNodeRuntimeAvailable(): Promise, getBridgeEntryPoint(dir): string, scheduleBridgeSync(): void, refreshGameModsOnStartup(): Promise, ensureBridgeExtracted(): Promise, register(ipcMain) }`。`register` は `bridge:syncStatus`・`bridge:extractTo`・`server:copyTemplate`・`server:copyTemplateStatus` の4個を登録する。
  - `ensureBridgeExtracted` は main では使わない（テストで確かめるために返す）。
  - 中で変えるのは: `__dirname` → `appDir`（`getBridgeRuntimeArchivePath`・`getBridgeRuntimeManifestPath`・`getPackagedBridgeResourceDir`・テンプレートのコピーの `commandsSrc`）、`refreshBridgeModJar` の `serverProcRef` → `serverChild()`。`isServerPortOpen()` は受け取った関数をそのまま呼ぶ。
  - `getBridgeEntryPoint` は BRIDGE の起動（PR5）が使うが、今の置き場（配布の区切り）のまま移す。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/bridge-sync-module.test.cjs`:

```js
// BRIDGE の配布（差分同期・同梱 node の準備・BridgeMOD の jar・ゲーム MOD の入れ替え）・サーバーテンプレートのコピー・BRIDGE の展開（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridgeSync } = require('../bridge_sync.cjs');

function setup(t, { packaged = true, appConfig = () => ({}) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources'), server = path.join(root, 'server');
  fs.mkdirSync(path.join(resources, 'bridge'), { recursive: true });
  fs.mkdirSync(server, { recursive: true });
  let config = appConfig(server);
  const ran = [], sent = [], handlers = new Map();
  // zip の展開（tar.exe）の代わり。展開先に node.exe と依存パッケージを置く。
  const runProc = async (cmd, args, cwd) => {
    ran.push([cmd, ...args]);
    for (const [file, body] of [['node/node.exe', 'node'], ['node_modules/tiktok-live-connector/package.json', '{}'], ['node_modules/rcon-client/package.json', '{}']]) {
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), body);
    }
    return { out: '' };
  };
  const bridgeSync = createBridgeSync({
    app: { isPackaged: packaged, getVersion: () => '2.0.0', getPath: () => root },
    process: { resourcesPath: resources }, appDir: path.join(root, 'app', 'electron'),
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => sent.push(args) } }] },
    runProc,
    readAppConfig: () => config, writeAppConfig: patch => { config = { ...config, ...patch }; },
    getBridgeBatDir: () => path.join(server, 'bridge'),
    getServerTemplatePath: () => path.join(resources, 'server', 'Douma_Craft'),
    gameProfiles: {}, gameProfileOperation: async action => action(), assertGameProfileIdle: () => {},
    serverChild: () => null, isServerPortOpen: async () => false,
  });
  bridgeSync.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { resources, server, ran, sent, bridgeSync, config: () => config, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BRIDGE の実行環境: 開発版は何もしない。配布版で zip から展開するときは main から受け取った runProc で tar を動かし、進み具合を画面へ知らせる', async t => {
  const dev = setup(t, { packaged: false });
  assert.deepEqual(await dev.bridgeSync.ensureNodeRuntimeAvailable(), { ready: true, development: true });
  assert.equal(dev.ran.length, 0);
  const x = setup(t);
  const archive = path.join(x.resources, 'bridge', 'bridge-runtime.zip');
  fs.writeFileSync(archive, 'zip');
  fs.writeFileSync(path.join(x.resources, 'bridge', 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'archive', nodeExeBytes: 4 }));
  const result = await x.bridgeSync.ensureNodeRuntimeAvailable();
  assert.equal(result.reason, 'extracted');
  assert.deepEqual(x.ran, [['tar.exe', '-xf', archive, '-C', path.join(x.server, 'bridge')]]);
  assert.equal(x.sent[0][0], 'bridge:syncStatus');
  assert.equal(x.sent[0][1].phase, 'extracting-runtime');
  assert.equal(x.invoke('bridge:syncStatus').phase, 'extracting-runtime');
});

test('アプリ更新後の BRIDGE の同期: 違う版なら写して版を記録し、同じ版で展開済みなら写さない。同期の状態は作ったものごとに持つ', async t => {
  const x = setup(t, { appConfig: server => ({ setupComplete: true, serverFolder: server, bridgeVersion: '1.0.0' }) });
  const src = path.join(x.resources, 'bridge');
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.js'), '// bridge');
  fs.writeFileSync(path.join(src, 'index.bundle.cjs'), '// bundle');
  fs.writeFileSync(path.join(src, 'node', 'node.exe'), 'node');
  fs.writeFileSync(path.join(src, 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'bundle', nodeExeBytes: 4 }));
  await x.bridgeSync.ensureBridgeExtracted();
  assert.ok(fs.existsSync(path.join(x.server, 'bridge', 'index.js')));
  assert.equal(x.config().bridgeVersion, '2.0.0');
  assert.equal(x.invoke('bridge:syncStatus').state, 'done');
  await x.bridgeSync.ensureBridgeExtracted();
  assert.deepEqual([x.invoke('bridge:syncStatus').state, x.invoke('bridge:syncStatus').phase], ['current', 'skipped']);
  const other = setup(t);
  assert.equal(other.invoke('bridge:syncStatus').state, 'idle', '別に作ったものの同期の状態は変わらない');
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/bridge-sync-module.test.cjs`
Expected: FAIL（`Cannot find module '../bridge_sync.cjs'`）。

- [ ] **Step 3: `electron/bridge_sync.cjs` を作り、main.cjs とテストを直す**

- 上の「移すもの」を `createBridgeSync` の中へ移す（`let bridgeSyncState`・`let copyTemplateState` も中へ、`ipcMain.handle` は `register(ipcMain)` の中へ）。関数の並びは今のまま（`scheduleBridgeSync` → `refreshGameModsOnStartup` → `ensureBridgeExtracted`）。区切りのコメントも一緒に移す。
- main.cjs の `giftsViewer.register(ipcMain);` の次に足す:

```js
const { createBridgeSync } = require('./bridge_sync.cjs');
const bridgeSync = createBridgeSync({
  app, process, appDir: __dirname, BrowserWindow, runProc, readAppConfig, writeAppConfig, getBridgeBatDir, getServerTemplatePath,
  gameProfiles, gameProfileOperation, assertGameProfileIdle,
  serverChild: () => serverProcRef,
  isServerPortOpen: () => isServerPortOpen(),
});
// BRIDGE の配布は bridge_sync.cjs が持つ。起動時の同期・BRIDGE の起動・ギフトの取得・配信の確認が使う。
const { ensureNodeRuntimeAvailable, getBridgeEntryPoint, scheduleBridgeSync, refreshGameModsOnStartup } = bridgeSync;
bridgeSync.register(ipcMain);
```

- main.cjs の require から、使わなくなったものを消す: `./command_migration.cjs` の行、`./game_mods_refresh.cjs` の行（どちらも移したものだけが使う）。
- `electron/test/game-mods-after-update.test.cjs` の 180〜187行: `scheduleBridgeSync`・`refreshGameModsOnStartup` の切り出しは `read('electron/bridge_sync.cjs')` から行う。中の正規表現は変えない。コメントを1行足す: `// 起動時の同期とゲーム MOD の入れ替えは electron/bridge_sync.cjs へ移した（2026-10-17 main.cjs の分割 PR3）。`

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/bridge-sync-module.test.cjs electron/test/game-mods-after-update.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。Task 1 の3件も通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern 'BRIDGE_SYNC_MARKER|bridgeSyncState|copyTemplateState|copyBridgeDifferential|ensureBridgeRuntimeReady|function refreshBridgeModJar|function scheduleBridgeSync|function refreshGameModsOnStartup|ensureBridgeExtracted|migrateRetiredCommands|refreshGameModsAfterUpdate|ipcMain.handle\("(bridge:syncStatus|bridge:extractTo|server:copyTemplate)'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/bridge_sync.cjs electron/test/bridge-sync-module.test.cjs electron/main.cjs electron/test/game-mods-after-update.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: BRIDGE の配布を electron/bridge_sync.cjs に分ける」
```

---

### Task 3: 全体の確かめ・本物の Electron での確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番「main.cjs の大きさ」の PR3 の行）
- Create（git に入れない）: scratchpad の `e2e-pr3.cjs`（PR2 の `e2e-pr2.cjs` をもとにする）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。test:app は 435件（430件＋この PR の5件）。

- [ ] **Step 2: 大きさを確かめる**

Run: `(Get-Content electron/main.cjs).Count` と `(Get-Content electron/bridge_sync.cjs).Count`
Expected: main.cjs はおよそ 1,100 行。bridge_sync.cjs は 800 行以下（およそ 670 行）。

- [ ] **Step 3: 開発版を本物の Electron で起動し、画面の中から呼ぶ（読むだけ）**

- 先に electron と MyGamePack が動いていないかを見る。動いていたら、止めてよいかをユーザーに聞く。
- `e2e-pr3.cjs` は `e2e-pr2.cjs` を写し、呼ぶものに `bridgeSyncStatus`（`state` が `idle`）と `serverCopyTemplateStatus`（`state` が `idle`）を足す。PR2 で移した17個もそのまま呼ぶ（main の読み込みの順番が変わったので、起動と配線を確かめ直す）。
- Expected: どれも OK。閉じるボタンでアプリが終わる。アプリ設定・BRIDGE の設定は変わらず、バックアップも増えない。終わったら `git status --short` で作業コピーに変わったファイルがないことを見る。

- [ ] **Step 4: HANDOFF を書く**

`HANDOFF/HANDOFF04.md` の「main.cjs の大きさ」の PR2 の行のあとに足す（PR 番号は PR を出してから書き足す）:

```markdown
     - PR3（配布）：`bridge_sync.cjs`（ipc 4個。差分同期・同梱 node の準備・BridgeMOD の jar・ゲーム MOD の入れ替え・テンプレートのコピー・BRIDGE の展開）。ブランチ `refactor/main-split-3`。main.cjs は 1,730行 → （Step 2 の行数）行。
     - 配布の処理にはテストがほとんどなかったので、分ける前に main を通したテスト3件（BRIDGE の展開・テンプレートのコピー・BridgeMOD の jar の入れ替えを止める配線）で今の動きを固定してから移した。
```

PR2 の「次にやること」の行は、PR #112 のマージ（d97ccbd）を書いて、PR3 の次にやること（PR4：`server_process`・`map_operations`・`server_files`・`minecraft_client`）に書き換える。

- [ ] **Step 5: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に main.cjs の分割 PR3 を書く」
```
