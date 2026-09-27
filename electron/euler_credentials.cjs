const fs = require('node:fs');
const crypto = require('node:crypto');
const { atomicWrite } = require('./settings_backups.cjs');

// Keep credentials outside portable settings, server folders and exported backups.
function createEulerCredentials({ filePath, safeStorage }) {
  const available = () => Boolean(safeStorage?.isEncryptionAvailable());
  function read() {
    if (!fs.existsSync(filePath())) return { key: '', revision: '' };
    try {
      if (!available()) throw new Error();
      const data = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
      if (data.version !== 1 || typeof data.encrypted !== 'string') throw new Error();
      const key = safeStorage.decryptString(Buffer.from(data.encrypted, 'base64'));
      validate(key);
      return { key, revision: crypto.createHash('sha256').update(key).digest('hex') };
    } catch {
      throw new Error('保存したEuler Stream APIキーを読み込めません。キーを保存し直すか、削除してください。');
    }
  }
  function validate(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 4096 || /\s|[\x00-\x1f\x7f]/.test(value.trim())) {
      throw new Error('APIキーを空白や改行を含めずに入力してください。');
    }
  }
  function save(value) {
    validate(value);
    if (!available()) throw new Error('このPCでキーを暗号化できません。アプリを再起動してお試しください。');
    try {
      const encrypted = safeStorage.encryptString(value.trim()).toString('base64');
      atomicWrite(filePath(), JSON.stringify({ version: 1, encrypted }));
    } catch {
      throw new Error('APIキーを保存できませんでした。保存先の空き容量やアクセス権を確認してください。');
    }
  }
  function clear() {
    try { fs.unlinkSync(filePath()); } catch (error) { if (error.code !== 'ENOENT') throw new Error('APIキーを削除できませんでした。'); }
  }
  function status(appliedRevision, running) {
    const base = { configured: fs.existsSync(filePath()), storageAvailable: available(), restartRequired: false };
    try {
      const value = read();
      return { ...base, restartRequired: Boolean(running && value.revision !== appliedRevision) };
    } catch (error) { return { ...base, error: error.message }; }
  }
  function runtime(baseEnv = process.env) {
    const { key, revision } = read();
    const env = { ...baseEnv };
    delete env.SIGN_API_KEY;
    if (key) env.SIGN_API_KEY = key;
    return { env, revision };
  }
  return { save, clear, status, runtime };
}
module.exports = { createEulerCredentials };
