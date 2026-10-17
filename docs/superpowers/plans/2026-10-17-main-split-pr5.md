# main.cjs の分割 PR5（BRIDGE 側）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `electron/main.cjs` から BRIDGE 側の3つの仕事（操作履歴と統計・BridgeMOD との通信・BRIDGE の起動と停止）を別ファイルに分け、テストが main の BRIDGE の変数を書き換えている所をモジュールの関数に置き換える（アプリの動きは変えない）。

**Architecture:** PR1〜PR4 と同じ形。`createXxx(deps)` が関数のまとまりと `register(ipcMain)` を返す。BRIDGE の「動いているか」は `bridge_process` が関数で出し、main とほかのモジュールは呼ばれたときに `bridgeProcess.child()`・`bridgeProcess.isActive()` で読む。テストがない窓口は、分ける前に main を通したテストで固定する。PR4 の最終レビューにならい、main に足す配線は1行ずつ「壊すと落ちるテスト」があるようにする。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（テストでは偽物の electron を vm で渡す）。

**Spec:** docs/superpowers/specs/2026-10-17-main-split-design.md

## Global Constraints

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。`electron/preload.cjs` と `src/` は変えない。ipc の窓口の一覧のテスト（116個と3個）はそのまま通ること。
- 関数の中の処理は、移すだけにする。直すのは、受け取る形を変えるのに必要な所だけ。`async` の有無も変えない（`operations:earnings:save`・`stream:session:status`・`bridge:logs` などは同期のまま）。
- 例外（設計書 2）: 分ける前から誰も呼んでいない `killBridgeByCommandLine` は、移さずに消す。
- `electron`・`child_process` は main.cjs だけが読み込む。`spawn`・`spawnSync`・`runProc` は main から渡す。
- モジュールの状態（BRIDGE の子プロセス・再起動の待ち・ログ・テスト発火の実行中・BridgeMOD の待ちの時間切れの記録）は `createXxx` の中に置く。
- モジュールは自分の `__dirname`・`process` を使わず、main から受け取る。`fs`・`path`・`http`・`crypto` と、electron を読み込まない今の小さいモジュール（`./restart_policy.cjs`・`./tiktok_live_status.cjs`・`../bridge/bridge_mod_token.cjs`・`../bridge/command_files.cjs`・`./game_command_scope.cjs`・`./stream_sessions.cjs`・`./image_export.cjs`・`./stats_export.cjs`）は自分で読み込んでよい。
- main とほかのモジュールは、BRIDGE の状態を呼ばれたときにオブジェクトから読む: `bridgeProcess.child()`・`bridgeProcess.isActive()`。分割代入で受けない（テストの `pretend` が差し替えるため）。`launchBridge`・`stopBridge`・`requestBridgeMod`・`waitForBridgeMod` のような操作の関数は分割代入で受けてよい。
- `bridgeProcess`・`bridgeModClient`・`operationsStats` は main.cjs の一番外の `const` に置く。
- テストが main の変数を書き換えていた所はなくす: `setBridge` は `bridgeProcess.attach(child)`、`shortenTestEventReply` は `bridgeModClient.setTestEventReplyMs(50)`、`bridgeRestartTimer` の書き換えは `pretend('bridgeProcess.isActive', ...)`。PR5 のあと、テストが main の変数を書き換える所は残らない。
- 実際の利用者のテスト発火の返事の待ちは今のまま 15 秒（`setTestEventReplyMs` はテストだけが使う）。設計書 6 の例は `createBridgeModClient({ replyMs })` だが、テストの `loadApp` は main を読み込んだあとに変えるので、PR4 の `setStopWaitMs` と同じく関数で変える。
- 移すコードは PR3・PR4 と同じくスクリプトで main.cjs から切り出して写す（決めた置き換え以外は1文字も変えない。複数行のテンプレート文字列があれば止める）。
- 作業は D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）のブランチ `refactor/main-split-5`（origin/main の e7d757d から切った）。行番号はすべて e7d757d の `electron/main.cjs`。
- 文書に Windows の場所を書くときは `/` 区切りにする。git は PowerShell で行い、`git add` の前に `git hash-object -w <file>` を通す。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない。Write でファイルにしてから実行する。PowerShell の `Select-String` で残りを探すときは `-CaseSensitive` を付ける。
- コメントは周りと同じく日本語。既存ファイルの改行（CRLF）は変えない。

## Review Focus

1. BRIDGE が動いている・再起動を待っていることを、ゲームの切り替え・MAP の作業・設定の復元・配信前チェック・配信の記録・テスト発火のすべてが、`bridgeProcess` の関数で見ること → Task 4 の配線のテスト（`pretend`・`setBridge`）と、今の配信前チェック・テスト発火のテストで確かめる。
2. 実際の利用者のテスト発火の返事の待ちは今のまま 15 秒で、`setTestEventReplyMs` はテストだけが使うこと → Task 3 のモジュールのテストで確かめ、最終レビューで既定値を読んで確かめる。
3. BridgeMOD の認証の失敗（403）を、起動済みのサーバーの確かめ・OP の付与の前の待ちで、今と同じ文言で知らせ、サーバーのログに書くこと → Task 3 の配線のテストとモジュールのテストで確かめる。
4. 起動のときに操作履歴を JSONL に直し、30日より古い行を消すこと（`pruneOperationsHistoryOldRows` は `whenReady` から呼ぶ） → Task 2 のモジュールのテストで確かめ、最終レビューで `whenReady` の呼び出しを読んで確かめる。
5. `waitForBridgeMod` が、動いているサーバーで一度時間切れになったら同じサーバーでは待たないこと（一括起動で5分固まる事故の防止） → Task 3 のモジュールのテストで確かめる（main を通すと150秒待つので、配線は最終レビューで読んで確かめる）。

---

