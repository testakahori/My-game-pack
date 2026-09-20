const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { runProc } = require("./process_runner.cjs");
const { atomicWrite } = require("./settings_backups.cjs");

const FORGE_VERSION = "1.20.1-47.3.0";
const JAVA_DIR = "jdk-21.0.4+7";
const FORGE_DIR = `libraries/net/minecraftforge/forge/${FORGE_VERSION}`;
const EULA_URL = "https://www.minecraft.net/eula";
// Windowsで信頼済みのCAを使う。HTTPSの証明書検証自体は有効のまま。
const JAVA_TLS_ARGS = process.platform === "win32"
  ? ["-Djavax.net.ssl.trustStoreType=Windows-ROOT", "-Djavax.net.ssl.trustStore=NONE"] : [];
const read = file => { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return ""; throw e; } };
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };

function readProperties(text) {
  const props = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#!\s=]+)\s*=(.*)$/);
    if (match) props[match[1]] = match[2].trim();
  }
  return props;
}

function mergeProperties(text, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = text.split(/\r?\n/).map(line => {
    const match = line.match(/^\s*([^#!\s=]+)\s*=/);
    if (!match || !Object.hasOwn(updates, match[1])) return line;
    remaining.delete(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  while (lines.at(-1) === "") lines.pop();
  return [...lines, ...[...remaining].map(([key, value]) => `${key}=${value}`), ""].join("\n");
}

function missingServerFiles(root) {
  const argsFile = `${FORGE_DIR}/win_args.txt`;
  const args = read(path.join(root, argsFile));
  const jars = [...new Set(args.match(/libraries\/[^\s;]+\.jar/g) || [])];
  const required = [`${JAVA_DIR}/bin/java.exe`, "run.bat", "user_jvm_args.txt", argsFile, `${FORGE_DIR}/forge-${FORGE_VERSION}-server.jar`, ...jars];
  return required.filter(file => !isFile(path.join(root, file)));
}

function inspectSetup(root) {
  const missing = [];
  const props = readProperties(read(path.join(root, "server.properties")));
  if (readProperties(read(path.join(root, "eula.txt"))).eula !== "true") missing.push("Minecraft利用規約への同意");
  if (missingServerFiles(root).length) missing.push("Java・Forgeサーバーの必要ファイル");
  if (!isFile(path.join(root, "server.properties"))) missing.push("サーバー設定");
  if (props["enable-rcon"] !== "true" || !props["rcon.password"] || !Number(props["rcon.port"])) missing.push("RCON接続設定");
  return { complete: missing.length === 0, dir: root, missing };
}

function inspectForgeClient(minecraftDir) {
  const id = "1.20.1-forge-47.3.0";
  let profile = {};
  try { profile = JSON.parse(read(path.join(minecraftDir, "versions", id, `${id}.json`))); } catch {}
  const installed = profile.id === id && Array.isArray(profile.libraries)
    && profile.libraries.some(lib => lib.name === `net.minecraftforge:fmlloader:${FORGE_VERSION}`);
  return { installed, version: FORGE_VERSION, launcherReady: isFile(path.join(minecraftDir, "launcher_profiles.json")) || isFile(path.join(minecraftDir, "launcher_profiles_microsoft_store.json")) };
}

function launchForgeInstaller(root, spawnProcess = spawn) {
  const jar = path.join(root, `forge-${FORGE_VERSION}-installer.jar`);
  const java = path.join(root, JAVA_DIR, "bin", "javaw.exe");
  for (const file of [jar, java]) {
    if (!isFile(file)) throw new Error(`インストール用のファイルが不足しています。「Forgeをインストールする」をもう一度押して準備し直してください: ${path.basename(file)}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(java, [...JAVA_TLS_ARGS, "-jar", jar], { cwd: root, windowsHide: true, detached: true, stdio: "ignore" });
    child.once("error", error => reject(new Error(`Forgeインストーラーを起動できませんでした (${error.code || error.message})。`)));
    child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
  });
}

async function prepareServerEnvironment(root, { eulaAccepted = false, runInstaller = runProc } = {}) {
  if (!eulaAccepted && readProperties(read(path.join(root, "eula.txt"))).eula !== "true") {
    throw new Error("Minecraft利用規約への同意が必要です。");
  }
  const java = path.join(root, JAVA_DIR, "bin", "java.exe");
  if (!isFile(java)) throw new Error("同梱Javaが見つかりません。環境構築をもう一度実行してください。");
  if (missingServerFiles(root).length) {
    const jar = path.join(root, `forge-${FORGE_VERSION}-installer.jar`);
    if (!isFile(jar)) throw new Error("Forgeインストーラーが見つかりません。環境構築をもう一度実行してください。");
    try { await runInstaller(java, [...JAVA_TLS_ARGS, "-jar", jar, "--installServer"], root, { timeoutMs: 300000 }); }
    catch { throw new Error("Forgeサーバーの準備に失敗しました。通信状態を確認して再試行してください。詳細は保存先のForgeインストールログで確認できます。"); }
    if (missingServerFiles(root).length) throw new Error("Forgeサーバーの必要ファイルが不足しています。環境構築をもう一度実行してください。");
  }
  const propsFile = path.join(root, "server.properties");
  const text = read(propsFile);
  const props = readProperties(text);
  const password = props["rcon.password"] || read(path.join(root, "RCON_password.txt")).trim() || crypto.randomBytes(16).toString("hex");
  if (/[\r\n]/.test(password)) throw new Error("RCONパスワードに改行が含まれています。設定ファイルを確認してください。");
  const defaults = { "server-port": "25565", "online-mode": "true", "level-name": "world", "view-distance": "8", "simulation-distance": "6", "allow-flight": "true" };
  const updates = Object.fromEntries(Object.entries(defaults).filter(([key]) => !Object.hasOwn(props, key)));
  Object.assign(updates, { "enable-rcon": "true", "rcon.port": props["rcon.port"] || "25575", "rcon.password": password, "enable-command-block": "true", "broadcast-rcon-to-ops": "true" });
  // server.propertiesを最後に確定。途中失敗を完了として扱わない。
  const jvmFile = path.join(root, "user_jvm_args.txt");
  const jvmArgs = read(jvmFile);
  if (JAVA_TLS_ARGS.length && !/^\s*-Djavax\.net\.ssl\.trustStore(?:Type)?=/m.test(jvmArgs)) {
    atomicWrite(jvmFile, jvmArgs.trimEnd() + "\n" + JAVA_TLS_ARGS.join("\n") + "\n");
  }
  atomicWrite(path.join(root, "eula.txt"), "eula=true\n");
  atomicWrite(path.join(root, "RCON_password.txt"), password + "\n");
  atomicWrite(path.join(root, "RCONパスワード.txt"), password + "\n");
  atomicWrite(propsFile, mergeProperties(text, updates));
  const status = inspectSetup(root);
  if (!status.complete) throw new Error(`セットアップが完了していません: ${status.missing.join("、")}`);
  return { ok: true, ...status };
}

module.exports = { FORGE_VERSION, EULA_URL, JAVA_TLS_ARGS, inspectSetup, inspectForgeClient, launchForgeInstaller, prepareServerEnvironment, missingServerFiles };
