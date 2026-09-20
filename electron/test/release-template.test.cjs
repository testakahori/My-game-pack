const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareServerTemplate } = require("../../scripts/prepare-server-template.cjs");

test("公開テンプレート: ワールド・プレイヤー・パスワード・設定・ログを含めない", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-template-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), target = path.join(root, "template");
  fs.mkdirSync(source);
  for (const name of ["jdk-21.0.4+7", "libraries", "mods", "GiftStream_Pack", "world", "bridge", "logs"]) {
    fs.mkdirSync(path.join(source, name)); fs.writeFileSync(path.join(source, name, "fixture"), "data");
  }
  for (const name of ["forge-1.20.1-47.3.0-installer.jar", "run.bat", "run.sh", "setup.bat", "user_jvm_args.txt", "RCON_password.txt", "server.properties", "usercache.json", "ops.json"]) fs.writeFileSync(path.join(source, name), "data");
  fs.writeFileSync(path.join(source, "mods", "doumacmd-1.2.0.jar"), "old");
  const currentMod = path.join(root, "doumacmd-1.3.0.jar");
  fs.writeFileSync(currentMod, "current");
  assert.throws(() => prepareServerTemplate(source, target, path.join(root, "missing.jar")), /Build the current/);
  assert.equal(fs.existsSync(target), false);
  prepareServerTemplate(source, target, currentMod);
  assert.equal(fs.readFileSync(path.join(target, "mods", "doumacmd-1.3.0.jar"), "utf8"), "current");
  assert.equal(fs.existsSync(path.join(target, "mods", "doumacmd-1.2.0.jar")), false);
  for (const name of ["world", "bridge", "logs", "RCON_password.txt", "server.properties", "usercache.json", "ops.json"]) assert.equal(fs.existsSync(path.join(target, name)), false, name);
  assert.equal(fs.existsSync(path.join(target, "mods", "fixture")), true);
  assert.throws(() => prepareServerTemplate(source, target), /already exists/);
});
