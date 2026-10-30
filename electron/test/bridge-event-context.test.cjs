// 本番の処理（ギフト・いいね・シェア・フォロー・訪問・コメント・死亡）は、状態と送り先を ctx で受け取る。
// 本番は liveContext で、テスト発火は毎回新しい状態の ctx で同じ処理を通す（2026-10-16 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8').replace(/\r\n/g, '\n');
const body = name => {
  const start = source.indexOf(`function ${name}(ctx`);
  assert.ok(start >= 0, 'missing ' + name);
  return source.slice(start, source.indexOf('\n  }\n', start));
};
const HANDLERS = ['handleGift', 'handleLikeProgress', 'handleShare', 'handleFollow', 'handleMember', 'handleChat', 'handleDeath'];

test('本番の TikTok のイベントは、liveContext を渡して同じ処理を呼ぶ', () => {
  for (const [event, handler] of [['gift', 'handleGift'], ['share', 'handleShare'], ['follow', 'handleFollow'], ['member', 'handleMember'], ['chat', 'handleChat']]) {
    assert.match(source, new RegExp(`onTikTok\\("${event}", async \\(data\\) => ${handler}\\(liveContext, data\\)\\);`), event);
  }
  assert.match(source, /handleLikeProgress\(liveContext, data, progress\);/);
  assert.match(source, /onBridgeModWsMessage = \(status\) => handleDeath\(liveContext, status\);/);
  assert.match(source, /dispatch: event => dispatchBridgeEvent\(liveContext, "like:" \+ event\.commandFile, event\),/);
});

test('処理の中では、状態と送り先を ctx から使う（本番の状態を直接さわらない）', () => {
  for (const name of HANDLERS) {
    const text = body(name);
    assert.doesNotMatch(text, /(?<!ctx\.)\b(lastExecAt|streakLastCount|commentGiftLastAt)\b/, name + ': 記録は ctx から');
    assert.doesNotMatch(text, /isDuplicateEvent\(|queueLikeEventBatched\(|sendBridgeExec\(|recordDeliveryRejection\(/, name + ': 送り先は ctx から');
  }
  assert.doesNotMatch(source, /dispatchBridgeEvent\((?!ctx, |liveContext, )/, 'dispatchBridgeEvent には必ず ctx を渡す');
});
