const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createSettingsBackups, atomicWrite } = require("../settings_backups.cjs");
const { runPreflight } = require("../preflight.cjs");
const { validateBridgeConfig } = require("../config_schema.cjs");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const write = (file, value) => atomicWrite(file, JSON.stringify(value));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mygamepack-safety-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const p = { config: path.join(root, "bridge/config.json"), app: path.join(root, "app.json"), tts: path.join(root, "tts.json"), bridgeTts: path.join(root, "bridge/tts.json"), commands: path.join(root, "bridge/commands"), backups: path.join(root, "backups") };
  const cfg = { tiktokUsername: "akahoridouma", mappings: [{ giftId: "5655", commandFile: "rose.txt", repeat: 1 }], rcon: { password: "live-secret", port: 25575 }, options: { commandTransport: "bridge_mod", commandsDir: p.commands, bridgeModPort: 25576, giftCooldownMs: 300 } };
  write(p.config, cfg); write(p.app, { authToken: "private-login", serverFolder: root, setupComplete: true, autoBackupOnServerStart: true });
  write(p.tts, { engine: "voicevox", enabled: true, speakerId: 2 }); write(p.bridgeTts, read(p.tts));
  atomicWrite(path.join(p.commands, "rose.txt"), "say original");
  const deps = { paths: () => p, version: () => "test", readTts: () => read(p.tts), isRunning: () => false };
  return { root, p, cfg, deps, store: createSettingsBackups(deps) };
}

test("設定バックアップ: 復元・復元の取消と接続情報の保持", t => {
  const { p, cfg, store } = fixture(t);
  const original = store.create();
  const snapshotText = fs.readFileSync(path.join(p.backups, original.id), "utf8");
  assert.doesNotMatch(snapshotText, /live-secret|private-login/);
  write(p.config, { ...cfg, mappings: [], rcon: { password: "new-secret", port: 12345 } });
  atomicWrite(path.join(p.commands, "rose.txt"), "say changed");
  write(p.tts, { engine: "aivis", enabled: false, speakerId: 1 });
  write(p.app, { ...read(p.app), authToken: "current-login", autoBackupOnServerStart: false });
  const result = store.restore(original.id);
  assert.equal(read(p.config).mappings.length, 1);
  assert.equal(read(p.config).rcon.password, "new-secret");
  assert.equal(read(p.app).authToken, "current-login");
  assert.equal(read(p.app).autoBackupOnServerStart, true);
  assert.equal(fs.readFileSync(path.join(p.commands, "rose.txt"), "utf8"), "say original");
  assert.deepEqual(read(p.tts), read(p.bridgeTts));
  store.restore(result.safetyBackup);
  assert.equal(read(p.config).mappings.length, 0);
  assert.equal(fs.readFileSync(path.join(p.commands, "rose.txt"), "utf8"), "say changed");
  assert.equal(read(p.tts).engine, "aivis");
});

test("設定復元: 書き込み失敗時に全ファイルを巻き戻し、事前バックアップを保持", t => {
  const { p, cfg, store, deps } = fixture(t);
  const original = store.create();
  write(p.config, { ...cfg, mappings: [] });
  const before = fs.readFileSync(p.config, "utf8");
  let calls = 0;
  const failing = createSettingsBackups({ ...deps, write(file, value) { atomicWrite(file, value); if (++calls === 2) throw new Error("disk failure"); } });
  assert.throws(() => failing.restore(original.id), /変更前の設定へ戻しました/);
  assert.equal(fs.readFileSync(p.config, "utf8"), before);
  assert.ok(store.list().some(row => row.reason === "before-restore"));
});

test("未完成の設定もバックアップでき、修正後に元の状態へ戻せる", t => {
  const { p, cfg, store } = fixture(t);
  const unfinished = { ...cfg, mappings: [{ giftId: "15752", name: "Star Goggles" }] };
  write(p.config, unfinished);
  const row = store.create("automatic");
  assert.equal(row.issues, 1);
  write(p.config, cfg);
  store.restore(row.id);
  assert.deepEqual(read(p.config).mappings, unfinished.mappings);
});

