const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { runProc } = require("../process_runner.cjs");

test("子プロセス: 成功・起動失敗・非ゼロ終了・タイムアウトを返す", async () => {
  assert.match((await runProc(process.execPath, ["-e", "console.log('done')"], os.tmpdir())).out, /done/);
  await assert.rejects(runProc(path.join(os.tmpdir(), "missing-mygamepack-node.exe"), [], os.tmpdir()), /起動できません/);
  await assert.rejects(runProc(process.execPath, ["-e", "console.error('network failed'); process.exit(2)"], os.tmpdir()), /network failed/);
  await assert.rejects(runProc(process.execPath, ["-e", "setInterval(()=>{},1000)"], os.tmpdir(), { timeoutMs: 200 }), /完了しませんでした/);
});

function loadApp(t, run = async () => { throw new Error("unexpected process"); }, updater = {}, dialog = {}, safeStorage) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "mygamepack-regression-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  // ipcMain.on は同じ名前でも何度でも登録できてしまう（処理が2回動く）ので、重なりも含めて集める。
  const onChannels = [];
  let serverSpawn;
  const notifications = [];
  const copiedTexts = [];
  const mainPath = path.resolve(__dirname, "../main.cjs");
  const realRequire = createRequire(mainPath);
  const app = {
    isPackaged: false, getPath: () => root, getVersion: () => "test",
    requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {},
  };
  const requireMock = (name) => {
    if (name === 'child_process') {
      const real = realRequire(name);
      return { ...real, spawn: (...args) => serverSpawn ? serverSpawn(...args) : real.spawn(...args) };
    }
    if (name === "electron") return {
      // 本物の ipcMain.handle は同じ名前の二重登録で例外を投げ、アプリが起動しない。偽物も同じく止める（main.cjs の分割 PR1 レビュー）。
      app, dialog, safeStorage, ipcMain: { handle: (name, fn) => { if (handlers.has(name)) throw new Error('ipc の二重登録: ' + name); handlers.set(name, fn); },
        on: name => onChannels.push(name) },
      clipboard: { writeText: text => copiedTexts.push(text) },
      BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [{ webContents: { send: (...args) => notifications.push(args) } }] },
    };
    if (name === "electron-updater") throw new Error("Manual distribution must not load an updater");
    if (name === "./process_runner.cjs") return { runProc: run };
    return realRequire(name);
  };
  fs.mkdirSync(path.join(root, "electron"));
  fs.mkdirSync(path.join(root, "bridge"));
  const configPath = path.join(root, "bridge", "config.minecraft.json");
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../bridge/config.minecraft.json"), "utf8"));
  config.tiktokUsername = "akahoridouma";
  config.mappings = [];
  fs.writeFileSync(configPath, JSON.stringify(config));
  const commandsDir = path.join(root, 'bridge', 'commands', 'minecraft');
  fs.mkdirSync(commandsDir, { recursive: true });
  for (const name of fs.readdirSync(path.resolve(__dirname, '../../bridge/commands/minecraft')).filter(name => name.endsWith('.txt'))) {
    fs.copyFileSync(path.resolve(__dirname, '../../bridge/commands/minecraft', name), path.join(commandsDir, name));
  }
  const tools = path.join(root, "GiftsViewer", "tools");
  fs.mkdirSync(tools, { recursive: true });
  for (const file of ["fetch_gifts.cjs", "gifts_to_html.cjs", "live_status.cjs"]) fs.writeFileSync(path.join(tools, file), "");
  const context = vm.createContext({
    require: requireMock, __dirname: path.join(root, "electron"), console,
    process: Object.assign(Object.create(process), { resourcesPath: path.join(root, 'resources') }),
    Buffer, URL, AbortSignal, fetch, setTimeout, clearTimeout, setInterval, clearInterval,
    // 本物の Electron の main にもある。分ける前の main のテンプレートのコピーが、25件ごとに setImmediate で一息ついていた（main.cjs の分割 PR3）。
    setImmediate, clearImmediate,
  });
  vm.runInContext(fs.readFileSync(mainPath, "utf8"), context, { filename: mainPath });
  // Ordinary regression cases start after the user saved Survival on TOP.
  // 場所は games_ipc が出し、書くのはテストの fs で行う（テストに場所の式の写しを持たない。main.cjs の分割 PR6）。
  context.fixtureGameState = path.join(vm.runInContext('gamesIpc.getGameProfilesDir()', context), 'profiles.json');
  const appliedRoots = vm.runInContext(`[path.resolve(getServerRoot()), path.resolve(app.getPath('appData'), '.minecraft')]`, context);
  fs.mkdirSync(path.dirname(context.fixtureGameState), { recursive: true });
  fs.writeFileSync(context.fixtureGameState, JSON.stringify({ format: 1, active: 'common', packages: {}, profiles: {}, appliedFormat: 3, appliedRoots: [...appliedRoots] }));
  return { root, configPath, notifications, copiedTexts, clearGameSelection: () => fs.unlinkSync(context.fixtureGameState), invoke: (name, ...args) => handlers.get(name)({}, ...args),
    // ipc の窓口の名前（main.cjs の分割で増えたり減ったりしていないかを確かめる。2026-10-17）。
    channels: () => [...handlers.keys()].sort(), onChannels: () => [...onChannels].sort(),
    // main.cjs の中の変数を読む・書く（配線の確かめ用）。
    evaluate: code => vm.runInContext(code, context),
    usePackagedPaths: () => { app.isPackaged = true; },
    mockServerSpawn: fn => { serverSpawn = fn; },
    // サーバーの子プロセスは server_process.cjs が持つ（main.cjs の分割 PR4）。
    setServer: child => { context.fixtureChild = child; vm.runInContext('serverProcess.attach(fixtureChild);', context); },
    shortenServerWait: () => vm.runInContext('serverProcess.setStopWaitMs(30);', context),
    // モジュールが外に出す関数を、確かめる間だけ差し替える（main の配線の確かめ用。main.cjs の分割 PR4）。元に戻す関数を返す。
    pretend: (target, replacement) => {
      const original = vm.runInContext(target, context);
      context.__pretendValue = replacement;
      vm.runInContext(`${target} = __pretendValue;`, context);
      return () => { context.__pretendValue = original; vm.runInContext(`${target} = __pretendValue;`, context); };
    },
    // テスト発火を受ける BRIDGE の代わり（ipc の通り道つきの子プロセス）。
    setBridge: child => { context.fixtureBridge = child; vm.runInContext('bridgeProcess.attach(fixtureBridge);', context); },
    shortenTestEventReply: () => vm.runInContext('bridgeModClient.setTestEventReplyMs(50);', context),
  };
}

// main.cjs を仕事ごとのファイルに分けても、ipc の窓口は1つも増やさず減らさない（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 仕事として窓口を足す・消すときは、その PR でこの一覧も直す。
const IPC_HANDLE_CHANNELS = ["app:config:read","app:config:write","app:version","bridge:commands:check","bridge:commands:list","bridge:commands:openFolder","bridge:commands:readMeta","bridge:commands:write","bridge:dir","bridge:extractTo","bridge:launch","bridge:logs","bridge:processStatus","bridge:restart","bridge:root","bridge:stop","bridge:syncStatus","clipboard:writeText","config:giftMapping:save","config:mappings:write","config:path","config:read","config:validate","config:write","dialog:pickFile","dialog:pickFolder","euler:clear","euler:openPortal","euler:save","euler:status","folder:open","games:activate","games:clientFolder","games:clientFolders","games:install","games:list","games:recover","games:refreshMods","games:selectClientFolder","giftTemplate:apply","giftTemplate:cancel","giftTemplate:open","giftTemplate:save","gifts:openFolder","gifts:openHtml","gifts:read","gifts:update","gv:gifts:copyPngDataUrl","gv:gifts:fetchImageBase64","gv:gifts:openFolder","gv:gifts:openHtml","gv:gifts:read","gv:gifts:update","gv:settings:read","gv:settings:write","image:saveGiftPanel","minecraft:grantOp","minecraft:launch","minecraft:status","mod:pause","mod:resume","mod:status","mod:testEvent","operations:earnings:save","operations:history","operations:history:clear","operations:stats","operations:stats:export","operations:streamStats","preflight:run","presets:list","presets:load","presets:save","server:checkSetupComplete","server:command","server:copyTemplate","server:copyTemplateStatus","server:datapack:deployNightVision","server:forgeClientStatus","server:forgeInstall","server:forgeInstall:atPath","server:gamerules:apply","server:logs","server:processStatus","server:props:read","server:props:write","server:rconpassword:read","server:setup","server:setup:atPath","server:setup:status","server:start","server:stop","server:worlds:list","settings:backups:create","settings:backups:list","settings:backups:restore","setup:inspectEnvironment","stream:session:end","stream:session:start","stream:session:status","tiktok:liveStatus","tts:checkEngine","tts:getSpeakers","tts:launchEngine","tts:settings:read","tts:settings:write","tts:test","updater:check","updater:install","updater:status","world:backup","world:saves:list","world:saves:load","world:saves:save"];
const IPC_ON_CHANNELS = ["window:close", "window:maximizeToggle", "window:minimize"];

test('ipc の窓口の一覧は、main.cjs を分けても変わらない（114個と、ウィンドウの3個）', t => {
  const app = loadApp(t);
  // 運営ログインの3つ（auth:status・auth:login・auth:logout）は、ログインをなくしたので消した（2026-10-24 ユーザーの決定）。
  assert.equal(IPC_HANDLE_CHANNELS.length, 114);
  assert.deepEqual(app.channels(), [...IPC_HANDLE_CHANNELS].sort());
  assert.deepEqual(app.onChannels(), IPC_ON_CHANNELS);
});

// main.cjs がモジュールへ渡す「呼ばれたときに読む関数」の配線（main.cjs の分割 PR1 レビュー）。
// モジュールのテストは代わりの関数を渡すので、main の配線の取り違え（別の変数を読む・1つ抜ける）はここで止める。
test('配線: サーバーの起動中は保存先を変えず、作業中（5つのどれか）はウィンドウを閉じない', async t => {
  const app = loadApp(t);
  // サーバーの起動中・停止中は server_process.cjs が持つ。main が serverProcess の関数で見ていることを、差し替えて確かめる（main.cjs の分割 PR4）。
  const restore = app.pretend('serverProcess.isStarting', () => true);
  await assert.rejects(app.invoke('app:config:write', { serverFolder: app.root }), /サーバーの起動中は保存先を変更できません。/);
  restore();
  assert.equal(app.evaluate('isAppBusy()'), false);
  // 初期セットアップは setup_ipc.cjs、ゲームの操作は games_ipc.cjs が持つので、下のテストで本当に作業中にして確かめる（main.cjs の分割 PR2）。
  // MAP の作業中は map_operations.cjs、サーバーの起動中・停止中は server_process.cjs の関数を差し替えて確かめる（main.cjs の分割 PR4）。
  for (const target of ['mapOperations.isBusy', 'serverProcess.isStarting', 'serverProcess.isStopping']) {
    const back = app.pretend(target, () => true);
    assert.equal(app.evaluate('isAppBusy()'), true, target);
    back();
  }
});

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