### Task 1: テストがない窓口の今の動きを、main を通して固定する（分ける前）

**Files:**
- Modify: `electron/test/app-regressions.test.cjs`（下の4件）

- [ ] **Step 1: テストを書く**

「配線: サーバーの起動の前に、中断した MAP の読込の後始末を map_operations に頼む」のテストのあとに足す:

```js
// BRIDGE 側の窓口は bridge_process・bridge_mod_client・operations_stats へ移す（main.cjs の分割 PR5）。分ける前の動きをここで固定する。
test('BRIDGE の状態・再起動: 動いている BRIDGE の pid と稼働を返し、再起動は止めてから起動し直す', async t => {
  const { EventEmitter } = require('node:events');
  const app = loadApp(t);
  fs.writeFileSync(path.join(app.root, 'bridge', 'index.js'), '');
  const pids = [];
  app.mockServerSpawn(() => {
    const child = new EventEmitter();
    const pid = 30000 + pids.length;
    pids.push(pid);
    Object.assign(child, { pid, stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, exitCode: null, signalCode: null,
      send: () => setImmediate(() => { child.exitCode = 0; child.emit('exit', 0); }) });
    return child;
  });
  assert.equal((await app.invoke('bridge:launch')).pid, 30000);
  const status = await app.invoke('bridge:processStatus');
  assert.deepEqual([status.running, status.pid, status.restartCount], [true, 30000, 0]);
  assert.equal((await app.invoke('bridge:restart', 'home:restart')).pid, 30001);
  assert.deepEqual(pids, [30000, 30001]);
  assert.ok((await app.invoke('bridge:logs')).lines.some(line => line.includes('[BRIDGE] PID 30001 で起動しました')));
  await app.invoke('bridge:stop');
  assert.equal((await app.invoke('bridge:processStatus')).running, false);
});

test('操作の履歴と統計: JSONL の履歴を新しい順に返し、コマンド・送り主ごとに回数で数え、消すと空にする', async t => {
  const app = loadApp(t);
  const history = path.join(app.root, 'bridge', 'operations-history.json');
  const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  fs.writeFileSync(history, [
    { at: at(3), sender: 'alice', commandFile: 'zombie.txt', count: 2, ok: true },
    { at: at(2), sender: 'bob', commandFile: 'zombie.txt', count: 0, ok: false },
    { at: at(1), sender: 'alice', commandFile: 'tnt.txt', ok: true },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  assert.deepEqual((await app.invoke('operations:history')).map(row => row.commandFile), ['tnt.txt', 'zombie.txt', 'zombie.txt']);
  assert.deepEqual(plainJson(await app.invoke('operations:stats')), { total: 3, succeeded: 2, failed: 1,
    topCommands: [{ name: 'zombie.txt', count: 2 }, { name: 'tnt.txt', count: 1 }],
    topSenders: [{ name: 'alice', count: 3 }, { name: 'bob', count: 0 }] });
  assert.deepEqual(plainJson(await app.invoke('operations:history:clear')), { ok: true });
  assert.equal(fs.readFileSync(history, 'utf8'), '[]');
  assert.deepEqual(plainJson(await app.invoke('operations:history')), []);
});

test('配信の受取額: 配信ごとに受取額を保存し、知らない配信は止める', async t => {
  const app = loadApp(t);
  const session = await app.invoke('stream:session:start', '受取額テスト');
  await new Promise(resolve => setTimeout(resolve, 5));
  await app.invoke('stream:session:end', { id: session.id });
  const stream = (await app.invoke('operations:streamStats', 90)).streams[0];
  assert.deepEqual(plainJson(app.invoke('operations:earnings:save', stream.id, 1200.5)), { ok: true });
  const saved = JSON.parse(fs.readFileSync(path.join(app.root, 'bridge', 'stream-earnings.json'), 'utf8'));
  assert.deepEqual(saved.map(row => [row.id, row.amount, row.currency]), [[stream.id, 1200.5, 'JPY']]);
  assert.throws(() => app.invoke('operations:earnings:save', 'missing', 1), /配信が見つかりません。/);
});

test('ギフト案内画像の保存: PNG だけを、選んだ場所に保存する', async t => {
  let savePath;
  const app = loadApp(t, undefined, undefined, { showSaveDialog: async () => ({ canceled: false, filePath: savePath }) });
  savePath = path.join(app.root, 'panel.png');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]).toString('base64');
  assert.deepEqual(plainJson(await app.invoke('image:saveGiftPanel', { dataUrl: 'data:image/png;base64,' + png, filename: 'panel.png' })), { canceled: false, path: savePath });
  assert.deepEqual([...fs.readFileSync(savePath)].slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  await assert.rejects(app.invoke('image:saveGiftPanel', { dataUrl: 'data:image/jpeg;base64,AAAA' }), /PNG画像のデータが不正です。/);
});
```

- [ ] **Step 2: 分ける前の main.cjs で通ることを確かめる**

Run: `node --test --test-name-pattern="^(BRIDGE の状態・再起動|操作の履歴と統計|配信の受取額|ギフト案内画像の保存):" electron/test/app-regressions.test.cjs`
Expected: PASS（4件）。

- [ ] **Step 3: わざと壊して、どのテストも本当に落ちることを確かめる**

main.cjs を1か所ずつ書き換えて Step 2 を動かし、`git restore electron/main.cjs` で戻す（先に `git status --short` で main.cjs に変更がないことを確かめる）。
- `bridge:restart` の中の `await stopBridge(origin);` を消す … Expected: 「BRIDGE の状態・再起動」が FAIL。
- `const amount = Number.isFinite(count) && count >= 0 ? count : 1;` → `const amount = 1;` … Expected: 「操作の履歴と統計」が FAIL。
- `operations:earnings:save` の `computeStreamStats().streams` → `[]` … Expected: 「配信の受取額」が FAIL。
- `saveGiftPanelPng(dialog, value)` → `({ canceled: true })` … Expected: 「ギフト案内画像の保存」が FAIL。
- 戻したあと Step 2 を動かす … Expected: PASS（4件）。