// 一覧の「問題の数」は、戻したときに書く設定（今のつなぎ方を戻し、古い版の値を直したもの）で数える（2026-10-18 設計書の 7）。
test("設定バックアップの一覧: 戻したときの設定で問題を数える（警告と、戻すときに直る値は数えない）", t => {
  const { p, cfg, store } = fixture(t);
  const issues = config => { write(p.config, config); const row = store.create(); write(p.config, cfg); return store.list().find(r => r.id === row.id).issues; };
  assert.equal(issues({ ...cfg, mappings: [{ giftId: "1", name: "ネコ", commandFile: "ネコ.txt" }] }), 0);
  assert.equal(issues({ ...cfg, mappings: [{ giftId: "5655", commandFile: "rose.txt", repeat: 2.5 }] }), 0);
  assert.equal(issues({ ...cfg, tiktokUsername: "foo-bar" }), 1);
});

test("設定復元: 古い版のバックアップの回数（2.5 など）は戻すときに直す", t => {
  const { p, cfg, store } = fixture(t);
  write(p.config, { ...cfg, mappings: [{ giftId: "5655", commandFile: "rose.txt", repeat: 2.5 }], likeEvents: [{ threshold: 0, commandFile: "rose.txt" }] });
  const row = store.create();
  write(p.config, cfg);
  store.restore(row.id);
  const restored = read(p.config);
  assert.deepEqual([restored.mappings[0].repeat, restored.likeEvents[0].threshold, restored.configVersion], [3, 1, 2]);
  assert.equal(validateBridgeConfig(restored).ok, true);
});

test("設定復元: 起動中・破損・別サーバー・パス脱出は書き込み前に拒否", t => {
  const { p, store, deps } = fixture(t);
  const row = store.create();
  const file = path.join(p.backups, row.id);
  const good = read(file);
  assert.throws(() => createSettingsBackups({ ...deps, isRunning: () => true }).restore(row.id), /停止/);
  assert.throws(() => store.restore("../app.json"), /ID/);
  write(file, { ...good, scope: "another-server" });
  assert.throws(() => store.restore(row.id), /別のサーバー/);
  write(file, { ...good, sha256: "invalid" });
  assert.throws(() => store.restore(row.id), /破損/);
  good.payload.commands["../outside.txt"] = "bad";
  good.sha256 = crypto.createHash("sha256").update(JSON.stringify(good.payload)).digest("hex");
  write(file, good);
  assert.throws(() => store.restore(row.id), /コマンド/);
  assert.equal(read(p.config).mappings.length, 1);
  assert.deepEqual(store.list(), []);
});

test("設定バックアップ: 同一内容の自動保存を重複させず30世代を保持", t => {
  const { p, cfg, store } = fixture(t);
  const manual = store.create();
  assert.equal(store.create("automatic").id, manual.id);
  for (let i = 0; i < 33; i++) { write(p.config, { ...cfg, options: { ...cfg.options, giftCooldownMs: i } }); store.create("automatic"); }
  assert.equal(store.list().filter(row => row.reason === "automatic").length, 30);
  assert.ok(store.list().some(row => row.id === manual.id));
});

test("配信前チェック: 破損した設定でも修復先を案内する", async t => {
  const { p } = fixture(t);
  for (const invalid of ["null", "[]", "{broken"]) {
    atomicWrite(p.config, invalid);
    const result = await runPreflight({ configPath: p.config });
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].status, "error");
    assert.equal(result.checks[0].page, "operations");
  }
});

