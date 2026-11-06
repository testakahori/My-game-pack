// アプリを閉じるとき、このアプリが起動したサーバーと BRIDGE を止めてから終わる（2026-11-06 品質レビュー 重大）。
// × で閉じると、サーバーが保存されずに残り、次の起動で「このアプリからの停止・MAP操作はできません」になっていた。
// アプリが終わると、直の子（run.bat の cmd.exe・BRIDGE の node）は Windows が一緒に終わらせるが、孫の java は残る（2026-11-06 試した）。
// electron は読み込まない。app・dialog と、サーバー・BRIDGE の仕事（serverProcess・bridgeProcess）は main から受け取り、呼ばれたときに読む。
// getWindow は、アプリの終了（before-quit）で確認の窓を出す親のウィンドウ（無ければ null）。

const CONFIRM = {
  type: "question", title: "Minecraftサーバーが動いています",
  message: "ワールドを保存してサーバーを止めてから終了します。",
  detail: "止まるまで少しかかります。このアプリを開いたままお待ちください。",
  buttons: ["保存して終了", "やめる"], defaultId: 0, cancelId: 1, noLink: true,
};

// 保存・停止が終わらなかったとき。黙って強制終了せず、選んでもらう（すぐ決めるボタンは「やめる」）。
function failedOptions(error) {
  return {
    type: "warning", title: "サーバーを止められませんでした",
    message: "ワールドの保存とサーバーの停止が終わっていません。",
    detail: `${error?.message || error}\n\n強制終了すると、最後に保存したあとのワールドの変化が消えることがあります。`,
    buttons: ["強制終了して閉じる", "やめる"], defaultId: 1, cancelId: 1, noLink: true,
  };
}

function createAppQuit({ app, dialog, serverProcess, bridgeProcess, getWindow = () => null, log = console }) {
  // idle（何もしていない）・asking（確認の窓を出している）・stopping（BRIDGE とサーバーを止めている）。
  let phase = "idle";
  // 強制終了を選んだあとも残っているサーバー。これだけは止まっていなくても終了を通す（あとで起動したサーバーはまた聞く）。
  let forcedChild = null;
  // 終了の直前（will-quit）に BRIDGE を止めたか。止められなくても2回は止めない。
  let bridgeStoppedForQuit = false;

  // このアプリが起動したサーバーだけを見る。アプリを開く前から動いているサーバーは止めない（今までどおり閉じる）。
  function serverRunning() {
    const child = serverProcess.child();
    return Boolean(child) && child !== forcedChild;
  }

  async function ask(win, options) {
    // タスクバーから閉じると最小化のままのことがあり、その窓に付けた確認の窓は隠れて見えない。ウィンドウを戻して前に出す。
    if (win?.isMinimized?.()) win.restore();
    win?.focus?.();
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return result?.response;
  }

  // 聞いてから、BRIDGE → サーバーの順に止めて終わる。やめたときはウィンドウを残す。
  async function stopAndQuit(win) {
    phase = "asking";
    try {
      if (await ask(win, CONFIRM) !== 0) return;
      phase = "stopping";
      // 先に BRIDGE を止めて、ギフトがサーバーへ送られないようにする。止められなくてもサーバーの保存は続ける。
      if (bridgeProcess.isActive()) {
        try { await bridgeProcess.stopBridge("app:quit"); } catch (error) { log.warn("[Quit] BRIDGE を止められませんでした:", error?.message || error); }
      }
      try {
        await serverProcess.stopServer("app:quit");
      } catch (error) {
        phase = "asking";
        if (await ask(win, failedOptions(error)) !== 0) return;
        phase = "stopping";
        try { await serverProcess.killServer(); } catch (killError) { log.warn("[Quit] サーバーを強制終了できませんでした:", killError?.message || killError); }
        forcedChild = serverProcess.child();
      }
      // 終了の中で close・before-quit がもう一度来るので、先に作業中を外す。未保存の設定の確認はこのあと（ウィンドウを閉じるとき）に出る。
      phase = "idle";
      app.quit();
    } finally {
      phase = "idle";
    }
  }

  // ウィンドウの close（×・タスクバーの「ウィンドウを閉じる」・Alt+F4）。保存・準備中の知らせは window.cjs が先に出す。
  function onWindowClose(event, win) {
    if (phase !== "idle") { event.preventDefault(); return; }
    if (!serverRunning()) return;
    event.preventDefault();
    void stopAndQuit(win);
  }

  // アプリの終了（app.quit()）。ウィンドウを閉じるより先に来るので、同じように聞く。
  function onBeforeQuit(event) {
    if (phase !== "idle") { event.preventDefault(); return; }
    if (!serverRunning()) return;
    event.preventDefault();
    void stopAndQuit(getWindow());
  }

  // ウィンドウがすべて閉じたあと（未保存の設定の確認も済んだあと）。BRIDGE が動いていれば、聞かずに止めてから終わる。
  function onWillQuit(event) {
    if (bridgeStoppedForQuit || !bridgeProcess.isActive()) return;
    event.preventDefault();
    bridgeStoppedForQuit = true;
    Promise.resolve()
      .then(() => bridgeProcess.stopBridge("app:quit"))
      .catch(error => log.warn("[Quit] BRIDGE を止められませんでした:", error?.message || error))
      .finally(() => app.quit());
  }

  // BRIDGE とサーバーを止めている間は、ウィンドウを閉じない（main の isAppBusy が見る）。
  function isBusy() { return phase === "stopping"; }

  return { onWindowClose, onBeforeQuit, onWillQuit, isBusy };
}

module.exports = { createAppQuit };
