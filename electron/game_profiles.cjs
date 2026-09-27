"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { atomicWrite } = require('./settings_backups.cjs');

const GAMES = [{ id: 'common', name: '共通コマンドのみ', modName: 'BridgeMOD' },
  { id: 'umetate', name: '埋め立て', modName: 'UmetateMOD' }, { id: 'run', name: 'ラン', modName: 'RunMOD' }];
const PROFILE_KEYS = ['mappings', 'likeEvents', 'unmappedGiftEvent', 'shareEvent', 'followEvent', 'memberEvent',
  'roulette', 'deathRoulette', 'commentGifts', 'milestones', 'combos'];
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2));
const clone = value => JSON.parse(JSON.stringify(value));
const safeName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/.test(name) && !name.includes('..');

function plainFile(file, max = 256 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) throw new Error(`通常のファイルではないか、大きすぎます: ${path.basename(file)}`);
  return fs.readFileSync(file);
}

// Read only the bounded metadata entry, never extract a supplied archive to disk.
function jarModIds(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Forge MODのjarではありません');
  const count = bytes.readUInt16LE(eocd + 10); let cursor = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24);
    const len = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42), name = bytes.subarray(cursor + 46, cursor + 46 + len).toString('utf8');
    if (name === 'META-INF/mods.toml') {
      if (size > 1024 * 1024 || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50 || ![0, 8].includes(method)) break;
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      if (start + compressed > bytes.length) break;
      const raw = bytes.subarray(start, start + compressed);
      const text = (method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: 1024 * 1024 }) : raw).toString('utf8');
      return [...text.matchAll(/\[\[mods\]\]([\s\S]*?)(?=\[|$)/g)].flatMap(m => [...m[1].matchAll(/^\s*modId\s*=\s*["']([^"']+)["']/gm)].map(x => x[1]));
    }
    cursor += 46 + len + extra + comment;
  }
  throw new Error('Forge MODのmods.tomlを読み取れません');
}

