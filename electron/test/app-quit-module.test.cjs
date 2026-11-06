// アプリを閉じるとき、このアプリが起動したサーバーと BRIDGE を止めてから終わる（app_quit.cjs。2026-11-06 品質レビュー 重大）。
// × で閉じると、サーバー（cmd.exe /c run.bat の孫の java）が保存されずに残り、次の起動で止められなくなっていた。
// main の配線（close・before-quit・will-quit と isAppBusy）は app-regressions.test.cjs で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppQuit } = require('../app_quit.cjs');

const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, ng) => { resolve = ok; reject = ng; });
  return { promise, resolve, reject };
}
function closeEvent() {
  const event = { prevented: false, preventDefault() { event.prevented = true; } };
  return event;
}

// サーバー・BRIDGE・dialog・app の偽物。確認の窓の答えは answer(n) で返す（返すまで窓は開いたまま）。
function setup({ server = true, bridge = false } = {}) {
  const calls = [], asked = [], answers = [];
  const win = { name: 'main-window' };
  const state = { serverChild: server ? { pid: 777 } : null, bridgeActive: bridge, stopServer: null, stopBridge: null, kill: null };
  const serverProcess = {
    child: () => state.serverChild,
    stopServer: origin => {
      calls.push(`stopServer:${origin}`);
      if (state.stopServer) return state.stopServer();
      state.serverChild = null;
      return Promise.resolve({ ok: true, graceful: true });
    },
    killServer: () => {
      calls.push('killServer');
      if (state.kill) return state.kill();
      state.serverChild = null;
      return Promise.resolve(true);
    },
  };
  const bridgeProcess = {
    isActive: () => state.bridgeActive,
    stopBridge: origin => {
      calls.push(`stopBridge:${origin}`);
      if (state.stopBridge) return state.stopBridge();
      state.bridgeActive = false;
      return Promise.resolve({ ok: true });
    },
  };
  const dialog = {
    showMessageBox: (...args) => {
      const [parent, options] = args.length === 2 ? args : [null, args[0]];
      asked.push({ parent, options });
      const answer = deferred();
      answers.push(answer);
      return answer.promise;
    },
  };
  const app = { quit: () => calls.push('quit') };
  const warnings = [];
  const appQuit = createAppQuit({ app, dialog, serverProcess, bridgeProcess, getWindow: () => win, log: { warn: (...args) => warnings.push(args.join(' ')) } });
  return {
    appQuit, calls, asked, state, win, warnings,
    titles: () => asked.map(x => x.options.title),
    // n 番目（0 から）の確認の窓に答える。
    answer: async (n, response) => { answers[n].resolve({ response }); await tick(); await tick(); },
    close: () => { const event = closeEvent(); appQuit.onWindowClose(event, win); return event; },
    beforeQuit: () => { const event = closeEvent(); appQuit.onBeforeQuit(event); return event; },
    willQuit: () => { const event = closeEvent(); appQuit.onWillQuit(event); return event; },
  };
}

test('サーバーが動いていなければ、聞かずに今までどおり閉じる（アプリを開く前から動いているサーバーも止めない）', () => {
  // アプリの外で起動したサーバーは serverProcess.child() が null（server_process.cjs はポートで見つけるだけで、子プロセスを持たない）。
  const x = setup({ server: false });
  assert.equal(x.close().prevented, false);
  assert.equal(x.beforeQuit().prevented, false);
  assert.equal(x.willQuit().prevented, false);
  assert.deepEqual(x.asked, []);
  assert.deepEqual(x.calls, [], 'サーバーも BRIDGE も止めない');
  assert.equal(x.appQuit.isBusy(), false);
});

test('サーバーが動いていれば、閉じずにウィンドウを親にして聞く。「やめる」ならウィンドウを残し、何も止めない。次の × でまた聞く', async () => {
  const x = setup({ bridge: true });
  assert.equal(x.close().prevented, true);
  await tick();
  assert.equal(x.asked.length, 1);
  assert.equal(x.asked[0].parent, x.win, 'ウィンドウを親にする');
  assert.deepEqual(x.asked[0].options, {
    type: 'question', title: 'Minecraftサーバーが動いています',
    message: 'ワールドを保存してサーバーを止めてから終了します。',
    detail: '止まるまで少しかかります。このアプリを開いたままお待ちください。',
    buttons: ['保存して終了', 'やめる'], defaultId: 0, cancelId: 1, noLink: true,
  });
  await x.answer(0, 1);
  assert.deepEqual(x.calls, [], '止めない・終わらない');
  assert.equal(x.close().prevented, true);
  await tick();
  assert.deepEqual(x.titles(), ['Minecraftサーバーが動いています', 'Minecraftサーバーが動いています']);
});

