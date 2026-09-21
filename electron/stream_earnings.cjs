const fs = require('node:fs');
const { atomicWrite } = require('./settings_backups.cjs');
function readEarnings(file) {
  try {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(rows)) throw new Error('受取額の保存形式が不正です。');
    return rows;
  } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
function saveEarnings(file, sessions, id, amount) {
  if (!sessions.some(row => row.id === id)) throw new Error('配信が見つかりません。');
  if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1e9 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001)) throw new Error('受取額は0以上の金額（小数2桁まで）を入力してください。');
  const rows = readEarnings(file).filter(row => row.id !== id);
  if (amount !== null) rows.push({ id, amount, currency: 'JPY', enteredAt: new Date().toISOString() });
  atomicWrite(file, JSON.stringify(rows, null, 2) + '\n');
  return { ok: true };
}
module.exports = { readEarnings, saveEarnings };
