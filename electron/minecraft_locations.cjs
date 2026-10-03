const fs = require('node:fs/promises');
const path = require('node:path');
const PROFILE_FILES = ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json'];
const MAX_PROFILE_BYTES = 2 * 1024 * 1024;
const MAX_PROFILES = 512;
const key = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const inside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
function localPath(value, base) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f]/.test(value) || /^[\\/]{2}/.test(value) || /^[a-z]+:\/\//i.test(value)) {
    throw new Error('このPC内のMinecraftフォルダーを選んでください。');
  }
  if (process.platform === 'win32' && (/^[a-z]:[^\\/]/i.test(value) || (!path.isAbsolute(value) && !base))) {
    throw new Error('Minecraftフォルダーの絶対パスを指定してください。');
  }
  if (!path.isAbsolute(value) && !base) throw new Error('Minecraftフォルダーの絶対パスを指定してください。');
  return path.resolve(base || '', value);
}
async function canonical(value) {
  const result = await fs.realpath(value).catch(() => value);
  return localPath(result);
}
async function inspectFolder(value, serverRoot) {
  let folder = localPath(value);
  let stat;
  try { stat = await fs.stat(folder); }
  catch (error) {
    return { path: folder, exists: false, selectable: false, reason: error.code === 'ENOENT' ? 'フォルダーがありません。ランチャーの保存先を確認してください。' : 'フォルダーを読み取れません。アクセス権を確認してください。' };
  }
  if (!stat.isDirectory()) return { path: folder, exists: true, selectable: false, reason: 'フォルダーではありません。' };
  folder = await canonical(folder);
  const reject = reason => ({ path: folder, exists: true, selectable: false, reason });
  if (path.dirname(folder) === folder) return reject('ドライブ全体は選べません。Minecraftのゲームフォルダーを選んでください。');
  if (serverRoot) {
    const server = await canonical(path.resolve(serverRoot));
    if (inside(key(server), key(folder)) || inside(key(folder), key(server))) return reject('サーバーの保存先とは別のMinecraftフォルダーを選んでください。');
  }
  for (const name of ['mods', '.mygamepack-mod-switch']) {
    let child;
    try { child = await fs.lstat(path.join(folder, name)); }
    catch (error) { if (error.code === 'ENOENT') continue; return reject(name + 'を確認できません。アクセス権を確認してください。'); }
    if (!child.isDirectory() || child.isSymbolicLink()) return reject(name + 'が通常のフォルダーではありません。リンク先へのMOD配置を防ぐため選択できません。');
  }
  return { path: folder, exists: true, selectable: true };
}

// Read only known launcher files. Never scan a drive or return launcher accounts/tokens.
async function discoverMinecraftLocations({ appData, currentFolder, serverRoot }) {
  const standard = path.join(appData, '.minecraft');
  const current = currentFolder || standard;
  const candidates = new Map();
  const warnings = [];
  async function add(value, source, profile) {
    let info;
    try { info = await inspectFolder(value, serverRoot); }
    catch { warnings.push(source + 'の保存先がこのPC内の有効なパスではないため、候補から除外しました。'); return; }
    const id = key(info.path);
    let candidate = candidates.get(id);
    if (!candidate) {
      candidate = { ...info, modsPath: path.join(info.path, 'mods'), sources: [], profiles: [], current: false, recommended: false };
      candidates.set(id, candidate);
    }
    if (!candidate.sources.includes(source)) candidate.sources.push(source);
    if (profile && !candidate.profiles.some(item => item.name === profile.name && item.version === profile.version)) candidate.profiles.push(profile);
    return candidate;
  }
  await add(standard, '標準の保存先');
  if (currentFolder) await add(currentFolder, '現在の設定');
  const roots = new Set();
  for (const root of [standard, currentFolder].filter(Boolean)) {
    let resolved;
    try { resolved = await canonical(localPath(root)); } catch { continue; }
    if (roots.has(key(resolved))) continue;
    roots.add(key(resolved));
    for (const filename of PROFILE_FILES) {
      const file = path.join(resolved, filename);
      let handle;
      try {
        handle = await fs.open(file, 'r');
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_PROFILE_BYTES) throw new Error('large');
        // Bound the read even if the launcher rewrites the file between stat and read.
        const buffer = Buffer.alloc(MAX_PROFILE_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > MAX_PROFILE_BYTES) throw new Error('large');
        const data = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, ''));
        if (!data.profiles || typeof data.profiles !== 'object' || Array.isArray(data.profiles)) throw new Error('format');
        const profiles = Object.values(data.profiles);
        if (profiles.length > MAX_PROFILES) warnings.push(filename + 'の起動構成が多いため、先頭512件を確認しました。');
        for (const profile of profiles.slice(0, MAX_PROFILES)) {
          if (!profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
          const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.slice(0, 200) : '名前なしの起動構成';
          const version = typeof profile.lastVersionId === 'string' ? profile.lastVersionId.slice(0, 200) : 'バージョン未指定';
          let folder;
          try { folder = profile.gameDir === undefined || profile.gameDir === '' ? resolved : localPath(profile.gameDir, resolved); }
          catch { warnings.push(name + 'の保存先が不正、またはネットワーク上にあるため確認を省略しました。'); continue; }
          await add(folder, 'ランチャーの起動構成', { name, version });
        }
      } catch (error) {
        if (error.code !== 'ENOENT') warnings.push(file + 'を読み取れませんでした。ランチャーを閉じて再検索するか、手動で指定してください。');
      } finally { await handle?.close(); }
    }
  }
  let currentKey;
  try { currentKey = key(await canonical(localPath(current))); } catch { /* Invalid saved path remains unselected. */ }
  for (const candidate of candidates.values()) {
    candidate.current = key(candidate.path) === currentKey;
    candidate.recommended = candidate.selectable && candidate.profiles.some(profile => /^1\.20\.1-forge-47\./i.test(profile.version));
  }
  return { candidates: [...candidates.values()].sort((a, b) => Number(b.current) - Number(a.current) || Number(b.recommended) - Number(a.recommended) || a.path.localeCompare(b.path)), warnings: [...new Set(warnings)] };
}

async function validateMinecraftFolder(value, { serverRoot, candidates = [], requireCandidate = false } = {}) {
  const info = await inspectFolder(value, serverRoot);
  if (!info.selectable) throw new Error(info.reason);
  const known = candidates.some(candidate => key(candidate.path) === key(info.path) && candidate.selectable);
  if (requireCandidate && !known) throw new Error('候補を再検索してから保存先を選んでください。');
  if (!known) {
    const markers = await Promise.all(['options.txt', 'versions', 'saves', 'mods'].map(async name => {
      const stat = await fs.stat(path.join(info.path, name)).catch(() => null);
      return name === 'options.txt' ? stat?.isFile() : stat?.isDirectory();
    }));
    if (!markers.some(Boolean)) throw new Error('Minecraftのゲームフォルダーを選んでください（modsフォルダーの1つ上）。起動構成に登録した未起動のフォルダーは、自動検出の候補から選べます。');
  }
  return info.path;
}
module.exports = { discoverMinecraftLocations, validateMinecraftFolder };