- [ ] **Step 4: commit**

```powershell
git add electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「test: BRIDGE 側の窓口の今の動きを固定する（main.cjs の分割 PR5 の前に）」
```

---

### Task 2: 操作履歴と統計を `electron/operations_stats.cjs` に分ける

**Files:**
- Create: `electron/operations_stats.cjs`
- Create: `electron/test/operations-stats-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線、16〜18 の require）
- Modify: `electron/test/bridge-minor-fixes.test.cjs`（41〜42行の切り出し元）

**移すもの**（e7d757d の行）
- 74: `streamSessions` を作る行
- 419〜486: `getOperationsHistoryPath`・`readOperationsHistory`・`migrateOperationsHistoryToJsonlIfNeeded`・`pruneOperationsHistoryOldRows`・`readViewerMetrics`
- 579〜588: `stream:session:status`・`stream:session:start`・`stream:session:end`・`image:saveGiftPanel`
- 634〜671: `operations:history`・`operations:history:clear`・`operations:stats`・`computeStreamStats`・`operations:stats:export`・`operations:earnings:save`・`operations:streamStats`

**Interfaces:**
- Consumes: main の `bridgeProcRef`（Task 4 までは main。`bridgeChild` で受け取る）。
- Produces: `createOperationsStats({ BrowserWindow, dialog, getBridgeBatDir, bridgeChild })` → `{ pruneOperationsHistoryOldRows(days = 30), readOperationsHistory(), register(ipcMain) }`。`register` は上の10個の ipc を登録する。
  - 中で変えるのは `stream:session:status` の `bridgeProcRef` → `bridgeChild()`（3か所）だけ。モジュールは `./stream_sessions.cjs`（`createStreamSessions`・`streamBuckets`）・`./image_export.cjs`・`./stats_export.cjs` を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/operations-stats-module.test.cjs`:

```js
// 操作履歴・配信統計・視聴者数・受取額・配信の記録・ギフト案内画像（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOperationsStats } = require('../operations_stats.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'operations-stats-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), state = { bridge: null }, handlers = new Map();
  fs.mkdirSync(bridge);
  const operationsStats = createOperationsStats({ BrowserWindow: { getFocusedWindow: () => null }, dialog: {}, getBridgeBatDir: () => bridge, bridgeChild: () => state.bridge });
  operationsStats.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, state, operationsStats, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('配信の記録の状態: main から受け取った BRIDGE の子プロセスがあるときだけ見張り中とし、記録の失敗を出す', t => {
  const x = setup(t);
  fs.writeFileSync(path.join(x.bridge, 'runtime-status.json'), JSON.stringify({ recording: { error: '記録できません' } }));
  assert.deepEqual(x.invoke('stream:session:status'), { active: null, monitoring: false, error: '' });
  x.state.bridge = { pid: 1 };
  assert.deepEqual(x.invoke('stream:session:status'), { active: null, monitoring: true, error: '記録できません' });
});

test('起動のときの履歴の整理: 古い配列の履歴を JSONL に直し、30日より古い行を消す', t => {
  const x = setup(t);
  const file = path.join(x.bridge, 'operations-history.json');
  const old = new Date(Date.now() - 40 * 86400000).toISOString(), recent = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify([{ at: recent, commandFile: 'new.txt' }, { at: old, commandFile: 'old.txt' }]));
  x.operationsStats.pruneOperationsHistoryOldRows(30);
  assert.deepEqual(fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line).commandFile), ['new.txt']);
  assert.deepEqual(x.invoke('operations:history').map(row => row.commandFile), ['new.txt']);
});
```

- [ ] **Step 2: 動かす**

Run: `node --test electron/test/operations-stats-module.test.cjs`
Expected: FAIL（`Cannot find module '../operations_stats.cjs'`）。

- [ ] **Step 3: `electron/operations_stats.cjs` を作り、main.cjs とテストを直す**

- 上の「移すもの」をスクリプトで切り出して `createOperationsStats` の中へ写す（`ipcMain.handle` は `register` の中へ）。
- main.cjs の `serverFiles.register(ipcMain);` の次に足す:

```js
const { createOperationsStats } = require('./operations_stats.cjs');
const operationsStats = createOperationsStats({ BrowserWindow, dialog, getBridgeBatDir, bridgeChild: () => bridgeProcRef });
// 起動のときに古い操作履歴を整理する（app.whenReady の中で呼ぶ）。
const { pruneOperationsHistoryOldRows } = operationsStats;
operationsStats.register(ipcMain);
```

- main.cjs の require から `./stream_sessions.cjs`・`./image_export.cjs`・`./stats_export.cjs` の3行を消す（移したものだけが使う）。
- `electron/test/bridge-minor-fixes.test.cjs` の 41〜42行: `read('electron/operations_stats.cjs')` から切り出す。中の正規表現は変えない。コメントを1行足す: `// 運用の統計は electron/operations_stats.cjs へ移した（2026-10-17 main.cjs の分割 PR5）。`

- [ ] **Step 4: 動かす**

Run: `node --test electron/test/operations-stats-module.test.cjs electron/test/bridge-minor-fixes.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。Task 1 の「操作の履歴と統計」「配信の受取額」「ギフト案内画像の保存」と、今の「配信統計」「統計IPC」も通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern 'createStreamSessions|streamSessions|function readOperationsHistory|function pruneOperationsHistoryOldRows|function readViewerMetrics|function computeStreamStats|saveGiftPanelPng|exportStreamStatsMarkdown|ipcMain.handle\(.(operations:|stream:session:|image:saveGiftPanel)'`
Expected: 何も出ない。