// ゲームの切り替えは games_ipc.cjs が持つ（main.cjs の分割 PR2）。止める判定は、main が渡す各作業の「作業中」の関数で見る。
test('配線: ゲームの切り替えは、初期セットアップ・サーバーの起動と停止・BRIDGE の再起動待ち・MAP の作業の間は止める', async t => {
  let answerEula;
  const app = loadApp(t, undefined, {}, { showMessageBox: () => new Promise(resolve => { answerEula = resolve; }) });
  // サーバーの起動中・停止中は server_process.cjs の関数を差し替えて確かめる（main.cjs の分割 PR4）。
  for (const target of ['serverProcess.isStarting', 'serverProcess.isStopping']) {
    const back = app.pretend(target, () => true);
    await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, target);
    back();
  }
  // BRIDGE の再起動待ちは bridge_process.cjs が持つ。isActive を差し替えて確かめる（main.cjs の分割 PR5）。
  const backBridge = app.pretend('bridgeProcess.isActive', () => true);
  await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, 'bridgeProcess.isActive');
  backBridge();
  // MAP の作業中は map_operations.cjs が持つ。main が mapOperations.assertIdle で見ていることを、差し替えて確かめる（main.cjs の分割 PR4）。
  const back = app.pretend('mapOperations.assertIdle', () => { throw new Error('MAPを保存・読込中です。完了までお待ちください。'); });
  await assert.rejects(app.invoke('games:recover'), /MAPを保存・読込中です。/);
  back();
  const target = path.join(app.root, 'setup-target');
  fs.mkdirSync(target);
  const setup = app.invoke('server:setup:atPath', target);
  await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/);
  answerEula({ response: 2 });
  await setup;
});

// BRIDGE の子プロセス（bridgeProcess.child()）とサーバーの稼働（getServerProcessStatus）も、main から渡した関数で見る（main.cjs の分割 PR2 の最終レビュー）。
test('配線: ゲームの切り替えは、BRIDGE やサーバーが動いている間は止める', async t => {
  const app = loadApp(t);
  app.setBridge(fakeBridge(() => undefined).child);
  await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, 'BRIDGE');
  app.setBridge(null);
  app.setServer({ pid: 4321, exitCode: null, signalCode: null });
  await assert.rejects(app.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, 'server');
  app.setServer(null);
});

// 初期セットアップ・設定の復元・MAP の作業も、サーバーと MAP の状態を serverProcess・mapOperations の関数で見る（main.cjs の分割 PR4 の最終レビュー）。
test('配線: サーバーが動いている間は、初期セットアップを始めない', async t => {
  const app = loadApp(t);
  const target = path.join(app.root, 'setup-target');
  fs.mkdirSync(target);
  app.setServer({ pid: 1, exitCode: null, signalCode: null });
  await assert.rejects(app.invoke('server:setup:atPath', target), /Minecraftサーバーを停止してから環境構築を実行してください。/);
  app.setServer(null);
});

test('配線: サーバーの起動中・MAP の作業中は、設定のバックアップを復元しない', async t => {
  const app = loadApp(t);
  const backup = await app.invoke('settings:backups:create');
  for (const target of ['serverProcess.isStarting', 'mapOperations.isBusy', 'bridgeProcess.isActive']) {
    const back = app.pretend(target, () => true);
    await assert.rejects(async () => app.invoke('settings:backups:restore', backup.id), /復元する前にBridgeを停止してください。/, target);
    back();
  }
  await app.invoke('settings:backups:restore', backup.id);
});

test('配線: サーバーの起動中は、MAP の作業を始めない', async t => {
  const app = loadApp(t);
  const back = app.pretend('serverProcess.isStarting', () => true);
  await assert.rejects(app.invoke('world:saves:save', 'x'), /サーバーの準備・停止が終わるまでお待ちください。/);
  back();
});

// BRIDGE が動いているか（再起動の待ちを含む）は bridge_process が持つ（main.cjs の分割 PR5）。
// MAP の作業の相手にする、開発版の決まった場所のサーバー（loadApp がここでゲームを「保存」済みにしている。保存先を変えると BRIDGE の起動が TOP の確かめで止まる）。
function mapServerFixture(app) {
  const server = path.join(app.root, 'server', 'Douma_Craft');
  fs.mkdirSync(path.join(server, 'world'), { recursive: true });
  fs.writeFileSync(path.join(server, 'world', 'level.dat'), 'world');
  fs.writeFileSync(path.join(server, 'server.properties'), 'level-name=world\nserver-port=39974\n');
}

test('配線: MAP の作業は、BRIDGE が動いて（再起動を待って）いれば止めてから行い、あとで起動し直す', async t => {
  const app = loadApp(t);
  mapServerFixture(app);
  const back = app.pretend('bridgeProcess.isActive', () => true);
  const result = await app.invoke('world:saves:save', 'with-bridge');
  back();
  assert.equal(result.saved.name, 'with-bridge');
  assert.match(result.restartError, /Bridge entry not found/, 'あとで BRIDGE を起動し直そうとした（この偽の環境には BRIDGE がない）');
});

// 止める相手は main の BRIDGE の子プロセス（stopBridge の配線。PR5 の最終レビュー）。
test('配線: MAP の作業は、動いている BRIDGE の子プロセスに止める指示を送り、止まってから行う', async t => {
  const app = loadApp(t);
  mapServerFixture(app);
  const bridge = fakeBridge(message => {
    if (message.type === 'shutdown') setImmediate(() => { bridge.child.exitCode = 0; bridge.child.emit('exit', 0, null); });
  });
  app.setBridge(bridge.child);
  const result = await app.invoke('world:saves:save', 'stop-bridge');
  assert.equal(result.saved.name, 'stop-bridge');
  // attach で持たせた子プロセスには、終わったら手放す受け手（launchBridge が付ける）がない。止める指示が届いたことだけを見る。
  assert.deepEqual(bridge.asked.map(message => message.type), ['shutdown']);
  assert.match(result.restartError, /Bridge entry not found/, 'あとで BRIDGE を起動し直そうとした（この偽の環境には BRIDGE がない）');
});

// ゲームの切り替えの最中・復旧が必要な間は、BRIDGE を起動しない（bridge_process に渡す assertGameProfileIdle の配線。PR5 の最終レビュー）。
test('配線: ゲームの切り替えの復旧が必要な間は、BRIDGE を起動しない', async t => {
  const app = loadApp(t);
  const list = app.evaluate('gameProfiles.list');
  const back = app.pretend('gameProfiles.list', () => ({ ...list(), recoveryRequired: true }));
  await assert.rejects(app.invoke('bridge:launch'), /ゲームの切替中、または切替の復旧が必要です。/);
  back();
});

test('配線: MAP の作業中は、BRIDGE の起動・停止・再起動をしない', async t => {
  const app = loadApp(t);
  const back = app.pretend('mapOperations.assertIdle', () => { throw new Error('MAPを保存・読込中です。完了までお待ちください。'); });
  for (const channel of ['bridge:launch', 'bridge:stop', 'bridge:restart']) await assert.rejects(app.invoke(channel, 'home:stop'), /MAPを保存・読込中です。/, channel);
  back();
});

test('配線: 配信の記録の状態は、main の BRIDGE の子プロセスで見張り中かを決める', async t => {
  const app = loadApp(t);
  assert.equal((await app.invoke('stream:session:status')).monitoring, false);
  app.setBridge(fakeBridge(() => undefined).child);
  assert.equal((await app.invoke('stream:session:status')).monitoring, true);
  app.setBridge(null);
});

test('配線: サーバーが動いている間の OP の付与は、BridgeMOD の応答を確かめてから送る', async t => {
  const app = loadApp(t);
  const seen = [];
  await bridgeModStatus(t, app, req => { seen.push(`${req.method} ${req.url}`); return { ok: true }; });
  await app.invoke('app:config:write', { minecraftPlayerName: 'Steve_01' });
  app.setServer({ pid: 1, exitCode: null, signalCode: null });
  assert.deepEqual(plainJson(await app.invoke('minecraft:grantOp')), { ok: true, name: 'Steve_01' });
  assert.deepEqual(seen, ['GET /bridge/status', 'POST /bridge/event']);
  app.setServer(null);
});

test('配線: MAP の保存は、保存の直前にもサーバーが止まっていることを serverProcess の関数で確かめる', async t => {
  const app = loadApp(t);
  await app.invoke('app:config:write', { serverFolder: app.root });
  fs.mkdirSync(path.join(app.root, 'world'));
  fs.writeFileSync(path.join(app.root, 'world', 'level.dat'), 'world');
  fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=39972\n');
  const back = app.pretend('serverProcess.assertMapServerStopped', async () => { throw new Error('サーバーが停止していません。MAP操作を中止しました。'); });
  await assert.rejects(app.invoke('world:saves:save', 'x'), /サーバーが停止していません。MAP操作を中止しました。/);
  back();
  assert.equal(fs.existsSync(path.join(app.root, 'map-saves')), false);
});

test('配線: サーバーの起動の前に、中断した MAP の読込の後始末を map_operations に頼む', async t => {
  const app = loadApp(t);
  await app.invoke('app:config:write', { serverFolder: app.root });
  fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=39973\n');
  fs.writeFileSync(path.join(app.root, 'run.bat'), 'must never execute');
  const child = new (require('node:events').EventEmitter)();
  Object.assign(child, { pid: 123458, stdout: new (require('node:stream').PassThrough)(), stderr: new (require('node:stream').PassThrough)() });
  app.mockServerSpawn(() => child);
  let recovered = 0;
  const back = app.pretend('mapOperations.mapSaves.recover', async () => { recovered++; });
  assert.equal((await app.invoke('server:start')).ok, true);
  back();
  assert.equal(recovered, 1);
});

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
  assert.deepEqual(plainJson((await app.invoke('operations:history')).map(row => row.commandFile)), ['tnt.txt', 'zombie.txt', 'zombie.txt']);
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