test('タスクバーから閉じて最小化のままなら、ウィンドウを戻して前に出してから聞く（最小化の窓に付けた確認の窓は隠れる）', async () => {
  const x = setup();
  let minimized = true;
  Object.assign(x.win, { isMinimized: () => minimized, restore: () => { minimized = false; x.calls.push('restore'); }, focus: () => x.calls.push('focus') });
  x.close();
  await tick();
  assert.deepEqual(x.calls, ['restore', 'focus']);
  assert.equal(x.asked.length, 1);
});

test('「保存して終了」: BRIDGE → サーバーの順に止めてから終わる。止めている間の × と終了は止め、作業中（isBusy）になる', async () => {
  const x = setup({ bridge: true });
  const server = deferred();
  x.state.stopServer = () => server.promise.then(() => { x.state.serverChild = null; return { ok: true, graceful: true }; });
  x.close();
  await tick();
  // 窓を出している間に重ねて閉じても、窓を増やさない。
  assert.equal(x.close().prevented, true);
  assert.equal(x.beforeQuit().prevented, true);
  await tick();
  assert.equal(x.asked.length, 1);
  await x.answer(0, 0);
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'stopServer:app:quit']);
  assert.equal(x.appQuit.isBusy(), true, 'main の isAppBusy が「保存・準備中です」を出す');
  assert.equal(x.close().prevented, true);
  assert.equal(x.beforeQuit().prevented, true);
  await tick();
  assert.equal(x.asked.length, 1, '止めている間に重ねて閉じても聞き直さない');
  server.resolve();
  await tick(); await tick();
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'stopServer:app:quit', 'quit']);
  assert.equal(x.appQuit.isBusy(), false);
  // 終わりの中でもう一度来る before-quit・close・will-quit は通す（未保存の設定の確認は、このあとウィンドウを閉じるときに出る）。
  assert.equal(x.beforeQuit().prevented, false);
  assert.equal(x.close().prevented, false);
  assert.equal(x.willQuit().prevented, false, 'BRIDGE はもう止めた');
});

test('BRIDGE が動いていなければ、サーバーだけを止めて終わる', async () => {
  const x = setup();
  x.close();
  await tick();
  await x.answer(0, 0);
  assert.deepEqual(x.calls, ['stopServer:app:quit', 'quit']);
});

test('BRIDGE を止められなくても、サーバーは保存して止めてから終わる', async () => {
  const x = setup({ bridge: true });
  x.state.stopBridge = () => Promise.reject(new Error('Bridgeを停止できませんでした。'));
  x.close();
  await tick();
  await x.answer(0, 0);
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'stopServer:app:quit', 'quit']);
  assert.ok(x.warnings.some(line => line.includes('Bridgeを停止できませんでした。')));
});

test('保存・停止が終わらなかったら、黙って強制終了せずに知らせる。「やめる」ならウィンドウを残し、強制終了しない', async () => {
  const x = setup();
  x.state.stopServer = () => Promise.reject(new Error('サーバーの保存・停止がまだ完了していません。'));
  x.close();
  await tick();
  await x.answer(0, 0);
  assert.equal(x.asked.length, 2);
  assert.equal(x.asked[1].parent, x.win);
  assert.deepEqual(x.asked[1].options, {
    type: 'warning', title: 'サーバーを止められませんでした',
    message: 'ワールドの保存とサーバーの停止が終わっていません。',
    detail: 'サーバーの保存・停止がまだ完了していません。\n\n強制終了すると、最後に保存したあとのワールドの変化が消えることがあります。',
    buttons: ['強制終了して閉じる', 'やめる'], defaultId: 1, cancelId: 1, noLink: true,
  });
  // 2つ目の窓を出している間も、重ねて閉じても窓を増やさない。
  assert.equal(x.close().prevented, true);
  assert.equal(x.appQuit.isBusy(), false);
  await x.answer(1, 1);
  assert.deepEqual(x.calls, ['stopServer:app:quit'], '強制終了も終了もしない');
  assert.equal(x.appQuit.isBusy(), false);
  // サーバーはまだ動いているので、次の × でまた聞く。
  assert.equal(x.close().prevented, true);
  await tick();
  assert.equal(x.asked.length, 3);
});