- [ ] **Step 5: commit**

```powershell
git add electron/operations_stats.cjs electron/test/operations-stats-module.test.cjs electron/main.cjs electron/test/bridge-minor-fixes.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: 操作履歴と統計を electron/operations_stats.cjs に分ける」
```

---

### Task 3: BridgeMOD との通信とテスト発火を `electron/bridge_mod_client.cjs` に分ける

**Files:**
- Create: `electron/bridge_mod_client.cjs`
- Create: `electron/test/bridge-mod-client-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線、require）
- Modify: `electron/test/app-regressions.test.cjs`（`shortenTestEventReply`、配線のテスト2件）

**移すもの**（e7d757d の行）
- 387: `BRIDGE_MOD_AUTH_FAILED`、389〜417: `requestBridgeMod`
- 488〜577: `mod:status`・`setDisruptionPause`・`mod:pause`・`mod:resume`・`testEventReplyMs`・`askBridgeTestEvent`・`BRIDGE_STOPPED_FOR_TEST`・`testEventRunning`・`mod:testEvent`
- 590〜632: `waitForBridgeMod` とその前の説明のコメント・`bridgeModWaitTimedOutFor`

**Interfaces:**
- Consumes: Task 2 までの main、PR4 の `serverProcess.child()`・`appendServerLog`、main の `bridgeProcRef`（Task 4 までは main。`bridgeChild` で受け取る）。
- Produces: `createBridgeModClient({ getConfigPath, getServerRoot, stopRequests, selectableCommandNames, gameProfiles, appendServerLog, serverChild, bridgeChild })` → `{ BRIDGE_MOD_AUTH_FAILED: string, requestBridgeMod(method, requestPath, body, configOverride): Promise, waitForBridgeMod(timeoutMs = 150000, intervalMs = 3000): Promise<boolean>, setTestEventReplyMs(ms), register(ipcMain) }`。`register` は `mod:status`・`mod:pause`・`mod:resume`・`mod:testEvent` の4個を登録する。
  - 中で変えるのは `bridgeProcRef` → `bridgeChild()`（2か所）、`serverProcess.child()` → `serverChild()`（5か所）。`setTestEventReplyMs(ms)` を足す（テストで返事の待ちを短くするためにだけ使う。コメントにそう書く）。
  - モジュールは `http`・`crypto`・`fs`・`../bridge/bridge_mod_token.cjs`・`../bridge/command_files.cjs`（`usesBridgeModTransport`）・`./game_command_scope.cjs`（`assertGameCommands`）を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/bridge-mod-client-module.test.cjs`:

```js
// BridgeMOD との通信・状態・一時停止と再開・テスト発火の受け渡し・応答待ち（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { createBridgeModClient } = require('../bridge_mod_client.cjs');
const { bridgeModTokenPath } = require('../../bridge/bridge_mod_token.cjs');

// 空いているポート（BridgeMOD がいない）。
async function closedPort() {
  const server = require('node:net').createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function setup(t, { port = 25576 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-mod-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ options: { commandTransport: 'bridge_mod', bridgeModHost: '127.0.0.1', bridgeModPort: port } }));
  const logs = [], state = { server: null, bridge: null }, handlers = new Map();
  const client = createBridgeModClient({
    getConfigPath: () => configPath, getServerRoot: () => root, stopRequests: { record: () => '出どころ' },
    selectableCommandNames: () => [], gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    appendServerLog: line => logs.push(line), serverChild: () => state.server, bridgeChild: () => state.bridge,
  });
  client.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, logs, state, client, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BridgeMOD との通信: 設定のポートへトークン付きで送り、403 は認証の失敗として直し方を返す', async t => {
  let status = 403;
  const tokens = [];
  const server = http.createServer((req, res) => { tokens.push(req.headers['x-bridge-token']); res.writeHead(status); res.end(JSON.stringify({ ok: true, tps: 20 })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const x = setup(t, { port: server.address().port });
  fs.mkdirSync(path.dirname(bridgeModTokenPath(x.root)), { recursive: true });
  fs.writeFileSync(bridgeModTokenPath(x.root), 'fixture-token\n');
  await assert.rejects(x.client.requestBridgeMod('GET', '/bridge/status'), error => error.authFailed === true && error.message === x.client.BRIDGE_MOD_AUTH_FAILED);
  status = 200;
  assert.deepEqual(await x.client.requestBridgeMod('GET', '/bridge/status'), { ok: true, tps: 20 });
  assert.deepEqual(tokens, ['fixture-token', 'fixture-token']);
});

test('BridgeMOD の応答待ち: 動いているサーバーで一度時間切れになったら、同じサーバーでは待たずに諦める（ログは main から受け取った関数へ）', async t => {
  const x = setup(t, { port: await closedPort() });
  x.state.server = { pid: 1 };
  assert.equal(await x.client.waitForBridgeMod(50, 10), false);
  assert.ok(x.logs.some(line => line.includes('Modの応答待ちがタイムアウトしました')));
  const count = x.logs.length;
  assert.equal(await x.client.waitForBridgeMod(50, 10), false);
  assert.equal(x.logs.length, count, '同じサーバーでは待たない');
});

test('テスト発火: main から受け取った BRIDGE の子プロセスへ送り、返事がなければ setTestEventReplyMs の時間で理由を返す', async t => {
  const x = setup(t);
  const asked = [];
  x.state.bridge = Object.assign(new EventEmitter(), { connected: true, send: (message, callback) => { asked.push(message.type); callback?.(null); return true; } });
  x.client.setTestEventReplyMs(30);
  await assert.rejects(x.invoke('mod:testEvent', { type: 'share', preview: true }), /BRIDGE から返事がありません/);
  assert.deepEqual(asked, ['testEvent']);
  x.state.bridge = null;
  assert.equal((await x.invoke('mod:testEvent', { type: 'share', preview: true })).bridgeStopped, true);
});
```

