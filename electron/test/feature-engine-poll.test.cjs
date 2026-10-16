// コメント投票の締め切りを1つの関数（finishPoll）にする。時間切れでも、テスト発火（すぐ締め切る）でも同じ当選を出す（2026-10-16）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { FeatureEngine } = require('../../bridge/feature_engine.js');

const poll = { enabled: true, durationMs: 5000, options: { '1': 'a.txt', '2': { commandFile: 'b.txt', repeat: 3 } } };

test('すぐ締め切ると、票の多い選択肢を1回だけ出し、あとから時間切れでもう一度出さない', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted = [];
  const engine = new FeatureEngine({ poll }, feature => emitted.push(feature));
  engine.startPoll();
  engine.recordComment('!2', 'A');
  engine.finishPoll();
  assert.deepEqual(emitted, [{ type: 'poll', commandFile: 'b.txt', count: 3, sender: 'コメント投票', label: '!2' }]);
  t.mock.timers.tick(5000);
  assert.equal(emitted.length, 1, '時間切れでもう一度出さない');
  engine.finishPoll();
  assert.equal(emitted.length, 1, '締め切ったあとは何もしない');
});

test('時間切れでも同じ締め切りを通す（票がなければ最初の選択肢）', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted = [];
  const engine = new FeatureEngine({ poll }, feature => emitted.push(feature));
  engine.startPoll();
  t.mock.timers.tick(5000);
  assert.deepEqual(emitted, [{ type: 'poll', commandFile: 'a.txt', count: 1, sender: 'コメント投票', label: '!1' }]);
});
