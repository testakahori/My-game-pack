const fs = require('node:fs');
const crypto = require('node:crypto');
const { atomicWrite } = require('./settings_backups.cjs');

function createStreamSessions(getPath, now = () => Date.now()) {
  const read = () => {
    let raw;
    try { raw = fs.readFileSync(getPath(), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('配信記録の形式が不正です。ファイルを上書きせずに中止しました。');
    return rows;
  };
  const save = rows => atomicWrite(getPath(), JSON.stringify(rows, null, 2) + '\n');
  const active = () => read().find(row => !row.endedAt) || null;
  const start = title => {
    const rows = read();
    const existing = rows.find(row => !row.endedAt);
    if (existing) return existing; // 連打・再送でも二重の配信を作らない。
    const row = { id: crypto.randomUUID(), title: String(title || '').trim().slice(0, 80), startedAt: new Date(now()).toISOString(), endedAt: null, createdAt: new Date(now()).toISOString() };
    rows.push(row); save(rows); return row;
  };
  const end = (id, endedAt) => {
    const rows = read(), row = rows.find(item => item.id === id);
    if (!row) throw new Error('配信記録が見つかりません。');
    if (row.endedAt && !endedAt) return row;
    const time = endedAt ? Date.parse(endedAt) : now();
    if (!Number.isFinite(time) || time < Date.parse(row.startedAt) || time > now()) throw new Error('終了は開始以降・現在以前の時刻を指定してください。');
    if (rows.some(other => other.id !== id && Date.parse(other.startedAt) < time && (other.endedAt ? Date.parse(other.endedAt) : now() + 1) > Date.parse(row.startedAt))) throw new Error('別の配信記録と時間が重なります。');
    row.endedAt = new Date(time).toISOString(); row.updatedAt = new Date(now()).toISOString();
    save(rows); return row;
  };
  return { read, active, start, end };
}

function streamBuckets(rows, sessions, gapMs, now = Date.now()) {
  const manual = sessions.map(s => ({
    id: s.id, title: s.title, recorded: true, active: !s.endedAt,
    startT: Date.parse(s.startedAt), lastT: s.endedAt ? Date.parse(s.endedAt) : now, rows: [],
  })).filter(s => Number.isFinite(s.startT) && Number.isFinite(s.lastT) && s.lastT >= s.startT);
  const legacy = [];
  let current = null;
  for (const row of rows) {
    const recorded = manual.find(s => row.t >= s.startT && (s.active ? row.t <= s.lastT : row.t < s.lastT));
    if (recorded) { recorded.rows.push(row); current = null; continue; }
    // 明示記録の前後を、イベント間隔だけで再結合しない。
    const crossed = current && manual.some(s => s.startT >= current.lastT && s.startT <= row.t);
    if (!current || crossed || row.t - current.lastT >= gapMs) {
      current = { recorded: false, active: false, startT: row.t, lastT: row.t, rows: [] }; legacy.push(current);
    }
    current.rows.push(row); current.lastT = row.t;
  }
  return [...manual, ...legacy].sort((a, b) => a.startT - b.startT);
}
module.exports = { createStreamSessions, streamBuckets };