- [ ] **Step 2: main の配線のテストを足す（分ける前の動きを固定する）**

Task 1 のテストのあとに足す:

```js
// BridgeMOD の認証の失敗の文言とサーバーのログは、bridge_mod_client から main・server_process へ渡す（main.cjs の分割 PR5）。
async function bridgeModForbidden(t, app) {
  const mod = require('node:http').createServer((_req, res) => { res.writeHead(403); res.end('{}'); });
  await new Promise(resolve => mod.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => mod.close(resolve)));
  const cfg = JSON.parse(fs.readFileSync(app.configPath)); cfg.options.bridgeModHost = '127.0.0.1'; cfg.options.bridgeModPort = mod.address().port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
}

test('配線: 起動済みのサーバーで BridgeMOD の認証に失敗したら、BridgeMOD の文言で止める', async t => {
  const app = loadApp(t);
  await app.invoke('app:config:write', { serverFolder: app.root });
  const game = require('node:net').createServer(socket => socket.end());
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => game.close(resolve)));
  fs.writeFileSync(path.join(app.root, 'server.properties'), `level-name=world\nserver-port=${game.address().port}\n`);
  fs.writeFileSync(path.join(app.root, 'run.bat'), 'must never execute');
  await bridgeModForbidden(t, app);
  await assert.rejects(app.invoke('server:start'), /起動済みのサーバーが見つかりましたが、BridgeMODは応答していますが、認証に失敗しました。/);
});

test('配線: OP の付与の前の待ちで BridgeMOD の認証に失敗したら、サーバーのログに書く', async t => {
  const app = loadApp(t);
  await bridgeModForbidden(t, app);
  await app.invoke('app:config:write', { minecraftPlayerName: 'Steve_01' });
  app.setServer({ pid: 1, exitCode: null, signalCode: null });
  await assert.rejects(app.invoke('minecraft:grantOp'), /認証に失敗しました/);
  assert.ok((await app.invoke('server:logs')).lines.some(line => line.includes('[SERVER] BridgeMODは応答していますが、認証に失敗しました。')));
  app.setServer(null);
});
```

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/bridge-mod-client-module.test.cjs`
Expected: FAIL（`Cannot find module '../bridge_mod_client.cjs'`）。

Run: `node --test --test-name-pattern="^配線: (起動済みのサーバーで BridgeMOD|OP の付与の前の待ち)" electron/test/app-regressions.test.cjs`
Expected: PASS（2件。分ける前の main.cjs で通る）。

- [ ] **Step 4: `electron/bridge_mod_client.cjs` を作り、main.cjs とテストを直す**

- 上の「移すもの」をスクリプトで切り出して `createBridgeModClient` の中へ写し、Interfaces の置き換えだけをする。
- main.cjs の `operationsStats.register(ipcMain);` の次に足す:

```js
const { createBridgeModClient } = require('./bridge_mod_client.cjs');
const bridgeModClient = createBridgeModClient({
  getConfigPath, getServerRoot, stopRequests, selectableCommandNames, gameProfiles, appendServerLog,
  serverChild: () => serverProcess.child(),
  bridgeChild: () => bridgeProcRef,
});
// BridgeMOD との通信は bridge_mod_client.cjs が持つ。配信前チェック・サーバーの起動・OP の付与・ゲームルールが使う。
const { requestBridgeMod, waitForBridgeMod } = bridgeModClient;
bridgeModClient.register(ipcMain);
```

- serverProcess の `authFailedMessage: () => BRIDGE_MOD_AUTH_FAILED,` → `authFailedMessage: () => bridgeModClient.BRIDGE_MOD_AUTH_FAILED,`
- main.cjs の require から `http` の行と `../bridge/command_files.cjs` の行を消し、`../bridge/bridge_mod_token.cjs` からは `withBridgeModToken` を外す（`bridgeModTokenPath` は Task 4 まで BRIDGE の起動が使う）。
- `electron/test/app-regressions.test.cjs` の `shortenTestEventReply` を `shortenTestEventReply: () => vm.runInContext('bridgeModClient.setTestEventReplyMs(50);', context),` にする。

- [ ] **Step 5: 動かす**

Run: `node --test electron/test/bridge-mod-client-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。今のテスト発火・一時停止・配信前チェックのテストも通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern 'BRIDGE_MOD_AUTH_FAILED =|function requestBridgeMod|function waitForBridgeMod|testEventReplyMs|askBridgeTestEvent|testEventRunning|setDisruptionPause|withBridgeModToken|usesBridgeModTransport|require\("http"\)|ipcMain.handle\("mod:'`
Expected: 何も出ない。

Run: `Select-String -CaseSensitive -Path electron/test/app-regressions.test.cjs -Pattern 'testEventReplyMs'`
Expected: 何も出ない。

- [ ] **Step 6: commit**

```powershell
git add electron/bridge_mod_client.cjs electron/test/bridge-mod-client-module.test.cjs electron/main.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: BridgeMOD との通信とテスト発火を electron/bridge_mod_client.cjs に分ける」
```

---

### Task 4: BRIDGE の起動と停止を `electron/bridge_process.cjs` に分ける

**Files:**
- Create: `electron/bridge_process.cjs`
- Create: `electron/test/bridge-process-module.test.cjs`
- Modify: `electron/main.cjs`（下の「移すもの」、配線、BRIDGE の変数を読んでいた所、require）
- Modify: `electron/test/app-regressions.test.cjs`（`setBridge`、配線のテスト）

**移すもの**（e7d757d の行）
- 73: `bridgeEulerRevision`、206〜212: BRIDGE の状態（`bridgePid`・`bridgeProcRef`・`bridgeStopRequested`・`bridgeRestartTimer`・`bridgeRestartPolicy`・ログ）
- 214〜251: `appendBridgeLog`・`pipeBridgeStream`・`getProcessMetrics`
- 253〜275: `checkTikTokLive`・`tiktok:liveStatus`・`euler:*` の4個
- 277〜279・294〜385: `// IPC: Bridge 起動` の区切り、`launchBridge`・`stopBridge`・`bridge:launch`・`bridge:stop`・`bridge:restart`・`bridge:processStatus`・`bridge:logs`
- 消すもの: 280〜292 の `killBridgeByCommandLine` とその説明（分ける前から誰も呼んでいない）

