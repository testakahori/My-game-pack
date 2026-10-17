// BridgeMOD との通信（HTTP:25576）・状態・妨害の一時停止と再開・テスト発火の受け渡し・応答待ち。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const { bridgeModTokenPath, withBridgeModToken } = require("../bridge/bridge_mod_token.cjs");
const { usesBridgeModTransport } = require("../bridge/command_files.cjs");
const { assertGameCommands } = require('./game_command_scope.cjs');

// サーバーと BRIDGE の子プロセスは main・server_process が持つので、呼ばれたときに読む関数で受け取る。
function createBridgeModClient({ getConfigPath, getServerRoot, stopRequests, selectableCommandNames, gameProfiles, appendServerLog, serverChild, bridgeChild }) {
  const BRIDGE_MOD_AUTH_FAILED = "BridgeMODは応答していますが、認証に失敗しました。Minecraftサーバーを起動し直すと直ります。直らない場合は、初期セットアップのサーバーフォルダーと、実際に起動しているサーバーが同じか確認してください。";

  function requestBridgeMod(method, requestPath, body, configOverride) {
    return new Promise((resolve, reject) => {
      let cfg = configOverride || {};
      if (!configOverride) try { cfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8")); } catch {}
      const host = cfg.options?.bridgeModHost || cfg.options?.doumaModHost || "127.0.0.1";
      const port = Number(cfg.options?.bridgeModPort || cfg.options?.doumaModPort || 25576);
      const data = body ? Buffer.from(JSON.stringify(body)) : null;
      // BridgeMOD はサーバー起動ごとのトークンがない要求を 403 で拒否する。
      const headers = withBridgeModToken(bridgeModTokenPath(getServerRoot()),
        data ? { "Content-Type": "application/json", "Content-Length": data.length } : {});
      const req = http.request({ host, port, path: requestPath, method, timeout: 1500, headers },
      (res) => {
        const chunks = [];
        res.on("data", c => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = {}; try { parsed = JSON.parse(text); } catch { parsed = { message: text }; }
          // 403 は「MODは動いているが認証に失敗」。オフラインと区別して原因と直し方を出す。
          if (res.statusCode === 403) reject(Object.assign(new Error(BRIDGE_MOD_AUTH_FAILED), { status: 403, authFailed: true }));
          else if (res.statusCode >= 400 || parsed.ok === false) reject(Object.assign(new Error(parsed.message || `HTTP ${res.statusCode}`), { status: res.statusCode }));
          else resolve(parsed);
        });
      });
      req.on("timeout", () => req.destroy(new Error("Mod status timeout")));
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  // 妨害の一時停止・再開（BridgeMOD 1.8.0 の /bridge/control。2026-10-16 ユーザーの決定）。停止と同じく出どころを記録する。
  async function setDisruptionPause(pause, origin) {
    stopRequests.record(pause ? "pause" : "resume", origin);
    try {
      const result = await requestBridgeMod("POST", "/bridge/control", { action: pause ? "pause" : "resume" });
      return { ok: true, paused: result.paused === true };
    } catch (error) {
      // 1.7.5〜1.7.6 は 400（受け付けない指示）、1.7.4 より前は /bridge/control がなく 404（HTML）を返す。
      if (error?.status === 400 || error?.status === 404) return { ok: false, message: "BridgeMOD を新しくすると使えます（1.8.0 以上）。" };
      // 認証の失敗は直し方を含んだ文言を返す。つながらない・応答がないときは、英語の生の文字列を出さない。
      if (error?.authFailed) return { ok: false, message: error.message };
      if (!error?.status) return { ok: false, message: "BridgeMOD とつながっていません。Minecraft サーバーが動いているか確かめてください。" };
      return { ok: false, message: error?.message || String(error) };
    }
  }

  // テスト発火は BRIDGE に渡し、本番と同じ処理・同じ送る列を通す（2026-10-16 ユーザーの決定。
  // 設計書 docs/superpowers/specs/2026-10-16-test-fire-parity-design.md）。BRIDGE は結果を最大10秒待つので、返事は15秒まで待つ。
  let testEventReplyMs = 15000;
  function askBridgeTestEvent(input) {
    const child = bridgeChild();
    if (!child?.connected) return Promise.resolve(null);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      let timer = null;
      const onMessage = message => { if (message?.type === "testEventResult" && message.id === id) finish(resolve, message.result); };
      const onExit = () => finish(reject, new Error("BRIDGE が止まったため、結果を受け取れませんでした。"));
      function finish(settle, value) {
        clearTimeout(timer);
        child.off("message", onMessage);
        child.off("exit", onExit);
        settle(value);
      }
      child.on("message", onMessage);
      child.on("exit", onExit);
      timer = setTimeout(() => finish(reject, new Error("BRIDGE から返事がありません。BRIDGE のログを確認してください。")), testEventReplyMs);
      try { child.send({ type: "testEvent", id, input }, error => { if (error) finish(reject, new Error("BRIDGE へ送れませんでした: " + error.message)); }); }
      catch (error) { finish(reject, new Error("BRIDGE へ送れませんでした: " + error.message)); }
    });
  }

  const BRIDGE_STOPPED_FOR_TEST = { ok: false, bridgeStopped: true, message: "BRIDGE を起動すると試せます。" };
  let testEventRunning = false;

  // Mod HTTP (25576) が応答するまで待つ。Forge起動直後はワールド読み込み中でまだ
  // 待ち受けが開いておらず、即送信すると ECONNREFUSED になる（一括起動時の
  // OP自動付与とゲームルール適用が毎回「スキップ」されていた真因）。
  // 同一サーバープロセスで一度タイムアウトしたら記録し、以降の呼び出しは1回の確認だけで
  // 即諦める（一括起動で gamerules→OP付与 と連続150秒ずつ待って計5分固まる事故の防止）。
  let bridgeModWaitTimedOutFor = null;
  async function waitForBridgeMod(timeoutMs = 150000, intervalMs = 3000) {
    let authFailed = false;
    const quickCheck = async () => {
      for (let attempt = 0; ; attempt++) {
        try { await requestBridgeMod("GET", "/bridge/status"); authFailed = false; return true; }
        catch (e) {
          authFailed = e?.authFailed === true;
          // トークンの書き換えと読み込みがすれ違うと、正常でも1回だけ 403 になる。少し待って読み直してから判断する。
          if (!authFailed || attempt >= 1) return false;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    };
    // 認証の失敗は待っても直らない（トークンはサーバー起動時に HTTP より先に書かれる）。すぐ原因を出す。
    const reportAuthFailure = () => { appendServerLog(`[SERVER] ${BRIDGE_MOD_AUTH_FAILED}（トークンファイル: ${bridgeModTokenPath(getServerRoot())}）`); return false; };
    if (await quickCheck()) { bridgeModWaitTimedOutFor = null; return true; }
    if (authFailed) return reportAuthFailure();
    if (serverChild() && bridgeModWaitTimedOutFor === serverChild()) return false;
    appendServerLog("[SERVER] Mod（BridgeMod）のHTTP応答を待っています。ワールド読み込み完了（Done表示）までお待ちください…");
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (Date.now() >= deadline || !serverChild()) {
        if (serverChild()) {
          bridgeModWaitTimedOutFor = serverChild();
          appendServerLog("[SERVER] Modの応答待ちがタイムアウトしました（HTTP:25576）。mods/ の bridgemod jar 配置とサーバーログを確認してください。");
        }
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (await quickCheck()) {
        bridgeModWaitTimedOutFor = null;
        appendServerLog("[SERVER] Mod（HTTP:25576）と接続できました。");
        return true;
      }
      if (authFailed) return reportAuthFailure();
    }
  }

  // テストで返事の待ち時間を短くするためにだけ使う。
  function setTestEventReplyMs(ms) { testEventReplyMs = ms; }

  function register(ipcMain) {
    ipcMain.handle("mod:status", async () => {
      try { return { online: true, ...(await requestBridgeMod("GET", "/bridge/status")) }; }
      catch (e) { return { online: false, authFailed: e?.authFailed === true, error: e.message }; }
    });

    ipcMain.handle("mod:pause", (_event, origin) => setDisruptionPause(true, origin));
    ipcMain.handle("mod:resume", (_event, origin) => setDisruptionPause(false, origin));

    ipcMain.handle("mod:testEvent", async (_event, value) => {
      if (testEventRunning) return { ok: false, message: "別のテストを実行中です。完了後にお試しください。" };
      const bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
      assertGameCommands(bridgeCfg, selectableCommandNames(), gameProfiles.list());
      if (value?.type === "gift") assertGameCommands({ gameProfile: bridgeCfg.gameProfile, commandFile: value.commandFile }, selectableCommandNames(), gameProfiles.list());
      // RCON・7DTD では BridgeMOD の状態を読みに行かず、使えない理由をそのまま返す（最後のレビュー Minor #5）。
      if (!usesBridgeModTransport(bridgeCfg)) return { ok: false, message: "テスト発火は、Minecraft を BridgeMOD で動かしているときだけ使えます。" };
      if (!bridgeChild()?.connected) return { ...BRIDGE_STOPPED_FOR_TEST };
      const preview = value?.preview === true;
      testEventRunning = true;
      try {
        // 一時停止中でも待ちに積む。実行は再開まで待つことを結果に書く（2026-10-16）。
        // 読み取りは実行中の印を立てたあとに行う（待っている間に押された2つ目を、同時に動かさない）。
        let paused = false;
        if (!preview) {
          try { paused = (await requestBridgeMod("GET", "/bridge/status", null, bridgeCfg)).paused === true; }
          catch (error) {
            // つながらないときは送らない。止まっている間に送る列へ入れると、あとでサーバーを起動したときに思いがけず動く（設計書 7）。
            // HTTP の応答が返ったとき（403 など）はつながっているので送り、BRIDGE の送り直しに任せる。
            if (!Number.isInteger(error?.status)) return { ok: false, message: "Minecraft サーバー（BridgeMOD）につながりません。サーバーを起動してから試してください。" };
          }
        }
        const result = await askBridgeTestEvent({ ...value, preview });
        if (!result) return { ...BRIDGE_STOPPED_FOR_TEST };
        if (!result.ok) throw new Error(result.error || "テスト発火に失敗しました。");
        const steps = result.steps || [], notes = result.notes || [], fired = result.fired || [];
        if (preview || !steps.length) return {
          ok: true, matched: steps.length > 0, preview: true, steps, notes,
          message: steps.length ? steps.length + "件の設定が条件に一致しました（未送信）。" : "発火する設定はありません。条件・有効設定を確認してください。",
        };
        const count = state => fired.filter(row => row.state === state).length;
        const delivered = count("delivered"), pending = count("pending"), failed = count("failed"), discarded = count("discarded");
        const parts = ["BridgeMOD が受け付けた " + delivered + "件"];
        if (pending) parts.push("送り直し中 " + pending + "件");
        if (failed) parts.push("送れなかった " + failed + "件");
        if (discarded) parts.push("取りやめ " + discarded + "件");
        // 手順があるのに何も受け付けられなかったら（ルーレットを途中で無効にしたなど）、成功にしない（最後のレビュー Important #1）。
        return { ok: failed === 0 && discarded === 0 && delivered + pending > 0, matched: true, fired, steps, notes,
          // 送れなかった分は再開しても実行されないので、受け付けた分・送り直し中の分があるときだけ書く。
          message: parts.join("・") + "。ゲーム内の結果も確認してください。" + (paused && delivered + pending > 0 ? " 一時停止中です。再開すると実行されます。" : "") };
      } finally { testEventRunning = false; }
    });
  }

  return { BRIDGE_MOD_AUTH_FAILED, requestBridgeMod, waitForBridgeMod, setTestEventReplyMs, register };
}

module.exports = { createBridgeModClient };