test('配線: ゲームの操作の間（パックのフォルダーを選んでいる間）は、ウィンドウを閉じない', async t => {
  let answerFolder;
  const app = loadApp(t, undefined, {}, { showOpenDialog: () => new Promise(resolve => { answerFolder = resolve; }) });
  const install = app.invoke('games:install');
  assert.equal(app.evaluate('isAppBusy()'), true);
  answerFolder({ canceled: true, filePaths: [] });
  assert.equal((await install).canceled, true);
  assert.equal(app.evaluate('isAppBusy()'), false);
});

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
  // テストにだけ置くコマンド。本物のリポジトリにはないので、main から受け取った appDir（偽の __dirname）の1つ上から写したときだけ届く（PR3 の最終レビュー）。
  fs.writeFileSync(path.join(app.root, 'bridge', 'commands', 'minecraft', 'fixture_only.txt'), 'say fixture\n');
  assert.deepEqual(plainJson(await app.invoke('server:copyTemplate', target)), { ok: true });
  assert.ok(fs.existsSync(path.join(target, 'bridge', 'commands', 'minecraft', 'fixture_only.txt')), '開発版のコマンド txt は appDir の1つ上から写す');
  assert.equal(fs.readFileSync(path.join(target, 'run.bat'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(target, 'world', 'level.dat'), 'utf8'), 'world');
  assert.ok(fs.existsSync(path.join(target, 'bridge', 'commands', 'minecraft', 'zombie.txt')));
  const total = 2 + fs.readdirSync(path.join(app.root, 'bridge', 'commands', 'minecraft')).length;
  assert.deepEqual(plainJson(await app.invoke('server:copyTemplateStatus')), { state: 'done', copied: total, total, error: '' });
});

// 標準装備の OBSMOD は、BRIDGE の同期のときに雛形からサーバーの mods へ入れ替える（2026-10-25。最後のレビュー 軽い8）。
test('配布: BRIDGE の同期は、雛形の BridgeMOD・DisplayMOD・OBSMOD をサーバーの mods に入れ替え、古い OBSMOD を退避する', async t => {
  const { fakeModJar } = require('./fake-mod-jar.cjs');
  const app = loadApp(t);
  app.usePackagedPaths();
  packagedBridgeResources(app);
  const templateMods = path.join(app.root, 'resources', 'server', 'Douma_Craft', 'mods');
  fs.mkdirSync(templateMods, { recursive: true });
  for (const [name, id] of [['bridgemod-9.9.9.jar', 'bridgemod'], ['displaymod-9.9.9.jar', 'displaymod'], ['minecraft_obs_bridge-9.9.9.jar', 'minecraft_obs_bridge']]) fs.writeFileSync(path.join(templateMods, name), fakeModJar(id));
  const target = path.join(app.root, 'target');
  fs.mkdirSync(path.join(target, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(target, 'mods', 'minecraft_obs_bridge-2.4.7.jar'), fakeModJar('minecraft_obs_bridge'));
  await app.invoke('bridge:extractTo', target);
  assert.deepEqual(fs.readdirSync(path.join(target, 'mods')).sort(), ['bridgemod-9.9.9.jar', 'displaymod-9.9.9.jar', 'minecraft_obs_bridge-9.9.9.jar']);
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
  app.setServer(null);
  const listener = require('node:net').createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  const running = path.join(app.root, 'running-server');
  fs.mkdirSync(running);
  fs.writeFileSync(path.join(running, 'server.properties'), `server-port=${listener.address().port}\n`);
  await app.invoke('app:config:write', { serverFolder: running });
  await assert.rejects(app.invoke('bridge:extractTo', target), /BridgeMODを入れ替える前にMinecraftサーバーを停止してください/, 'port');
});

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

// 古い設定を読み込む所は、保存済みの設定と同じ直しを通してから確かめる（2026-10-18 設計書の 7）。
test('プリセット: 古い版で保存したプリセット（回数 2.5 など）も、読み込むときに直して読み込める', async t => {
  const app = loadApp(t);
  app.invoke('presets:save', 'old');
  const file = path.join(path.dirname(app.configPath), 'presets', 'old.json');
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 2.5 }] }));
  assert.equal(app.invoke('presets:load', 'old.json').config.mappings[0].repeat, 3);
  const saved = await app.invoke('config:read');
  assert.deepEqual([saved.mappings[0].repeat, saved.configVersion], [3, 2]);
});

test('プリセット: 中身がオブジェクトでないプリセットは「設定全体がJSONオブジェクトではありません」で止め、設定を変えない', async t => {
  const app = loadApp(t);
  const dir = path.join(path.dirname(app.configPath), 'presets');
  app.invoke('presets:save', 'base');
  const before = fs.readFileSync(app.configPath, 'utf8');
  for (const [name, text] of [['array.json', '[]'], ['text.json', '"x"'], ['null.json', 'null']]) {
    fs.writeFileSync(path.join(dir, name), text);
    assert.throws(() => app.invoke('presets:load', name), error => error.message === '設定全体がJSONオブジェクトではありません', name);
  }
  assert.equal(fs.readFileSync(app.configPath, 'utf8'), before);
});

test('起動: 保存済みの設定の直しは画面が設定を読む前（createWindow の前）に行い、知らせはウィンドウを出したあと', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  const ready = source.slice(source.indexOf('app.whenReady()'));
  const at = text => { const index = ready.indexOf(text); assert.ok(index >= 0, text); return index; };
  assert.ok(at('migrateSavedConfigOnStartup()') < at('createWindow();'));
  assert.ok(at('createWindow();') < at('notifyConfigMigration('));
  // 起動のときの直しが届かない設定（手動インストールのあとのセットアップ前など）のため、セットアップを終えたとき・BRIDGE を起動する前にも直す。
  for (const factory of ['createAppConfig({', 'createBridgeProcess({']) {
    const deps = source.slice(source.indexOf(factory), source.indexOf('});', source.indexOf(factory)));
    assert.match(deps, /migrateSavedConfig: \(\) => bridgeSettings\.ensureSavedConfigMigrated\(\)/, factory);
  }
  const panel = fs.readFileSync(path.resolve(__dirname, '../../src/components/SettingsBackupsPanel.tsx'), 'utf8');
  assert.match(panel, /reason === "migration" \? "更新で直す前の自動保存"/);
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

// 運営ログインはなくした（誰が使えるかは公式 HP の購入者ログインで決める。2026-10-24 ユーザーの決定）。コンソールはログインなしで送れる。
test('コンソールの送信: ログインなしで、動いているサーバーに送る', async t => {
  const app = loadApp(t);
  const written = [];
  app.setServer({ pid: 1, exitCode: null, signalCode: null, stdin: { writable: true, write: text => written.push(text) } });
  await app.invoke('server:command', '/say hi');
  assert.deepEqual(written, ['say hi\n']);
  app.setServer(null);
});

// テスト発火を受ける偽の BRIDGE。届いた問い合わせを記録し、answer の戻り値を返事として返す（undefined なら返さない）。
function fakeBridge(answer, { connected = true } = {}) {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  const asked = [];
  Object.assign(child, { pid: 4321, connected, exitCode: null, signalCode: null,
    send(message, callback) {
      asked.push(JSON.parse(JSON.stringify(message)));
      callback?.(null);
      const result = answer(message);
      if (result !== undefined) setImmediate(() => child.emit('message', { type: 'testEventResult', id: message.id, result }));
      return true;
    } });
  return { child, asked };
}
// テスト発火が送る前に読む BridgeMOD の状態（/bridge/status）。
async function bridgeModStatus(t, app, reply = () => ({ ok: true, paused: false })) {
  const http = require('node:http');
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply(req))); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const cfg = JSON.parse(fs.readFileSync(app.configPath)); cfg.options.bridgeModPort = server.address().port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  return server;
}
const plainJson = value => JSON.parse(JSON.stringify(value));

test('Euler IPC: 保存キーをBRIDGE・配信確認・ギフト取得へ渡し、削除とバックアップ分離を保つ', async t => {
  const calls = [];
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from([...value].reverse().join('')),
    decryptString: value => [...value.toString()].reverse().join('') };
  const app = loadApp(t, async (_cmd, args, _cwd, options) => {
    calls.push({ tool: path.basename(args[0]), env: options.env });
    if (args[0].endsWith('live_status.cjs')) return { out: '{"live":true}' };
    const out = args[args.indexOf('--out') + 1];
    if (args[0].endsWith('fetch_gifts.cjs')) {
      fs.writeFileSync(path.join(out, 'gifts.full.json'), '[]');
      fs.writeFileSync(path.join(out, 'gifts.min.json'), '[{"id":5655,"name":"バラ","diamond_count":1}]');
      fs.writeFileSync(path.join(out, 'gifts.meta.json'), JSON.stringify({ username: args[1], count: 1 }));
    } else fs.writeFileSync(path.join(out, 'gifts.html'), 'ok');
    return { out: '' };
  }, undefined, undefined, safeStorage);
  fs.writeFileSync(path.join(app.root, 'bridge', 'index.js'), '');
  const { EventEmitter } = require('node:events');
  let spawnedEnv;
  app.mockServerSpawn((_cmd, args, options) => {
    assert.ok(!args.some(arg => arg.includes('fixture-euler')));
    spawnedEnv = options.env;
    const child = new EventEmitter();
    Object.assign(child, { pid: 12345, stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, exitCode: null, signalCode: null,
      send: () => setImmediate(() => { child.exitCode = 0; child.emit('exit', 0); }) });
    return child;
  });
  app.invoke('euler:save', 'fixture-euler-one');
  await app.invoke('bridge:launch');
  assert.equal(spawnedEnv.SIGN_API_KEY, 'fixture-euler-one');
  assert.equal(app.invoke('euler:status').restartRequired, false);
  await app.invoke('tiktok:liveStatus', 'fixture');
  await app.invoke('gifts:update', 'fixture');
  for (const tool of ['live_status.cjs', 'fetch_gifts.cjs']) assert.equal(calls.find(call => call.tool === tool).env.SIGN_API_KEY, 'fixture-euler-one');
  app.invoke('euler:save', 'fixture-euler-two');
  assert.equal(app.invoke('euler:status').restartRequired, true);
  await app.invoke('tiktok:liveStatus', 'fixture');
  assert.equal(calls.at(-1).env.SIGN_API_KEY, 'fixture-euler-two', 'key change invalidates the cached live result');
  await app.invoke('bridge:stop');
  const backup = await app.invoke('settings:backups:create');
  app.invoke('euler:clear');
  await app.invoke('settings:backups:restore', backup.id);
  assert.equal(app.invoke('euler:status').configured, false, 'restoring settings does not restore a secret');
  await app.invoke('bridge:launch');
  assert.equal(spawnedEnv.SIGN_API_KEY, undefined);
  await app.invoke('bridge:stop');
  assert.doesNotMatch(fs.readFileSync(app.configPath, 'utf8'), /fixture-euler/);
});

