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
      app, dialog, safeStorage, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      clipboard: { writeText: text => copiedTexts.push(text) },
      BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [{ webContents: { send: (...args) => notifications.push(args) } }] },
    };
    if (name === "electron-updater") return { autoUpdater: updater };
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
  const tools = path.join(root, "GiftsViewer", "tools");
  fs.mkdirSync(tools, { recursive: true });
  for (const file of ["fetch_gifts.cjs", "gifts_to_html.cjs", "live_status.cjs"]) fs.writeFileSync(path.join(tools, file), "");
  const context = vm.createContext({
    require: requireMock, __dirname: path.join(root, "electron"), console,
    process: Object.assign(Object.create(process), { resourcesPath: path.join(root, 'resources') }),
    Buffer, URL, AbortSignal, fetch, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(fs.readFileSync(mainPath, "utf8"), context, { filename: mainPath });
  return { root, configPath, notifications, copiedTexts, invoke: (name, ...args) => handlers.get(name)({}, ...args),
    startUpdater: () => {
      app.isPackaged = true;
      context.setTimeout = () => {};
      context.setupAutoUpdater();
    },
    usePackagedPaths: () => { app.isPackaged = true; },
    mockServerSpawn: fn => { serverSpawn = fn; },
    setServer: child => { context.fixtureChild = child; vm.runInContext('serverProcRef = fixtureChild; serverPid = fixtureChild?.pid || null;', context); },
    shortenServerWait: () => vm.runInContext('const originalWait = waitChildExit; waitChildExit = child => originalWait(child, 30);', context),
  };
}

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

test("自動更新: 検出・進捗・適用準備を保持し、エラー後は再試行できる", async t => {
  const listeners = new Map();
  let checks = 0, installs = [];
  const updater = { on: (event, fn) => listeners.set(event, fn), checkForUpdates: async () => { checks++; }, quitAndInstall: (...args) => installs.push(args) };
  const app = loadApp(t, undefined, updater);
  app.startUpdater();
  assert.equal(updater.allowPrerelease, false);
  assert.equal(updater.allowDowngrade, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal((await app.invoke("updater:install")).ok, false);
  listeners.get("checking-for-update")();
  await app.invoke("updater:check");
  assert.equal(checks, 0);
  listeners.get("update-available")({ version: "1.0.25" });
  listeners.get("download-progress")({ percent: 57.4 });
  assert.equal((await app.invoke("updater:status")).percent, 57);
  listeners.get("update-downloaded")({ version: "1.0.25" });
  assert.equal((await app.invoke("updater:check")).state, "ready");
  assert.equal(checks, 0);
  assert.equal((await app.invoke("updater:install")).ok, true);
  assert.deepEqual(installs, [[true, true]]);
  listeners.get("error")(new Error("通信切断"));
  assert.equal((await app.invoke("updater:status")).error, "通信切断");
  await app.invoke("updater:check");
  assert.equal(checks, 1);
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

test("イベントIPC: 条件確認は未送信、全種別の実送信はテスト履歴、部分失敗も報告", async t => {
  const http = require("node:http");
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString()); received.push({ url: req.url, payload });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(payload.key === "fail" ? { ok: false, message: "模擬エラー" } : { ok: true }));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const app = loadApp(t);
  const cfg = JSON.parse(fs.readFileSync(app.configPath));
  const rule = { commandFile: "qa.txt", enabled: true, repeat: 1 };
  Object.assign(cfg, { shareEvent: rule, followEvent: rule, memberEvent: rule, unmappedGiftEvent: rule,
    likeEvents: [{ ...rule, threshold: 10 }], commentGifts: { enabled: true, rules: [{ ...rule, match: "確認" }] } });
  cfg.options.bridgeModPort = server.address().port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  const dir = path.join(app.root, "bridge", "commands", "minecraft"); fs.mkdirSync(dir, { recursive: true });
  for (const file of ["qa.txt", "fail.txt"]) fs.writeFileSync(path.join(dir, file), "say test");
  const preview = await app.invoke("mod:testEvent", { type: "share", preview: true });
  assert.equal(preview.matched, true); assert.equal(received.length, 0);
  for (const type of ["share", "follow", "member", "unmapped_gift", "comment", "like", "gift"]) {
    const result = await app.invoke("mod:testEvent", { type, comment: "確認", likeCount: 10, commandFile: "qa.txt" });
    assert.equal(result.ok, true, type);
  }
  assert.equal(received.length, 7);
  assert.ok((await app.invoke("operations:history")).every(row => row.source === "test"));
  assert.equal((await app.invoke("operations:streamStats")).overall.events, 0);
  cfg.commentGifts.rules.push({ ...rule, match: "確認", commandFile: "fail.txt" }); fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  const partial = await app.invoke("mod:testEvent", { type: "comment", comment: "確認" });
  assert.equal(partial.ok, false); assert.equal(partial.fired.filter(row => row.ok).length, 1);
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

test("読み上げ: Bridgeに保存できなければ成功として返さない", async (t) => {
  const app = loadApp(t);
  const destination = path.join(app.root, "bridge", "tts-settings.json");
  fs.mkdirSync(destination);
  assert.throws(() => app.invoke("tts:settings:write", { engine: "voicevox", enabled: true }));
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
  assert.deepEqual(JSON.parse(fs.readFileSync(app.configPath, 'utf8')), before);
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


test('更新確認のPromise失敗もエラー状態へ戻り、再試行で復旧する',async t=>{
 const listeners=new Map();let fail=true;
 const updater={on:(event,fn)=>listeners.set(event,fn),checkForUpdates:async()=>{
   listeners.get('checking-for-update')();if(fail)throw new Error('network unavailable');listeners.get('update-not-available')({version:'1.0.43'});
 }};
 const app=loadApp(t,undefined,updater);app.startUpdater();
 assert.equal((await app.invoke('updater:check')).state,'error');
 fail=false;assert.equal((await app.invoke('updater:check')).state,'current');
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
