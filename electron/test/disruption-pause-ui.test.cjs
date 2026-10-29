// 妨害の一時停止（2026-10-16 ユーザーの決定）：画面の判断と配線。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
function loadTs(relative) {
  const file = path.resolve(__dirname, '../../src/lib', relative);
  const compiled = new Module(file, module);
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
  return compiled.exports;
}
const source = relative => fs.readFileSync(path.resolve(__dirname, '../../src', relative), 'utf8');
const { pauseView, pauseBannerText, setDisruptionPause } = loadTs('disruptionPause.ts');

test('止めているかは、BridgeMOD とつながっていて paused が true のときだけ。古い BridgeMOD・再起動で解けたときは止めていない', () => {
  assert.deepEqual(pauseView({ online: true, paused: true, gift: 2, like: 30, other: 1 }), { online: true, paused: true, queued: { gift: 2, like: 30, other: 1 } });
  assert.equal(pauseView({ online: true, gift: 0 }).paused, false, '古い BridgeMOD は paused を返さない');
  assert.equal(pauseView({ online: true, paused: false }).paused, false, '再起動で解けた');
  assert.equal(pauseView({ online: false, paused: true }).paused, false, 'つながっていなければ帯を出さない');
  assert.equal(pauseView(null).paused, false);
  assert.deepEqual(pauseView({ online: true, paused: true, gift: 'x', like: -1 }).queued, { gift: 0, like: 0, other: 0 }, '数でない値は0');
});

test('帯の文言は、預かっている件数と、再開すると順に起きること、サーバーを止めると預かった分が消えることを書く', () => {
  assert.equal(pauseBannerText({ online: true, paused: true, queued: { gift: 2, like: 30, other: 1 } }),
    '妨害を一時停止中です。届いた分は預かっています（ギフト 2・いいね 30・そのほか 1）。再開すると順に起きます。サーバーを止めると、BridgeMOD で預かっている分は消えます');
});

// 止めている間にサーバーを止める（MAP の読込・ゲームの切り替えも含む）と、BridgeMOD の待ちは消える（PR レビュー I-1）。
test('止めている間のサーバー停止・一括停止の確認は、預かった分が消えることを書く。BRIDGE停止と、止めていないときは今までどおり', () => {
  const { stopConfirmMessage } = loadTs('stopSafety.ts');
  const running = { bridgeRunning: true, serverRunning: true, tiktokConnected: false };
  const note = '妨害を一時停止中です。サーバーを止めると一時停止は解け、BridgeMOD で預かっている分は消えます。';
  for (const target of ['server', 'all']) {
    assert.ok(stopConfirmMessage(target, { ...running, disruptionPaused: true }).includes(note), target);
    assert.ok(!stopConfirmMessage(target, running).includes('預かっている分'), target + '（止めていない）');
  }
  assert.ok(!stopConfirmMessage('bridge', { ...running, disruptionPaused: true }).includes('預かっている分'), 'BRIDGE停止はサーバーに触れない');
  assert.equal(stopConfirmMessage('server', { ...running, serverRunning: false, disruptionPaused: true }), null, '止まっているサーバーは確認しない');
  const home = source('components/DashboardPage.tsx');
  assert.match(home, /stopConfirmMessage\(target, \{ \.\.\.stopState\(bridgeProcess, serverProc\), disruptionPaused: disruption\?\.paused === true \}\)/);
  assert.match(home, /サーバーを止める・再起動すると一時停止は解け、BridgeMOD で預かっていた分は消えます。/);
});

test('一時停止・再開は出どころを付けて IPC を呼ぶ。失敗したら理由を返し、止めたことにしない', async () => {
  const calls = [];
  const api = { modPause: async origin => { calls.push(['pause', origin]); return { ok: true, paused: true }; },
    modResume: async origin => { calls.push(['resume', origin]); return { ok: false, message: 'BridgeMOD を新しくすると使えます（1.8.0 以上）。' }; } };
  assert.deepEqual(await setDisruptionPause(api, true, 'home:pause'), { ok: true, paused: true });
  assert.deepEqual(await setDisruptionPause(api, false, 'banner:resume'), { ok: false, message: 'BridgeMOD を新しくすると使えます（1.8.0 以上）。' });
  assert.deepEqual(calls, [['pause', 'home:pause'], ['resume', 'banner:resume']]);
  const throwing = { modPause: async () => { throw new Error('つながりません'); } };
  assert.deepEqual(await setDisruptionPause(throwing, true, 'home:pause'), { ok: false, message: 'つながりません' });
  assert.deepEqual(await setDisruptionPause({}, true, 'home:pause'), { ok: false, message: 'このアプリでは一時停止を使えません。' });
});

test('帯はどのページにも出し、再開ボタンは帯から出どころ付きで呼ぶ。配信ホームのボタンも出どころを付ける', () => {
  const app = source('App.tsx');
  assert.match(app, /pauseView\(mod\)/, '画面上部の5秒ごとの mod:status から読む');
  assert.match(app, /className="pause-banner" role="status"/);
  assert.match(app, /setDisruptionPause\(api, false, "banner:resume"\)/);
  // 後ろにゲームの欄（gameSelector）を渡す（2026-10-29）。妨害の一時停止のつなぎ方は同じ。
  assert.match(app, /<DashboardPage onNavigate=\{navigateTo\} disruption=\{disruption\} onDisruptionPause=\{changeDisruptionPause\} startReady=\{gameReady\}\s[^>]*gameSelector=/);
  const home = source('components/DashboardPage.tsx');
  assert.match(home, /onDisruptionPause\(!disruption\.paused\)/);
  assert.match(home, /妨害を再開/);
  assert.match(home, /妨害を一時停止/);
  assert.match(app, /setDisruptionPause\(api, pause, pause \? "home:pause" : "home:resume"\)/);
});
