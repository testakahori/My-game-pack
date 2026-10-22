// BRIDGE（配信のイベントを受けてゲームへ送る node のプロセス）の起動・停止・自動再起動・ログ・状態と、Euler の鍵・TikTok LIVE の確かめ。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。child_process・electron は読み込まず、spawn・spawnSync・shell・runProc は main から受け取る。
const path = require("path");
const fs = require("fs");
const { RestartPolicy } = require("./restart_policy.cjs");
const { bridgeModTokenPath } = require("../bridge/bridge_mod_token.cjs");
const { assertGameCommands } = require('./game_command_scope.cjs');

// MAP の作業中かは map_operations が持つので、呼ばれたときに読む関数（assertMapIdle）で受け取る。
function createBridgeProcess({ process, spawn, spawnSync, shell, runProc, stopRequests, eulerCredentials, getBridgeBatDir, getServerRoot, getConfigPath, getNodeCommand, getGvToolPath,
  getBridgeEntryPoint, ensureNodeRuntimeAvailable, assertGameProfileIdle, selectableCommandNames, gameProfiles, waitChildExit, assertMapIdle, migrateSavedConfig }) {
  let bridgeEulerRevision = null;
  // BRIDGE を起動した時刻。runtime-status.json がこれより前に書かれていれば、前の BRIDGE が残したもの（2026-10-18）。
  let bridgeStartedAt = 0;

  let bridgePid  = null;
  let bridgeProcRef = null;
  let bridgeStopRequested = false;
  let bridgeRestartTimer = null;
  const bridgeRestartPolicy = new RestartPolicy();
  const BRIDGE_LOG_LIMIT = 300;
  const bridgeLogBuffer = [];

  function appendBridgeLog(message) {
    const text = String(message ?? "").replace(/\r/g, "");
    for (const line of text.split("\n")) {
      const trimmed = line.trimEnd();
      if (!trimmed) continue;
      bridgeLogBuffer.push(`[${new Date().toLocaleTimeString("ja-JP")}] ${trimmed}`);
    }
    if (bridgeLogBuffer.length > BRIDGE_LOG_LIMIT) {
      bridgeLogBuffer.splice(0, bridgeLogBuffer.length - BRIDGE_LOG_LIMIT);
    }
  }

  function pipeBridgeStream(stream, prefix) {
    if (!stream) return;
    stream.on("data", (chunk) => {
      appendBridgeLog(`${prefix} ${chunk.toString("utf8")}`);
    });
  }

  function getProcessMetrics(pid) {
    if (!pid || process.platform !== "win32") return { cpuPercent: null, memMb: null };
    try {
      const result = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p=Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$_.IDProcess -eq ${Number(pid)}} | Select-Object -First 1 PercentProcessorTime,WorkingSet; if ($p) { "$($p.PercentProcessorTime)|$([math]::Round($p.WorkingSet/1MB,1))" }`,
      ], { windowsHide: true, timeout: 1500, encoding: "utf8" });
      const raw = String(result.stdout || "").trim();
      const [cpu, mem] = raw.split("|");
      return {
        cpuPercent: Number.isFinite(Number(cpu)) ? Number(cpu) : null,
        memMb: Number.isFinite(Number(mem)) ? Number(mem) : null,
      };
    } catch {
      return { cpuPercent: null, memMb: null };
    }
  }

  const checkTikTokLive = require("./tiktok_live_status.cjs").createLiveStatusChecker({
    query: async username => {
      await ensureNodeRuntimeAvailable();
      const tool = getGvToolPath("live_status.cjs");
      const { env } = eulerCredentials.runtime();
      const result = await runProc(getNodeCommand(), [tool, username], path.dirname(tool), { timeoutMs: 20000, env });
      return JSON.parse(result.out.trim());
    },
  });

  const eulerStatus = () => eulerCredentials.status(bridgeEulerRevision, Boolean(bridgeProcRef));

  // --------------------
  // IPC: Bridge 起動（同梱 node 優先、なければ PATH の node）
  // --------------------

  async function launchBridge() {
    assertGameProfileIdle();
    // 起動のときの直しが届かなかった古い版の設定（手動インストールのあと・古いフォルダーを使い直したときなど）も、起動する前に直す（PR3 の最終レビュー）。
    migrateSavedConfig?.();
    assertGameCommands(JSON.parse(fs.readFileSync(getConfigPath(), "utf8")), selectableCommandNames(), gameProfiles.list());
    const dir = getBridgeBatDir();
    const indexJs = getBridgeEntryPoint(dir);
    if (!fs.existsSync(indexJs)) throw new Error(`Bridge entry not found: ${indexJs}`);

    await ensureNodeRuntimeAvailable();
    const nodeCmd = getNodeCommand();

    // 落ちて自動再起動を待っている間に起動したら、待ちを取りやめて今すぐ起動する。待ちを残すと、待ちが終わったときに
    // もう1つ起動して BRIDGE が2つ動き、ギフトが2回動いていた（2026-10-18）。起動の準備（同梱 node の確かめ）の間に自動再起動が先に動いていれば、下の確かめで起動しない。
    if (bridgeRestartTimer) {
      clearTimeout(bridgeRestartTimer);
      bridgeRestartTimer = null;
      appendBridgeLog("[BRIDGE] 自動再起動の待ちを取りやめ、今すぐ起動します");
    }
    bridgeStopRequested = false;
    bridgeRestartPolicy.start();
    const spawnOnce = () => {
      bridgeStartedAt = Date.now();
      const { env, revision } = eulerCredentials.runtime();
      appendBridgeLog(`[BRIDGE] 起動します: ${indexJs}`);
      // BridgeMOD の認証トークンはサーバーフォルダーにある。開発時は bridge とサーバーの場所が離れているので明示する。
      const child = spawn(nodeCmd, [indexJs, "--config", path.join(dir, "config.minecraft.json")], {
        cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"],
        env: { ...env, BRIDGE_MOD_TOKEN_FILE: bridgeModTokenPath(getServerRoot()) },
      });
      bridgeEulerRevision = revision;
      attach(child);
      appendBridgeLog(`[BRIDGE] PID ${bridgePid} で起動しました`);
      pipeBridgeStream(child.stdout, "[stdout]");
      pipeBridgeStream(child.stderr, "[stderr]");
      child.on("exit", (code, signal) => {
        appendBridgeLog(`[BRIDGE] 終了しました code=${code ?? "null"} signal=${signal ?? "null"}`);
        if (bridgeProcRef === child) { bridgePid = null; bridgeProcRef = null; }
        if (!bridgeStopRequested && bridgeRestartPolicy.shouldRestart()) {
          const backoffMs = bridgeRestartPolicy.nextDelayMs ? bridgeRestartPolicy.nextDelayMs() : 2000;
          appendBridgeLog(`[BRIDGE] ${Math.round(backoffMs / 1000)}秒後に自動再起動します`);
          bridgeRestartTimer = setTimeout(() => {
            bridgeRestartTimer = null;
            try { spawnOnce(); } catch (error) { appendBridgeLog(`[BRIDGE] ${error.message}`); }
          }, backoffMs);
        } else if (bridgeRestartPolicy.exhausted && bridgeRestartPolicy.exhausted()) {
          appendBridgeLog("[BRIDGE] 自動再起動の上限に達しました。設定を確認して手動で再起動してください。");
        }
      });
    };
    if (!bridgeProcRef) spawnOnce();

    return { ok: true, pid: bridgePid };
  }

  // origin はどのボタン・操作から止めたか（stop_requests.cjs の名前）。ログ欄と logs/stop-requests.log に残す。
  async function stopBridge(origin) {
    bridgeStopRequested = true;
    bridgeRestartPolicy.requestStop();
    if (bridgeRestartTimer) { clearTimeout(bridgeRestartTimer); bridgeRestartTimer = null; }
    const child = bridgeProcRef;
    if (!child) return { ok: true };
    appendBridgeLog(`[BRIDGE] 停止します（${stopRequests.record("bridge", origin)}）`);
    if (child.connected) {
      const ended = waitChildExit(child, 7000);
      child.send({ type: 'shutdown' }, error => { if (error) appendBridgeLog('[BRIDGE] ' + error.message); });
      if (await ended) return { ok: true };
    }
    const ended = waitChildExit(child, 5000);
    try { spawn('taskkill.exe', ['/F', '/T', '/PID', String(child.pid)], { windowsHide: true }); } catch {}
    if (!await ended) throw new Error('Bridgeを停止できませんでした。ログを確認してください。');
    return { ok: true };
  }

  // BRIDGE の子プロセス（落ちて再起動を待つ間は null）。main とほかのモジュールは bridgeProcess.child() で読む。
  function currentChild() { return bridgeProcRef; }
  // BRIDGE が動いている、または落ちて再起動を待っている。ゲームの切り替え・MAP の作業・設定の復元が止めるときに見る。
  function isActive() { return Boolean(bridgeProcRef || bridgeRestartTimer); }
  // 子プロセスを持たせる。launchBridge と、テストが偽の子プロセスを持たせるときに使う。
  function attach(child) { bridgeProcRef = child || null; bridgePid = child?.pid || null; }

  function register(ipcMain) {
    ipcMain.handle("tiktok:liveStatus", (_event, username) => checkTikTokLive(username));

    ipcMain.handle('euler:status', eulerStatus);
    ipcMain.handle('euler:save', (_event, key) => {
      eulerCredentials.save(key);
      checkTikTokLive.clearCache();
      return eulerStatus();
    });
    ipcMain.handle('euler:clear', () => {
      eulerCredentials.clear();
      checkTikTokLive.clearCache();
      return eulerStatus();
    });
    ipcMain.handle('euler:openPortal', () => shell.openExternal('https://www.eulerstream.com/dashboard'));

    ipcMain.handle("bridge:launch", async () => { assertMapIdle(); return launchBridge(); });

    // --------------------
    // IPC: Bridge 停止
    // --------------------
    ipcMain.handle("bridge:stop", async (_event, origin) => { assertMapIdle(); return stopBridge(origin); });

    // --------------------
    // IPC: Bridge 再起動（停止完了を待ってから起動する。UI側の stop→launch 連打は使わない）
    // --------------------
    ipcMain.handle("bridge:restart", async (_event, origin) => {
      assertMapIdle();
      await stopBridge(origin);
      await new Promise((r) => setTimeout(r, 400)); // ポート/ファイル解放の猶予
      return launchBridge();
    });
    ipcMain.handle("bridge:processStatus", () => {
      const status = bridgeRestartPolicy.status(bridgePid);
      let runtime = {}, runtimeWrittenAt = 0;
      try {
        const runtimeFile = path.join(getBridgeBatDir(), "runtime-status.json");
        runtime = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
        runtimeWrittenAt = fs.statSync(runtimeFile).mtimeMs;
      } catch {}
      return { ...status, ...getProcessMetrics(bridgePid), tiktok: status.running ? (runtime.tiktok || null) : null, recording: status.running ? (runtime.recording || null) : null,
        delivery: status.running ? (runtime.delivery || null) : null,
        // 配信中につなぎ方（TikTok ID など）を変えて保存したとき、BRIDGE が書く「再起動で反映される設定」の名前（2026-10-18）。
        // 起動した直後、新しい BRIDGE が書き直すまでの間は、前の BRIDGE の案内を出さない。
        pendingRestart: status.running && runtimeWrittenAt >= bridgeStartedAt && Array.isArray(runtime.pendingRestart) ? runtime.pendingRestart : [] };
    });

    ipcMain.handle("bridge:logs", () => ({ ok: true, lines: [...bridgeLogBuffer] }));
  }

  return { child: currentChild, isActive, attach, launchBridge, stopBridge, register };
}

module.exports = { createBridgeProcess };
