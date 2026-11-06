const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { runProc } = require("./process_runner.cjs");
const { atomicWrite } = require("./settings_backups.cjs");
const { ensureManagedWorld, worldReady, assertSetupPortsAvailable } = require("./world_setup.cjs");

const { FORGE_VERSION, FORGE_CLIENT_ID, FORGE_DIR, detectServerForgeVersion } = require("./forge_version.cjs");
const { captureServerLaunchers, backupServerLaunchers, synchronizeServerLaunchers } = require("./forge_launchers.cjs");
const JAVA_DIR = "jdk-21.0.4+7";
const EULA_URL = "https://www.minecraft.net/eula";
// Windowsで信頼済みのCAを使う。HTTPSの証明書検証自体は有効のまま。
const JAVA_TLS_ARGS = process.platform === "win32"
  ? ["-Djavax.net.ssl.trustStoreType=Windows-ROOT", "-Djavax.net.ssl.trustStore=NONE"] : [];
const read = file => { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return ""; throw e; } };
const isFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
// Minecraft のサーバー本体（Mojang）と Forge の部品は配らず、初回の環境構築で Forge のインストーラーが取りに行く（約 70MB。2026-11-06 ユーザーの決定）。
// 速い回線で1分ほど。遅い回線でも途中で切らないよう、待つ時間を長めにする。
const INSTALLER_TIMEOUT_MS = 15 * 60 * 1000;
// 通信が一瞬止まっただけの失敗をやり直す回数と、その間（2026-11-06 レビュー 重要2）。
const INSTALLER_ATTEMPTS = 3;
const INSTALLER_RETRY_DELAY_MS = 5000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const INSTALLER_PROGRESS = "Minecraft のサーバー本体（Mojang）と Forge の部品をダウンロードしています。インターネットへの接続が必要です。回線によっては数分かかります…";
// server.properties の読み書きは、ゲームの切り替えのマップの入れ替えと同じもの（埋め立て PR3 で分けた）。
const { readProperties, mergeProperties } = require("./server_properties.cjs");

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
  if (detectServerForgeVersion(root) !== FORGE_VERSION) missing.push("Forgeサーバーの起動設定");
  if (!isFile(path.join(root, "server.properties"))) missing.push("サーバー設定");
  if (props["enable-rcon"] !== "true" || !props["rcon.password"] || !Number(props["rcon.port"])) missing.push("RCON接続設定");
  if (!worldReady(root, props["level-name"] || "world")) missing.push("配信ワールドの生成・保存");
  return { complete: missing.length === 0, dir: root, missing };
}

function inspectForgeClient(minecraftDir) {
  const id = FORGE_CLIENT_ID;
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
    // javawはコンソールを作らない。GUIまで隠さないようwindowsHideはfalseにする。
    const child = spawnProcess(java, [...JAVA_TLS_ARGS, "-jar", jar], { cwd: root, windowsHide: false, detached: true, stdio: "ignore" });
    child.once("error", error => reject(new Error(`Forgeインストーラーを起動できませんでした (${error.code || error.message})。`)));
    child.once("spawn", () => { child.unref(); resolve({ ok: true }); });
  });
}

async function prepareServerEnvironment(root, { eulaAccepted = false, runInstaller = runProc, generateWorld, ensureStopped = assertSetupPortsAvailable, onProgress = () => {}, sleep = wait } = {}) {
  if (!eulaAccepted && readProperties(read(path.join(root, "eula.txt"))).eula !== "true") {
    throw new Error("Minecraft利用規約への同意が必要です。");
  }
  const java = path.join(root, JAVA_DIR, "bin", "java.exe");
  if (!isFile(java)) throw new Error("同梱Javaが見つかりません。環境構築をもう一度実行してください。");
  const beforeProps = readProperties(read(path.join(root, "server.properties")));
  const ports = [Number(beforeProps["server-port"] || 25565), Number(beforeProps["rcon.port"] || 25575), 25576, 25577];
  await ensureStopped(ports);
  const originalLaunchers = captureServerLaunchers(root);
  onProgress("Java・Forgeサーバーの必要ファイルを確認しています…");
  let launcherBackup = "";
  if (missingServerFiles(root).length) {
    const jar = path.join(root, `forge-${FORGE_VERSION}-installer.jar`);
    if (!isFile(jar)) throw new Error("Forgeインストーラーが見つかりません。環境構築をもう一度実行してください。");
    // The installer can overwrite launchers even if it later fails downloading a library.
    launcherBackup = backupServerLaunchers(root, originalLaunchers);
    onProgress(INSTALLER_PROGRESS);
    // 通信が一瞬止まっただけでもインストーラーはやめる（実機で2回に1回あった）。何度動かしても同じ結果になるので、3回まで自動でやり直す（2026-11-06 レビュー 重要2）。
    let lastError = null;
    for (let attempt = 1; attempt <= INSTALLER_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        onProgress(`ダウンロードが途中で止まったので、やり直しています（${attempt}/${INSTALLER_ATTEMPTS}回目）…`);
        await sleep(INSTALLER_RETRY_DELAY_MS);
      }
      try { await runInstaller(java, [...JAVA_TLS_ARGS, "-jar", jar, "--installServer"], root, { timeoutMs: INSTALLER_TIMEOUT_MS }); lastError = null; break; }
      catch (error) { lastError = error; }
    }
    // ログの名前は保存先で変わる（英数字だけの場所は forge-…-installer.jar.log、日本語や空白を含む場所は installer.log。レビュー 軽い3）。
    // 本当の理由（Java を起動できない・時間切れなど）も添える（軽い4）。
    if (lastError) throw new Error(`Minecraft のサーバー本体と Forge の部品をダウンロードできませんでした。インターネットにつながっているか確かめて、もう一度「環境構築をする」を押してください。詳しくは保存先の forge-${FORGE_VERSION}-installer.jar.log または installer.log に出ています。（${lastError?.message || lastError}）`);
    if (missingServerFiles(root).length) throw new Error("Forgeサーバーの必要ファイルが不足しています。環境構築をもう一度実行してください。");
  }
  const launchers = synchronizeServerLaunchers(root, originalLaunchers, launcherBackup);
  if (launchers.backupDir) onProgress("以前の起動設定を退避し、Forgeサーバーの起動先を揃えました。");
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
  const configured = readProperties(read(propsFile));
  const world = await ensureManagedWorld(root, {
    levelName: configured["level-name"], ports, ensureStopped, generateWorld, onProgress,
    selectWorld: name => atomicWrite(propsFile, mergeProperties(read(propsFile), { "level-name": name })),
  });
  const status = inspectSetup(root);
  if (!status.complete) throw new Error(`セットアップが完了していません: ${status.missing.join("、")}`);
  return { ok: true, ...status, world: world.world };
}

module.exports = { FORGE_VERSION, JAVA_DIR, EULA_URL, JAVA_TLS_ARGS, INSTALLER_PROGRESS, INSTALLER_TIMEOUT_MS, INSTALLER_ATTEMPTS, inspectSetup, inspectForgeClient, launchForgeInstaller, prepareServerEnvironment, missingServerFiles };
