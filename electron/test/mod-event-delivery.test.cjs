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
  assert.ok([...retried, ...accepted].every(e => e.requestId === e.eventId), 'ゲームまで伝える要求番号は再送中も同一');
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


test('ゲーム要求は150個でも1件のまま、再送中も元のゲーム番号・引数・名前を保持する', async () => {
  const { captureGameEvent } = require('../../bridge/mod_event_delivery.cjs');
  let sessions = { gamemod: { sessionId: 'round-1' } };
  const args = { strength: 7, color: 'red' }, attempts = [], accepted = [];
  let release, blocked;
  const waiting = new Promise(resolve => { blocked = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let retry = true;
  const delivery = createModEventDelivery({
    prepare: event => captureGameEvent(event, 'gamemod', sessions),
    send: async event => { attempts.push(event); if (retry) { retry = false; throw Error('429'); } accepted.push(event); },
    sleep: async () => { blocked(); await gate; },
  });
  const first = delivery.enqueue({ type: 'gift', commandFile: 'tower.txt', count: 150, listenerName: 'A', args });
  await waiting;
  args.color = 'blue'; sessions = { gamemod: { sessionId: 'round-2' } };
  const second = delivery.enqueue({ type: 'gift', commandFile: 'tower.txt', count: 2, listenerName: 'B' });
  release(); await Promise.all([first, second]);
  assert.deepEqual(accepted.map(e => [e.count, e.listenerName, e.gameSessionId]), [[150, 'A', 'round-1'], [2, 'B', 'round-2']]);
  assert.equal(accepted[0].args.color, 'red');
  assert.equal(attempts[0].requestId, attempts[1].requestId);
  assert.notEqual(accepted[0].requestId, accepted[1].requestId);
  await assert.rejects(delivery.enqueue({ count: 100001 }), /Invalid event count/);
  await assert.rejects(delivery.enqueue({ args: { nested: {} } }), /Invalid game argument/);
});

test('同じユーザーのゲーム向けいいねも別要求のまま保持し、待機中にゲーム番号を書き換えない', async () => {
  const { captureGameEvent } = require('../../bridge/mod_event_delivery.cjs');
  let sessions = { gamemod: { sessionId: 'round-1' } }, flush;
  const sent = [], jobs = [];
  const delivery = createModEventDelivery({ send: async event => { sent.push(event); } });
  const batch = createLikeBatcher({ dispatch: event => jobs.push(delivery.enqueue(event)), windowMs: 100,
    schedule: fn => { flush = fn; return 1; },
    prepare: event => captureGameEvent(event, event.commandFile === 'tower.txt' ? 'gamemod' : null, sessions) });
  batch('tower.txt', 6, 'A', true, 3);
  sessions = { gamemod: { sessionId: 'round-2' } };
  batch('tower.txt', 2, 'A', true);
  batch('cod.txt', 5, 'A', false); batch('cod.txt', 7, 'A', false);
  flush(); await Promise.all(jobs);
  assert.equal(new Set(sent.map(e => e.requestId)).size, sent.length);
  assert.deepEqual(sent.map(e => [e.count, e.gameSessionId]), [[2,'round-1'],[2,'round-1'],[2,'round-1'],[2,'round-2'],[12,undefined]]);
});
