// 配信の途中からつないだとき・つなぎ直したとき・配信が終わったときの、「N いいねごと」の設定（likeEvents）の動き。
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

// つなぎ直すたびに、いいねの数え方（likeCounter）は前の累計を忘れ、最初の通知の分だけを新しく数える（切れていた間の分はまとめて動かさない）。
// 配信が終わったら、次につながるまでいいねを使わない（2026-10-14 ユーザーの決定）。PR #177 レビュー 軽い2。
test('つなぎ直しと配信終了: 同じ配信へのつなぎ直しでは切れていた間の分を動かさず、配信終了のあとは使わず、次につないだら数える', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { cod: 'say cod\n' },
    config: { likeEvents: [{ enabled: true, threshold: 100, commandFile: 'cod.txt', repeat: 1 }] },
  });
  const cods = () => bridge.requests.filter(x => x.key === 'cod').reduce((sum, x) => sum + x.count, 0);
  // つなぎ直しは、切れてから5秒後。
  const reconnect = async () => {
    const connected = () => bridge.logs.filter(line => line.includes('[TikTok] Connected.')).length;
    const before = connected();
    bridge.connection().emit('disconnected', { reason: 'fixture' });
    for (let i = 0; i < 400 && connected() === before; i++) await bridge.wait(20);
    assert.ok(connected() > before, 'reconnected');
  };
  await bridge.emit('WebcastLikeMessage', { count: 150, total: '150' });
  await bridge.until(() => cods() === 1, 'first 100 likes');
  // 同じ配信へつなぎ直す。切れていた間に 200 を越えていても（150→255）、つないでからの5回分（255→260）だけを数える。
  await reconnect();
  await bridge.emit('WebcastLikeMessage', { count: 5, total: '260' });
  await bridge.wait(400);
  const sameStream = cods();
  // 配信が終わったあとに届いたいいね（460 まで）は使わない。
  bridge.connection().emit('streamEnd', {});
  await bridge.wait(100);
  await bridge.emit('WebcastLikeMessage', { count: 200, total: '460' });
  await bridge.wait(400);
  const afterEnd = cods();
  // 次の配信につないだら、累計 120 で 100いいねごと が1回動く。
  await reconnect();
  await bridge.emit('WebcastLikeMessage', { count: 120, total: '120' });
  await bridge.until(() => cods() === 2, 'next stream: 100 likes');
  await bridge.wait(300);
  assert.deepEqual({ sameStream, afterEnd, afterReconnect: cods() }, { sameStream: 1, afterEnd: 1, afterReconnect: 2 });
});
