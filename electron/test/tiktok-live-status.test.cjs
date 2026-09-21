const test = require('node:test');
const assert = require('node:assert/strict');
const { createLiveStatusChecker } = require('../tiktok_live_status.cjs');

test('live status: checks the account independently from Bridge, caches and updates after expiry', async () => {
  let time = 0, calls = 0, live = true;
  const check = createLiveStatusChecker({ now: () => time, query: async username => { calls++; assert.equal(username, 'streamer'); return { live }; } });
  assert.equal((await check('@Streamer')).state, 'live');
  live = false; time = 10000;
  assert.equal((await check('streamer')).state, 'live'); assert.equal(calls, 1);
  time = 30001;
  assert.equal((await check('streamer')).state, 'offline'); assert.equal(calls, 2);
});

test('live status: connection failures and invalid responses never become offline or connected', async () => {
  for (const query of [async () => { throw new Error('network'); }, async () => ({ live: 'true' }), async () => ({})]) {
    assert.equal((await createLiveStatusChecker({ query })('streamer')).state, 'error');
  }
});

test('live status: account changes remain independent and simultaneous requests are coalesced', async () => {
  let calls = 0, finish;
  const check = createLiveStatusChecker({ query: id => { calls++; return id === 'first' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ live: false }); } });
  const one = check('first'), two = check('first');
  assert.equal((await check('second')).state, 'offline');
  finish({ live: true });
  assert.equal((await one).username, 'first'); assert.deepEqual(await one, await two); assert.equal(calls, 2);
});

test('live status: empty or invalid IDs do not start a network request', async () => {
  const check = createLiveStatusChecker({ query: () => { throw new Error('must not query'); } });
  assert.equal((await check('')).state, 'empty');
  for (const value of ['https://tiktok.com/@user', '--argument', 'x'.repeat(25)]) assert.equal((await check(value)).state, 'error');
});