test("テキストコピー: コマンド・ギフトID・日本語をネイティブへ渡し、不正入力は拒否する", async t => {
  const app = loadApp(t);
  for (const text of ["/bridge zombie 1", "5655", "日本語「バラ」🌹"]) {
    assert.equal((await app.invoke("clipboard:writeText", text)).ok, true);
    assert.equal(app.copiedTexts.at(-1), text);
  }
  for (const input of [null, {}, 5655, "x".repeat(65537)]) {
    assert.throws(() => app.invoke("clipboard:writeText", input), /文字列が不正/);
  }
  assert.equal(app.copiedTexts.length, 3);
});

test("手動配布: 開発版・製品版とも更新確認で通信せず、導入済みバージョンを返す", async t => {
  const app = loadApp(t);
  const before = fs.readFileSync(app.configPath, "utf8");
  for (const packaged of [false, true]) {
    if (packaged) app.usePackagedPaths();
    for (const ipc of ["updater:status", "updater:check", "updater:check"]) {
      const result = await app.invoke(ipc);
      assert.equal(result.state, "manual");
      assert.equal(result.version, "test");
      assert.equal(result.checkedAt, null);
      assert.equal(result.error, "");
    }
  }
  assert.equal(fs.readFileSync(app.configPath, "utf8"), before);
});

test("配信統計: 90分以上空いたイベントは別配信に分け、休止時間を加算しない", async t => {
  const app = loadApp(t);
  const start = Date.now() - 12 * 60 * 60 * 1000;
  const rows = [0, 10, 100, 700].map(minutes => ({
    at: new Date(start + minutes * 60000).toISOString(), type: "like",
    sender: "tester", commandFile: "qa.txt", count: 1, ok: true,
  }));
  fs.writeFileSync(path.join(app.root, "bridge", "operations-history.json"), JSON.stringify(rows));
  const stats = await app.invoke("operations:streamStats", 90);
  assert.equal(stats.overall.streams, 3);
  assert.equal(stats.overall.events, 4);
  assert.equal(stats.streams.reduce((sum, stream) => sum + stream.durationMs, 0), 10 * 60000);
});

test("統計IPC: テスト履歴を除外し、イベントなしの明示記録を保持する", async t => {
  const app = loadApp(t);
  const session = await app.invoke("stream:session:start", "記録テスト");
  assert.equal((await app.invoke("stream:session:start", "連打")).id, session.id);
  fs.writeFileSync(path.join(app.root, "bridge", "operations-history.json"), JSON.stringify([
    { at: new Date().toISOString(), source: "test", type: "gift", count: 100, ok: true },
  ]));
  await new Promise(resolve => setTimeout(resolve, 5));
  const ended = await app.invoke("stream:session:end", { id: session.id });
  const stats = await app.invoke("operations:streamStats", 90);
  assert.equal(stats.overall.events, 0);
  assert.equal(stats.streams.length, 1);
  assert.equal(stats.streams[0].recorded, true);
  assert.equal(stats.streams[0].durationMs, Date.parse(ended.endedAt) - Date.parse(session.startedAt));
  assert.equal((await app.invoke("stream:session:status")).active, null);
});

test('テスト発火IPC: BRIDGE が止まっていると試せない。動いていれば入力を BRIDGE へ渡し、返事から文を作る（2026-10-16）', async t => {
  const app = loadApp(t);
  await bridgeModStatus(t, app);
  const stopped = await app.invoke('mod:testEvent', { type: 'share', preview: true });
  assert.deepEqual(plainJson(stopped), { ok: false, bridgeStopped: true, message: 'BRIDGE を起動すると試せます。' });
  // 子プロセスはあっても ipc の通り道が切れている（自動再起動の直後など）ときも同じ。
  app.setBridge(fakeBridge(() => undefined, { connected: false }).child);
  assert.equal((await app.invoke('mod:testEvent', { type: 'share', preview: true })).bridgeStopped, true);
  const steps = [{ label: 'シェア', commandFile: 'qa.txt', count: 1, type: 'share' }, { label: 'ルーレット', commandFile: 'roulette.txt', count: 2, type: 'roulette', roulette: true }];
  const bridge = fakeBridge(message => message.input.preview
    ? { ok: true, preview: true, sender: '検証', steps: steps.slice(0, 1), notes: ['メモ'], fired: [] }
    : { ok: true, preview: false, sender: '検証', steps, notes: [], fired: [
      { stepIndex: 0, commandFile: 'qa.txt', count: 1, state: 'delivered', message: 'BridgeMOD が受け付けました' },
      { stepIndex: 1, commandFile: 'roulette.txt', count: 2, state: 'pending', message: 'ルーレットを回しています（当たりは回したあとに送ります）' },
    ] });
  app.setBridge(bridge.child);
  const preview = await app.invoke('mod:testEvent', { type: 'share', preview: true, listenerName: '検証' });
  assert.equal(preview.ok, true); assert.equal(preview.matched, true); assert.deepEqual(plainJson(preview.notes), ['メモ']);
  assert.equal(preview.message, '1件の設定が条件に一致しました（未送信）。');
  assert.equal(bridge.asked[0].type, 'testEvent');
  assert.deepEqual(bridge.asked[0].input, { type: 'share', preview: true, listenerName: '検証' });
  const fired = await app.invoke('mod:testEvent', { type: 'share', listenerName: '検証' });
  assert.equal(fired.ok, true);
  assert.equal(fired.message, 'BridgeMOD が受け付けた 1件・送り直し中 1件。ゲーム内の結果も確認してください。');
  assert.equal(fired.fired.length, 2);
  assert.deepEqual(plainJson(await app.invoke('operations:history')), [], '履歴は BRIDGE が書く（main は書かない）');
  // 手順があるのに何も受け付けられなかったら（ルーレットを途中で無効にしたなど）、緑の「成功」にしない（最後のレビュー Important #1）。
  app.setBridge(fakeBridge(() => ({ ok: true, steps: steps.slice(1), notes: [], fired: [] })).child);
  const nothing = await app.invoke('mod:testEvent', { type: 'roulette' });
  assert.equal(nothing.ok, false);
});

test('テスト発火IPC: 入力の誤りは例外。返事がない・途中で BRIDGE が止まった・BridgeMOD につながらないときは理由を返す', async t => {
  const app = loadApp(t);
  const server = await bridgeModStatus(t, app);
  app.shortenTestEventReply();
  app.setBridge(fakeBridge(() => undefined).child);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'share', preview: true }), /BRIDGE から返事がありません/);
  // 返事がなくても実行中の印は残らない（次のテストを押せる）。
  app.setBridge(fakeBridge(() => ({ ok: false, error: 'テストするコメントを入力してください。' })).child);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'comment', preview: true }), /テストするコメントを入力してください/);
  const dying = fakeBridge(() => undefined);
  dying.child.send = (_message, callback) => { callback?.(null); setImmediate(() => dying.child.emit('exit', 1)); return true; };
  app.setBridge(dying.child);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'share', preview: true }), /BRIDGE が止まったため、結果を受け取れませんでした/);
  // BridgeMOD につながらないときは、送る列に入れない（あとでサーバーを起動したときに思いがけず動くため。設計書 7）。
  const asked = fakeBridge(() => ({ ok: true, steps: [], notes: [], fired: [] }));
  app.setBridge(asked.child);
  await new Promise(resolve => server.close(resolve));
  const refused = await app.invoke('mod:testEvent', { type: 'share' });
  assert.equal(refused.ok, false);
  assert.equal(refused.message, 'Minecraft サーバー（BridgeMOD）につながりません。サーバーを起動してから試してください。');
  assert.equal(asked.asked.length, 0);
  // 条件だけ確認は BridgeMOD がなくても使える。
  assert.equal((await app.invoke('mod:testEvent', { type: 'share', preview: true })).ok, true);
  assert.equal(asked.asked.length, 1);
});

test('テスト発火IPC: BridgeMOD で動かしていない設定（RCON など）では、BRIDGE に渡さずに理由を返す（最後のレビュー Minor #5）', async t => {
  const app = loadApp(t);
  const cfg = JSON.parse(fs.readFileSync(app.configPath)); cfg.options.commandTransport = 'rcon';
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  const bridge = fakeBridge(() => ({ ok: true, steps: [], notes: [], fired: [] }));
  app.setBridge(bridge.child);
  for (const preview of [true, false]) {
    assert.deepEqual(plainJson(await app.invoke('mod:testEvent', { type: 'share', preview })),
      { ok: false, message: 'テスト発火は、Minecraft を BridgeMOD で動かしているときだけ使えます。' }, 'preview=' + preview);
  }
  assert.equal(bridge.asked.length, 0);
});

