// いいね・コメント・死亡の判定（bridge/event_rules.cjs）。テスト発火の入力の変換は test-fire-actions.test.cjs、本番と同じかは test-fire-parity.test.cjs で確かめる（2026-10-16）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { likeRuleProgress, matchingCommentRules, deathRouletteMatches } = require('../../bridge/event_rules.cjs');

test('共有判定: コメント複数一致と死亡の境界', () => {
  const rules=[{commandFile:'a.txt',match:'あり'}, {commandFile:'b.txt',match:'ありがとう'}, {enabled:false,commandFile:'c.txt',match:'あり'}];
  assert.equal(matchingCommentRules({enabled:true,rules},'ありがとう').length,2);
  assert.equal(matchingCommentRules({enabled:false,rules},'ありがとう').length,0);
  assert.equal(deathRouletteMatches({enabled:true,everyDeaths:3},0),false);
  assert.equal(deathRouletteMatches({enabled:true,everyDeaths:3},6),true);
  assert.equal(likeRuleProgress({threshold:100},1000,undefined).triggersToRun,0);
});

// 「何回死ぬごと」が設定に無いときは 3（画面の表示に合わせる。2026-10-23 ユーザーの決定。処理のコピー PR9）。前は BRIDGE が 1（毎回）として回していた。
test('死亡: everyDeaths が無ければ3回死ぬごと', () => {
  assert.deepEqual([1, 2, 3, 6].map(n => deathRouletteMatches({ enabled: true }, n)), [false, false, true, true]);
});
