const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { FORGE_VERSION, FORGE_DIR, detectServerForgeVersion } = require("./forge_version.cjs");
const { atomicWrite } = require("./settings_backups.cjs");

const FILES = ["run.bat", "run.sh", "setup.bat"];
const FORGE_ARGS = /libraries[\\/]net[\\/]minecraftforge[\\/]forge[\\/]1\.20\.1-47\.\d+\.\d+[\\/]win_args\.txt/i;
const read = file => {
  try { return fs.readFileSync(file); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

function captureServerLaunchers(root) {
  const originals = Object.fromEntries(FILES.map(name => [name, read(path.join(root, name))]));
  if (originals["run.bat"]) {
    const active = originals["run.bat"].toString("latin1").split(/\r?\n/)
      .filter(line => !/^\s*(?:rem\b|::)/i.test(line)).join("\n");
    if (!FORGE_ARGS.test(active)) {
      throw new Error("run.batのForge起動設定を確認できません。既存ファイルは変更せず停止しました。サーバーフォルダーの起動設定を確認してください。");
    }
  }
  return originals;
}

function backupServerLaunchers(root, originals) {
  const files = Object.entries(originals).filter(([, content]) => content);
  if (!files.length) return "";
  const backupDir = path.join(root, "forge-launcher-backups", `${Date.now()}-${crypto.randomUUID()}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const [name, content] of files) fs.writeFileSync(path.join(backupDir, name), content, { flag: "wx" });
  return backupDir;
}

function synchronizeServerLaunchers(root, originals, backupDir = "") {
  const defaultRun = ["@echo off", 'cd /d "%~dp0"',
    `".\\jdk-21.0.4+7\\bin\\java.exe" @user_jvm_args.txt @${FORGE_DIR}/win_args.txt nogui %*`,
    'if "%NO_PAUSE%"=="" pause', ""].join("\r\n");
  const changes = [];
  for (const name of FILES) {
    const file = path.join(root, name), current = read(file);
    const original = originals[name];
    const source = name === "run.bat" && !original ? Buffer.from(defaultRun) : original || current;
    if (!source) continue;
    // Only ASCII version text changes; Japanese comments retain their original encoding.
    const desired = Buffer.from(source.toString("latin1").replace(/1\.20\.1-47\.\d+\.\d+/g, FORGE_VERSION), "latin1");
    if (current?.equals(desired) && (!original || original.equals(desired))) continue;
    changes.push({ name, file, desired, previous: original || current });
  }
  if (changes.length) {
    // Complete every backup before replacing any startup file.
    if (!backupDir) backupDir = backupServerLaunchers(root, Object.fromEntries(changes.map(c => [c.name, c.previous])));
    try {
      for (const change of changes) atomicWrite(change.file, change.desired);
    } catch (error) {
      for (const change of changes) if (change.previous) atomicWrite(change.file, change.previous);
      throw error;
    }
  }
  if (detectServerForgeVersion(root) !== FORGE_VERSION) {
    throw new Error("Forgeサーバーの起動設定が一致しません。環境構築は完了していません。");
  }
  return { backupDir };
}

module.exports = { captureServerLaunchers, backupServerLaunchers, synchronizeServerLaunchers };