test("Mod状態IPC: 認証の失敗（403）はオフラインと区別し、直し方を返す", async t => {
  const http = require("node:http");
  const server = http.createServer((_req, res) => { res.writeHead(403, { "Content-Type": "application/json" }); res.end('{"ok":false,"error":"forbidden"}'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const app = loadApp(t);
  const cfg = JSON.parse(fs.readFileSync(app.configPath)); cfg.options.bridgeModPort = server.address().port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  const status = await app.invoke("mod:status");
  assert.equal(status.online, false); assert.equal(status.authFailed, true);
  assert.match(status.error, /認証に失敗/);
  const check = (await app.invoke("preflight:run")).checks.find(row => row.id === "mod");
  assert.equal(check.status, "error"); assert.match(check.detail, /認証に失敗/);
});

test('妨害の一時停止IPC: /bridge/control へ送り、出どころを記録する。古い BridgeMOD（400）では新しくするよう伝える。止めている間のテスト発火には文言を足す', async t => {
  const http = require("node:http");
  const received = [];
  let supported = true, paused = false, missingRoute = false, rejectEvents = false, slowStatus = 0;
  const server = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      received.push({ method: req.method, url: req.url, payload });
      res.setHeader("Content-Type", "application/json");
      // BridgeMOD 1.7.0〜1.7.4 には /bridge/control がなく、JDK の HttpServer が HTML の 404 を返す。
      if (req.url === "/bridge/control" && missingRoute) { res.statusCode = 404; res.setHeader("Content-Type", "text/html"); res.end("<h1>404 Not Found</h1>No context found for request"); return; }
      if (req.url === "/bridge/control" && !supported) { res.statusCode = 400; res.end('{"ok":false,"error":"unsupported"}'); return; }
      if (req.url === "/bridge/control") { paused = payload.action === "pause"; res.end(JSON.stringify({ ok: true, paused })); return; }
      if (req.url === "/bridge/status") { setTimeout(() => res.end(JSON.stringify({ ok: true, paused, gameSessions: {} })), slowStatus); return; }
      if (req.url === "/bridge/event" && rejectEvents) { res.statusCode = 429; res.end('{"ok":false,"error":"queue_full"}'); return; }
      res.end('{"ok":true}');
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const app = loadApp(t);
  // テスト発火は BRIDGE へ渡す（2026-10-16）。rejectEvents のあいだは「送れなかった」と返す。
  app.setBridge(fakeBridge(() => ({ ok: true, steps: [{ label: 'シェア', commandFile: 'qa.txt', count: 1, type: 'share' }], notes: [],
    fired: [rejectEvents
      ? { stepIndex: 0, commandFile: 'qa.txt', count: 1, state: 'failed', message: 'BridgeMODが受け付けませんでした（HTTP 400）' }
      : { stepIndex: 0, commandFile: 'qa.txt', count: 1, state: 'delivered', message: 'BridgeMOD が受け付けました' }] })).child);
  const cfg = JSON.parse(fs.readFileSync(app.configPath));
  cfg.options.bridgeModPort = server.address().port;
  cfg.shareEvent = { commandFile: "qa.txt", enabled: true, repeat: 1 };
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  fs.writeFileSync(path.join(app.root, "bridge", "commands", "minecraft", "qa.txt"), "say test");
  const logFile = path.join(app.root, "logs", "stop-requests.log");

  // main は vm の中で動くので、比べる前に普通のオブジェクトへ直す。
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await app.invoke("mod:pause", "home:pause")), { ok: true, paused: true });
  assert.deepEqual(received.at(-1), { method: "POST", url: "/bridge/control", payload: { action: "pause" } });
  const fired = await app.invoke("mod:testEvent", { type: "share" });
  assert.match(fired.message, /一時停止中です。再開すると実行されます。/);
  assert.deepEqual(plain(await app.invoke("mod:resume", "banner:resume")), { ok: true, paused: false });
  assert.doesNotMatch((await app.invoke("mod:testEvent", { type: "share" })).message, /一時停止中/);
  const lines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
  assert.match(lines[0], /妨害の一時停止 ← 配信ホームの一時停止$/);
  assert.match(lines[1], /妨害の再開 ← 一時停止の帯の再開$/);

  // 送れなかったテスト発火には「再開すると実行されます」と書かない（PR レビュー M-3）。
  await app.invoke("mod:pause", "home:pause");
  rejectEvents = true;
  const refused = await app.invoke("mod:testEvent", { type: "share" });
  assert.equal(refused.ok, false);
  assert.doesNotMatch(refused.message, /再開すると実行されます/);
  rejectEvents = false;
  await app.invoke("mod:resume", "home:resume");

  // 状態を読んでいる間に押されたテスト発火も、同時には動かさない（PR レビュー M-1）。
  slowStatus = 300;
  const both = await Promise.all([app.invoke("mod:testEvent", { type: "share" }), app.invoke("mod:testEvent", { type: "share" })]);
  assert.equal(both.filter(result => /別のテストを実行中です/.test(result.message)).length, 1, both.map(result => result.message).join(" / "));
  slowStatus = 0;

  supported = false;
  assert.deepEqual(plain(await app.invoke("mod:pause", "home:pause")), { ok: false, message: "BridgeMOD を新しくすると使えます（1.8.0 以上）。" });
  // 1.7.0〜1.7.4（404）にも同じ文言を返す（PR レビュー M-2）。
  missingRoute = true;
  assert.deepEqual(plain(await app.invoke("mod:pause", "home:pause")), { ok: false, message: "BridgeMOD を新しくすると使えます（1.8.0 以上）。" });
  server.close();
  await new Promise(resolve => server.once("close", resolve));
  // つながらないときは、英語の生の文字列ではなく、確かめることを返す（PR レビュー M-2）。
  assert.deepEqual(plain(await app.invoke("mod:resume", "home:resume")), { ok: false, message: "BridgeMOD とつながっていません。Minecraft サーバーが動いているか確かめてください。" });
});

test("ギフト更新: 手動と自動の同時実行をまとめ、検証後に両画面へ通知する", async (t) => {
  let calls = 0;
  const app = loadApp(t, async (_cmd, args) => {
    calls++;
    const out = args[args.indexOf("--out") + 1];
    if (args[0].endsWith("fetch_gifts.cjs")) {
      await new Promise(resolve => setTimeout(resolve, 20));
      const gifts = [{ id: 5655, name: "バラ", diamond_count: 1, image: null }];
      for (const file of ["gifts.min.json", "gifts.full.json"]) fs.writeFileSync(path.join(out, file), JSON.stringify(gifts));
      fs.writeFileSync(path.join(out, "gifts.meta.json"), JSON.stringify({ username: args[1], count: 1, generatedAt: new Date().toISOString() }));
    } else fs.writeFileSync(path.join(out, "gifts.html"), "<html></html>");
  });
  const results = await Promise.all([app.invoke("gifts:update", "@akahoridouma"), app.invoke("gv:gifts:update", "akahoridouma")]);
  assert.equal(calls, 2);
  assert.equal(results[0].meta.count, 1);
  assert.equal((await app.invoke("gv:gifts:read")).gifts[0].name, "バラ");
  assert.equal(app.notifications.length, 1);
});

test("ギフト更新: 取得失敗でも前の一覧を保持し、再試行できる", async (t) => {
  let calls = 0;
  const app = loadApp(t, async () => { calls++; throw new Error("通信失敗"); });
  const dir = path.join(app.root, "GiftsViewer/data/gifts");
  fs.mkdirSync(dir, { recursive: true });
  const saved = '[{"id":1,"name":"保存済み"}]';
  fs.writeFileSync(path.join(dir, "gifts.min.json"), saved);
  await assert.rejects(app.invoke("gifts:update", "akahoridouma"), /通信失敗/);
  await assert.rejects(app.invoke("gifts:update", "akahoridouma"), /通信失敗/);
  assert.equal(calls, 2);
  assert.equal(fs.readFileSync(path.join(dir, "gifts.min.json"), "utf8"), saved);
  assert.deepEqual(fs.readdirSync(dir), ["gifts.min.json"]);
});

test("設定保存: ギフト全削除を保持し、他のイベント設定を変更しない", async (t) => {
  const app = loadApp(t);
  const before = await app.invoke("config:read");
  await app.invoke("config:mappings:write", [{ giftId: "5655", name: "バラ", commandFile: "zombie.txt", repeat: 1 }]);
  assert.equal((await app.invoke("config:read")).mappings.length, 1);
  await app.invoke("config:mappings:write", []);
  const after = await app.invoke("config:read");
  assert.equal(after.mappings.length, 0);
  assert.deepEqual(after.likeEvents, before.likeEvents);
  await assert.rejects(app.invoke("config:mappings:write", [{ giftId: "", commandFile: "" }]), /設定エラー/);
  assert.equal((await app.invoke("config:read")).mappings.length, 0);
});

test("設定保存: 旧版で保存した使えない名前の割り当ては残したまま保存でき、新しい割り当てだけ止める", async (t) => {
  const app = loadApp(t);
  fs.writeFileSync(path.join(app.root, "bridge", "commands", "minecraft", "ネコ.txt"), "say neko\n");
  // 旧版のアプリで保存された設定（この割り当ては BridgeMOD に拒否され、一度も実行されていなかった）。
  const legacy = { ...JSON.parse(fs.readFileSync(app.configPath, "utf8")), mappings: [{ giftId: "5655", name: "バラ", commandFile: "ネコ.txt", repeat: 1 }] };
  fs.writeFileSync(app.configPath, JSON.stringify(legacy));
  // ID承認・一括起動と同じく、設定全体を書き直してもエラーにしない。
  await app.invoke("config:write", { ...legacy, tiktokUsername: "another_id" });
  assert.equal((await app.invoke("config:read")).tiktokUsername, "another_id");
  const check = await app.invoke("config:validate", { ...legacy, tiktokUsername: "another_id" });
  assert.equal(check.ok, true); assert.ok(check.warnings.some(w => w.includes("ネコ.txt")));
  // 「新しいか」はコマンドの名前で決める（2026-10-18 設計書の 7）。保存済みの名前を別のギフトへ割り当てるのは止めず、保存済みに無い名前は保存前に止める。
  fs.writeFileSync(path.join(app.root, "bridge", "commands", "minecraft", "イヌ.txt"), "say inu\n");
  await assert.rejects(app.invoke("config:mappings:write", [...legacy.mappings, { giftId: "1", name: "ハート", commandFile: "イヌ.txt", repeat: 1 }]), /ハート.*半角英数字/s);
  await app.invoke("config:mappings:write", [...legacy.mappings, { giftId: "1", name: "ハート", commandFile: "ネコ.txt", repeat: 1 }]);
  assert.equal((await app.invoke("config:read")).mappings.length, 2);
  // コマンドの一覧には使えない名前の印を付ける。title はルーレット名・ギフト画像に使われるので変えない。
  const meta = await app.invoke("bridge:commands:readMeta");
  const listed = meta.find(row => row.name === "ネコ.txt");
  assert.equal(listed.invalidName, true); assert.equal(listed.title, "ネコ.txt");
  assert.ok(!meta.find(row => row.name === "cod.txt").invalidName);
  // いいね・ルーレットなどの候補（bridge:commands:list）にも同じ印を届ける。
  // 印には直し方の文（commandFileProblem）も付ける。foo.txt.txt は「半角英数字に」では直らない（PR7 の最後のレビュー。画面に出すのは PR8）。
  assert.match(listed.invalidReason, /ネコ\.txt.*半角英数字/);
  fs.writeFileSync(path.join(app.root, "bridge", "commands", "minecraft", "foo.txt.txt"), "say foo\n");
  const double = (await app.invoke("bridge:commands:readMeta")).find(row => row.name === "foo.txt.txt");
  assert.equal(double.invalidName, true); assert.match(double.invalidReason, /\.txt が2つあります/);
  const options = await app.invoke("bridge:commands:list");
  assert.deepEqual({ ...options.find(row => row.name === "ネコ.txt") }, { name: "ネコ.txt", title: "ネコ.txt", invalidName: true, invalidReason: listed.invalidReason });
  assert.deepEqual(Object.keys(options.find(row => row.name === "cod.txt")).sort(), ["name", "title"]);
  // ルーレットのファイルには印を付ける（画面は写しを持たずにこれで除く。処理のコピー PR8）。大文字の Roulette.TXT は command-rows.test.cjs。
  // Windows では Roulette.TXT を書いても前からある roulette.txt の名前のままなので、小文字にして探す。
  fs.writeFileSync(path.join(app.root, "bridge", "commands", "minecraft", "Roulette.TXT"), "# TITLE: くじ\n");
  const isRouletteName = row => row.name.toLowerCase() === "roulette.txt";
  const metaRoulette = (await app.invoke("bridge:commands:readMeta")).filter(isRouletteName);
  assert.ok(metaRoulette.length > 0 && metaRoulette.every(row => row.roulette === true), JSON.stringify(metaRoulette));
  const withRoulette = await app.invoke("bridge:commands:list");
  assert.ok(withRoulette.filter(isRouletteName).every(row => row.roulette === true) && withRoulette.some(isRouletteName));
  assert.deepEqual(Object.keys(withRoulette.find(row => row.name === "cod.txt")).sort(), ["name", "title"]);
  await assert.rejects(app.invoke("bridge:commands:write", { filename: "ネコ2.txt", content: "say x" }), /半角英数字/);
});

test("セットアップ: 保存するパスは絶対パス、消失しても別サーバーへ切り替わらない", async (t) => {
  const app = loadApp(t);
  await app.invoke("app:config:write", { serverFolder: "server/Douma_Craft", setupComplete: true });
  assert.equal(path.isAbsolute((await app.invoke("app:config:read")).serverFolder), true);
  const missing = path.join(app.root, "missing-server");
  await app.invoke("app:config:write", { serverFolder: missing });
  const status = await app.invoke("server:checkSetupComplete");
  assert.equal(status.dir, missing);
  assert.equal(status.complete, false);
});

test("初回構築IPC: 規約のキャンセルで同意・設定を保存せず、再試行できる", async t => {
  let prompts = 0;
  const app = loadApp(t, undefined, {}, { showMessageBox: async options => {
    prompts++;
    assert.equal(options.cancelId, 2);
    assert.equal(options.defaultId, 2);
    return { response: 2 };
  } });
  const target = path.join(app.root, "新しいフォルダー (3)");
  fs.mkdirSync(target);
  await app.invoke("app:config:write", { serverFolder: target });
  assert.equal((await app.invoke("server:setup:atPath", target)).canceled, true);
  assert.equal((await app.invoke("server:setup")).canceled, true);
  assert.equal(prompts, 2);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal((await app.invoke("server:checkSetupComplete")).complete, false);
});

test("初回の標準保存先: 更新されるアプリの同梱領域へワールドを作らない", async t => {
  const app = loadApp(t);
  app.usePackagedPaths();
  const status = await app.invoke("server:checkSetupComplete");
  assert.equal(status.dir, path.join(app.root, "MyGamePack", "Server"));
  assert.equal(status.complete, false);
});

test("設定バックアップIPC: 保存前の世代を作り、復元で割り当てを戻す", async t => {
  const app = loadApp(t);
  const original = await app.invoke("settings:backups:create");
  await app.invoke("config:mappings:write", [{ giftId: "5655", commandFile: "zombie.txt", repeat: 1 }]);
  assert.equal((await app.invoke("config:read")).mappings.length, 1);
  const restored = await app.invoke("settings:backups:restore", original.id);
  assert.equal((await app.invoke("config:read")).mappings.length, 0);
  await app.invoke("settings:backups:restore", restored.safetyBackup);
  assert.equal((await app.invoke("config:read")).mappings.length, 1);
});

// 復元の確かめは、バックアップの中のコマンドも「使える名前」に足す。game_mode_on.txt のような共通のコマンドも足す
// （前は game_ で始まる名前を外し、「選択したゲームでは使えないコマンドです」で止まった。処理のコピー PR6）。
test("設定バックアップIPC: game_ で始まる共通のコマンドを使う設定も、バックアップから戻せる", async t => {
  const app = loadApp(t);
  const commands = path.join(app.root, "bridge", "commands", "minecraft");
  fs.writeFileSync(path.join(commands, "game_mode_on.txt"), "say on\n");
  await app.invoke("config:mappings:write", [{ giftId: "5655", commandFile: "game_mode_on.txt", repeat: 1 }]);
  const backup = await app.invoke("settings:backups:create");
  await app.invoke("config:mappings:write", []);
  fs.unlinkSync(path.join(commands, "game_mode_on.txt"));
  await app.invoke("settings:backups:restore", backup.id);
  assert.equal((await app.invoke("config:read")).mappings[0].commandFile, "game_mode_on.txt");
});

test("読み上げ: Bridgeに保存できなければ成功として返さない", async (t) => {
  const app = loadApp(t);
  const destination = path.join(app.root, "bridge", "tts-settings.json");
  // 前はここをフォルダーにして書けなくしていた。今はフォルダーも壊れたファイルとして別の名前に残してから書くので、
  // 差し替えを失敗させて確かめる（設定ファイルの PR2）。
  const rename = fs.renameSync;
  const restore = () => { fs.renameSync = rename; };
  t.after(restore);
  fs.renameSync = (from, to) => { if (to === destination) throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }); return rename(from, to); };
  assert.throws(() => app.invoke("tts:settings:write", { engine: "voicevox", enabled: true }), /EACCES/);
  restore();
  assert.equal(fs.existsSync(path.join(app.root, "tts-settings.json")), false);
});

