// BRIDGE の自動再起動の決め方（electron/restart_policy.cjs）。
// 前はウィンドウ（60秒）が待ち時間の合計（2+4+8+16+30秒）より短く、5回目の前に数え直していた。
// 起動して 0.5 秒で落ちる BRIDGE が、いつまでも再起動を続けていた（2026-11-07 品質レビュー）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { RestartPolicy } = require('../restart_policy.cjs');

// 時計を進められる RestartPolicy。crashAfter ミリ秒動いて落ち、決められた待ち時間のあとに起動し直す、を繰り返す。
function crashLoop(policy, clock, crashAfter, times) {
  const answers = [], delays = [];
  for (let i = 0; i < times; i++) {
    policy.spawned();
    clock.t += crashAfter;
    const restart = policy.shouldRestart();
    answers.push(restart);
    if (!restart) break;
    const delay = policy.nextDelayMs();
    delays.push(delay);
    clock.t += delay;
  }
  return { answers, delays };
}

test('自動再起動: 起動して 0.5 秒で落ちるのが3回続いたら、再起動をやめて上限に達したことにする', () => {
  const clock = { t: 1_000_000 };
  const policy = new RestartPolicy({ now: () => clock.t });
  policy.start();
  const { answers } = crashLoop(policy, clock, 500, 10);
  assert.deepEqual(answers, [true, true, false], '最初の起動のあと、自動再起動は2回まで');
  assert.equal(policy.exhausted(), true);
  assert.equal(policy.status(null).restartExhausted, true);
  assert.equal(policy.shouldRestart(), false, '上限のあとは再起動しない');
});

test('自動再起動: しばらく動いてから落ちるのを繰り返しても、10分の中で5回再起動したら、6回目は再起動しない（待ちは 2・4・8・16・30 秒）', () => {
  const clock = { t: 1_000_000 };
  const policy = new RestartPolicy({ now: () => clock.t });
  policy.start();
  const { answers, delays } = crashLoop(policy, clock, 10_000, 10);
  assert.deepEqual(answers, [true, true, true, true, true, false]);
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 30000]);
  assert.equal(policy.exhausted(), true);
  assert.equal(policy.restartCount, 5);
});

test('自動再起動: 間をあけて落ちる（15分に1回）なら上限にならず、待ちはいつも 2 秒', () => {
  const clock = { t: 1_000_000 };
  const policy = new RestartPolicy({ now: () => clock.t });
  policy.start();
  const { answers, delays } = crashLoop(policy, clock, 15 * 60_000, 20);
  assert.equal(answers.length, 20);
  assert.ok(answers.every(Boolean));
  assert.ok(delays.every(delay => delay === 2000));
  assert.equal(policy.exhausted(), false);
});

test('自動再起動: すぐ落ちた回数は、しばらく動けたら数え直す', () => {
  const clock = { t: 1_000_000 };
  const policy = new RestartPolicy({ now: () => clock.t, windowMs: 1000 });
  policy.start();
  const crash = after => { policy.spawned(); clock.t += after; const restart = policy.shouldRestart(); clock.t += 60_000; return restart; };
  assert.deepEqual([crash(500), crash(500), crash(30_000), crash(500), crash(500)], [true, true, true, true, true]);
  assert.equal(crash(500), false, '続けて3回目で止める');
});

test('自動再起動: 手で止めたら再起動せず上限の印も出さない。手で起動し直すと数え直す', () => {
  const clock = { t: 1_000_000 };
  const policy = new RestartPolicy({ now: () => clock.t });
  assert.equal(policy.shouldRestart(), false, '起動する前は再起動しない');
  policy.start();
  crashLoop(policy, clock, 500, 10);
  assert.equal(policy.exhausted(), true);
  policy.requestStop();
  assert.equal(policy.exhausted(), false);
  assert.equal(policy.status(null).restartExhausted, false);
  policy.start();
  assert.equal(policy.exhausted(), false);
  assert.equal(policy.restartCount, 0);
  assert.deepEqual(crashLoop(policy, clock, 500, 10).answers, [true, true, false], '数え直してから、また3回目で止める');
  assert.deepEqual(policy.status(4321), { running: true, pid: 4321, stopRequested: false, restartCount: 2, restartExhausted: true });
});
