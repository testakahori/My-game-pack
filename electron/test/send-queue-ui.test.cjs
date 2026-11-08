// BRIDGE の送信待ち（BridgeMOD にまだ受け付けられていない分）を、配信ホームに出し、停止・再起動の確認に書く（2026-11-07 品質レビュー）。
// 前は BRIDGE を止める・再起動すると黙って消え、画面にも出ていなかった。自動再起動の上限も、閉じたログ欄にしか出ていなかった。
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
const { stopState, stopConfirmMessage, restartConfirmMessage, sendQueueNotice } = loadTs('stopSafety.ts');

test('送信待ち: 動いている BRIDGE の sendQueue だけを数える（止まっている・不明・壊れた値は 0）', () => {
  const sendQueue = { pending: 3, gifts: 2, oldestAt: '2026-11-07T10:00:00.000Z' };
  const running = stopState({ running: true, sendQueue }, { running: true });
  assert.deepEqual([running.pendingDeliveries, running.pendingGifts], [3, 2]);
  assert.deepEqual([stopState({ running: false, sendQueue }, null).pendingDeliveries, stopState(null, null).pendingDeliveries], [0, 0]);
  assert.equal(stopState({ running: true, sendQueue: { pending: 'x', gifts: -1 } }, null).pendingDeliveries, 0);
});

test('送信待ち: BRIDGE停止・一括停止の確認に「未送信のギフト N件は消えます」を書く。サーバー停止には書かない（BRIDGE が持ったまま再送する）', () => {
  const state = stopState({ running: true, sendQueue: { pending: 2, gifts: 2 } }, { running: true });
  for (const target of ['bridge', 'all']) assert.ok(stopConfirmMessage(target, state).includes('未送信のギフト 2件は消えます。\n'), target);
  assert.ok(!stopConfirmMessage('server', state).includes('未送信'));
  const mixed = stopState({ running: true, sendQueue: { pending: 5, gifts: 1 } }, { running: true });
  assert.ok(stopConfirmMessage('bridge', mixed).includes('未送信のギフト 1件は消えます。未送信のいいね・コメントなど 4件も消えます。'));
  const likes = stopState({ running: true, sendQueue: { pending: 4, gifts: 0 } }, { running: true });
  assert.ok(stopConfirmMessage('bridge', likes).includes('未送信のいいね・コメントなど 4件は消えます。'));
  const none = stopState({ running: true, sendQueue: { pending: 0, gifts: 0 } }, { running: true });
  assert.ok(!stopConfirmMessage('bridge', none).includes('未送信'), '0件なら書かない');
});

test('送信待ち: 再起動の確認は送信待ちがあるときだけ出す', () => {
  assert.equal(restartConfirmMessage(stopState({ running: true, sendQueue: { pending: 0 } }, null)), null);
  assert.equal(restartConfirmMessage(stopState({ running: true }, null)), null);
  assert.equal(restartConfirmMessage(stopState({ running: true, sendQueue: { pending: 1, gifts: 1 } }, null)), '未送信のギフト 1件は消えます。\nBRIDGEを再起動しますか？');
});

test('送信待ち: 配信ホームの文は件数といちばん古いものの秒数を書き、0件なら出さない', () => {
  const now = Date.parse('2026-11-07T10:00:12.400Z');
  assert.equal(sendQueueNotice({ pending: 2, gifts: 2, oldestAt: '2026-11-07T10:00:00.000Z' }, now),
    '送信待ち 2件（いちばん古いものは 12秒前から）。BridgeMODへ送れるまでBRIDGEが預かっています。BRIDGEを止める・再起動すると消えます。');
  assert.equal(sendQueueNotice({ pending: 1, oldestAt: null }, now), '送信待ち 1件。BridgeMODへ送れるまでBRIDGEが預かっています。BRIDGEを止める・再起動すると消えます。');
  assert.equal(sendQueueNotice({ pending: 0, oldestAt: null }, now), null);
  assert.equal(sendQueueNotice(null, now), null);
});

test('配信ホーム: 送信待ちと自動再起動の上限を、ログ欄の外（ほかの案内と同じ並び）に出し、再起動の前に送信待ちを確かめる', () => {
  const home = source('components/DashboardPage.tsx');
  assert.match(home, /\{sendQueueNotice\(bridgeProcess\.sendQueue\) \? <p role="status" className="cockpit-launch-notice cockpit-launch-notice--info">\{sendQueueNotice\(bridgeProcess\.sendQueue\)\}<\/p> : null\}/);
  assert.match(home, /\{bridgeProcess\.restartExhausted \? \(\s*<p role="alert" className="cockpit-launch-notice cockpit-launch-notice--error">\s*BRIDGEが落ちるのを繰り返したため、自動再起動の上限に達して止めました。/);
  const restart = home.slice(home.indexOf('const handleBridgeRestart = async () => {'), home.indexOf('const handleMinecraftLaunch'));
  assert.match(restart, /const restartMessage = restartConfirmMessage\(stopState\(bridgeProcess, serverProc\)\);\s*if \(restartMessage && !window\.confirm\(restartMessage\)\) return;/);
});