test("配信前チェック: 接続・一覧の新鮮さ・コマンド・音声を独立判定", async t => {
  const { p, cfg, root } = fixture(t);
  atomicWrite(path.join(root, "server.properties"), "enable-rcon=true\nrcon.password=live-secret\nrcon.port=25575\nlevel-name=world\n");
  atomicWrite(path.join(root, "run.bat"), ""); atomicWrite(path.join(root, "world/level.dat"), "");
  const giftsPath = path.join(root, "gifts.json"), giftsMetaPath = path.join(root, "meta.json");
  write(giftsPath, [{ id: 5655 }, { id: 5655 }]);
  write(giftsMetaPath, { username: "akahoridouma", generatedAt: new Date().toISOString() });
  const deps = { configPath: p.config, serverRoot: root, commandsDir: p.commands, giftsPath, giftsMetaPath,
    modStatus: async () => ({ online: true, player: { online: true } }), bridgeStatus: () => ({ running: true, tiktok: { state: "connected", username: "akahoridouma" } }), ttsStatus: async () => ({ enabled: true, online: true, engine: "voicevox" }) };
  const good = await runPreflight(deps);
  assert.ok(good.checks.every(row => row.status === "ok"));
  assert.match(good.checks.find(row => row.id === "gifts").detail, /1種類/);
  write(p.config, { ...cfg, mappings: [{ giftId: 1, commandFile: "missing.txt" }] });
  write(giftsMetaPath, { username: "other", generatedAt: new Date().toISOString() });
  const bad = await runPreflight({ ...deps, modStatus: async () => { throw new Error("offline"); }, bridgeStatus: () => ({ running: false, tiktok: { state: "connected" } }), ttsStatus: async () => ({ enabled: false }) });
  const status = id => bad.checks.find(row => row.id === id).status;
  assert.equal(status("commands"), "error"); assert.equal(status("gifts"), "warn"); assert.equal(status("bridge"), "warn"); assert.equal(status("mod"), "warn"); assert.equal(status("tts"), "skip");
  assert.doesNotMatch(JSON.stringify(bad), /live-secret|private-login/);
  assert.equal(validateBridgeConfig({ ...cfg, mappings: {} }).ok, false);
  // TikTok ID は tiktok_id.cjs で整えた形（BRIDGE が接続する形）で確かめて出す（2026-10-18 設計書の 9）。
  write(p.config, { ...cfg, tiktokUsername: " @AkahoriDouma " });
  const account = (await runPreflight(deps)).checks.find(row => row.id === "account");
  assert.deepEqual([account.status, account.detail], ["ok", "@akahoridouma"]);
  // ギフト一覧を取った ID も同じ形に整えて比べる（ギフト一覧の自動更新と同じ。PR3 の最終レビュー）。
  write(giftsMetaPath, { username: " @AkahoriDouma ", generatedAt: new Date().toISOString() });
  assert.equal((await runPreflight(deps)).checks.find(row => row.id === "gifts").status, "ok");
  // 参照の数え方は command_files.cjs の commandFileRefs の1か所（処理のコピー PR5）。BRIDGE が動かすものだけを数える。
  write(p.config, { ...cfg, options: { gameplay: { commentCommands: { "!猫": "missing.txt" } } } });
  assert.match((await runPreflight(deps)).checks.find(row => row.id === "commands").detail, /missing\.txt/, "文字列で書いたコメントコマンドも数える");
  write(p.config, { ...cfg, mappings: [{ giftId: "1", commandFile: "missing.txt", enabled: false }, ...cfg.mappings], roulette: { items: [{ commandFile: "missing.txt" }] } });
  assert.equal((await runPreflight(deps)).checks.find(row => row.id === "commands").status, "ok", "無効の割り当て・有効にしていないルーレットは数えない");
  write(p.config, { ...cfg, tiktokUsername: "foo-bar" });
  assert.equal((await runPreflight(deps)).checks.find(row => row.id === "account").status, "error");
});

// Shift_JIS などの UTF-8 でない txt（処理のコピー PR7。HANDOFF04 の PR1 のレビューの残り）。
// 前はバックアップが UTF-8 として読んで U+FFFD に変え、戻すとファイルが壊れていた。「# TITLE: ネコ」と「say hi」。
const SJIS = Buffer.from([0x23, 0x20, 0x54, 0x49, 0x54, 0x4c, 0x45, 0x3a, 0x20, 0x83, 0x6c, 0x83, 0x52, 0x0a, 0x73, 0x61, 0x79, 0x20, 0x68, 0x69, 0x0a]);

