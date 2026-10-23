// 設定ファイルが壊れていて戻したことを、userData の logs/settings-recovery.log に残す
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5.3）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSettingsRecoveryLog } = require('../settings_recovery_log.cjs');

const tempDir = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-recovery-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const at = () => new Date(2026, 9, 23, 15, 30, 12);
const entry = (dir, reason = 'JSON として読めない') => ({
  file: path.join(dir, 'app-config.json'), reason, action: 'restored',
  brokenFile: path.join(dir, 'app-config.json.broken-20261023-153012'),
});

test('1行に時刻と記録の文を書き足す', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'logs', 'settings-recovery.log');
  const log = createSettingsRecoveryLog({ file: () => file, now: at });
  log.record(entry(dir));
  log.record({ ...entry(dir), action: 'defaults' });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.equal(lines[0], '2026-10-23 15:30:12.000 app-config.json が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。壊れたファイル: app-config.json.broken-20261023-153012');
  assert.match(lines[1], /^2026-10-23 15:30:12\.000 app-config\.json が壊れていた（JSON として読めない）。前の正しい状態の写しが無い/);
});

test('書けなくても投げない', t => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, 'logs'), 'フォルダーでなくファイル');
  const log = createSettingsRecoveryLog({ file: () => path.join(dir, 'logs', 'settings-recovery.log'), now: at });
  assert.doesNotThrow(() => log.record(entry(dir)));
});

test('大きくなったら古い行を切る', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'settings-recovery.log');
  const log = createSettingsRecoveryLog({ file: () => file, now: at, maxBytes: 1000 });
  for (let i = 0; i < 10; i++) log.record(entry(dir, `理由${i}`));
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  assert.match(lines.at(-1), /理由9/, '最後の行は残る');
  assert.ok(!text.includes('理由0'), '古い行は切る');
  // 切るのは書き足す前なので、ファイルは maxBytes と最後の1行の分までに収まる（停止の記録と同じ）。
  assert.ok(Buffer.byteLength(text) <= 1000 + Buffer.byteLength(lines.at(-1) + '\n'), String(Buffer.byteLength(text)));
});
