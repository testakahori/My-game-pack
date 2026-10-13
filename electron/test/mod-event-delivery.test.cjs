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

test('MODが400で拒否したギフトは再送せずに記録し、後ろのギフトを止めない', async () => {
  const sent = [], rejected = [], retried = [];
  const delivery = createModEventDelivery({
    send: async event => {
      sent.push(event);
      if (event.commandFile === 'broken.txt') throw Object.assign(new Error('BridgeMod HTTP 400'), { status: 400 });
    },
    retry: (event, error) => retried.push(error.status),
    rejected: (event, error) => rejected.push([event.commandFile, event.count, error.status]),
    sleep: async () => { throw new Error('a permanent failure must not wait for a retry'); },
  });
  const results = await Promise.allSettled(['broken.txt', 'zombie.txt', 'cod.txt'].map((commandFile, i) =>
    delivery.enqueue({ type: 'gift', commandFile, count: i + 1, listenerName: 'A' })));
  assert.deepEqual(results.map(r => r.status), ['rejected', 'fulfilled', 'fulfilled']);
  assert.deepEqual(sent.map(e => e.commandFile), ['broken.txt', 'zombie.txt', 'cod.txt'], '400は1回だけ送る');
  assert.deepEqual(rejected, [['broken.txt', 1, 400]]);
  assert.deepEqual(retried, []);
  assert.deepEqual(delivery.pending(), { like: 0, gift: 0, other: 0 });
});

test('429・5xx・接続失敗は従来どおり届くまで再送する', async () => {
  const failures = [Object.assign(new Error('HTTP 429'), { status: 429 }), Object.assign(new Error('HTTP 503'), { status: 503 }), new Error('ECONNREFUSED')];
  const rejected = [], accepted = [];
  const delivery = createModEventDelivery({
    send: async event => { const error = failures.shift(); if (error) throw error; accepted.push(event); },
    rejected: (...args) => rejected.push(args), sleep: async () => {},
  });
  await delivery.enqueue({ type: 'gift', commandFile: 'zombie.txt', count: 1 });
  assert.equal(accepted.length, 1);
  assert.deepEqual(rejected, []);
});

test('送る前に検査で弾いたイベントも記録する', async () => {
  const rejected = [];
  const delivery = createModEventDelivery({
    send: async () => assert.fail('must not send'),
    prepare: event => { if (event.commandFile === 'ネコ.txt') throw Object.assign(new Error('bad name'), { permanent: true }); return event; },
    rejected: (event, error) => rejected.push([event.commandFile, error.message]),
  });
  await assert.rejects(delivery.enqueue({ type: 'gift', commandFile: 'ネコ.txt' }), /bad name/);
  await assert.rejects(delivery.enqueue({ type: 'gift', commandFile: 'cod.txt', count: 0 }), /Invalid event count/);
  assert.deepEqual(rejected, [['ネコ.txt', 'bad name'], ['cod.txt', 'Invalid event count']]);
});

test('いいねのまとめ送りで1件が例外を出しても、残りは送り、その1件を記録する', () => {
  let flush;
  const sent = [], failed = [];
  const batch = createLikeBatcher({ windowMs: 100, schedule: fn => { flush = fn; return 1; },
    dispatch: event => { if (event.commandFile === 'bad.txt') throw new Error('boom'); sent.push(event.commandFile); },
    failed: (event, error) => failed.push([event.commandFile, error.message]) });
  batch('cod.txt', 1, 'A', true); batch('bad.txt', 1, 'A', true); batch('zombie.txt', 1, 'A', true);
  assert.doesNotThrow(() => flush());
  assert.deepEqual(sent, ['cod.txt', 'zombie.txt']);
  assert.deepEqual(failed, [['bad.txt', 'boom']]);
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

test('再送のあいだ同じ要求には同じ状態を渡し、次の要求には新しい状態を渡す', async () => {
  // Bridge は 403 が同じ要求で2回続いたかをこの状態で数える（失敗の種類をまたいで数えない）。
  const states = [];
  let failures = 2;
  const delivery = createModEventDelivery({
    send: async () => { if (failures-- > 0) throw Object.assign(new Error('HTTP 503'), { status: 503 }); },
    retry: (_event, _error, _attempt, state) => states.push(state),
    sleep: async () => {},
  });
  await delivery.enqueue({ type: 'gift', commandFile: 'a.txt', count: 1 });
  failures = 1;
  await delivery.enqueue({ type: 'gift', commandFile: 'b.txt', count: 1 });
  assert.equal(states.length, 3);
  assert.equal(states[0], states[1]);
  assert.notEqual(states[1], states[2]);
});

test('いいねの待ちを捨てると、待っているいいねも再送を待っているいいねも送らず、ギフトはそのまま送る（2026-10-14）', async () => {
  const sent = [];
  let likeTries = 0, wake;
  const delivery = createModEventDelivery({
    send: async event => {
      if (event.type === 'like') { likeTries++; throw Object.assign(new Error('HTTP 429'), { status: 429 }); }
      sent.push(event);
    },
    sleep: () => new Promise(resolve => { wake = resolve; }),
  });
  const likes = [delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 3 }),
    delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 2 })];
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(likeTries, 1, '先頭のいいねは 429 で再送を待っている');
  assert.equal(delivery.discard('like'), 5, '捨てた回数を返す');
  wake();
  await Promise.all(likes);
  assert.equal(likeTries, 1, '捨てたあとは送り直さない');
  assert.deepEqual(delivery.pending(), { gift: 0, like: 0, other: 0 });
  await delivery.enqueue({ type: 'gift', commandFile: 'rose.txt', count: 1 });
  assert.deepEqual(sent.map(e => e.type), ['gift']);
});

