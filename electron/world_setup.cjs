const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const INCOMPLETE = ".world-setup-incomplete.json";

function worldPath(root, name) {
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  if (!name || path.isAbsolute(name) || target === base || !target.startsWith(base + path.sep)) {
    throw new Error("ワールドの保存先はサーバーフォルダー内を指定してください。");
  }
  // 移動・生成先がジャンクションやリンク経由で保存先の外へ出ないようにする。
  let current = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("ワールド保存先にリンクが含まれています。通常のフォルダーを指定してください。");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return target;
}

function worldReady(root, levelName) {
  try {
    if (fs.existsSync(path.join(root, INCOMPLETE))) return false;
    const info = fs.statSync(path.join(worldPath(root, levelName), "level.dat"));
    return info.isFile() && info.size > 0;
  } catch { return false; }
}

async function assertSetupPortsAvailable(ports) {
  for (const port of new Set(ports)) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("サーバーのポート番号が不正です。");
    const listening = await new Promise(resolve => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const finish = value => { socket.destroy(); resolve(value); };
      socket.once("connect", () => finish(true));
      socket.once("error", error => finish(error.code !== "ECONNREFUSED"));
      socket.setTimeout(1000, () => finish(true));
    });
    if (listening) throw new Error(`ポート${port}が使用中です。起動中のMinecraftサーバーを停止してから環境構築を再試行してください。`);
  }
}

function generateInitialWorld(root, destination, {
  onProgress = () => {}, spawnProcess = spawn, startupTimeoutMs = 300000, stopTimeoutMs = 90000,
} = {}) {
  return new Promise((resolve, reject) => {
    const logPath = path.join(root, "setup-world.log");
    const log = fs.createWriteStream(logPath);
    let ready = false, stopping = false, failure, tail = "", stopTimer;
    const child = spawnProcess(path.join(root, "jdk-21.0.4+7", "bin", "java.exe"), [
      "@user_jvm_args.txt", "-Xms512M", "-Xmx1536M",
      "@libraries/net/minecraftforge/forge/1.20.1-47.3.0/win_args.txt", "nogui",
    ], { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stop = () => {
      if (stopping) return;
      stopping = true;
      onProgress("生成したワールドを保存し、サーバーを停止しています…");
      try { child.stdin.end("stop\n"); } catch {}
      stopTimer = setTimeout(() => {
        failure = new Error("ワールドの保存・停止が完了しませんでした。setup-world.logを確認して再試行してください。");
        child.kill(); // この構築処理で起動した子プロセスだけを停止する。
      }, stopTimeoutMs);
    };
    const timer = setTimeout(() => {
      failure = new Error("ワールド生成が時間内に完了しませんでした。setup-world.logを確認して再試行してください。");
      stop();
    }, startupTimeoutMs);
    log.on("error", error => { failure = error; stop(); });
    child.stdin.on("error", () => {});
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    const collect = text => {
      log.write(text);
      tail = (tail + text).slice(-4096);
      if (!ready && /Done \([\d.]+s\)!/.test(tail)) {
        ready = true;
        clearTimeout(timer);
        stop();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", error => { failure = new Error(`ワールド生成用のJavaを起動できませんでした (${error.code || error.message})。`); });
    child.once("close", code => {
      clearTimeout(timer); clearTimeout(stopTimer); log.end();
      if (failure) return reject(failure);
      if (!ready || code !== 0 || !fs.existsSync(path.join(destination, "level.dat"))) {
        return reject(new Error(`ワールド生成に失敗しました（終了コード: ${code}）。保存先のsetup-world.logを確認してください。`));
      }
      resolve();
    });
  });
}

async function ensureManagedWorld(root, {
  levelName = "world", selectWorld, ports = [25565, 25575, 25576, 25577],
  ensureStopped = assertSetupPortsAvailable, generateWorld = generateInitialWorld, onProgress = () => {},
} = {}) {
  await ensureStopped(ports);
  const managed = worldPath(root, "haihu_world");
  fs.mkdirSync(managed, { recursive: true });
  let name = levelName || "world";
  let destination = worldPath(root, name);
  if (name === "world") {
    const source = destination;
    destination = worldPath(root, "haihu_world/world");
    if (fs.existsSync(source)) {
      if (!fs.statSync(source).isDirectory()) throw new Error("worldがフォルダーではありません。保存先を確認してください。");
      if (fs.existsSync(destination)) throw new Error("worldとhaihu_world/worldの両方が存在します。上書きせず停止しました。使用するワールドを確認してください。");
      onProgress("既存のworldをhaihu_world/worldへ移動しています…");
      // worldPathで両方の絶対パスとリンクを検証済み。同一保存先内のみ移動する。
      fs.renameSync(source, destination);
    }
    name = "haihu_world/world";
    await selectWorld(name);
  }
  if (!worldReady(root, name)) {
    const marker = path.join(root, INCOMPLETE);
    fs.writeFileSync(marker, JSON.stringify({ world: name, startedAt: new Date().toISOString() }));
    onProgress(`${name} にワールドを生成しています…初回は数分かかります。`);
    await generateWorld(root, destination, { onProgress });
    const info = fs.statSync(path.join(destination, "level.dat"));
    if (!info.isFile() || !info.size) throw new Error("生成したワールドを確認できません。環境構築を再試行してください。");
    fs.unlinkSync(marker);
  }
  onProgress(`ワールドの準備が完了しました: ${name}`);
  return { world: name, path: destination };
}

module.exports = { INCOMPLETE, worldPath, worldReady, assertSetupPortsAvailable, generateInitialWorld, ensureManagedWorld };
