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

function loadApp(t, run = async () => { throw new Error("unexpected process"); }, updater = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mygamepack-regression-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const handlers = new Map();
  const notifications = [];
  const mainPath = path.resolve(__dirname, "../main.cjs");
  const realRequire = createRequire(mainPath);
  const app = {
    isPackaged: false, getPath: () => root, getVersion: () => "test",
    requestSingleInstanceLock: () => true, whenReady: () => ({ then() {} }), on() {},
  };
  const requireMock = (name) => {
    if (name === "electron") return {
      app, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },
      BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => notifications.push(args) } }] },
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
  for (const file of ["fetch_gifts.cjs", "gifts_to_html.cjs"]) fs.writeFileSync(path.join(tools, file), "");
  const context = vm.createContext({
    require: requireMock, __dirname: path.join(root, "electron"), console,
    process, Buffer, URL, AbortSignal, fetch, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  vm.runInContext(fs.readFileSync(mainPath, "utf8"), context, { filename: mainPath });
  return { root, configPath, notifications, invoke: (name, ...args) => handlers.get(name)({}, ...args),
    startUpdater: () => {
      app.isPackaged = true;
      context.setTimeout = () => {};
      context.setupAutoUpdater();
    },
  };
}

test("自動更新: 検出・進捗・適用準備を保持し、エラー後は再試行できる", async t => {
  const listeners = new Map();
  let checks = 0, installs = [];
  const updater = { on: (event, fn) => listeners.set(event, fn), checkForUpdates: async () => { checks++; }, quitAndInstall: (...args) => installs.push(args) };
  const app = loadApp(t, undefined, updater);
  app.startUpdater();
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