test("ギフト取得: ルームIDを指定し、不正な応答を拒否する", async () => {
  const file = path.resolve(__dirname, "../../GiftsViewer/tools/fetch_gifts.cjs");
  const module = { exports: {} };
  const req = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, "utf8"), {
    module, require: name => name === "tiktok-live-connector" ? {} : req(name),
  });
  const { fetchGiftCatalog, configureSystemCertificates, formatFetchError } = module.exports;
  let trusted;
  configureSystemCertificates({
    getCACertificates: type => type === "default" ? ["existing-ca"] : ["system-ca"],
    setDefaultCACertificates: certs => { trusted = Array.from(certs); },
  });
  assert.deepEqual(trusted, ["existing-ca", "system-ca"]);
  assert.doesNotThrow(() => configureSystemCertificates({}));
  const certificateError = { message: "", errors: [{ code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", config: { secret: "must-not-be-shown" } }] };
  certificateError.cause = certificateError;
  assert.match(formatFetchError(certificateError), /証明書/);
  assert.doesNotMatch(formatFetchError(certificateError), /must-not-be-shown|config|stack/);
  assert.match(formatFetchError({ errors: [] }), /取得できません/);
  let params;
  const connection = { fetchRoomId: async () => "123456", clientParams: {}, webClient: {
    getJsonObjectFromWebcastApi: async (_route, values) => {
      params = values;
      return { data: { gifts: [{ id: 5655, name: "バラ", diamond_count: 1 }] } };
    },
  } };
  assert.equal((await fetchGiftCatalog(connection)).gifts.length, 1);
  assert.equal(params.room_id, "123456");
  assert.equal(params.app_language, "ja-JP");
  connection.webClient.getJsonObjectFromWebcastApi = async () => ({ data: { gifts: [] } });
  await assert.rejects(fetchGiftCatalog(connection), /有効なギフト一覧/);
});

test("画像編集のギフト保存IPC: 読み直した設定を保持し、競合と保存エラーを成功扱いしない", async t => {
  const app = loadApp(t);
  const dir = path.join(app.root, 'bridge', 'commands', 'minecraft');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'heal.txt'), '# TITLE: 回復');
  fs.writeFileSync(path.join(dir, 'zombie.txt'), '# TITLE: ゾンビ');
  const config = JSON.parse(fs.readFileSync(app.configPath, 'utf8'));
  config.mappings = [{ giftId: '5655', name: 'バラ', commandFile: 'heal.txt', repeat: 1 }];
  fs.writeFileSync(app.configPath, JSON.stringify(config));
  const original = await app.invoke('config:read');
  config.options.unrelated = 'latest';
  fs.writeFileSync(app.configPath, JSON.stringify(config));
  const request = { giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 3, expected: original.mappings };
  const result = app.invoke('config:giftMapping:save', request);
  assert.equal(result.ok, true);
  const saved = JSON.parse(fs.readFileSync(app.configPath, 'utf8'));
  assert.equal(saved.mappings[0].commandFile, 'zombie.txt');
  assert.equal(saved.options.unrelated, 'latest');
  assert.equal(saved.mappings[0].repeat, 3);
  assert.throws(() => app.invoke('config:giftMapping:save', request), /別の操作/);
  saved.tiktokUsername = '';
  fs.writeFileSync(app.configPath, JSON.stringify(saved));
  const before = fs.readFileSync(app.configPath, 'utf8');
  const current = await app.invoke('config:read');
  assert.throws(() => app.invoke('config:giftMapping:save', { ...request, expected: current.mappings }), /未承認/);
  assert.equal(fs.readFileSync(app.configPath, 'utf8'), before);
});

test("ギフトテンプレートIPC: 確認後に割り当てのみ適用し、自動バックアップから戻せる", async t => {
  let templateFile;
  const app = loadApp(t, undefined, undefined, { showOpenDialog: async () => ({ canceled: false, filePaths: [templateFile] }) });
  const dir = path.join(app.root, 'bridge', 'commands', 'minecraft');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'heal.txt'), '# TITLE: 回復！');
  templateFile = path.join(app.root, 'gift-template.json');
  fs.writeFileSync(templateFile, JSON.stringify({ format: 'mygamepack-gift-template', version: 1, name: '回復セット', mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'heal.txt', repeat: 2 }], tiktokUsername: 'must-not-import' }));
  const before = JSON.parse(fs.readFileSync(app.configPath, 'utf8'));
  before.options = { ...before.options, commandsDir: dir };
  fs.writeFileSync(app.configPath, JSON.stringify(before));
  const opened = await app.invoke('giftTemplate:open');
  assert.deepEqual(JSON.parse(fs.readFileSync(app.configPath, 'utf8')), before);
  assert.equal(opened.preview.mappings[0].title, '回復！');
  assert.equal(app.invoke('giftTemplate:apply', opened.preview.token).ok, true);
  const after = JSON.parse(fs.readFileSync(app.configPath, 'utf8'));
  assert.equal(after.tiktokUsername, before.tiktokUsername);
  assert.equal(after.mappings[0].repeat, 2);
  const backups = await app.invoke('settings:backups:list');
  assert.equal(backups.length, 1);
  await app.invoke('settings:backups:restore', backups[0].id);
  // 戻した設定には、今の決まりで確かめた印の版の番号が付く（2026-10-18 設計書の 7）。
  assert.deepEqual(JSON.parse(fs.readFileSync(app.configPath, 'utf8')), { ...before, configVersion: 2 });
});


