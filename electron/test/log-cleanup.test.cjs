// ログファイルの整理（bridge/log_cleanup.cjs）。
// 前の BRIDGE は新しい 50 個だけを残していたので、起動してすぐ落ちる再起動の繰り返しで、最初に落ちたときのログと前の配信のログが消えていた（2026-11-07 品質レビュー）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pruneLogFiles } = require('../../bridge/log_cleanup.cjs');

const DAY = 24 * 60 * 60 * 1000;
// 時刻はこの PC の「今日」の正午（今日のログかは、この PC の日付で見る）。
const NOW = new Date(2026, 10, 7, 12, 0, 0).getTime();

function logsDir(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-cleanup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, at] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), 'log');
    fs.utimesSync(path.join(dir, name), new Date(at), new Date(at));
  }
  return dir;
}
const left = dir => fs.readdirSync(dir).sort();

test('ログの整理: 7日より古いものだけを消す。名前の頭が違うもの・.log でないものは消さない', t => {
  const dir = logsDir(t, {
    'bridge-today.log': NOW - 60_000,
    'bridge-6days.log': NOW - 6 * DAY,
    'bridge-8days.log': NOW - 8 * DAY,
    'main-8days.log': NOW - 8 * DAY,
    'bridge-notes.txt': NOW - 30 * DAY,
  });
  assert.deepEqual(pruneLogFiles(dir, { prefix: 'bridge-', now: NOW }), ['bridge-8days.log']);
  assert.deepEqual(left(dir), ['bridge-6days.log', 'bridge-notes.txt', 'bridge-today.log', 'main-8days.log']);
});

test('ログの整理: 再起動を繰り返して今日のログが 50 個を超えても、今日のログと前の配信のログは消さない', t => {
  const files = { 'bridge-yesterday-stream.log': NOW - 20 * 60 * 60 * 1000 };
  for (let i = 0; i < 60; i++) files[`bridge-crash-${String(i).padStart(2, '0')}.log`] = NOW - (60 - i) * 60_000;
  const dir = logsDir(t, files);
  assert.deepEqual(pruneLogFiles(dir, { prefix: 'bridge-', now: NOW }), []);
  assert.equal(left(dir).length, 61);
});

test('ログの整理: 数の上限を超えたら古いものから消すが、今日のログは上限を超えても消さない', t => {
  const files = {};
  for (let i = 0; i < 5; i++) files[`bridge-today-${i}.log`] = NOW - (i + 1) * 60_000;
  for (let i = 0; i < 3; i++) files[`bridge-yesterday-${i}.log`] = NOW - DAY - i * 60_000;
  const dir = logsDir(t, files);
  assert.deepEqual(pruneLogFiles(dir, { prefix: 'bridge-', now: NOW, maxFiles: 3 }).sort(), ['bridge-yesterday-0.log', 'bridge-yesterday-1.log', 'bridge-yesterday-2.log']);
  assert.equal(left(dir).length, 5);
});

test('ログの整理: フォルダーが無くても落ちない', () => {
  assert.deepEqual(pruneLogFiles(path.join(os.tmpdir(), 'log-cleanup-missing-' + process.pid), { prefix: 'bridge-' }), []);
});

test('ログの整理: BRIDGE は起動のときに bridge- のログをこの決め方で整理する（新しい 50 個だけを残す整理は使わない）', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  const setup = source.slice(source.indexOf('(function setupFileLogging()'), source.indexOf('const stamp = new Date()'));
  assert.match(setup, /require\("\.\/log_cleanup\.cjs"\)\.pruneLogFiles\(logsDir, \{ prefix: "bridge-" \}\);/);
  assert.doesNotMatch(setup, /slice\(50\)/);
});
