const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const setup = require("../initial_setup.cjs");
const { FORGE_VERSION, JAVA_TLS_ARGS, inspectSetup, inspectForgeClient, launchForgeInstaller, missingServerFiles } = setup;
const prepareServerEnvironment = (root, options = {}) => setup.prepareServerEnvironment(root, {
  ensureStopped: async () => {},
  generateWorld: async (_root, destination) => {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "level.dat"), "saved world fixture");
  }, ...options,
});

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
  write("run.bat", `@echo off\r\njava @user_jvm_args.txt @libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt nogui\r\n`);
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
    assert.equal(options.windowsHide, false);
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

test("初回構築: 同意後に設定と配信ワールドを準備し、コンソール操作は不要", async t => {
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
  assert.equal(fs.existsSync(path.join(f.dir, "haihu_world/world/level.dat")), true);
  assert.match(f.read("server.properties"), /^level-name=haihu_world\/world$/m);
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
  // 3回とも失敗したときだけ知らせる。ログの名前は2通り、本当の理由も添える（2026-11-06 レビュー 重要2・軽い3・軽い4）。
  let failures = 0;
  const slept = [];
  await assert.rejects(prepareServerEnvironment(f.dir, { eulaAccepted: true, sleep: async ms => { slept.push(ms); }, runInstaller: async () => { failures++; throw Error("network failed"); } }),
    /ダウンロードできませんでした.*インターネット.*installer\.jar\.log または installer\.log.*（network failed）/s);
  assert.equal(failures, 3);
  assert.deepEqual(slept, [5000, 5000]);
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

// 通信が一瞬止まって1回目が失敗しても、やり直して通れば環境構築は終わる（実機で2回に1回 Read timed out があった。2026-11-06 レビュー 重要2）。
test("依存ファイル不足: インストーラーが1回失敗しても、やり直して通れば完了する", async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  const progress = [];
  let runs = 0;
  const result = await prepareServerEnvironment(f.dir, { eulaAccepted: true, sleep: async () => {}, onProgress: message => progress.push(message), runInstaller: async () => {
    runs++;
    if (runs === 1) throw Error("Read timed out");
    f.write("libraries/test/dependency.jar");
  } });
  assert.equal(result.complete, true);
  assert.equal(runs, 2);
  assert.ok(progress.some(message => /やり直しています（2\/3回目）/.test(message)), progress.join(" / "));
});

// 配る雛形には libraries を入れない（Mojang のサーバー本体と対応表を再配布しない。2026-11-06 ユーザーの決定）。
// 初回の環境構築で Forge のインストーラーが取りに行く。インターネットが要ることを、進み具合の文で知らせる。
test("配る雛形（libraries なし）: 初回の環境構築でインストーラーがダウンロードし、起動ファイルは雛形のまま", async t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.dir, "libraries"), { recursive: true });
  const runBat = f.read("run.bat");
  assert.deepEqual(missingServerFiles(f.dir), [`libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt`, `libraries/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-server.jar`]);
  assert.equal(inspectSetup(f.dir).complete, false);
  const progress = [];
  let options;
  const result = await prepareServerEnvironment(f.dir, { eulaAccepted: true, onProgress: message => progress.push(message), runInstaller: async (_java, args, cwd, given) => {
    options = given;
    assert.deepEqual(args, [...JAVA_TLS_ARGS, "-jar", path.join(f.dir, `forge-${FORGE_VERSION}-installer.jar`), "--installServer"]);
    assert.equal(progress.at(-1), setup.INSTALLER_PROGRESS, "ダウンロードの前に知らせる");
    // 本物のインストーラーは libraries を作り、run.bat を書き直す。
    f.write(`libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt`, "-p libraries/test/dependency.jar\n");
    f.write(`libraries/net/minecraftforge/forge/${FORGE_VERSION}/forge-${FORGE_VERSION}-server.jar`);
    f.write("libraries/test/dependency.jar");
    f.write("run.bat", `java @libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt %*\r\npause\r\n`);
  } });
  assert.equal(result.complete, true);
  assert.match(setup.INSTALLER_PROGRESS, /Mojang/);
  assert.match(setup.INSTALLER_PROGRESS, /インターネット/);
  assert.equal(options.timeoutMs, setup.INSTALLER_TIMEOUT_MS);
  assert.ok(setup.INSTALLER_TIMEOUT_MS >= 10 * 60 * 1000, "遅い回線でも途中で切らない");
  assert.equal(f.read("run.bat"), runBat, "起動ファイルは雛形のもの（同梱の Java を使う）に戻す");
});

test("完了判定: 空のlibrariesやrun.batだけでは完了しない", async t => {
  const f = fixture(t);
  f.write("server.properties", "enable-rcon=false\n");
  f.write("run.bat", `java @libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt nogui`);
  assert.equal(inspectSetup(f.dir).complete, false);
  assert.ok(inspectSetup(f.dir).missing.includes("RCON接続設定"));
  await prepareServerEnvironment(f.dir, { eulaAccepted: true });
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  assert.equal(inspectSetup(f.dir).complete, false);
});