test('MAP IPC: save/load round trip and Markdown export use the selected server', async t => {
  const report = path.join(os.tmpdir(), 'stats-export-' + require('node:crypto').randomUUID() + '.md');
  t.after(() => fs.rmSync(report, { force: true }));
  const app = loadApp(t, undefined, undefined, { showSaveDialog: async () => ({ canceled: false, filePath: report }) });
  await app.invoke('app:config:write', { serverFolder: app.root });
  const world = path.join(app.root, 'world'); fs.mkdirSync(world); fs.writeFileSync(path.join(world, 'level.dat'), 'before');
  fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=39968\n');
  const saved = await app.invoke('world:saves:save', 'first'); assert.equal(saved.ok, true);
  fs.writeFileSync(path.join(world, 'level.dat'), 'after');
  const loaded = await app.invoke('world:saves:load', saved.saved.id); assert.equal(loaded.ok, true);
  assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'before');
  assert.equal((await app.invoke('world:saves:list')).saves.length, 1);
  const md = await app.invoke('operations:stats:export'); assert.equal(md.ok, true); assert.match(fs.readFileSync(report, 'utf8'), /# 配信統計/);
});
test('MAP IPC: stop waits for server save; path changes, starts and a second operation are blocked', async t => {
  const { EventEmitter } = require('node:events');
  const app = loadApp(t); await app.invoke('app:config:write', { serverFolder: app.root });
  const world = path.join(app.root, 'world'); fs.mkdirSync(world); fs.writeFileSync(path.join(world, 'level.dat'), 'current');
  fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=39969\n');
  const child = new EventEmitter(); Object.assign(child, { pid: 123456, exitCode: null, signalCode: null });
  let requested = false; child.stdin = { writable: true, write: text => { assert.equal(text, 'stop\n'); requested = true; } }; app.setServer(child);
  const saving = app.invoke('world:saves:save', 'checkpoint'); assert.equal(requested, true);
  await assert.rejects(app.invoke('app:config:write', { serverFolder: app.root + '-other' }), /保存・読込中/);
  await assert.rejects(app.invoke('server:start'), /保存・読込中/);
  await assert.rejects(app.invoke('server:props:write', { 'level-name': 'different' }), /保存・読込中/);
  await assert.rejects(app.invoke('world:saves:save', 'second'), /保存・読込中/);
  assert.equal(fs.existsSync(path.join(app.root, 'map-saves')), false);
  child.exitCode = 0; app.setServer(null); child.emit('exit', 0);
  const result = await saving; assert.equal(result.saved.name, 'checkpoint');
  assert.match(result.restartError, /run.bat/); // The save remains successful even if relaunch fails.
});
test('MAP IPC: external listening server prevents a snapshot', async t => {
  const app = loadApp(t); await app.invoke('app:config:write', { serverFolder: app.root });
  const server = require('node:net').createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=' + server.address().port + '\n');
  await assert.rejects(app.invoke('world:saves:save', 'unsafe'), /別のMinecraftサーバー/);
  assert.equal(fs.existsSync(path.join(app.root, 'map-saves')), false);
});

async function runningServerFixture(t, modResponse = { ok: true, tps: 20, player: { online: true } }) {
  const app = loadApp(t);
  await app.invoke('app:config:write', { serverFolder: app.root });
  const game = require('node:net').createServer(socket => socket.end());
  const mod = require('node:http').createServer((_req, res) => res.end(JSON.stringify(modResponse)));
  await new Promise(resolve => game.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => mod.listen(0, '127.0.0.1', resolve));
  t.after(() => Promise.all([game, mod].map(s => new Promise(resolve => { s.close(resolve); s.closeAllConnections?.(); }))));
  fs.writeFileSync(path.join(app.root, 'server.properties'), `level-name=world\nserver-port=${game.address().port}\n`);
  fs.writeFileSync(path.join(app.root, 'run.bat'), 'must not run');
  fs.mkdirSync(path.join(app.root, 'world'));
  fs.writeFileSync(path.join(app.root, 'world', 'level.dat'), 'world stays unchanged');
  const cfg = JSON.parse(fs.readFileSync(app.configPath));
  cfg.options.bridgeModHost = '127.0.0.1'; cfg.options.bridgeModPort = mod.address().port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  return app;
}

test('server startup: reuse a running Mod server after reopening the app without touching MAP files', async t => {
  const app = await runningServerFixture(t);
  const status = await app.invoke('server:processStatus');
  assert.equal(status.running, true); assert.equal(status.managed, false); assert.equal(status.modReady, true);
  const started = await app.invoke('server:start');
  assert.equal(started.alreadyRunning, true); assert.equal(started.external, true);
  assert.equal(fs.existsSync(path.join(app.root, 'map-saves')), false);
  assert.equal(fs.readFileSync(path.join(app.root, 'world/level.dat'), 'utf8'), 'world stays unchanged');
  await assert.rejects(app.invoke('server:stop'), /起動した画面で stop/);
  await assert.rejects(app.invoke('world:saves:save', 'live'), /別のMinecraftサーバー/);
  assert.equal((await app.invoke('server:processStatus')).running, true);
});

test('server startup: an occupied port without the Mod blocks a duplicate launch with an actionable error', async t => {
  const app = await runningServerFixture(t, { message: 'not the Mod' });
  assert.equal((await app.invoke('server:processStatus')).modReady, false);
  await assert.rejects(app.invoke('server:start'), /MyGamePackのModに接続できません/);
  assert.equal(fs.existsSync(path.join(app.root, 'map-saves')), false);
});

test('server stop: wait for save completion and prevent concurrent restarts', async t => {
  const app = loadApp(t); await app.invoke('app:config:write', { serverFolder: app.root });
  const child = new (require('node:events').EventEmitter)();
  Object.assign(child, { pid: 123456, exitCode: null, signalCode: null });
  let requested = false, completed = false;
  child.stdin = { writable: true, write: text => { assert.equal(text, 'stop\n'); requested = true; } };
  app.setServer(child);
  const stopped = app.invoke('server:stop').then(result => { completed = true; return result; });
  assert.equal(requested, true); assert.equal(completed, false);
  await assert.rejects(app.invoke('server:start'), /起動・停止中/);
  await assert.rejects(app.invoke('server:stop'), /起動・停止中/);
  await assert.rejects(app.invoke('world:saves:save', 'saving'), /準備・停止/);
  child.exitCode = 0; child.emit('exit', 0);
  assert.equal((await stopped).graceful, true);
  assert.equal((await app.invoke('server:processStatus')).running, false);
});

test('server stop: a save timeout leaves the process alive and reports incomplete shutdown', async t => {
  const app = loadApp(t); app.shortenServerWait();
  const child = new (require('node:events').EventEmitter)();
  Object.assign(child, { pid: 123456, exitCode: null, signalCode: null, stdin: { writable: true, write() {} } });
  app.setServer(child);
  await assert.rejects(app.invoke('server:stop'), /強制終了せず/);
  assert.equal((await app.invoke('server:processStatus')).running, true);
  assert.equal(child.exitCode, null);
});

test('停止の記録: BRIDGE停止はサーバーへ stop を書かず、どちらの停止も出どころを残してから止める', async t => {
  // 2026-10-10、停止パネルの BRIDGE停止だけを押したはずがサーバーも止まった。次に起きたときに出どころを追えるようにする。
  const { EventEmitter } = require('node:events');
  const app = loadApp(t);
  const logFile = path.join(app.root, 'logs', 'stop-requests.log');
  const logLines = () => fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').trimEnd().split('\n') : [];
  // 動いているサーバー。stdin に書かれたものと、書かれた時点の記録を控える。
  const writes = [];
  const server = new EventEmitter();
  Object.assign(server, { pid: 123456, exitCode: null, signalCode: null, stdin: { writable: true, write: text => { writes.push({ text, logged: logLines() }); } } });
  app.setServer(server);
  // 動いている BRIDGE。shutdown を受けたら終わる。
  fs.writeFileSync(path.join(app.root, 'bridge', 'index.js'), '');
  app.mockServerSpawn(() => {
    const child = new EventEmitter();
    Object.assign(child, { pid: 23456, stdout: new EventEmitter(), stderr: new EventEmitter(), connected: true, exitCode: null, signalCode: null,
      send: () => setImmediate(() => { child.exitCode = 0; child.emit('exit', 0); }) });
    return child;
  });

  await app.invoke('bridge:launch');
  await app.invoke('bridge:stop', 'stop-panel:bridge');
  assert.deepEqual(writes, [], 'BRIDGE停止ではサーバーに何も書かない');
  assert.equal(logLines().length, 1);
  assert.match(logLines()[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} BRIDGE停止 ← 停止パネルのBRIDGE停止$/);
  assert.ok((await app.invoke('bridge:logs')).lines.some(line => line.includes('[BRIDGE] 停止します（停止パネルのBRIDGE停止）')));

  // 画面から文字列以外の出どころが来ても、停止は最後まで行う。
  await app.invoke('bridge:launch');
  assert.equal((await app.invoke('bridge:stop', { toString: 'x' })).ok, true);
  assert.match(logLines().at(-1), /BRIDGE停止 ← 不明な出どころ$/);

  const stopping = app.invoke('server:stop', 'stop-panel:all');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].text, 'stop\n');
  assert.match(writes[0].logged.at(-1), /サーバー停止 ← 停止パネルの一括停止$/, 'stop を書く前に記録する');
  server.exitCode = 0; server.emit('exit', 0);
  assert.equal((await stopping).graceful, true);
  assert.ok((await app.invoke('server:logs')).lines.some(line => line.includes('[SERVER] ワールドを保存して停止します（停止パネルの一括停止）')));
  assert.equal(logLines().length, 3);
});

