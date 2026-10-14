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
      likeMilestones: [{ threshold: 100, commandFile: 'boss.txt' }],
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

  // 同じ配信へつなぎ直す：いいねは発火し直さず、フォローは続きから数える（2回目で発火）。
  await reconnect('fixture-room');
  await bridge.emit('WebcastLikeMessage', { count: 10, total: '160' });
  await follow();
  await bridge.until(() => follows() === 1, 'same stream: the 2nd follow fires');
  await bridge.wait(300);
  assert.equal(likes(), 1, '同じ配信では 100いいね を二度発火しない');

  // 次の配信：累計は0から。100いいね・フォロー2回で、また発火する。
  bridge.connection().emit('streamEnd', {});
  bridge.setRoomId('room-2');
  await reconnect('room-2');
  await bridge.emit('WebcastLikeMessage', { count: 120, total: '120' });
  await follow();
  await follow();
  await bridge.until(() => likes() === 2 && follows() === 2, 'next stream: milestones fire again');
});
