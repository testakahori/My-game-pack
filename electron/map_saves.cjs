const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { atomicWrite } = require('./settings_backups.cjs');

const ID = /^[a-f0-9-]{36}$/;
function inside(root, target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('MAPの保存先が不正です。');
  return target;
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || /[:\x00-\x1f]/.test(relative) || path.isAbsolute(relative)) throw new Error('MAPのパスが不正です。');
  const target = inside(root, path.resolve(root, relative));
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('リンク先のMAPは操作できません。');
  }
  return target;
}
async function inventory(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'session.lock') continue;
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('MAP内にリンクがあるため中止しました。');
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const sha = crypto.createHash('sha256');
        let bytes = 0;
        for await (const chunk of fs.createReadStream(file)) { sha.update(chunk); bytes += chunk.length; }
        files.push({ path: path.relative(root, file).split(path.sep).join('/'), bytes, sha256: sha.digest('hex') });
      } else throw new Error('MAP内に通常のファイルではない項目があります。');
    }
  }
  await walk(root);
  if (!files.some(f => f.path === 'level.dat' && f.bytes > 0)) throw new Error('有効なMAP（level.dat）がありません。');
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function copyVerified(source, destination, files) {
  for (const file of files) {
    const src = safePath(source, file.path), dst = safePath(destination, file.path);
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
  }
  if (JSON.stringify(await inventory(destination)) !== JSON.stringify(files)) throw new Error('MAPのコピーを照合できませんでした。元のMAPは保持しています。');
}
function createMapSaves({ getRoot, assertStopped = async () => {}, rename = (a, b) => fsp.rename(a, b), now = () => new Date() }) {
  let busy = false;
  function context() {
    const root = fs.realpathSync(getRoot());
    const props = fs.readFileSync(path.join(root, 'server.properties'), 'utf8');
    const level = (props.match(/^level-name=(.*)$/m)?.[1] || 'world').trim();
    if (/^(map-saves|backups)([\\/]|$)/i.test(level)) throw new Error('保存用フォルダーをプレイ用MAPには指定できません。');
    const world = safePath(root, level), saves = safePath(root, 'map-saves');
    fs.mkdirSync(saves, { recursive: true });
    return { root, level, world, saves, journal: path.join(saves, 'restore-pending.json') };
  }
  const summary = m => ({ id: m.id, name: m.name, createdAt: m.createdAt, level: m.level, reason: m.reason, bytes: m.files.reduce((n, f) => n + f.bytes, 0), files: m.files.length });
  function readSave(c, id) {
    if (!ID.test(String(id))) throw new Error('保存MAPのIDが不正です。');
    const dir = safePath(c.saves, id);
    const m = JSON.parse(fs.readFileSync(safePath(dir, 'map.json'), 'utf8'));
    if (m.version !== 1 || m.id !== id || typeof m.name !== 'string' || typeof m.createdAt !== 'string' || !Number.isFinite(Date.parse(m.createdAt)) || typeof m.level !== 'string' || !Array.isArray(m.files) || !m.files.length) throw new Error('保存MAPの情報が破損しています。');
    const seen = new Set();
    for (const f of m.files) {
      safePath(path.join(dir, 'world'), f.path);
      if (seen.has(f.path) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || !/^[a-f0-9]{64}$/.test(f.sha256)) throw new Error('保存MAPの情報が不正です。');
      seen.add(f.path);
    }
    return { dir, world: safePath(dir, 'world'), manifest: m };
  }
  async function recover(c) {
    if (!fs.existsSync(c.journal)) return;
    const pending = JSON.parse(fs.readFileSync(c.journal, 'utf8'));
    if (pending.level !== c.level || !ID.test(pending.safetyId) || !ID.test(pending.stageId)) throw new Error('MAP復元の中断を確認してください。保存先が変わっています。');
    const oldWorld = safePath(c.saves, pending.safetyId + '/world');
    const stage = safePath(c.root, '.map-stage-' + pending.stageId);
    if (!fs.existsSync(c.world) && fs.existsSync(oldWorld)) await rename(oldWorld, c.world);
    if (!fs.existsSync(c.world)) throw new Error('MAPの復旧に失敗しました。自動退避したMAPを保持しています。');
    // Only remove staging folders whose absolute path is checked under this server.
    if (fs.existsSync(stage)) await fsp.rm(stage, { recursive: true, force: true });
    await fsp.unlink(c.journal);
  }
  async function exclusive(fn) {
    if (busy) throw new Error('MAPの保存・読込中です。完了までお待ちください。');
    busy = true;
    try { await assertStopped(); const c = context(); await recover(c); return await fn(c); }
    finally { busy = false; }
  }
  function manifest(c, name, reason, files, id = crypto.randomUUID()) {
    return { version: 1, id, name: String(name || '').trim().slice(0, 80) || 'MAP ' + now().toLocaleString('ja-JP'), createdAt: now().toISOString(), level: c.level, reason, files };
  }
  async function save(name, reason = 'manual') {
    return exclusive(async c => {
      const files = await inventory(c.world), m = manifest(c, name, reason, files);
      const dir = safePath(c.saves, m.id);
      await fsp.mkdir(dir);
      await copyVerified(c.world, path.join(dir, 'world'), files);
      atomicWrite(path.join(dir, 'map.json'), JSON.stringify(m, null, 2));
      return summary(m);
    });
  }
  async function load(id) {
    return exclusive(async c => {
      const selected = readSave(c, id);
      if (JSON.stringify(await inventory(selected.world)) !== JSON.stringify(selected.manifest.files)) throw new Error('保存MAPが変更・破損しています。ロードを中止しました。');
      const files = await inventory(c.world);
      const safety = manifest(c, 'ロード前の自動退避 ' + now().toLocaleString('ja-JP'), 'before-load', files);
      const safetyDir = safePath(c.saves, safety.id);
      const stageId = crypto.randomUUID(), stage = safePath(c.root, '.map-stage-' + stageId);
      await copyVerified(selected.world, stage, selected.manifest.files);
      await fsp.mkdir(safetyDir);
      atomicWrite(path.join(safetyDir, 'map.json'), JSON.stringify(safety, null, 2));
      atomicWrite(c.journal, JSON.stringify({ level: c.level, safetyId: safety.id, stageId }));
      try {
        await rename(c.world, path.join(safetyDir, 'world'));
        await rename(stage, c.world);
        await fsp.unlink(c.journal);
      } catch (error) {
        await recover(c);
        throw error;
      }
      return { loaded: summary(selected.manifest), safety: summary(safety) };
    });
  }
  async function list() {
    const c = context();
    const rows = [];
    for (const name of await fsp.readdir(c.saves)) if (ID.test(name)) {
      try { const saved = readSave(c, name); if (fs.existsSync(path.join(saved.world, 'level.dat'))) rows.push(summary(saved.manifest)); } catch { /* Incomplete saves are never loadable. */ }
    }
    return { world: c.level, busy, recoveryPending: fs.existsSync(c.journal), saves: rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
  }
  return { save, load, list, recover: () => exclusive(async () => ({ ok: true })), isBusy: () => busy };
}
module.exports = { createMapSaves, safePath, inventory };