test('「強制終了して閉じる」: サーバーを強制終了してから終わる', async () => {
  const x = setup();
  x.state.stopServer = () => Promise.reject(new Error('サーバーが正常終了しませんでした。'));
  x.close();
  await tick();
  await x.answer(0, 0);
  await x.answer(1, 0);
  assert.deepEqual(x.calls, ['stopServer:app:quit', 'killServer', 'quit']);
  assert.equal(x.close().prevented, false);
});

test('強制終了しても止まらなかったサーバーは、終わるのを止めない（あとで起動したサーバーはまた聞く）', async () => {
  const x = setup();
  const stuck = x.state.serverChild;
  x.state.stopServer = () => Promise.reject(new Error('止まらない'));
  x.state.kill = () => Promise.resolve(false);
  x.close();
  await tick();
  await x.answer(0, 0);
  await x.answer(1, 0);
  assert.deepEqual(x.calls, ['stopServer:app:quit', 'killServer', 'quit']);
  assert.equal(x.state.serverChild, stuck);
  assert.equal(x.beforeQuit().prevented, false);
  assert.equal(x.close().prevented, false);
  x.state.serverChild = { pid: 888 };
  assert.equal(x.close().prevented, true);
});

test('アプリの終了（before-quit）でも、ウィンドウを閉じる前に同じように聞く。親は getWindow() のウィンドウ', async () => {
  const x = setup({ bridge: true });
  assert.equal(x.beforeQuit().prevented, true);
  await tick();
  assert.equal(x.asked.length, 1);
  assert.equal(x.asked[0].parent, x.win);
  await x.answer(0, 0);
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'stopServer:app:quit', 'quit']);
});

test('BRIDGE だけが動いていれば、聞かずに閉じ、ウィンドウがすべて閉じたあと（will-quit）に止めてから終わる', async () => {
  const x = setup({ server: false, bridge: true });
  assert.equal(x.close().prevented, false, '未保存の設定の確認より先に BRIDGE を止めない');
  assert.equal(x.beforeQuit().prevented, false);
  const stop = deferred();
  x.state.stopBridge = () => stop.promise;
  assert.equal(x.willQuit().prevented, true);
  await tick();
  assert.deepEqual(x.calls, ['stopBridge:app:quit']);
  stop.resolve({ ok: true });
  await tick(); await tick();
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'quit']);
  assert.deepEqual(x.asked, []);
  // 止められなくても2回は止めず、そのまま終わる。
  assert.equal(x.willQuit().prevented, false);
});

test('BRIDGE を止められなくても、終わる', async () => {
  const x = setup({ server: false, bridge: true });
  x.state.stopBridge = () => Promise.reject(new Error('Bridgeを停止できませんでした。'));
  assert.equal(x.willQuit().prevented, true);
  await tick(); await tick();
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'quit']);
  assert.ok(x.warnings.some(line => line.includes('Bridgeを停止できませんでした。')));
  assert.equal(x.willQuit().prevented, false);
});

// 停止が失敗を返しても、サーバーがもう終わっていれば「止められませんでした／強制終了」は聞かずに終える（2026-11-06 レビュー 軽い3）。
// 例：終了コードが 0 でない・止めた直後のポートの確かめで失敗した・確認の窓の間にサーバーが落ちた。
test('停止が失敗を返しても、サーバーがもう終わっていれば、強制終了は聞かずに終わる', async () => {
  const x = setup();
  x.state.stopServer = () => { x.state.serverChild = null; return Promise.reject(new Error('ポートがまだ使われています')); };
  x.close();
  await tick();
  await x.answer(0, 0);
  assert.equal(x.asked.length, 1, '2つ目の窓を出さない');
  assert.deepEqual(x.calls, ['stopServer:app:quit', 'quit']);
  assert.match(x.warnings.join('\n'), /もう終わっています/);
});

// BRIDGE を止めたあとに停止が失敗したら、「やめる」で配信を続けるときのために BRIDGE を止めたことを書く（2026-11-06 レビュー 軽い4）。
test('BRIDGE を止めたあとに停止が失敗したら、2つ目の窓に BRIDGE を止めたことを書く', async () => {
  const x = setup({ bridge: true });
  x.state.stopServer = () => Promise.reject(new Error('時間切れ'));
  x.close();
  await tick();
  await x.answer(0, 0);
  assert.equal(x.asked.length, 2);
  assert.match(x.asked[1].options.detail, /BRIDGE は止めました。「やめる」で配信を続けるときは、配信ホームで BRIDGE を起動し直してください。/);
  await x.answer(1, 1);
  assert.deepEqual(x.calls, ['stopBridge:app:quit', 'stopServer:app:quit']);
});