test("設定バックアップ: UTF-8 でない txt（Shift_JIS）はバイトのまま取り、戻すと元と同じ", t => {
  const { p, store, deps } = fixture(t);
  fs.writeFileSync(path.join(p.commands, "sjis.txt"), SJIS);
  const backup = store.create();
  assert.equal(backup.commands, 2, "UTF-8 の rose.txt と Shift_JIS の sjis.txt");
  fs.writeFileSync(path.join(p.commands, "sjis.txt"), "say changed");
  atomicWrite(path.join(p.commands, "rose.txt"), "say changed");
  let names = [];
  createSettingsBackups({ ...deps, validateRestore: (_config, commands) => { names = Object.keys(commands).sort(); } }).restore(backup.id);
  assert.deepEqual(fs.readFileSync(path.join(p.commands, "sjis.txt")), SJIS, "前は U+FFFD に変わって戻っていた");
  assert.equal(fs.readFileSync(path.join(p.commands, "rose.txt"), "utf8"), "say original");
  assert.deepEqual(names, ["rose.txt", "sjis.txt"], "戻す前の確かめには両方の名前を渡す");
  // 全部 UTF-8 のときは前の形（binaryCommands がない）のまま。前の版のバックアップと同じ形なので、同じ内容の自動保存も重ならない。
  fs.unlinkSync(path.join(p.commands, "sjis.txt"));
  const plain = store.create();
  assert.equal(read(path.join(p.backups, plain.id)).payload.binaryCommands, undefined);
});

test("設定復元: binaryCommands の名前と値も確かめ、パス脱出は書き込み前に拒否", t => {
  const { p, store } = fixture(t);
  fs.writeFileSync(path.join(p.commands, "sjis.txt"), SJIS);
  const row = store.create();
  const file = path.join(p.backups, row.id);
  const good = read(file);
  const rewrite = binaryCommands => {
    const payload = { ...good.payload, binaryCommands };
    write(file, { ...good, payload, sha256: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex") });
  };
  // commands と同じ名前（rose.txt）・base64 でない値も断る（手で作ったバックアップ。PR7 の最後のレビュー）。
  for (const bad of [{ "../outside.txt": SJIS.toString("base64") }, { "sjis.txt": 1 }, [], { "rose.txt": SJIS.toString("base64") }, { "sjis.txt": "@@@" }]) {
    rewrite(bad);
    assert.throws(() => store.restore(row.id), /コマンド/, JSON.stringify(bad));
  }
  assert.equal(fs.existsSync(path.join(p.commands, "..", "outside.txt")), false);
});

test("配信前チェック: 参照しているコマンドが UTF-8 で保存されていなければエラーにする", async t => {
  const { p, cfg, root } = fixture(t);
  fs.writeFileSync(path.join(p.commands, "sjis.txt"), SJIS);
  write(p.config, { ...cfg, mappings: [{ giftId: "5655", commandFile: "sjis.txt", repeat: 1 }] });
  const deps = { configPath: p.config, serverRoot: root, commandsDir: p.commands, giftsPath: path.join(root, "none.json"), giftsMetaPath: path.join(root, "none.json"),
    modStatus: async () => ({ online: false }), bridgeStatus: () => ({ running: false }), ttsStatus: async () => ({ enabled: false }) };
  const commands = (await runPreflight(deps)).checks.find(row => row.id === "commands");
  assert.equal(commands.status, "error", "前は ok だった（BRIDGE は U+FFFD にして読み、BridgeMOD は読めない）");
  assert.match(commands.detail, /UTF-8 で保存されていないファイル: sjis\.txt。メモ帳などで UTF-8 で保存し直してください/);
});
