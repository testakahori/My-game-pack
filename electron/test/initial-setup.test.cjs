const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { FORGE_VERSION, JAVA_TLS_ARGS, inspectSetup, inspectForgeClient, launchForgeInstaller, prepareServerEnvironment, missingServerFiles } = require("../initial_setup.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "first-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "新しいフォルダー (3)");
  const write = (file, text = "fixture") => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  };
  write("jdk-21.0.4+7/bin/java.exe");
  write("jdk-21.0.4+7/bin/javaw.exe");
  write("run.bat");
  write("user_jvm_args.txt", "");
  write(`forge-${FORGE_VERSION}-installer.jar`);
  write(`libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt`, "-p libraries/test/dependency.jar\n");
  write(`libraries/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-server.jar`);
  write("libraries/test/dependency.jar");
  return { dir, write, read: file => fs.readFileSync(path.join(dir, file), "utf8") };
}

test("新規フォルダー: バッチ不要で同梱JavaからForge GUIを起動する", async t => {
  const f = fixture(t);
  let unreferenced = false;
  const result = await launchForgeInstaller(f.dir, (exe, args, options) => {
    assert.equal(exe, path.join(f.dir, "jdk-21.0.4+7/bin/javaw.exe"));
    assert.deepEqual(args, [...JAVA_TLS_ARGS, "-jar", path.join(f.dir, `forge-${FORGE_VERSION}-installer.jar`)]);
    assert.equal(options.cwd, f.dir);
    assert.equal(options.shell, undefined);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter();
    child.unref = () => { unreferenced = true; };
    process.nextTick(() => child.emit("spawn"));
    return child;
  });
  assert.equal(result.ok, true);
  assert.equal(unreferenced, true);
});

test("Forge GUI: 起動失敗・ファイル不足を成功扱いしない", async t => {
  const f = fixture(t);
  await assert.rejects(launchForgeInstaller(f.dir, () => {
    const child = new EventEmitter();
    process.nextTick(() => child.emit("error", Object.assign(new Error("blocked"), { code: "EACCES" })));
    return child;
  }), /起動できません.*EACCES/);
  fs.unlinkSync(path.join(f.dir, `forge-${FORGE_VERSION}-installer.jar`));
  assert.throws(() => launchForgeInstaller(f.dir), /不足/);
});

test("初回構築: 同意後に設定を生成し、コンソール・PowerShell・サーバー起動は不要", async t => {
  const f = fixture(t);
  assert.equal(inspectSetup(f.dir).complete, false);
  await assert.rejects(prepareServerEnvironment(f.dir), /同意/);
  assert.equal(fs.existsSync(path.join(f.dir, "eula.txt")), false);
  const result = await prepareServerEnvironment(f.dir, { eulaAccepted: true, runInstaller: () => { throw Error("unexpected process"); } });
  assert.equal(result.complete, true);
  assert.match(f.read("server.properties"), /^enable-rcon=true$/m);
  assert.match(f.read("server.properties"), /^enable-command-block=true$/m);
  assert.match(f.read("server.properties"), /^online-mode=true$/m);
  assert.match(f.read("RCON_password.txt"), /^[a-f0-9]{32}\n$/);
  assert.equal(f.read("RCON_password.txt"), f.read("RCONパスワード.txt"));
  assert.equal(f.read("eula.txt"), "eula=true\n");
  for (const arg of JAVA_TLS_ARGS) assert.ok(f.read("user_jvm_args.txt").includes(arg));
  assert.equal(fs.existsSync(path.join(f.dir, "world")), false);
});

test("再試行: パスワード・既存ワールド設定・OP・ギフト設定を保持する", async t => {
  const f = fixture(t);
  f.write("server.properties", "# existing\nlevel-name=my-world\nonline-mode=false\nrcon.password=keep_password\nrcon.port=25591\nmotd=My server\n");
  f.write("ops.json", '[{"name":"ExistingPlayer"}]');
  f.write("bridge/config.minecraft.json", '{"mappings":[{"giftId":"5655"}]}');
  await prepareServerEnvironment(f.dir, { eulaAccepted: true });
  const once = f.read("server.properties");
  const jvmOnce = f.read("user_jvm_args.txt");
  await prepareServerEnvironment(f.dir);
  assert.equal(f.read("server.properties"), once);
  assert.equal(f.read("user_jvm_args.txt"), jvmOnce);
  assert.match(once, /^level-name=my-world$/m);
  assert.match(once, /^rcon.port=25591$/m);
  assert.match(once, /^online-mode=false$/m);
  assert.equal(f.read("RCON_password.txt"), "keep_password\n");
  assert.equal(f.read("ops.json"), '[{"name":"ExistingPlayer"}]');
  assert.equal(f.read("bridge/config.minecraft.json"), '{"mappings":[{"giftId":"5655"}]}');
});

test("依存ファイル不足: インストーラーの終了を待ち、失敗時に完了を残さない", async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  assert.deepEqual(missingServerFiles(f.dir), ["libraries/test/dependency.jar"]);
  await assert.rejects(prepareServerEnvironment(f.dir, { eulaAccepted: true, runInstaller: async () => { throw Error("network failed"); } }), /準備に失敗/);
  assert.equal(fs.existsSync(path.join(f.dir, "server.properties")), false);
  let runs = 0;
  const result = await prepareServerEnvironment(f.dir, { eulaAccepted: true, runInstaller: async (java, args, cwd) => {
    runs++;
    assert.equal(cwd, f.dir);
    assert.equal(args.at(-1), "--installServer");
    assert.ok(java.endsWith("java.exe"));
    await new Promise(resolve => setTimeout(resolve, 5));
    f.write("libraries/test/dependency.jar");
  } });
  assert.equal(result.complete, true);
  assert.equal(runs, 1);
});

test("完了判定: 空のlibrariesやrun.batだけでは完了しない", async t => {
  const f = fixture(t);
  f.write("server.properties", "enable-rcon=false\n");
  f.write("run.bat");
  assert.equal(inspectSetup(f.dir).complete, false);
  assert.ok(inspectSetup(f.dir).missing.includes("RCON接続設定"));
  await prepareServerEnvironment(f.dir, { eulaAccepted: true });
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  assert.equal(inspectSetup(f.dir).complete, false);
});

test("Forgeクライアント: インストーラー起動と導入完了を区別する", t => {
  const f = fixture(t);
  assert.equal(inspectForgeClient(f.dir).installed, false);
  const id = "1.20.1-forge-47.3.0";
  f.write(`versions/${id}/${id}.json`, JSON.stringify({ id, libraries: [{ name: `net.minecraftforge:fmlloader:${FORGE_VERSION}` }] }));
  assert.equal(inspectForgeClient(f.dir).installed, true);
  f.write(`versions/${id}/${id}.json`, "broken");
  assert.equal(inspectForgeClient(f.dir).installed, false);
});