**Interfaces:**
- Consumes: PR3 の `ensureNodeRuntimeAvailable`・`getBridgeEntryPoint`、PR4 の `waitChildExit`・`mapOperations.assertIdle()`、PR2 の `selectableCommandNames`・`gameProfiles`・`assertGameProfileIdle`、main の `eulerCredentials`・`stopRequests`。
- Produces: `createBridgeProcess({ process, spawn, spawnSync, shell, runProc, stopRequests, eulerCredentials, getBridgeBatDir, getServerRoot, getConfigPath, getNodeCommand, getGvToolPath, getBridgeEntryPoint, ensureNodeRuntimeAvailable, assertGameProfileIdle, selectableCommandNames, gameProfiles, waitChildExit, assertMapIdle })` → `{ child(), isActive(): boolean, attach(child), launchBridge(): Promise, stopBridge(origin): Promise, register(ipcMain) }`。`register` は `bridge:launch`・`bridge:stop`・`bridge:restart`・`bridge:processStatus`・`bridge:logs`・`tiktok:liveStatus`・`euler:status`・`euler:save`・`euler:clear`・`euler:openPortal` の10個を登録する。
  - `isActive()` は `Boolean(bridgeProcRef || bridgeRestartTimer)`（BRIDGE が動いている、または落ちて再起動を待っている）。`child()` は `bridgeProcRef`。`attach(child)` は `bridgeProcRef = child || null; bridgePid = child?.pid || null;` だけを行い、`launchBridge` も子プロセスを持たせるときは `attach(child)` を使う。
  - 中で変えるのは `mapOperations.assertIdle()` → `assertMapIdle()`（3か所）、`bridgeProcRef = child; bridgePid = child.pid;` → `attach(child);`。モジュールは `./restart_policy.cjs`・`./tiktok_live_status.cjs`・`../bridge/bridge_mod_token.cjs`（`bridgeModTokenPath`）・`./game_command_scope.cjs` を自分で読み込む。

- [ ] **Step 1: モジュールのテストを書く**

`electron/test/bridge-process-module.test.cjs`:

```js
// BRIDGE の起動・停止・再起動・ログ・状態、Euler の鍵、TikTok LIVE の確かめ（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBridgeProcess } = require('../bridge_process.cjs');
const { bridgeModTokenPath } = require('../../bridge/bridge_mod_token.cjs');

// 子プロセスの終わりを待つ（server_process の waitChildExit と同じ約束）。
const waitChildExit = (child, ms) => new Promise(resolve => {
  if (child.exitCode !== null) return resolve(true);
  const timer = setTimeout(() => resolve(false), ms);
  child.once('exit', () => { clearTimeout(timer); resolve(true); });
});

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-process-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), server = path.join(root, 'server');
  fs.mkdirSync(bridge); fs.mkdirSync(server);
  fs.writeFileSync(path.join(bridge, 'index.js'), '');
  fs.writeFileSync(path.join(bridge, 'config.minecraft.json'), '{}');
  const spawned = [], children = [], records = [], handlers = new Map();
  const spawn = (cmd, args, options) => {
    spawned.push([cmd, args, options]);
    const child = Object.assign(new EventEmitter(), { pid: 40000 + children.length, stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, exitCode: null, signalCode: null,
      send: () => setImmediate(() => { child.exitCode = 0; child.emit('exit', 0); }) });
    children.push(child);
    return child;
  };
  const bridgeProcess = createBridgeProcess({
    process: { platform: 'linux' }, spawn, spawnSync: () => ({ stdout: '' }), shell: { openExternal: async () => {} }, runProc: async () => ({ out: '{}' }),
    stopRequests: { record: (kind, origin) => { records.push(`${kind}:${origin}`); return '出どころ'; } },
    eulerCredentials: { runtime: () => ({ env: { FIXTURE: '1' }, revision: 7 }), status: (revision, running) => ({ revision, running }), save() {}, clear() {} },
    getBridgeBatDir: () => bridge, getServerRoot: () => server, getConfigPath: () => path.join(bridge, 'config.minecraft.json'),
    getNodeCommand: () => 'node-fixture', getGvToolPath: name => path.join(root, name),
    getBridgeEntryPoint: dir => path.join(dir, 'index.js'), ensureNodeRuntimeAvailable: async () => {},
    assertGameProfileIdle: () => {}, selectableCommandNames: () => [], gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    waitChildExit, assertMapIdle: () => {},
  });
  bridgeProcess.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, server, spawned, children, records, bridgeProcess, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BRIDGE の起動と停止: main から受け取った spawn・Euler の鍵・トークンの場所で起動し、child() と isActive() に出る。止めると消える', async t => {
  const x = setup(t);
  assert.equal(x.bridgeProcess.isActive(), false);
  assert.equal((await x.invoke('bridge:launch')).pid, 40000);
  const [cmd, args, options] = x.spawned[0];
  assert.deepEqual([cmd, args, options.cwd], ['node-fixture', [path.join(x.bridge, 'index.js'), '--config', path.join(x.bridge, 'config.minecraft.json')], x.bridge]);
  assert.deepEqual([options.env.FIXTURE, options.env.BRIDGE_MOD_TOKEN_FILE], ['1', bridgeModTokenPath(x.server)]);
  assert.equal(x.bridgeProcess.child(), x.children[0]);
  assert.equal(x.bridgeProcess.isActive(), true);
  assert.deepEqual(x.invoke('euler:status'), { revision: 7, running: true });
  await x.invoke('bridge:stop', 'home:stop');
  assert.deepEqual(x.records, ['bridge:home:stop']);
  assert.equal(x.bridgeProcess.child(), null);
  assert.equal(x.bridgeProcess.isActive(), false);
});

test('BRIDGE の自動再起動: 落ちて再起動を待つ間も isActive() が true（ゲームの切り替え・MAP の作業・設定の復元が止める）。止めると待ちも消える', async t => {
  const x = setup(t);
  await x.invoke('bridge:launch');
  x.children[0].exitCode = 1;
  x.children[0].emit('exit', 1);
  assert.equal(x.bridgeProcess.child(), null);
  assert.equal(x.bridgeProcess.isActive(), true, '再起動を待っている');
  await x.invoke('bridge:stop', 'home:stop');
  assert.equal(x.bridgeProcess.isActive(), false);
  assert.equal(x.spawned.length, 1, '止めたので再起動しない');
});
```