test("Forgeクライアント: インストーラー起動と導入完了を区別する", t => {
  const f = fixture(t);
  assert.equal(inspectForgeClient(f.dir).installed, false);
  const id = "1.20.1-forge-47.4.10";
  f.write(`versions/${id}/${id}.json`, JSON.stringify({ id, libraries: [{ name: `net.minecraftforge:fmlloader:${FORGE_VERSION}` }] }));
  assert.equal(inspectForgeClient(f.dir).installed, true);
  f.write(`versions/${id}/${id}.json`, "broken");
  assert.equal(inspectForgeClient(f.dir).installed, false);
});

test("Forge更新: 旧版が併存してもrun.batが選んだ版を検出する", t => {
  const f = fixture(t);
  const { detectServerForgeVersion } = require("../forge_version.cjs");
  f.write("libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt", "old");
  f.write("run.bat", "rem java @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt\njava @libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt nogui");
  assert.equal(detectServerForgeVersion(f.dir), "1.20.1-47.4.10");
  f.write("run.bat", "java @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt nogui");
  assert.equal(detectServerForgeVersion(f.dir), "1.20.1-47.3.0");
  f.write("run.bat", "java @libraries/net/minecraftforge/forge/1.20.1-47.4.99/win_args.txt nogui");
  assert.equal(detectServerForgeVersion(f.dir), "");
});

test("既存フォルダー: 旧起動設定を退避して新版へ揃えてからワールドを準備する", async t => {
  const f = fixture(t);
  const oldRun = '@echo off\r\n"custom-java.exe" @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt nogui %*\r\n';
  f.write("run.bat", oldRun);
  f.write("run.sh", "java @libraries/net/minecraftforge/forge/1.20.1-47.3.0/unix_args.txt\n");
  f.write("setup.bat", "java -jar forge-1.20.1-47.3.0-installer.jar --installServer\r\n");
  assert.ok(inspectSetup(f.dir).missing.includes("Forgeサーバーの起動設定"));
  await prepareServerEnvironment(f.dir, { eulaAccepted: true, generateWorld: async (_root, destination) => {
    assert.equal(require("../forge_version.cjs").detectServerForgeVersion(f.dir), FORGE_VERSION);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "level.dat"), "saved");
  } });
  assert.equal(f.read("run.bat"), oldRun.replaceAll("47.3.0", "47.4.10"));
  assert.match(f.read("run.sh"), /47\.4\.10/);
  assert.match(f.read("setup.bat"), /47\.4\.10-installer/);
  const backups = path.join(f.dir, "forge-launcher-backups");
  const saved = fs.readdirSync(backups);
  assert.equal(saved.length, 1);
  assert.equal(fs.readFileSync(path.join(backups, saved[0], "run.bat"), "utf8"), oldRun);
  await prepareServerEnvironment(f.dir);
  assert.deepEqual(fs.readdirSync(backups), saved, "再実行で同じバックアップを増やさない");
  assert.equal(inspectSetup(f.dir).complete, true);
});

test("Forge再構築: インストーラーが起動ファイルを書いても以前のJava指定を保持する", async t => {
  const f = fixture(t);
  const original = '"chosen-java.exe" @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt nogui %*\r\n';
  f.write("run.bat", original);
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  await prepareServerEnvironment(f.dir, { eulaAccepted: true, runInstaller: async () => {
    f.write("run.bat", `java @libraries/net/minecraftforge/forge/${FORGE_VERSION}/win_args.txt %*\r\npause\r\n`);
    f.write("libraries/test/dependency.jar");
  } });
  assert.equal(f.read("run.bat"), original.replaceAll("47.3.0", "47.4.10"));
});

test("不明な独自起動ファイルは上書きせず環境構築を止める", async t => {
  const f = fixture(t);
  f.write("run.bat", "call custom-server.bat\r\n");
  await assert.rejects(prepareServerEnvironment(f.dir, { eulaAccepted: true }), /既存ファイルは変更せず/);
  assert.equal(f.read("run.bat"), "call custom-server.bat\r\n");
  assert.equal(fs.existsSync(path.join(f.dir, "server.properties")), false);
  assert.equal(fs.existsSync(path.join(f.dir, "haihu_world")), false);
});

test("Forge再構築: インストーラー自身が新版に揃えた場合も旧ファイルを退避する", async t => {
  const f = fixture(t);
  const original = 'java @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt nogui\r\n';
  f.write("run.bat", original);
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  await prepareServerEnvironment(f.dir, { eulaAccepted: true, runInstaller: async () => {
    f.write("run.bat", original.replaceAll("47.3.0", "47.4.10"));
    f.write("libraries/test/dependency.jar");
  } });
  const backups = path.join(f.dir, "forge-launcher-backups");
  assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0], "run.bat"), "utf8"), original);
});

test("Forge再構築: ダウンロード途中で失敗しても以前の起動設定は退避済み", async t => {
  const f = fixture(t);
  const original = 'java @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt nogui\r\n';
  f.write("run.bat", original);
  fs.unlinkSync(path.join(f.dir, "libraries/test/dependency.jar"));
  await assert.rejects(prepareServerEnvironment(f.dir, { eulaAccepted: true, runInstaller: async () => {
    f.write("run.bat", original.replaceAll("47.3.0", "47.4.10"));
    throw Error("download interrupted");
  } }), /ダウンロードできませんでした.*インターネット/);
  const backups = path.join(f.dir, "forge-launcher-backups");
  assert.equal(fs.readFileSync(path.join(backups, fs.readdirSync(backups)[0], "run.bat"), "utf8"), original);
  assert.equal(inspectSetup(f.dir).complete, false);
});
