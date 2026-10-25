// Minecraft サーバーの起動・停止・ログ・コンソールへの送信・稼働の確かめ。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・child_process は読み込まず、spawn・process は main から受け取る。
const path = require("path");
const fs = require("fs");
const { isConsoleStop } = require("./stop_requests.cjs");
const { bridgeCommandsDir, bridgeModEndpoint } = require("../bridge/config_defaults.cjs");

// MAP の保存・BridgeMOD との通信は、あとで main で作られるので、呼ばれたときに読む関数で受け取る。
function createServerProcess({
  app, process, spawn, getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, assertMapIdle,
  isInitialSetupRunning, recoverMapSaves, requestBridgeMod, authFailedMessage, stopRequests,
  // OBS 連携の設定（{ enabled, endpoint }。electron/obs_send.cjs）。渡さないときは書かない。
  obsSend = () => null,
}) {
  // サーバーの状態（子プロセス・ログ・起動中・停止中・停止の待ち）。使う関数より先に置く（main.cjs の分割 PR4 の最終レビュー）。
  let serverPid  = null;
  let serverProcRef = null;
  const SERVER_LOG_LIMIT = 500;
  const serverLogBuffer = [];
  let serverStarting = false;
  let serverStopping = false;
  // 保存の完了の待ち（実際の停止は 120 秒待つ）。テストで待ちを短くするためにだけ setStopWaitMs で変える。
  let stopWaitMs = 120000;

  function appendServerLog(message) {
    const text = String(message ?? "").replace(/\r/g, "");
    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      serverLogBuffer.push(`[${new Date().toLocaleTimeString("ja-JP")}] ${trimmed}`);
    }
    if (serverLogBuffer.length > SERVER_LOG_LIMIT) {
      serverLogBuffer.splice(0, serverLogBuffer.length - SERVER_LOG_LIMIT);
    }
  }

  function pipeServerStream(stream, prefix) {
    if (!stream) return;
    stream.on("data", (chunk) => {
      appendServerLog(`${prefix}${chunk.toString("utf8")}`);
    });
  }

  async function startServer(resumeAfterMap = false) {
    assertGameProfileIdle();
    if (!resumeAfterMap) assertMapIdle();
    if (serverStarting || serverStopping) throw new Error("サーバーを起動・停止中です。完了までお待ちください。");
    serverStarting = true;
    try {
    if (isInitialSetupRunning()) throw new Error("環境構築が完了するまでお待ちください。");
    const dir = getServerRoot();
    const bat = path.join(dir, "run.bat");
    if (!fs.existsSync(bat)) throw new Error(`run.bat not found: ${bat}`);
    if (serverProcRef) return { ok: true, alreadyRunning: true, backup: null };

    // アプリを開き直しても、動作中のサーバーを再起動したりMAPに触れたりしない。
    const existing = await getServerProcessStatus();
    if (existing.running) {
      if (existing.modAuthFailed) throw new Error(`起動済みのサーバーが見つかりましたが、${authFailedMessage()}`);
      if (!existing.modReady) throw new Error("起動済みのサーバーが見つかりましたが、MyGamePackのModに接続できません。サーバーの起動完了とModの設定を確認してください。");
      appendServerLog("[SERVER] 起動済みのサーバーを使用します（このアプリからの停止・MAP操作はできません）");
      return { ok: true, alreadyRunning: true, external: true, backup: null };
    }

    await recoverMapSaves();
    require('./bridge_mod_migration.cjs').retireLegacyEnvironment(dir);
    // MAPは「保存する」を押した時だけ作成。旧autoBackup設定が残っていても自動保存しない。

    // 黒い別窓は開かず、出力をアプリ内（ダッシュボードのForgeログ）へ取り込む。
    // run.bat 末尾の pause は NO_PAUSE=1 で無効化される。stdin は stop コマンド送信用。
    serverLogBuffer.length = 0;
    appendServerLog("[SERVER] Forgeサーバーを起動します");

    // 重力反転などの浮遊系コマンドで「このワールドでは飛行が禁止されています」キックが
    // 出ないよう、起動前に allow-flight=true を強制する（server.properties は起動時にのみ
    // 読み込まれるため、ここが唯一の安全な適用タイミング）。
    try {
      const propsPath = path.join(dir, "server.properties");
      if (fs.existsSync(propsPath)) {
        const props = fs.readFileSync(propsPath, "utf8");
        // (\r?) を捕捉して戻すことで CRLF ファイルの行末を LF に変えてしまわないようにする
        if (/^allow-flight=false[ \t]*\r?$/m.test(props)) {
          fs.writeFileSync(propsPath, props.replace(/^allow-flight=false[ \t]*(\r?)$/m, "allow-flight=true$1"), "utf8");
          appendServerLog("[SERVER] allow-flight=true を適用しました（浮遊コマンドのキック対策）");
        }
      }
    } catch { /* 設定に失敗しても起動は続行 */ }
    // OBSMOD（標準装備）はサーバーの起動のときに obs-send.properties を読むので、起動の直前にアプリの設定どおりに書く（OBS 連携。2026-10-25）。
    try {
      const send = obsSend();
      if (send) {
        require("./obs_send.cjs").writeObsSend(dir, send);
        appendServerLog(`[SERVER] OBS 連携：${send.enabled ? `OBS ツールへ送る（送り先 ${send.endpoint || require("./obs_send.cjs").DEFAULT_ENDPOINT}）` : "OBS ツールへは送らない"}`);
      }
    } catch (error) { appendServerLog(`[SERVER] OBS 連携の設定を書けませんでした：${error.message}`); }
    // 開発版（パッケージ前）は、BRIDGE とゲームの切替がリポジトリの bridge/commands/minecraft を使う。
    // BridgeMOD はふだんサーバーフォルダーの bridge/commands/minecraft を読むので、同じ場所を環境変数で教える。
    // インストール版はどちらもサーバーフォルダーなので渡さない（利用者の環境に残っていても消す）。
    const serverEnv = { ...process.env, NO_PAUSE: "1" };
    if (app.isPackaged) delete serverEnv.BRIDGE_MOD_COMMANDS_DIR;
    else serverEnv.BRIDGE_MOD_COMMANDS_DIR = bridgeCommandsDir(getBridgeBatDir());
    const proc = spawn("cmd.exe", ["/c", bat], {
      cwd: dir,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: serverEnv,
    });
    attach(proc);
    pipeServerStream(proc.stdout, "");
    pipeServerStream(proc.stderr, "[stderr] ");
    proc.on("error", (e) => appendServerLog(`[SERVER] 起動エラー: ${e?.message || e}`));
    proc.on("exit", (code, signal) => {
      appendServerLog(`[SERVER] 終了しました code=${code ?? "null"} signal=${signal ?? "null"}`);
      if (serverProcRef === proc) { serverPid = null; serverProcRef = null; }
    });

    return { ok: true };
    } finally { serverStarting = false; }
  }

  async function getServerProcessStatus() {
    if (serverProcRef) return { running: true, managed: true, pid: serverPid };
    const listening = await isServerPortOpen();
    if (!listening) return { running: false, managed: false, pid: null };
    let modReady = false, modAuthFailed = false;
    try {
      const cfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
      const host = bridgeModEndpoint(cfg.options).host.toLowerCase();
      if (["127.0.0.1", "localhost", "::1"].includes(host)) {
        const status = await requestBridgeMod("GET", "/bridge/status");
        modReady = status.ok === true && Number.isFinite(status.tps) && typeof status.player?.online === "boolean";
      }
    } catch (e) { modAuthFailed = e?.authFailed === true; /* ポートは開いている。Modが準備中なら再起動せず案内する。 */ }
    return { running: true, managed: false, pid: null, modReady, modAuthFailed };
  }

  async function portIsOpen(port, host = '127.0.0.1') {
    return new Promise((resolve, reject) => {
      const socket = require('node:net').connect({ port, host });
      socket.setTimeout(1200);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('timeout', () => { socket.destroy(); reject(new Error('サーバーの稼働状態を確認できません。時間をおいて再試行してください。')); });
      socket.once('error', error => { socket.destroy(); if (['ECONNREFUSED', 'EADDRNOTAVAIL'].includes(error.code)) resolve(false); else reject(error); });
    });
  }
  async function assertMapServerStopped() {
    if (serverProcRef || serverPid) throw new Error('サーバーが停止していません。MAP操作を中止しました。');
    if (await isServerPortOpen()) throw new Error('別のMinecraftサーバーが起動しています。停止してからMAPを操作してください。');
  }
  async function isServerPortOpen() {
    if (!fs.existsSync(path.join(getServerRoot(), 'server.properties'))) return false;
    const props = fs.readFileSync(path.join(getServerRoot(), 'server.properties'), 'utf8');
    const port = Number(props.match(/^server-port=(.+)$/m)?.[1]?.trim() || 25565);
    const host = props.match(/^server-ip=(.+)$/m)?.[1]?.trim();
    for (const address of new Set(['127.0.0.1', '::1', ...(host && host !== '0.0.0.0' && host !== '::' ? [host] : [])])) {
      if (await portIsOpen(port, address)) return true;
    }
    return false;
  }

  function waitChildExit(child, timeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
    return new Promise(resolve => {
      const done = value => { clearTimeout(timer); child.removeListener('exit', ended); resolve(value); };
      const ended = () => done(true);
      const timer = setTimeout(() => done(false), timeoutMs);
      child.once('exit', ended);
    });
  }
  // サーバーへ stop を書くのはここだけ（コンソールコマンドを除く）。origin はどのボタン・操作から止めたか。
  async function stopMapServer(origin) {
    const child = serverProcRef;
    if (!child) { await assertMapServerStopped(); return; }
    if (!child.stdin?.writable) throw new Error('サーバーに保存・停止を送信できません。ダッシュボードで停止してください。');
    const ended = waitChildExit(child, stopWaitMs);
    appendServerLog(`[SERVER] ワールドを保存して停止します（${stopRequests.record('server', origin)}）`);
    child.stdin.write('stop\n');
    if (!await ended) throw new Error('サーバーの保存・停止がまだ完了していません。強制終了せずに待機しています。Forgeログを確認し、停止完了後に再試行してください。');
    if (serverProcRef === child) { serverProcRef = null; serverPid = null; }
    if (child.exitCode !== 0) throw new Error('サーバーが正常終了しませんでした。Forgeログを確認してください。');
    await assertMapServerStopped();
  }

  function setStopWaitMs(ms) { stopWaitMs = ms; }
  // 子プロセスを持たせる（起動の処理と、テストの偽の子プロセスが使う）。
  function attach(child) { serverProcRef = child || null; serverPid = child?.pid || null; }
  // ほかの仕事が見る「いまの状態」。main は呼ばれたときに serverProcess.xxx() で読む。
  function child() { return serverProcRef; }
  function isStarting() { return serverStarting; }
  function isStopping() { return serverStopping; }

  function register(ipcMain) {
    // --------------------
    // IPC: サーバー起動 (run.bat)
    // --------------------
    ipcMain.handle("server:start", () => startServer());

    // --------------------
    // IPC: サーバー停止（保存完了を待ち、保存中の強制終了はしない）
    // --------------------
    ipcMain.handle("server:stop", async (_event, origin) => {
      assertMapIdle();
      if (serverStarting || serverStopping) throw new Error("サーバーを起動・停止中です。完了までお待ちください。");
      const proc = serverProcRef;
      if (!proc) {
        if ((await getServerProcessStatus()).running) throw new Error("このアプリを開く前から起動しているサーバーです。起動した画面で stop を実行してください。BRIDGEは単独で停止できます。");
        return { ok: true, alreadyStopped: true, graceful: true };
      }
      serverStopping = true;
      try {
        await stopMapServer(origin);
        return { ok: true, graceful: true };
      } finally { serverStopping = false; }
    });

    // --------------------
    // IPC: サーバーログ・稼働状態（ダッシュボードのForgeログパネル用）
    // --------------------
    ipcMain.handle("server:logs", () => ({ ok: true, lines: [...serverLogBuffer] }));

    // Forgeサーバーのコンソールへコマンドを1行送る（op 付与やデバッグの脱出ハッチ）。
    // 先頭の "/" は付けても付けなくてもよい（コンソールでは不要なので取り除く）。
    ipcMain.handle("server:command", async (_event, command) => {
      assertMapIdle();
      const cmd = String(command || "").trim().replace(/^\//, "");
      if (!cmd) throw new Error("コマンドが空です");
      if (/[\r\n]/.test(cmd)) throw new Error("コマンドは1行で入力してください");
      if (!serverProcRef?.stdin?.writable) throw new Error("Minecraftサーバーが起動していません");
      appendServerLog(`> ${cmd}`);
      if (isConsoleStop(cmd)) stopRequests.record("server", "console");
      serverProcRef.stdin.write(cmd + "\n");
      return { ok: true };
    });

    ipcMain.handle("server:processStatus", getServerProcessStatus);
  }

  return { child, isStarting, isStopping, attach, appendLog: appendServerLog, startServer, stopMapServer, assertMapServerStopped, getServerProcessStatus, isServerPortOpen, waitChildExit, setStopWaitMs, register };
}

module.exports = { createServerProcess };
