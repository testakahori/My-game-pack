// いいねマイルストーンは「配信の累計いいねが threshold に届いた瞬間に1回」（運用センターの説明）。
// 配信の途中からつないだとき、つなぐ前に越えていたマイルストーンをまとめて発火させない（アプリレビュー 2026-10-08 の確かめきれていない1件）。
// BRIDGE を止めずに次の配信へつないだら、いいね・フォローのマイルストーンはその配信でまた発火する（2026-10-14 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const proto = createRequire(path.resolve(__dirname, '../../bridge/index.js'))('tiktok-live-connector');

// 今の接続ライブラリは、common.displayText.key でフォローなどを見分ける。
const social = key => {
  const bytes = Buffer.from(key);
  return { displayText: proto.CommonMessageData.decode(Uint8Array.from([66, bytes.length + 2, 10, bytes.length, ...bytes])).displayText };
};

test('配信の途中からつないでも、つなぐ前に越えていたいいねマイルストーンは発火せず、そのあとに届いたものだけ1回発火する', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { boss: '# TITLE: boss\nsay boss\n' },
    config: { options: { gameplay: { likeMilestones: [
      { threshold: 100, commandFile: 'boss.txt' },
      { threshold: 1000, commandFile: 'boss.txt' },
      { threshold: 6000, commandFile: 'boss.txt', repeat: 2 },
    ] } } },
  });
  const milestones = () => bridge.requests.filter(x => x.key === 'boss');
  // つないだ時点で、配信の累計いいねはすでに 5000。最初の通知はそのうちの5回分。
  await bridge.emit('WebcastLikeMessage', { count: 5, total: '5000' });
  await bridge.wait(300);
  assert.deepEqual(milestones(), [], 'つなぐ前に越えていた 100・1000 は発火しない');

  await bridge.emit('WebcastLikeMessage', { count: 1000, total: '6000' });
  await bridge.until(() => milestones().length === 1, 'the 6000 milestone fires');
  assert.equal(milestones()[0].count, 2);
  await bridge.emit('WebcastLikeMessage', { count: 10, total: '6010' });
  await bridge.wait(300);
  assert.equal(milestones().length, 1, '同じマイルストーンは二度発火しない');
});

test('同じ配信へのつなぎ直しでは数え直さず、BRIDGE を止めずに次の配信へつないだら、いいね・フォローのマイルストーンがまた発火する', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { boss: '# TITLE: boss\nsay boss\n', fan: '# TITLE: fan\nsay fan\n' },
    config: { options: { gameplay: {
      likeMilestones: [{ threshold: 100, commandFile: 'boss.txt' }, { threshold: 200, commandFile: 'boss.txt' }],
      followMilestones: [{ threshold: 2, commandFile: 'fan.txt' }],
    } } },
  });
  const likes = () => bridge.requests.filter(x => x.key === 'boss').length;
  const follows = () => bridge.requests.filter(x => x.key === 'fan').length;
  const follow = () => bridge.emit('WebcastSocialMessage', { common: social('pm_main_follow_message'), action: '1' });
  // つなぎ直しは、切れてから5秒後。
  const reconnect = async room => {
    const before = bridge.logs.filter(line => line.includes('[TikTok] Connected.')).length;
    bridge.connection().emit('disconnected', { reason: 'fixture' });
    for (let i = 0; i < 400 && bridge.logs.filter(line => line.includes('[TikTok] Connected.')).length === before; i++) await bridge.wait(20);
    assert.ok(bridge.logs.some(line => line.includes(`[TikTok] Connected. roomId=${room}`)), 'reconnected to ' + room);
  };

  // 1つ目の配信：100いいねとフォロー1回。
  await bridge.emit('WebcastLikeMessage', { count: 150, total: '150' });
  await follow();
  await bridge.until(() => likes() === 1, 'first stream: 100 likes');
  assert.equal(follows(), 0);

  // 同じ配信へつなぎ直す：切れていた間に越えた 200いいね は1回発火し、100いいね は発火し直さない（PR #96 レビュー）。
  // フォローは続きから数える（2回目で発火）。
  await reconnect('fixture-room');
  await bridge.emit('WebcastLikeMessage', { count: 5, total: '260' });
  await follow();
  await bridge.until(() => likes() === 2 && follows() === 1, 'same stream: the 200 crossed while disconnected and the 2nd follow fire');

  // 配信終了のあと、配信の番号が同じに見えても（番号が取れないときなど）、次の配信として数え直す。
  bridge.connection().emit('streamEnd', {});
  await reconnect('fixture-room');
  await follow();
  await bridge.wait(300);
  assert.equal(follows(), 1, '配信終了で数え直したので、次の配信の1回目では発火しない');
  await bridge.emit('WebcastLikeMessage', { count: 120, total: '120' });
  await follow();
  await bridge.until(() => likes() === 3 && follows() === 2, 'next stream after streamEnd: milestones fire again');

  // 配信終了が届かなくても、別の配信（番号が違う）につないだら数え直す。
  bridge.setRoomId('room-3');
  await reconnect('room-3');
  await follow();
  await bridge.wait(300);
  assert.equal(follows(), 2, '別の配信の1回目では発火しない');
  await bridge.emit('WebcastLikeMessage', { count: 130, total: '130' });
  await follow();
  await bridge.until(() => likes() === 4 && follows() === 3, 'next room: milestones fire again');
  await bridge.wait(300);
  assert.deepEqual([likes(), follows()], [4, 3], '余分に発火しない');
});

test('つないで最初のいいねの通知に配信の累計がなく、あとから累計が届いても、そこでまとめて発火しない（PR #96 レビュー）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { boss: '# TITLE: boss\nsay boss\n', cod: '# TITLE: cod\nsay cod\n' },
    config: {
      likeEvents: [{ enabled: true, threshold: 100, commandFile: 'cod.txt', repeat: 1 }],
      options: { gameplay: { likeMilestones: [{ threshold: 1000, commandFile: 'boss.txt' }] } },
    },
  });
  // 累計0（届いていない）で5回分、次は配信の累計 5050 のうち3回分。
  await bridge.emit('WebcastLikeMessage', { count: 5, total: '0' });
  await bridge.emit('WebcastLikeMessage', { count: 3, total: '5050' });
  await bridge.wait(400);
  assert.deepEqual(bridge.requests.filter(x => x.key === 'boss' || x.key === 'cod'), [], 'つなぐ前の 5050 で、マイルストーンも 100いいねごと も動かない');
  await bridge.emit('WebcastLikeMessage', { count: 100, total: '5150' });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'the next 100 likes run once');
  assert.equal(bridge.requests.filter(x => x.key === 'cod').reduce((sum, x) => sum + x.count, 0), 1);
});
