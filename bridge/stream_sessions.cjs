const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
function atomicWrite(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = file + '.' + crypto.randomUUID() + '.tmp'; try { fs.writeFileSync(temp, text); fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); } }

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
  return { read, active, start, end, save };
}

function streamBuckets(rows, sessions, gapMs, now = Date.now()) {
  const manual = sessions.map(s => ({
    id: s.id, title: s.title, recorded: true, source: s.source || 'manual', roomId: s.roomId || '',
    endReason: s.endReason || '',
    active: !s.endedAt && (s.source !== 'automatic' || now - Date.parse(s.lastSeenAt) < 45000),
    startT: Date.parse(s.startedAt), lastT: s.endedAt ? Date.parse(s.endedAt) : s.source === 'automatic' && now - Date.parse(s.lastSeenAt) >= 45000 ? Date.parse(s.lastSeenAt) : now,
    segments: s.segments, rows: [],
  })).filter(s => Number.isFinite(s.startT) && Number.isFinite(s.lastT) && s.lastT >= s.startT);
  const legacy = [];
  let current = null;
  for (const row of rows) {
    const recorded = manual.find(s => row.t >= s.startT && (s.active ? row.t <= s.lastT : row.t < s.lastT) &&
      (!s.segments || s.segments.some(p => row.t >= Date.parse(p.startedAt) && row.t <= Date.parse(p.endedAt || new Date(s.lastT).toISOString()))));
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

// Room IDs identify broadcasts. A reconnect adds an observed interval to the
// same record, while a new room always gets a new record, even seconds later.
function createAutomaticRecorder(getPath, now = () => Date.now()) {
  const store = createStreamSessions(getPath, now);
  let currentId = null, lastId = null;
  const stamp = () => new Date(now()).toISOString();
  function closeRow(row, reason, at) {
    row.endedAt = at; row.lastSeenAt = at; row.endReason = reason;
    const last = row.segments?.at(-1);
    if (last && !last.endedAt) last.endedAt = at;
  }
  function connect(username, roomId) {
    if (!String(roomId || '').trim()) throw new Error('配信IDを取得できないため、自動記録を開始できません。');
    const rows = store.read(), at = stamp();
    const key = String(username).toLowerCase() + ':' + String(roomId);
    let row = rows.find(s => s.source === 'automatic' && s.broadcastKey === key);
    for (const old of rows) if (!old.endedAt && old !== row) closeRow(old, 'monitoring-interrupted', old.lastSeenAt || old.startedAt);
    if (row?.endReason === 'live-ended') { currentId = null; return row; }
    if (!row) {
      row = { id: crypto.randomUUID(), source: 'automatic', broadcastKey: key, roomId: String(roomId), username: String(username),
        title: 'TikTok LIVE', startedAt: at, createdAt: at, segments: [] };
      rows.push(row);
    }
    const last = row.segments.at(-1);
    if (last && !last.endedAt && (currentId !== row.id || now() - Date.parse(row.lastSeenAt) >= 45000)) last.endedAt = row.lastSeenAt;
    if (!last || last.endedAt) row.segments.push({ startedAt: at, endedAt: null });
    row.endedAt = null; row.lastSeenAt = at; row.endReason = '';
    store.save(rows); currentId = row.id; lastId = row.id; return row;
  }
  function heartbeat() {
    if (!currentId) return;
    const rows = store.read(), row = rows.find(s => s.id === currentId);
    if (row && !row.endedAt) { row.lastSeenAt = stamp(); store.save(rows); }
  }
  function end(reason = 'monitoring-stopped') {
    const id = currentId || (reason === 'live-ended' ? lastId : null);
    if (!id) return;
    const rows = store.read(), row = rows.find(s => s.id === id);
    if (row && (!row.endedAt || reason === 'live-ended')) { closeRow(row, reason, stamp()); store.save(rows); }
    currentId = null;
  }
  return { connect, heartbeat, end, activeId: () => currentId };
}
module.exports = { createStreamSessions, streamBuckets, createAutomaticRecorder };
