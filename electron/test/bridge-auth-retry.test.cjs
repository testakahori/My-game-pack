// BridgeMOD の 403（トークン違い）を、ほかの失敗と区別して数えることを、本番の bridge/index.js で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

async function giftWithReplies(t, replies) {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }] },
    respond: () => replies.shift() ?? 202,
  });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g1' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.length >= 3, 'delivered after retries');
  await bridge.wait(100);
  return bridge;
}

test('ほかの失敗のあとの1回だけの 403 は、認証の失敗として出さない', async t => {
  // サーバー再起動中は接続できない応答が続き、そのあとトークンの読み込みがすれ違って1回だけ 403 になることがある。
  const bridge = await giftWithReplies(t, [503, 403, 202]);
  assert.ok(!bridge.logs.some(x => x.includes('認証に失敗')), bridge.logs.join('\n'));
});

test('403 のあとに別の失敗が続いたら、その失敗もすぐログに出す', async t => {
  // 以前は再送の回数だけで判定していたため、2回目以降の別の失敗は20回目までログに出なかった。
  const bridge = await giftWithReplies(t, [403, 503, 202]);
  assert.ok(bridge.logs.some(x => x.includes('Waiting to retry') && x.includes('attempt=2') && x.includes('503')), bridge.logs.join('\n'));
  assert.ok(!bridge.logs.some(x => x.includes('認証に失敗')));
});

test('403 と接続エラーが交互に続いても、再送のたびにはログを出さない', async t => {
  // 種類が変わるたびに数え直すと、交互のときに再送1回おきにログが出ていた。
  const bridge = await giftWithReplies(t, [403, 503, 403, 503, 202]);
  // 再送の間隔は 250ms から倍に延びるので、5回目（届く回）は約4秒後。
  const deadline = Date.now() + 10000;
  while (bridge.requests.length < 5 && Date.now() < deadline) await bridge.wait(50);
  assert.equal(bridge.requests.length, 5);
  const waits = bridge.logs.filter(x => x.includes('Waiting to retry'));
  assert.equal(waits.length, 1, waits.join('\n'));
  assert.ok(!bridge.logs.some(x => x.includes('認証に失敗')));
});
