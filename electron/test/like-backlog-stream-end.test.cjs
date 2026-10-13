// 配信が終わったら、まだ実行していないいいね分を捨てる（2026-10-14 ユーザーの決定）。
// 配信中のいいね・ギフト・テスト発火は変えない。BridgeMOD の待ちも捨てさせる（BridgeMOD 1.7.5 から）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('配信が終わったら、BRIDGE に溜まったいいね分を送らず、BridgeMOD にもいいねの待ちを捨てさせる。ギフトはそのまま送る', async t => {
  let likesRejected = true;
  const bridge = await startBridgeFixture(t, {
    commands: { cod: '# TITLE: cod\nsay cod\n', zombie: '# TITLE: zombie\nsay zombie\n' },
    config: {
      likeEvents: [{ enabled: true, threshold: 10, commandFile: 'cod.txt', repeat: 1 }],
      mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }],
    },
    // BridgeMOD のいいねの待ちがいっぱい（429）で、BRIDGE にいいねが溜まっている状態。
    respond: (payload, url) => url === '/bridge/control' ? 200 : payload.type === 'like' && likesRejected ? 429 : 202,
  });
  // 失敗したときも、いいねの送り直しが終わってから片付ける（BRIDGE の送り直しは止まらないので、受け付けに戻す）。
  try {
  await bridge.emit('WebcastLikeMessage', { count: 30, total: '30' });
  await bridge.until(() => bridge.requests.some(x => x.type === 'like'), 'likes are being retried');

  bridge.connection().emit('streamEnd', {});
  await bridge.until(() => bridge.requests.some(x => x.action === 'discard'), 'BridgeMOD is told to discard likes');
  assert.deepEqual(bridge.requests.find(x => x.action === 'discard'), { action: 'discard', type: 'like' });
  await bridge.until(() => bridge.logs.some(line => line.includes('配信が終わったので、まだ実行していないいいね分を捨てました')), 'log');

  // 捨てたいいねは、BridgeMOD が受け付けるようになっても送り直さない（再送の待ちは最長3秒）。
  const likeTries = bridge.requests.filter(x => x.type === 'like').length;
  likesRejected = false;
  await bridge.wait(3300);
  assert.equal(bridge.requests.filter(x => x.type === 'like').length, likeTries);

  await bridge.emit('WebcastGiftMessage', { giftId: '5655', gift: { name: 'バラ', diamondCount: 1 }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.type === 'gift' && x.key === 'zombie'), 'gift still delivered');
  } finally {
    if (likesRejected) { likesRejected = false; await bridge.wait(3300); }
  }
});

test('BRIDGE は配信終了で、いいねのまとめ送り・送信の待ち・BridgeMOD の待ちの3か所を捨てる', () => {
  const source = read('bridge/index.js');
  const handler = source.slice(source.indexOf('onTikTok("streamEnd"'), source.indexOf('onTikTok("like"'));
  assert.match(handler, /const inBridge = queueLikeEventBatched\.discard\(\) \+ modDelivery\.discard\("like"\);/);
  assert.match(handler, /sendBridgeModControl\(bridgeMod, \{ action: "discard", type: "like" \}\)/);
});

test('BridgeMOD 1.7.5 は /bridge/control でいいねの待ちを捨てる（トークンで確かめる）', () => {
  const mod = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java');
  assert.match(mod, /bridgeServer\.createContext\("\/bridge\/control", exchange -> \{ if \(authorize\(exchange\)\) handleBridgeControl\(exchange\); \}\);/);
  const control = mod.slice(mod.indexOf('private void handleBridgeControl('), mod.indexOf('private void handleBridgeStatus('));
  assert.match(control, /if \(!"discard"\.equals\(action\) \|\| !"like"\.equals\(type\)\)/, 'いいね以外は捨てない');
  assert.match(control, /"\{\\"ok\\":true,\\"discarded\\":" \+ discarded \+ "\}"/);
  // 実行中のいいねは残りを0にして止める。捨てたあとに来た新しいいいねを、取り出しで消さない。
  assert.match(mod, /private synchronized int discardLikeQueue\(\) \{\s*int discarded = likeQueue\.size\(\);\s*for \(BridgeEvent event : likeQueue\) event\.remaining = 0;\s*likeQueue\.clear\(\);\s*return discarded;\s*\}/);
  assert.match(mod, /if \(queue\.peekFirst\(\) == event\) queue\.pollFirst\(\);/);
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.7\.5\r?$/m);
});