- [ ] **Step 2: main の配線のテストを足し、今のテストを直す**

`electron/test/app-regressions.test.cjs`:
- `setBridge` を `setBridge: child => { context.fixtureBridge = child; vm.runInContext('bridgeProcess.attach(fixtureBridge);', context); },` にする。
- 「配線: ゲームの切り替えは…」の `app.evaluate('bridgeRestartTimer = 1')` 〜 `app.evaluate('bridgeRestartTimer = null')` を `const backBridge = app.pretend('bridgeProcess.isActive', () => true);` 〜 `backBridge();` にする（同じ assert のまま）。
- 「配線: ゲームの切り替えは、BRIDGE やサーバーが動いている間は止める」の `app.evaluate('bridgeProcRef = null; bridgePid = null;')` を `app.setBridge(null);` にする。
- 「配線: サーバーの起動中・MAP の作業中は、設定のバックアップを復元しない」の差し替えの一覧に `'bridgeProcess.isActive'` を足す。
- 「配線: サーバーの起動中は、MAP の作業を始めない」のあとに足す:

```js
// BRIDGE が動いているか（再起動の待ちを含む）は bridge_process が持つ（main.cjs の分割 PR5）。
test('配線: MAP の作業は、BRIDGE が動いて（再起動を待って）いれば止めてから行い、あとで起動し直す', async t => {
  const app = loadApp(t);
  // 開発版の決まった場所のサーバー（loadApp がここでゲームを「保存」済みにしている。保存先を変えると BRIDGE の起動が TOP の確かめで止まる）。
  const server = path.join(app.root, 'server', 'Douma_Craft');
  fs.mkdirSync(path.join(server, 'world'), { recursive: true });
  fs.writeFileSync(path.join(server, 'world', 'level.dat'), 'world');
  fs.writeFileSync(path.join(server, 'server.properties'), 'level-name=world\nserver-port=39974\n');
  const back = app.pretend('bridgeProcess.isActive', () => true);
  const result = await app.invoke('world:saves:save', 'with-bridge');
  back();
  assert.equal(result.saved.name, 'with-bridge');
  assert.match(result.restartError, /Bridge entry not found/, 'あとで BRIDGE を起動し直そうとした（この偽の環境には BRIDGE がない）');
});

test('配線: 配信の記録の状態は、main の BRIDGE の子プロセスで見張り中かを決める', async t => {
  const app = loadApp(t);
  assert.equal((await app.invoke('stream:session:status')).monitoring, false);
  app.setBridge(fakeBridge(() => undefined).child);
  assert.equal((await app.invoke('stream:session:status')).monitoring, true);
  app.setBridge(null);
});
```

- [ ] **Step 3: 動かす**

Run: `node --test electron/test/bridge-process-module.test.cjs`
Expected: FAIL（`Cannot find module '../bridge_process.cjs'`）。

- [ ] **Step 4: `electron/bridge_process.cjs` を作り、main.cjs を直す**

- 上の「移すもの」をスクリプトで切り出して `createBridgeProcess` の中へ写し、Interfaces の置き換えだけをする。`killBridgeByCommandLine` は写さない。`child`・`isActive`・`attach` を足す。
- main.cjs の `bridgeModClient.register(ipcMain);` の次に足す:

```js
const { createBridgeProcess } = require('./bridge_process.cjs');
const bridgeProcess = createBridgeProcess({
  process, spawn, spawnSync, shell, runProc, stopRequests, eulerCredentials, getBridgeBatDir, getServerRoot, getConfigPath, getNodeCommand, getGvToolPath,
  getBridgeEntryPoint, ensureNodeRuntimeAvailable, assertGameProfileIdle, selectableCommandNames, gameProfiles, waitChildExit,
  assertMapIdle: () => mapOperations.assertIdle(),
});
// BRIDGE の子プロセス・再起動の待ちは bridge_process.cjs が持つ。main とほかのモジュールは、それを読む関数（child・isActive）を
// 呼ばれたときに bridgeProcess.xxx() で読み、分割代入では受けない（テストが差し替えて配線を確かめるため）。下の操作の関数は受けてよい。
const { launchBridge, stopBridge } = bridgeProcess;
bridgeProcess.register(ipcMain);
```

- main.cjs に残る所の置き換え（スクリプトで、置き換えた数を確かめる）:
  - `Boolean(bridgeProcRef || bridgeRestartTimer)` → `bridgeProcess.isActive()`（gamesIpc・mapOperations の配線）
  - settingsBackups の `isRunning` の `bridgeProcRef || bridgeRestartTimer || ` → `bridgeProcess.isActive() || `
  - bridgeSettings の `isBridgeRunning: () => Boolean(bridgeProcRef),` → `isBridgeRunning: () => Boolean(bridgeProcess.child()),`
  - operationsStats・bridgeModClient の `bridgeChild: () => bridgeProcRef` → `bridgeChild: () => bridgeProcess.child()`
