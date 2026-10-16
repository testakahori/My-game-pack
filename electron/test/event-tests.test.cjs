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
