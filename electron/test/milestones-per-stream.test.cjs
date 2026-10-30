// 配信の途中からつないだとき、つなぐ前のいいねで「N いいねごと」の設定（likeEvents）をまとめて動かさない（PR #96 レビュー）。
// いいね・フォローのマイルストーン（options.gameplay）は、演出・ゲーム性設定ごとなくした（2026-10-30 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

test('つないで最初のいいねの通知に配信の累計がなく、あとから累計が届いても、そこでまとめて発火しない（PR #96 レビュー）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { cod: '# TITLE: cod\nsay cod\n' },
    config: { likeEvents: [{ enabled: true, threshold: 100, commandFile: 'cod.txt', repeat: 1 }] },
  });
  // 累計0（届いていない）で5回分、次は配信の累計 5050 のうち3回分。
  await bridge.emit('WebcastLikeMessage', { count: 5, total: '0' });
  await bridge.emit('WebcastLikeMessage', { count: 3, total: '5050' });
  await bridge.wait(400);
  assert.deepEqual(bridge.requests.filter(x => x.key === 'cod'), [], 'つなぐ前の 5050 で、100いいねごと は動かない');
  await bridge.emit('WebcastLikeMessage', { count: 100, total: '5150' });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'the next 100 likes run once');
  assert.equal(bridge.requests.filter(x => x.key === 'cod').reduce((sum, x) => sum + x.count, 0), 1);
});
