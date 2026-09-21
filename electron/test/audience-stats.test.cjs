const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAudienceRecorder, readAudienceStats } = require('../../bridge/audience_stats.cjs');
const { computeStreamStats } = require('../stream_statistics.cjs');
const { saveEarnings, readEarnings } = require('../stream_earnings.cjs');
const { statsMarkdown } = require('../stats_export.cjs');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audience-stats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = Date.parse('2026-09-22T10:00:00Z');
  const file = path.join(dir, 'audience.json');
  const recorder = () => createAudienceRecorder(() => file, () => time);
  const r = recorder();
  return { dir, file, r, recorder, tick: ms => time += ms, now: () => time,
    rows: () => { r.flush(); return readAudienceStats(file); },
    connect: id => r.connect({ id, roomId: id, username: 'fixture' }) };
}
const gift = (msgId, repeatCount, repeatEnd = false, extra = {}) => ({ common: { msgId }, giftId: 'rose', gift: { name: 'バラ', diamondCount: 1, type: 1 }, user: { id: 'u1' }, repeatCount, repeatEnd, ...extra });
test('received gifts: streak increments, duplicate end, new streak and unknown unit prices', t => {
  const f = fixture(t); f.connect('one');
  f.r.receive('gift', gift('1', 1)); f.r.receive('gift', gift('2', 3)); f.r.receive('gift', gift('3', 3, true));
  f.r.receive('gift', gift('3', 3, true));
  f.r.receive('gift', gift('4', 1)); f.r.receive('gift', gift('5', 1, true));
  f.r.receive('gift', gift('6', 2, true, { giftId: 'unknown', gift: { name: '単価不明' } }));
  const row = f.rows()[0]; assert.equal(row.gifts, 6); assert.equal(row.coins, 4); assert.equal(row.unknownCoinGifts, 2);
  assert.deepEqual(row.giftBreakdown.map(g => g.count), [4, 2]);
});
test('received gifts: normal gifts do not turn into streaks and grouped out-of-order packets do not add', t => {
  const f = fixture(t); f.connect('one');
  const normal = { gift: { name: '通常ギフト', diamondCount: 10, type: 0 } };
  f.r.receive('gift', gift('1', 1, false, normal)); f.r.receive('gift', gift('2', 1, false, normal));
  f.r.receive('gift', gift('3', 5, false, { groupId: 'A' })); f.r.receive('gift', gift('4', 3, false, { groupId: 'A' }));
  f.r.receive('gift', gift('5', 5, true, { groupId: 'A' })); f.r.receive('gift', gift('6', 5, true, { groupId: 'A' }));
  assert.equal(f.rows()[0].gifts, 7); assert.equal(f.rows()[0].coins, 25);
});
test('likes: count/total, duplicate and out-of-order packets, no imported pre-join or disconnected likes', t => {
  const f = fixture(t); f.connect('one');
  f.r.receive('like', { msgId: '1', count: 100, total: '5000' });
  f.r.receive('like', { msgId: '2', count: 5, total: '5010' });
  f.r.receive('like', { msgId: '2', count: 5, total: '5010' });
  f.r.receive('like', { msgId: 'old', count: 500, total: '4000' });
  f.r.end(); f.tick(60000); f.connect('one');
  f.r.receive('like', { msgId: '3', count: 10, total: '6010' });
  assert.equal(f.rows()[0].likes, 120);
});
test('restarts retain dedupe and streak baseline; different broadcasts are separate and no activity records zero', t => {
  const f = fixture(t); f.connect('one'); f.r.receive('gift', gift('1', 3, false, { groupId: 'A' })); f.r.end();
  const r = f.recorder(); r.connect({ id: 'one', roomId: 'one' }); r.receive('gift', gift('1', 3, false, { groupId: 'A' }));
  r.receive('gift', gift('2', 5, true, { groupId: 'A' })); r.end();
  f.connect('two'); const rows = f.rows(); assert.equal(rows.length, 2); assert.equal(rows[0].gifts, 5); assert.equal(rows[1].gifts, 0);
});
test('all received notifications and zero viewers are recorded without any command configuration', t => {
  const f = fixture(t); f.connect('one');
  for (const type of ['chat', 'follow', 'share', 'member']) { f.r.receive(type, { msgId: type }); f.r.receive(type, { msgId: type }); }
  f.r.receive('roomUser', { total: 0 }); f.tick(60000); f.r.receive('roomUser', { total: 20 });
  const row = f.rows()[0]; for (const field of ['comments', 'follows', 'shares', 'visits']) assert.equal(row[field], 1);
  assert.equal(row.viewerSamples, 2); assert.equal(row.viewerSum, 20); assert.equal(row.maxViewers, 20);
});
test('corrupted or unsupported statistics fail without overwriting them', t => {
  const f = fixture(t); fs.writeFileSync(f.file, '{bad'); assert.throws(() => f.connect('one'));
  f.r.receive('gift', gift('1', 1)); f.r.flush(); assert.equal(fs.readFileSync(f.file, 'utf8'), '{bad');
  fs.writeFileSync(f.file, '{"version":100,"streams":[]}'); assert.throws(() => f.connect('one'), /形式/);
});
test('history beyond 30 days survives; raw gifts differ from multiplied commands; comparisons exclude missing metrics', t => {
  const f = fixture(t); f.connect('one'); f.r.receive('gift', gift('1', 3, true));
  const end = f.now() + 3600000;
  const sessions = [{ id: 'one', source: 'automatic', startedAt: new Date(f.now()).toISOString(), endedAt: new Date(end).toISOString() },
    { id: 'previous', startedAt: new Date(f.now() - 8 * 86400000).toISOString(), endedAt: new Date(f.now() - 8 * 86400000 + 1000).toISOString() },
    { id: 'old', startedAt: '2026-01-01T01:00:00Z', endedAt: '2026-01-01T02:00:00Z' }];
  const stats = computeStreamStats({ sessions, audience: f.rows(), rows: [{ at: new Date(f.now() + 1000).toISOString(), type: 'gift', count: 300, ok: true }], nowMs: end });
  assert.equal(stats.streams.length, 3); assert.equal(stats.streams[0].gift, 300); assert.equal(stats.streams[0].received.gifts, 3);
  assert.equal(stats.streams[2].received, null); assert.equal(stats.comparisons[0].current.coinsPerHour, 3);
  assert.equal(stats.comparisons[0].previous.gifts, null); assert.equal(stats.comparisons[0].previous.trackedStreams, 0);
  const md = statsMarkdown(stats); assert.match(md, /受信ギフト個数/); assert.match(md, /7日比較/); assert.match(md, /未取得/); assert.match(md, /固定換算はしません/);
});
test('confirmed earnings preserve zero vs missing, reject invalid values and clear only the selected broadcast', t => {
  const f = fixture(t), file = path.join(f.dir, 'earnings.json'), sessions = [{ id: 'one' }, { id: 'two' }];
  for (const invalid of [-1, NaN, Infinity, 0.001, '123', 1e10]) assert.throws(() => saveEarnings(file, sessions, 'one', invalid));
  assert.throws(() => saveEarnings(file, sessions, 'missing', 10));
  saveEarnings(file, sessions, 'one', 0); saveEarnings(file, sessions, 'two', 123.45);
  assert.deepEqual(readEarnings(file).map(row => row.amount), [0, 123.45]);
  saveEarnings(file, sessions, 'one', null); assert.deepEqual(readEarnings(file).map(row => row.amount), [123.45]);
});