function inspectPackage(folder) {
  const manifest = JSON.parse(plainFile(path.join(folder, 'game.json'), 1024 * 1024));
  const game = GAMES.find(g => g.id !== 'common' && g.id === manifest.id);
  if (!game || manifest.format !== 1 || !/^[a-z][a-z0-9_]{1,63}$/.test(manifest.modId || '') || manifest.modId === 'bridgemod' || manifest.modId === 'doumacmd') throw new Error('game.jsonのゲームID・MOD ID・形式を確認してください');
  const files = {};
  for (const side of ['server', 'client']) {
    const name = manifest[side + 'Jar'];
    if (!safeName(name) || !name.endsWith('.jar')) throw new Error(`${side}Jarには同じフォルダのjarファイル名を指定してください`);
    const bytes = plainFile(path.join(folder, name));
    if (!jarModIds(bytes).includes(manifest.modId)) throw new Error(`${name}のMOD IDがgame.jsonと一致しません`);
    files[name] = bytes;
  }
  if (!Array.isArray(manifest.commands) || manifest.commands.length > 300) throw new Error('commandsは300件以内の配列にしてください');
  const seen = new Set();
  const commands = manifest.commands.map(c => {
    if (!/^[a-z][a-z0-9_]{0,49}$/.test(c?.key || '') || seen.has(c.key)) throw new Error('コマンドのkeyが不正・重複しています');
    if (typeof c.title !== 'string' || !c.title.trim() || /[\r\n]/.test(c.title) || c.title.length > 100) throw new Error('コマンドの表示名が不正です');
    if (typeof c.command !== 'string' || !c.command.trim() || /[\r\n]/.test(c.command) || c.command.length > 2000 || /^(?:\/?bridge|\/?douma)\s/i.test(c.command.trim())) throw new Error('ゲームMODへ渡すコマンドは1行で指定してください（Bridgeの再呼び出しは不可）');
    seen.add(c.key);
    return { key: c.key, title: c.title, command: c.command.replace(/^\//, ''), category: game.modName };
  });
  const normalized = { format: 1, id: game.id, modId: manifest.modId, serverJar: manifest.serverJar, clientJar: manifest.clientJar, commands };
  return { manifest: normalized, files, digest: hash(JSON.stringify(normalized) + Object.entries(files).map(([n, b]) => n + hash(b)).sort().join('')) };
}

function createGameProfiles({ storage, serverRoot, clientRoot, configPath, bridgeJar, ensureStopped, beforeStep = () => {} }) {
  const root = () => path.resolve(storage());
  const stateFile = () => path.join(root(), 'profiles.json');
  const journalFile = () => path.join(root(), 'pending-switch.json');
  const state = () => readJson(stateFile(), { format: 1, active: 'common', packages: {}, profiles: {} });
  function targets() {
    const dirs = [serverRoot(), clientRoot()].map(p => path.resolve(p));
    const normalized = dirs.map(d => d.toLowerCase());
    if (normalized[0] === normalized[1] || normalized[0].startsWith(normalized[1] + path.sep) || normalized[1].startsWith(normalized[0] + path.sep)) throw new Error('サーバーとMinecraftは互いに独立したフォルダを指定してください');
    for (const dir of dirs) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory() || fs.realpathSync(dir).toLowerCase() !== dir.toLowerCase()) throw new Error(`実在する通常のフォルダを選んでください: ${dir}`);
      const mods = path.join(dir, 'mods');
      if (fs.existsSync(mods) && (!fs.lstatSync(mods).isDirectory() || fs.lstatSync(mods).isSymbolicLink())) throw new Error(`MOD保存先を確認してください: ${mods}`);
      const backups = path.join(dir, '.mygamepack-mod-switch');
      if (fs.existsSync(backups) && (fs.lstatSync(backups).isSymbolicLink() || !fs.lstatSync(backups).isDirectory())) throw new Error('MOD退避先にリンクやファイルは使用できません');
    }
    return dirs;
  }
  function list() {
    const current = state();
    return { active: current.active, applied: JSON.stringify(current.appliedRoots) === JSON.stringify([path.resolve(serverRoot()), path.resolve(clientRoot())]), serverMods: path.join(serverRoot(), 'mods'), clientMods: path.join(clientRoot(), 'mods'), recoveryRequired: fs.existsSync(journalFile()),
      games: GAMES.map(g => ({ ...g, installed: g.id === 'common' || Boolean(current.packages[g.id]), selected: current.active === g.id })) };
  }
  async function install(folder) {
    if (fs.existsSync(journalFile())) throw new Error('前回の切替を復旧してから登録してください');
    const checked = inspectPackage(folder), id = checked.manifest.id;
    const current = state();
    // Packages are immutable. Registering an update does not mutate a running profile.
    const target = path.join(root(), 'packages', id + '-' + checked.digest);
    fs.mkdirSync(target, { recursive: true });
    for (const [name, bytes] of Object.entries(checked.files)) atomicWrite(path.join(target, name), bytes);
    writeJson(path.join(target, 'game.json'), checked.manifest);
    current.packages[id] = path.basename(target); writeJson(stateFile(), current);
    return list();
  }
  function packageFor(current, id) {
    const name = current.packages[id];
    if (!new RegExp('^' + id + '-[a-f0-9]{64}$').test(name || '')) throw new Error('このゲームMODは未導入です。完成したゲームパックを登録してください');
    const checked = inspectPackage(path.join(root(), 'packages', name));
    if (name !== id + '-' + checked.digest) throw new Error('登録済みゲームパックが変更されています。元の配布ファイルから再登録してください');
    return checked;
  }
  function restore(journal) {
    const dirs = targets();
    if (!/^[a-f0-9-]{36}$/.test(journal.id || '') || JSON.stringify(dirs) !== JSON.stringify(journal.roots) || path.resolve(configPath()) !== journal.configPath) throw new Error('切替時の保存先へ戻してから復旧してください');
    for (const dir of dirs.slice().reverse()) {
      const slot = path.join(dir, '.mygamepack-mod-switch', journal.id), mods = path.join(dir, 'mods'), old = path.join(slot, 'previous');
      if (fs.existsSync(old)) {
        if (fs.existsSync(mods)) fs.renameSync(mods, path.join(slot, 'interrupted-' + crypto.randomUUID()));
        fs.renameSync(old, mods);
      } else if (!journal.hadMods[dirs.indexOf(dir)] && fs.existsSync(mods)) {
        fs.renameSync(mods, path.join(slot, 'interrupted-' + crypto.randomUUID()));
      }
    }
    const commands = path.join(path.dirname(configPath()), 'commands', 'minecraft');
    for (const [name, content] of Object.entries(journal.commandBefore || {})) {
      if (!/^game_(umetate|run)_[a-z0-9_]+\.txt$/.test(name)) throw new Error('切替記録のコマンド名が不正です');
      const file = path.join(commands, name);
      if (content === null) { if (fs.existsSync(file)) fs.unlinkSync(file); } else atomicWrite(file, content);
    }
    atomicWrite(configPath(), journal.configBefore); writeJson(stateFile(), journal.stateBefore);
    fs.unlinkSync(journalFile());
  }
  async function recover() {
    await ensureStopped();
    if (fs.existsSync(journalFile())) restore(readJson(journalFile()));
    return list();
  }
  async function activate(id) {
    if (!GAMES.some(g => g.id === id)) throw new Error('ゲームを選択してください');
    if (fs.existsSync(journalFile())) throw new Error('前回の切替を復旧してから切り替えてください');
    await ensureStopped();
    const dirs = targets(), current = state();
    const pack = id === 'common' ? null : packageFor(current, id);
    const commonPath = bridgeJar(), commonBytes = plainFile(commonPath);
    if (!jarModIds(commonBytes).includes('bridgemod')) throw new Error('BridgeMODのビルド済みjarが必要です');
    const commonName = path.basename(commonPath);
    if (!safeName(commonName) || !commonName.endsWith('.jar')) throw new Error('BridgeMODのjarファイル名が不正です');
    const before = fs.readFileSync(configPath(), 'utf8'), config = JSON.parse(before);
    const commandDir = path.join(path.dirname(configPath()), 'commands', 'minecraft');
    const gameFiles = Object.fromEntries((pack?.manifest.commands || []).map(c => [`game_${id}_${c.key}.txt`, `# TITLE: ${c.title}\n# CATEGORY: ${c.category}\n# DISPLAY_OWNER: game\n${c.command.includes('{Count}') ? '# COUNT_MODE: aggregate\n' : ''}${c.command}\n`]));
    const oldNames = fs.existsSync(commandDir) ? fs.readdirSync(commandDir).filter(n => /^game_(umetate|run)_[a-z0-9_]+\.txt$/.test(n)) : [];
    const next = clone(current);
    next.profiles[current.active] = Object.fromEntries(PROFILE_KEYS.filter(k => Object.hasOwn(config, k)).map(k => [k, config[k]]));
    const destination = id === current.active ? next.profiles[id] : next.profiles[id] || { mappings: [], likeEvents: [] };
    const available = new Set([...(fs.existsSync(commandDir) ? fs.readdirSync(commandDir).filter(n => n.endsWith('.txt') && !oldNames.includes(n)) : []), ...Object.keys(gameFiles)]);
    function checkCommands(value) {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (key === 'commandFile' && typeof item === 'string' && item && !available.has(item)) throw new Error(`保存済みの設定で使うコマンドがありません: ${item}。元のゲームパックを登録するか設定を修正してください`);
        if (item && typeof item === 'object') checkCommands(item);
      }
    }
    checkCommands(destination);
    const commandBefore = Object.fromEntries([...new Set([...oldNames, ...Object.keys(gameFiles)])].map(n => [n, fs.existsSync(path.join(commandDir, n)) ? fs.readFileSync(path.join(commandDir, n), 'utf8') : null]));
    const operation = crypto.randomUUID();
    fs.mkdirSync(root(), { recursive: true });
    const journal = { id: operation, roots: dirs, hadMods: dirs.map(d => fs.existsSync(path.join(d, 'mods'))), configPath: path.resolve(configPath()), configBefore: before, stateBefore: current, commandBefore };
    // Prepare and verify both sides before moving either current mods folder.
    for (const [i, dir] of dirs.entries()) {
      const staged = path.join(dir, '.mygamepack-mod-switch', operation, 'next'); fs.mkdirSync(staged, { recursive: true });
      const files = { [commonName]: commonBytes };
      if (pack) { const name = pack.manifest[i === 0 ? 'serverJar' : 'clientJar']; if (name === commonName) throw new Error('ゲームMODとBridgeMODのファイル名が重複しています'); files[name] = pack.files[name]; }
      for (const [name, bytes] of Object.entries(files)) { fs.writeFileSync(path.join(staged, name), bytes); if (hash(fs.readFileSync(path.join(staged, name))) !== hash(bytes)) throw new Error('MODコピーの確認に失敗しました'); }
    }
    writeJson(journalFile(), journal);
    try {
      for (const [i, dir] of dirs.entries()) {
        beforeStep(i);
        const slot = path.join(dir, '.mygamepack-mod-switch', operation), mods = path.join(dir, 'mods');
        if (fs.existsSync(mods)) fs.renameSync(mods, path.join(slot, 'previous'));
        fs.renameSync(path.join(slot, 'next'), mods);
      }
      for (const key of PROFILE_KEYS) delete config[key];
      Object.assign(config, destination);
      config.gameProfile = id;
      for (const name of oldNames) fs.unlinkSync(path.join(commandDir, name));
      for (const [name, text] of Object.entries(gameFiles)) atomicWrite(path.join(commandDir, name), text);
      atomicWrite(configPath(), JSON.stringify(config, null, 2));
      next.active = id; next.appliedRoots = dirs; writeJson(stateFile(), next);
      fs.unlinkSync(journalFile());
      return { ...list(), backupFolders: dirs.map(d => path.join(d, '.mygamepack-mod-switch', operation, 'previous')) };
    } catch (error) {
      try { restore(journal); } catch (rollback) { throw new Error(`切替を完了できませんでした。復旧が必要です: ${rollback.message}（原因: ${error.message}）`); }
      throw new Error(`切替に失敗したため元へ戻しました: ${error.message}`);
    }
  }
  return { list, install, activate, recover };
}

module.exports = { GAMES, PROFILE_KEYS, jarModIds, inspectPackage, createGameProfiles };
