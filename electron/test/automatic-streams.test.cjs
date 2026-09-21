const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createAutomaticRecorder, createStreamSessions, streamBuckets } = require('../stream_sessions.cjs');
const { computeStreamStats } = require('../stream_statistics.cjs');
const { statsMarkdown, exportStreamStatsMarkdown } = require('../stats_export.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-stream-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'sessions.json'); let now = Date.parse('2026-09-21T01:00:00Z');
  const recorder = () => createAutomaticRecorder(() => file, () => now);
  const read = () => createStreamSessions(() => file).read();
  return { file, recorder, read, tick: ms => now += ms, now: () => now, stats: (rows = [], viewerMetrics = []) => computeStreamStats({ rows, sessions: read(), viewerMetrics, nowMs: now }) };
}
test('automatic: empty broadcasts remain separate, duplicate connect is idempotent, real end is terminal', t => {
  const f = fixture(t), r = f.recorder(); const one = r.connect('USER', '100');
  assert.equal(r.connect('user', '100').id, one.id);
  f.tick(60000); r.end('live-ended'); r.connect('user', '100'); assert.equal(r.activeId(), null);
  f.tick(1000); const two = r.connect('user', '200'); assert.notEqual(one.id, two.id);
  f.tick(30000); r.end('live-ended');
  const stats = f.stats(); assert.equal(stats.streams.length, 2); assert.equal(stats.overall.events, 0);
  assert.deepEqual(stats.streams.map(s => s.durationMs), [30000, 60000]);
});
test('automatic: reconnect uses the same broadcast but excludes disconnected minutes and samples', t => {
  const f = fixture(t), r = f.recorder(); const start = f.now(), one = r.connect('user', '100');
  f.tick(60000); r.end('connection-lost'); f.tick(120000); assert.equal(r.connect('user', '100').id, one.id);
  f.tick(60000); r.end('live-ended');
  const stats = f.stats([], [{ t: start + 30000, viewers: 10 }, { t: start + 90000, viewers: 999 }, { t: start + 200000, viewers: 20 }]);
  assert.equal(stats.streams.length, 1); assert.equal(stats.streams[0].durationMs, 120000);
  assert.equal(stats.monthly.totalDurationMs, 120000); assert.equal(stats.streams[0].maxViewers, 20); assert.equal(stats.streams[0].avgViewers, 15);
});
test('automatic: crash caps stale time at heartbeat and a restarted process reopens the same room', t => {
  const f = fixture(t), r = f.recorder(); const one = r.connect('user', '100');
  f.tick(15000); r.heartbeat(); f.tick(600000);
  const stale = f.stats().streams[0]; assert.equal(stale.active, false); assert.equal(stale.durationMs, 15000);
  const restarted = f.recorder(); assert.equal(restarted.connect('user', '100').id, one.id);
  f.tick(15000); restarted.end('monitoring-stopped');
  assert.equal(f.stats().streams[0].durationMs, 30000);
});
test('automatic: events after the latest heartbeat belong to the active broadcast; tests are excluded', t => {
  const f = fixture(t), r = f.recorder(); r.connect('user', '100'); f.tick(1000);
  const at = new Date(f.now()).toISOString(); f.tick(1000);
  const stats = f.stats([{ at, source: 'gift', type: 'gift', commandFile: 'zombie.txt', sender: 'user', count: 50, diamond: 1, ok: true }, { at, source: 'test', count: 100, ok: true }]);
  assert.equal(stats.streams.length, 1); assert.equal(stats.streams[0].gift, 50); assert.equal(stats.overall.events, 1);
  assert.equal(stats.streams[0].diamonds, undefined); // Command repeats must never be reported as gift coin revenue.
});
test('automatic: missing room and corrupted sessions never overwrite existing records', t => {
  const f = fixture(t), r = f.recorder(); assert.throws(() => r.connect('user', ''), /配信ID/);
  fs.writeFileSync(f.file, '{bad'); assert.throws(() => r.connect('user', '100')); assert.equal(fs.readFileSync(f.file, 'utf8'), '{bad'); assert.equal(r.activeId(), null);
});
test('Markdown: per-broadcast rows, units, coverage and escaped untrusted names are explicit', async t => {
  const f = fixture(t), r = f.recorder(); const one = r.connect('user', '100'); f.tick(1000);
  const stats = f.stats([{ at: new Date(f.now()).toISOString(), type: 'gift', count: 10, ok: true, sender: '<script>|line\nbreak', commandFile: 'tnt.txt' }]);
  const text = statsMarkdown(stats, one.id);
  assert.match(text, /# 配信統計/); assert.match(text, /実際のいいね数/); assert.match(text, /コマンド要求回数/); assert.match(text, /&lt;script&gt;&#124;line break/); assert.doesNotMatch(text, /<script>/);
  assert.throws(() => statsMarkdown(stats, 'missing'), /見つかりません/);
  const canceled = await exportStreamStatsMarkdown({ stats, dialog: { showSaveDialog: async () => ({ canceled: true }) }, write: () => { throw new Error('must not write'); } }); assert.equal(canceled.canceled, true);
  const file = path.join(path.dirname(f.file), '分析.md');
  await exportStreamStatsMarkdown({ stats, streamId: one.id, dialog: { showSaveDialog: async () => ({ filePath: file, canceled: false }) } });
  assert.match(fs.readFileSync(file, 'utf8'), new RegExp(one.id));
  await assert.rejects(exportStreamStatsMarkdown({ stats, dialog: { showSaveDialog: async () => ({ filePath: file, canceled: false }) }, write: () => { throw new Error('disk full'); } }), /disk full/);
});
