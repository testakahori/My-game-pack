const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { planTestEvent } = require('../event_tests.cjs');
const { likeRuleProgress, matchingCommentRules, deathRouletteMatches } = require('../../bridge/event_rules.cjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'event-rules-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'qa.txt'), '# TITLE: 確認\nsay TEST\n');
  fs.writeFileSync(path.join(dir, 'roulette.txt'), '# virtual\n');
  const rule = { enabled: true, commandFile: 'qa.txt', repeat: 2 };
  const config = { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'qa.txt', repeat: 3 }],
    likeEvents: [{ ...rule, threshold: 100 }], shareEvent: rule, memberEvent: rule, followEvent: rule, unmappedGiftEvent: rule,
    commentGifts: { enabled: true, rules: [{ ...rule, match: 'ありがとう', sound: 'entity.player.levelup', particle: 'minecraft:heart' }] },
    roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: '日本語', repeat: 4 }] },
    deathRoulette: { enabled: true, everyDeaths: 3, items: [{ commandFile: 'qa.txt', repeat: 5 }] },
    options: { maxLikeCatchUpPerEvent: 2, gameplay: { combo: { levels: [{ count: 6, commandFile: 'qa.txt' }] },
      likeMilestones: [{ threshold: 300, commandFile: 'qa.txt' }], followMilestones: [{ threshold: 5, commandFile: 'qa.txt' }],
      commentCommands: { '!heal': 'qa.txt' }, poll: { enabled: true, options: { '1': 'qa.txt' } } } } };
  const plan = input => planTestEvent(config, { listenerName: '検証', ...input }, dir);
  return { dir, config, plan };
}
test('全イベント: 保存済みルール・回数・追加演出・当選設定を使う', t => {
  const { plan } = fixture(t);
  for (const type of ['share','member','follow','unmapped_gift']) assert.equal(plan({ type }).steps[0].count, 2, type);
  assert.equal(plan({ type:'gift', commandFile:'qa.txt', count:7 }).steps[0].count,7);
  assert.equal(plan({ type:'mapped_gift', giftId:'1', count:1 }).steps.at(-1).count,3);
  const comment = plan({ type:'comment', comment:'どうもありがとう！' });
  assert.equal(comment.steps.length,1); assert.equal(comment.steps[0].extras.length,2);
  assert.equal(plan({ type:'death', deaths:3 }).steps[0].roulette.items[0].repeat,5);
  assert.equal(plan({ type:'roulette' }).steps[0].roulette.items[0].repeat,4);
  for (const input of [{type:'combo', giftId:'1', count:2}, {type:'like_milestone',likeCount:300},
    {type:'follow_milestone', followCount:5}, {type:'comment_command',comment:'!heal'}, {type:'poll',pollOption:'1'}]) assert.equal(plan(input).steps.length,1,input.type);
});
test('無効・条件未達・ミュート・不明な種類を成功発火扱いにしない', t => {
  const { plan, config } = fixture(t);
  assert.equal(plan({type:'death',deaths:2}).steps.length,0);
  assert.equal(plan({type:'like',likeCount:99}).steps.length,0);
  assert.equal(plan({type:'comment',comment:'おはよう'}).steps.length,0);
  assert.equal(plan({type:'unmapped_gift',giftId:'1'}).steps.length,0);
  config.shareEvent = { ...config.shareEvent, enabled:false };
  assert.equal(plan({type:'share'}).steps.length,0);
  config.options.mutedUsers=['検証']; assert.equal(plan({type:'member'}).steps.length,0);
  assert.throws(()=>plan({type:'made_up'}),/対応していない/);
});
test('いいね: 前後の累計・追いつき上限・到達済みマイルストーンを判定', t => {
  const { plan } = fixture(t);
  const result = plan({type:'like',previousLikes:300,likeCount:900});
  assert.equal(result.steps.length,1); assert.equal(result.steps[0].count,4);
  assert.match(result.notes.join(''),/4回省略/);
  assert.throws(()=>plan({type:'like',previousLikes:100,likeCount:1}),/前回以上/);
  assert.equal(likeRuleProgress({threshold:100},1000,undefined).triggersToRun,0);
});
test('共有判定: コメント複数一致と死亡の境界', () => {
  const rules=[{commandFile:'a.txt',match:'あり'}, {commandFile:'b.txt',match:'ありがとう'}, {enabled:false,commandFile:'c.txt',match:'あり'}];
  assert.equal(matchingCommentRules({enabled:true,rules},'ありがとう').length,2);
  assert.equal(matchingCommentRules({enabled:false,rules},'ありがとう').length,0);
  assert.equal(deathRouletteMatches({enabled:true,everyDeaths:3},0),false);
  assert.equal(deathRouletteMatches({enabled:true,everyDeaths:3},6),true);
});
test('不正入力・パス脱出・存在しないコマンドを送信前に拒否', t => {
  const { plan } = fixture(t);
  for (const commandFile of ['../secret','C:\\secret','x/y','a:b','']) assert.throws(()=>plan({type:'gift',commandFile}),/ファイル名/);
  assert.throws(()=>plan({type:'gift',commandFile:'missing'}),/見つかりません/);
  for (const likeCount of [NaN, Infinity, -1, 1.5, 1000001]) assert.throws(()=>plan({type:'like',likeCount}),/整数/);
});