test('いいねのまとめ送りで待っている分も捨てられ、そのあとのいいねは送る（2026-10-14）', () => {
  const dispatched = [];
  let fire;
  const batch = createLikeBatcher({ dispatch: event => dispatched.push(event), windowMs: 100, schedule: fn => { fire = fn; return 1; } });
  batch('cod.txt', 2, 'A', false);
  batch('cod.txt', 3, 'A', false);
  assert.equal(batch.discard(), 5);
  fire();
  assert.deepEqual(dispatched, [], '捨てた分は時間が来ても送らない');
  batch('cod.txt', 1, 'B', false);
  fire();
  assert.deepEqual(dispatched.map(event => [event.listenerName, event.count]), [['B', 1]]);
});

test('送信中のいいねは、捨てたあとに届いても送れた分として記録し、捨てた回数に数えない（PR #94 レビュー）', async () => {
  const delivered = [];
  let finish, likeCalls = 0;
  const delivery = createModEventDelivery({
    send: event => {
      if (event.type !== 'like') return Promise.resolve();
      likeCalls++;
      // 2回目（101〜200回目）の送信の途中で捨てる。
      return likeCalls === 2 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve();
    },
    delivered: event => delivered.push(event.count),
    sleep: async () => {},
  });
  const job = delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 250 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(likeCalls, 2);
  assert.equal(delivery.discard('like'), 50, '送信中の100回は数えない');
  assert.deepEqual(delivery.pending(), { gift: 0, like: 0, other: 0 }, '捨てた分は待ちに数えない');
  finish();
  await job;
  assert.equal(likeCalls, 2, '残りの50回は送らない');
  assert.deepEqual(delivered, [200], '送れた200回は記録する');
});

test('捨てたあとに来たいいねは、捨てた先頭がまだ残っていても送る。知らない種類を捨てても何もしない（PR #94 レビュー）', async () => {
  const sent = [];
  let wake;
  let rejectLikes = true;
  const delivery = createModEventDelivery({
    send: async event => {
      if (event.type === 'like' && rejectLikes) throw Object.assign(new Error('HTTP 429'), { status: 429 });
      sent.push([event.type, event.count]);
    },
    sleep: () => new Promise(resolve => { wake = resolve; }),
  });
  const old = delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivery.discard('like'), 4);
  const fresh = delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 2 });
  rejectLikes = false;
  wake();
  await Promise.all([old, fresh]);
  assert.deepEqual(sent, [['like', 2]], '捨てたあとに来た2回だけを送る');
  assert.equal(delivery.discard('unknown'), 0);
});

test('送信中に捨てたいいねが送れなかったときは、再送を待たずに次へ進む（PR #94 再レビュー）', async () => {
  let fail, sleeps = 0, retries = 0;
  const delivery = createModEventDelivery({
    send: event => event.type === 'like' ? new Promise((_, reject) => { fail = reject; }) : Promise.resolve(),
    retry: () => { retries++; },
    sleep: async () => { sleeps++; },
  });
  const job = delivery.enqueue({ type: 'like', commandFile: 'cod.txt', count: 3 });
  await new Promise(resolve => setImmediate(resolve));
  delivery.discard('like');
  fail(Object.assign(new Error('HTTP 429'), { status: 429 }));
  await job;
  assert.equal(sleeps, 0, '捨てたいいねの再送は待たない（いいねの列を最大3秒止めない）');
  assert.equal(retries, 0, '捨てたいいねの再送は診断にも出さない');
});
