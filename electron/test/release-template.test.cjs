const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareServerTemplate } = require("../../scripts/prepare-server-template.cjs");

test("公開テンプレート: ワールド・プレイヤー・パスワード・設定・ログ・古いデータパック・作業の道具のフォルダーを含めない", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-template-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // 元のサーバーの親に .claude があっても、外すのは元のサーバーより下の .omc・.claude だけ（PR #169 レビュー 軽い3）。
  const source = path.join(root, ".claude", "source"), target = path.join(root, "template");
  fs.mkdirSync(source, { recursive: true });
  for (const name of ["jdk-21.0.4+7", "libraries", "mods", "GiftStream_Pack", "world", "bridge", "logs"]) {
    fs.mkdirSync(path.join(source, name)); fs.writeFileSync(path.join(source, name, "fixture"), "data");
  }
  for (const name of ["forge-1.20.1-47.4.10-installer.jar", "run.bat", "run.sh", "setup.bat", "user_jvm_args.txt", "RCON_password.txt", "server.properties", "usercache.json", "ops.json"]) fs.writeFileSync(path.join(source, name), "data");
  fs.writeFileSync(path.join(source, "mods", "bridgemod-1.2.0.jar"), "old");
  fs.writeFileSync(path.join(source, "mods", "doumacmd-1.3.4.jar"), "retired");
  fs.writeFileSync(path.join(source, "mods", "unselected-game.jar"), "another game");
  fs.writeFileSync(path.join(source, "run.bat"), "java @libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt nogui");
  fs.writeFileSync(path.join(source, "setup.bat"), "java -jar forge-1.20.1-47.3.0-installer.jar --installServer");
  // 作業の道具（.omc・.claude）が写すフォルダーの中で動くと、記録のフォルダーができる（2026-10-30 に本物のサーバーで起きた。PR #168 レビュー 軽い2）。
  for (const dir of ["mods/.omc/state", "libraries/.claude", "jdk-21.0.4+7/.omc", "libraries/org/.OMC/deep"]) {
    fs.mkdirSync(path.join(source, dir), { recursive: true }); fs.writeFileSync(path.join(source, dir, "note.json"), "{}");
  }
  const currentMod = path.join(root, "bridgemod-1.3.0.jar");
  fs.writeFileSync(currentMod, "current");
  const displayMod = path.join(root, "displaymod-1.0.0.jar"); fs.writeFileSync(displayMod, "display");
  assert.throws(() => prepareServerTemplate(source, target, path.join(root, "missing.jar")), /Build the current/);
  assert.equal(fs.existsSync(target), false);
  assert.throws(() => prepareServerTemplate(source, target, currentMod, path.join(root, 'missing-display.jar')), /DisplayMod/);
  assert.equal(fs.existsSync(target), false);
  prepareServerTemplate(source, target, currentMod, displayMod);
  assert.equal(fs.readFileSync(path.join(target, "mods", "bridgemod-1.3.0.jar"), "utf8"), "current");
  assert.equal(fs.existsSync(path.join(target, "mods", "bridgemod-1.2.0.jar")), false);
  assert.deepEqual(fs.readdirSync(path.join(target, "mods")).filter(n => n.endsWith('.jar')).sort(), ['bridgemod-1.3.0.jar', 'displaymod-1.0.0.jar']);
  assert.match(fs.readFileSync(path.join(target, "run.bat"), "utf8"), /1\.20\.1-47\.4\.10\/win_args/);
  assert.match(fs.readFileSync(path.join(target, "setup.bat"), "utf8"), /forge-1\.20\.1-47\.4\.10-installer/);
  assert.match(fs.readFileSync(path.join(source, "run.bat"), "utf8"), /47\.3\.0/);
  // GiftStream_Pack はサーバーフォルダーの直下では Minecraft に読まれず、中身もほかが受け持っているので配らない（2026-10-30 ユーザーの決定）。
  for (const name of ["world", "bridge", "logs", "GiftStream_Pack", "RCON_password.txt", "server.properties", "usercache.json", "ops.json"]) assert.equal(fs.existsSync(path.join(target, name)), false, name);
  for (const dir of ["mods/.omc", "libraries/.claude", "jdk-21.0.4+7/.omc", "libraries/org/.OMC"]) assert.equal(fs.existsSync(path.join(target, dir)), false, dir);
  for (const dir of ["mods", "libraries", "jdk-21.0.4+7"]) assert.equal(fs.existsSync(path.join(target, dir, "fixture")), true, `${dir} の中身は写す`);
  assert.equal(fs.existsSync(path.join(target, "libraries", "org")), true, "道具のフォルダーの横にあるものは写す");
  assert.throws(() => prepareServerTemplate(source, target), /already exists/);
});