test('server startup: 開発版は BridgeMOD にリポジトリのコマンドの置き場所を渡し、インストール版は渡さない', async t => {
  // 開発版はゲームの切替がリポジトリの bridge/commands/minecraft に書く。BridgeMOD がサーバーフォルダーを読むと、採掘のコマンドが「file not found」になっていた。
  const start = async (app, inherited) => {
    await app.invoke('app:config:write', { serverFolder: app.root, setupComplete: true });
    fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=39971\n');
    fs.writeFileSync(path.join(app.root, 'run.bat'), 'must never execute');
    const child = new (require('node:events').EventEmitter)();
    Object.assign(child, { pid: 123457, stdout: new (require('node:stream').PassThrough)(), stderr: new (require('node:stream').PassThrough)() });
    let options; app.mockServerSpawn((_cmd, _args, opts) => { options = opts; return child; });
    const before = process.env.BRIDGE_MOD_COMMANDS_DIR;
    if (inherited) process.env.BRIDGE_MOD_COMMANDS_DIR = inherited;
    try { assert.equal((await app.invoke('server:start')).ok, true); } finally {
      if (before === undefined) delete process.env.BRIDGE_MOD_COMMANDS_DIR; else process.env.BRIDGE_MOD_COMMANDS_DIR = before;
    }
    return options.env;
  };
  const dev = loadApp(t);
  const devEnv = await start(dev);
  assert.equal(devEnv.BRIDGE_MOD_COMMANDS_DIR, path.join(dev.root, 'bridge', 'commands', 'minecraft'));
  assert.equal(devEnv.NO_PAUSE, '1');
  // 利用者の環境変数に別の値が残っていても、開発版はリポジトリの置き場所で上書きする。
  const devAgain = loadApp(t);
  assert.equal((await start(devAgain, path.join(devAgain.root, 'elsewhere'))).BRIDGE_MOD_COMMANDS_DIR, path.join(devAgain.root, 'bridge', 'commands', 'minecraft'));
  const installed = loadApp(t); installed.usePackagedPaths();
  // 利用者の環境変数に残っていても、インストール版のサーバーには渡さない。
  const installedEnv = await start(installed, path.join(installed.root, 'elsewhere'));
  assert.equal(installedEnv.BRIDGE_MOD_COMMANDS_DIR, undefined);
  assert.equal(installedEnv.NO_PAUSE, '1');
});

test('server startup: legacy automatic backup setting never creates a MAP save', async t => {
  const app = loadApp(t); await app.invoke('app:config:write', { serverFolder: app.root, autoBackupOnServerStart: true });
  const world = path.join(app.root, 'world'); fs.mkdirSync(world); fs.writeFileSync(path.join(world, 'level.dat'), 'original');
  fs.writeFileSync(path.join(app.root, 'server.properties'), 'level-name=world\nserver-port=39970\n');
  fs.writeFileSync(path.join(app.root, 'run.bat'), 'must never execute');
  const child = new (require('node:events').EventEmitter)();
  Object.assign(child, { pid: 123456, stdout: new (require('node:stream').PassThrough)(), stderr: new (require('node:stream').PassThrough)() });
  let starts = 0; app.mockServerSpawn(() => { starts++; return child; });
  assert.equal((await app.invoke('server:start')).ok, true);
  assert.equal(starts, 1);
  assert.equal((await app.invoke('world:saves:list')).saves.length, 0);
  assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'original');
});


test("手動配布: 旧インストールIPCは再起動やプロセス停止を行わない", async t => {
  const app = loadApp(t);
  app.usePackagedPaths();
  app.setServer({ pid: 12345 });
  const before = fs.readFileSync(app.configPath, "utf8");
  const result = await app.invoke("updater:install");
  assert.equal(result.ok, false);
  assert.equal(result.state, "manual");
  assert.match(result.message, /配布者/);
  assert.equal(fs.readFileSync(app.configPath, "utf8"), before);
});

test('Minecraft保存先IPC: 読み取り・候補選択・手動選択を通してMODやMAPを変更しない', async t => {
  let picked;
  const app = loadApp(t, undefined, undefined, { showOpenDialog: async () => picked || { canceled: true } });
  const standard = path.join(app.root, '.minecraft');
  const custom = path.join(app.root, 'Minecraft-配信');
  const manual = path.join(app.root, 'Minecraft-手動');
  for (const folder of [standard, custom, manual]) fs.mkdirSync(path.join(folder, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(custom, 'mods', 'keep.jar'), 'existing-mod');
  fs.mkdirSync(path.join(custom, 'saves'));
  fs.writeFileSync(path.join(custom, 'saves', 'keep.dat'), 'existing-world');
  const launcherFile = path.join(standard, 'launcher_profiles.json');
  const launcherText = JSON.stringify({ profiles: { game: { name: '配信', gameDir: custom, lastVersionId: '1.20.1-forge-47.4.10' } } });
  fs.writeFileSync(launcherFile, launcherText);
  const configBefore = JSON.stringify(await app.invoke('app:config:read'));
  const discovery = await app.invoke('games:clientFolders');
  assert.equal(discovery.candidates.find(c => c.path === custom).recommended, true);
  assert.equal(JSON.stringify(await app.invoke('app:config:read')), configBefore, '検索だけで保存先を変えない');
  const selected = await app.invoke('games:selectClientFolder', custom);
  assert.equal(selected.clientMods, path.join(custom, 'mods'));
  assert.equal(selected.applied, false);
  assert.equal((await app.invoke('app:config:read')).minecraftGameFolder, custom);
  assert.equal((await app.invoke('games:clientFolders')).candidates.find(c => c.current).path, custom);
  assert.equal(fs.readFileSync(path.join(custom, 'mods', 'keep.jar'), 'utf8'), 'existing-mod');
  assert.equal(fs.readFileSync(path.join(custom, 'saves', 'keep.dat'), 'utf8'), 'existing-world');
  assert.equal(fs.readFileSync(launcherFile, 'utf8'), launcherText);
  assert.equal((await app.invoke('games:clientFolder')).canceled, true);
  assert.equal((await app.invoke('games:list')).clientMods, path.join(custom, 'mods'));
  await assert.rejects(app.invoke('games:selectClientFolder', manual), /候補を再検索/);
  picked = { canceled: false, filePaths: [manual] };
  assert.equal((await app.invoke('games:clientFolder')).clientMods, path.join(manual, 'mods'));
  const invalid = path.join(app.root, 'gone');
  fs.writeFileSync(launcherFile, JSON.stringify({ profiles: { gone: { gameDir: invalid } } }));
  await assert.rejects(app.invoke('games:selectClientFolder', invalid), /フォルダーがありません/);
  assert.equal((await app.invoke('games:list')).clientMods, path.join(manual, 'mods'), '失敗時は設定を維持する');
});


test('ゲーム選択IPC: TOPでの保存前は全候補・設定保存・イベントテストを止める', async t => {
  const app = loadApp(t); app.clearGameSelection();
  assert.equal(app.invoke('bridge:commands:list').length, 0);
  assert.equal(app.invoke('bridge:commands:readMeta').length, 0);
  const config = JSON.parse(fs.readFileSync(app.configPath));
  await assert.rejects(app.invoke('config:write', config), /TOP/);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'gift', commandFile: 'cod.txt', preview: true }), /TOP/);
});
test('ゲーム選択IPC: サバイバルでは残った採掘TXTをルーレットにも保存できない', async t => {
  const app = loadApp(t), dir = path.join(app.root, 'bridge/commands/minecraft');
  fs.writeFileSync(path.join(dir, 'game_saikutu_get_ender_pearl.txt'), '# TITLE: エンダーパール\nsaikutu get_ender_pearl 1');
  for (const route of ['bridge:commands:list','bridge:commands:readMeta']) {
    const files = app.invoke(route); assert.ok(files.some(file => file.name === 'cod.txt'));
    assert.ok(!files.some(file => /ender_pearl/.test(file.name)));
  }
  const config = JSON.parse(fs.readFileSync(app.configPath));
  config.deathRoulette = { enabled: true, everyDeaths: 1, items: [{ commandFile: 'game_saikutu_get_ender_pearl.txt', weight: 1, repeat: 1 }] };
  await assert.rejects(app.invoke('config:write', config), /使えないコマンド/);
});

test('ホームのゲーム一覧に、アプリの更新でMODが古いままかと、その理由を出す（2026-10-13）', async t => {
  const app = loadApp(t);
  assert.equal((await app.invoke('games:list')).modsOutdatedAfterUpdate, false);
  const file = path.join(app.root, 'app-config.json');
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  // この版（テストでは "test"）で入れ替えられなかった記録。
  fs.writeFileSync(file, JSON.stringify({ ...current, gameModsVersion: 'old', gameModsRefreshFailed: 'test', gameModsRefreshError: 'Minecraftを終了してから切り替えてください' }));
  const status = await app.invoke('games:list');
  assert.equal(status.modsOutdatedAfterUpdate, true);
  assert.equal(status.modsRefreshError, 'Minecraftを終了してから切り替えてください');
  // 次の版では、前の版の失敗の記録は出さない。
  fs.writeFileSync(file, JSON.stringify({ ...current, gameModsVersion: 'old', gameModsRefreshFailed: 'previous', gameModsRefreshError: 'x' }));
  assert.equal((await app.invoke('games:list')).modsOutdatedAfterUpdate, false);
});

// main が記録を本当につないでいるかを、本物の main.cjs で確かめる（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5.3。最後のレビューの軽い 3）。
test('配線: アプリの設定が壊れていたら写しから戻し、userData の logs/settings-recovery.log に1行書く', async t => {
  const app = loadApp(t);
  const file = path.join(app.root, 'app-config.json');
  fs.writeFileSync(file + '.last-good', JSON.stringify({ serverFolder: app.root, setupComplete: true, minecraftPlayerName: 'Steve' }));
  fs.writeFileSync(file, '{壊れた');
  const config = await app.invoke('app:config:read');
  assert.equal(config.minecraftPlayerName, 'Steve');
  assert.equal(config.setupComplete, true);
  await app.invoke('app:config:read');
  const lines = fs.readFileSync(path.join(app.root, 'logs', 'settings-recovery.log'), 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /app-config\.json が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。壊れたファイル: app-config\.json\.broken-/);
});

// ギフト設定が壊れていて写しも無いときの、本物の main.cjs の配線（2026-10-23 設計書の 6.4。PR3 の最後のレビューの軽い 7）。
// 雛形を作らずに置いたまま、アプリの設定の保存・ゲームの一覧は止めず、BRIDGE の起動は配信前チェックと同じ案内で止め、記録に1行書く。
test('配線: ギフト設定が壊れていて写しも無ければ置いたまま。アプリの設定の保存・ゲームの一覧は動き、BRIDGE の起動は案内で止まる', async t => {
  const app = loadApp(t);
  fs.writeFileSync(app.configPath, '{壊れた');
  app.evaluate('bridgeSettings.migrateSavedConfigOnStartup()');
  assert.equal(fs.readFileSync(app.configPath, 'utf8'), '{壊れた', '雛形を作らない');
  assert.deepEqual(await app.invoke('app:config:write', { minecraftPlayerName: 'Steve' }), { ok: true });
  await app.invoke('games:list');
  await assert.rejects(app.invoke('bridge:launch'), /設定を読み込めません。初期セットアップと設定バックアップを確認してください。/);
  const log = fs.readFileSync(path.join(app.root, 'logs', 'settings-recovery.log'), 'utf8').split('\n').filter(Boolean);
  assert.equal(log.length, 1);
  assert.match(log[0], /config\.minecraft\.json が壊れていた（JSON として読めない）。前の正しい状態の写しが無い（または使えない）ので、そのまま置いた。壊れたファイルの写し: config\.minecraft\.json\.broken-/);
});
