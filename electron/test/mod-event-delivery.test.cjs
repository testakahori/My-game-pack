const test = require('node:test');
const assert = require('node:assert/strict');
const { createModEventDelivery, createLikeBatcher } = require('../../bridge/mod_event_delivery.cjs');

test('混雑したいいねを待たせてもギフトはFIFOで送信し、回数を欠落させない', async () => {
  let release, blocked;
  const sleeping = new Promise(resolve => { blocked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const attempts = [], accepted = [];
  let failures = 8;
  const delivery = createModEventDelivery({
    send: async event => {
      attempts.push(event);
      if (event.type === 'like' && failures-- > 0) throw new Error('HTTP 429');
      accepted.push(event);
    },
    sleep: async () => { blocked(); await gate; },
    // Diagnostic errors must not make an event disappear either.
    retry: () => { throw new Error('log failure'); },
    delivered: () => { throw new Error('history failure'); },
  });
  const likes = [delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 257, listenerName: 'A' }),
    delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 2, listenerName: 'B' })];
  await sleeping;
  await Promise.all(['first', 'second', 'third'].map(listenerName => delivery.enqueue({ type: 'gift', count: 1, listenerName })));
  assert.deepEqual(accepted.map(e => e.listenerName), ['first', 'second', 'third']);
  assert.deepEqual(delivery.pending(), { like: 259, gift: 0, other: 0 });
  release(); await Promise.all(likes);
  assert.deepEqual(accepted.filter(e => e.type === 'like').map(e => [e.listenerName, e.count]), [['A', 100], ['A', 100], ['A', 57], ['B', 2]]);
  const retried = attempts.filter(e => e.type === 'like').slice(0, 9);
  assert.equal(new Set(retried.map(e => e.eventId)).size, 1, '応答がなくても同じ受付IDで再送');
  assert.equal(new Set(accepted.map(e => e.eventId)).size, accepted.length, '別の発火は別ID');
  assert.deepEqual(delivery.pending(), { like: 0, gift: 0, other: 0 });
});

test('いいねのまとめ送りは回数・送信者・コマンド順序を維持する', () => {
  let flush;
  const sent = [];
  const batch = createLikeBatcher({ dispatch: event => sent.push(event), windowMs: 100, schedule: fn => { flush = fn; return 1; } });
  batch('cod.txt', 80, 'A', true); batch('cod.txt', 70, 'A', true);
  batch('zombie.txt', 1, 'A', true); batch('cod.txt', 1, 'B', true); batch('cod.txt', 1, 'A', false);
  flush();
  assert.deepEqual(sent.map(e => [e.commandFile, e.count, e.listenerName, e.announce]), [
    ['cod.txt', 150, 'A', true], ['zombie.txt', 1, 'A', true], ['cod.txt', 1, 'B', true], ['cod.txt', 1, 'A', false],
  ]);
});