- main.cjs の require から `./restart_policy.cjs` の行と `../bridge/bridge_mod_token.cjs` の行を消す（移したものだけが使う）。

- [ ] **Step 5: 動かす**

Run: `node --test electron/test/bridge-process-module.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS（全件。今の BRIDGE の停止の記録・Euler・テスト発火・配信前チェックのテストも通る）。

Run: `Select-String -CaseSensitive -Path electron/main.cjs -Pattern '\bbridgeProcRef\b|\bbridgePid\b|\bbridgeRestartTimer\b|bridgeRestartPolicy|bridgeLogBuffer|bridgeEulerRevision|killBridgeByCommandLine|function launchBridge|function stopBridge|function getProcessMetrics|checkTikTokLive|RestartPolicy|bridgeModTokenPath|ipcMain.handle\(.(bridge:(launch|stop|restart|processStatus|logs)|tiktok:|euler:)'`
Expected: 何も出ない。

Run: `Select-String -CaseSensitive -Path electron/test/app-regressions.test.cjs -Pattern 'bridgeProcRef|bridgePid|bridgeRestartTimer|testEventReplyMs|serverProcRef|mapOperationBusy'`
Expected: 何も出ない（テストが main の変数を書き換える所は残らない）。

- [ ] **Step 6: main の配線を1行ずつ壊して、どれかのテストが落ちることを確かめる**

PR4 の最終レビューにならい、PR5 で書き換えた配線を1行ずつ壊し（`bridgeProcess.isActive()` → `false`、`bridgeProcess.child()` → `null` など。gamesIpc・mapOperations・settingsBackups・bridgeSettings・operationsStats・bridgeModClient の6か所と、bridgeModClient の `serverChild`・`appendServerLog`、serverProcess の `authFailedMessage`）、`node --test electron/test/app-regressions.test.cjs` を動かして戻す（スクリプトで、最後に main.cjs が元のままかをハッシュで確かめる）。
Expected: bridgeModClient の `serverChild` 以外は、どれも1件以上落ちる。`serverChild` は時間切れの道だけが使うので main を通しては確かめられない（Review Focus 5。モジュールのテストで確かめる）。

- [ ] **Step 7: commit**

```powershell
git add electron/bridge_process.cjs electron/test/bridge-process-module.test.cjs electron/main.cjs electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: BRIDGE の起動と停止を electron/bridge_process.cjs に分ける」
```

---

### Task 5: 全体の確かめ・本物の Electron での確かめ・HANDOFF

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（9番「main.cjs の大きさ」の PR5 の行）
- Create（git に入れない）: scratchpad の `e2e-pr5.cjs`（`e2e-pr4.cjs` をもとにする）

- [ ] **Step 1: 全体を動かす**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて通る。test:app は 470件（455件＋この PR の15件）。

- [ ] **Step 2: 大きさを確かめる**

Run: main.cjs と新しい3つのファイルの行数
Expected: main.cjs はおよそ 240 行（設計書の目標 400 行以下に入る）。新しいファイルはどれも 800 行以下（bridge_mod_client はおよそ 180 行）。

- [ ] **Step 3: 開発版を本物の Electron で起動し、画面の中から呼ぶ（読むだけ）**

- 先に electron と MyGamePack が動いていないかを見る。動いていたら、止めてよいかをユーザーに聞く。
- `e2e-pr5.cjs` は `e2e-pr4.cjs` を写し、PR5 で移した読むだけの ipc を足す。preload の名前は `electron/preload.cjs` で確かめてから書く: BRIDGE の状態（`running` が真偽）・BRIDGE のログ（`lines` が配列）・BridgeMOD の状態（`online` が真偽）・Euler の状態（オブジェクト）・操作履歴（配列）・統計（`total` が数）・配信統計（`streams` が配列）・配信の記録の状態（`monitoring` が真偽）。BRIDGE の起動・停止・テスト発火・一時停止は呼ばない。
- Expected: どれも OK。閉じるボタンでアプリが終わる。アプリ設定・BRIDGE の設定は変わらず、バックアップも増えない。終わったら `git status --short` で作業コピーに変わったファイルがないことを見る。

- [ ] **Step 4: HANDOFF を書く**

`HANDOFF/HANDOFF04.md` の「main.cjs の大きさ」の PR4 の行のあとに足す（PR 番号は PR を出してから書き足す）:

```markdown
     - PR5（BRIDGE 側）：`operations_stats.cjs`・`bridge_mod_client.cjs`・`bridge_process.cjs`（ipc 24個）。ブランチ `refactor/main-split-5`。main.cjs は 671行 → （Step 2 の行数）行。誰も呼んでいなかった `killBridgeByCommandLine` は消した。
     - テストが main の変数を書き換える所（`bridgeProcRef`・`bridgeRestartTimer`・`testEventReplyMs`）は、`bridgeProcess.attach`・`bridgeModClient.setTestEventReplyMs`・`pretend` に置き換えた。これでテストが main の変数を書き換える所はなくなった。
     - テストがなかった窓口（BRIDGE の状態と再起動・操作の履歴と統計・受取額・ギフト案内画像）は、分ける前に main を通したテスト4件で固定した。
```

PR4 の「次にやること」の行は、PR #114 のマージ（e7d757d）を書いて、PR5 の次にやること（PR6：main.cjs を配線だけにする仕上げ・行数の見張りテスト・AGENTS.md）に書き換える。

- [ ] **Step 5: commit**

```powershell
git add HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: HANDOFF に main.cjs の分割 PR5 を書く」
```
