"use strict";
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { atomicWrite } = require('./settings_backups.cjs');
const saikutu = require('./saikutu_commands.cjs');
const { isTxtName, ensureTxt, commandFileRefs } = require('../bridge/command_files.cjs');
const { migrateBridgeConfig } = require('../bridge/config_migration.cjs');
const { bridgeCommandsDir, newBridgeConfig } = require('../bridge/config_defaults.cjs');
// ゲームの一覧と、ゲーム専用の判定・MOD の ID・パックの key の決まりは bridge/game_commands.cjs の1か所（処理のコピー PR6）。
const { GAMES, RESERVED_MOD_IDS, gameOfCommand, isGameCommandFile, isGameModId, isGamePackKey } = require('../bridge/game_commands.cjs');
// ゲームの初期マップ（games.json の maps）の入れ替え（埋め立て PR3）。
const { MAP_SWITCH_DIR, hasWorld, mapPlaces, ensureMapBackup, stageMap, worldAllowed, dedicatedOnly, notDedicated, ownMapOf, planMapChange, journalMap, applyMapSwap, restoreMapSwap } = require('./game_maps.cjs');
const { levelNameOf } = require('./server_properties.cjs');
// 'milestones'・'combos' は、どこも書いていない名前だったので外した（2026-10-30）。
const PROFILE_KEYS = ['mappings', 'likeEvents', 'unmappedGiftEvent', 'shareEvent', 'followEvent', 'memberEvent',
  'roulette', 'deathRoulette', 'commentGifts'];
// ゲーム別に持つ項目だけを取り出す。options（古い設定に残った演出・ゲーム性設定 options.gameplay を含む）は読まない（2026-10-30）。
const profileOf = config => Object.fromEntries(PROFILE_KEYS.filter(k => Object.hasOwn(config, k)).map(k => [k, config[k]]));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const writeJson = (file, value) => atomicWrite(file, JSON.stringify(value, null, 2));
// 切り替えの記録（profiles.json）とギフト設定は、壊れても消えないように読み書きする
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.4〜6.6。設定ファイルの PR3）。
const { createSafeJsonFile, peekJsonFile, inspectJsonFile, setAsideBrokenFile, writeWithLastGood, writeFileDurable, lastGoodPath } = require('../bridge/safe_json_file.cjs');
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// 切り替えの記録の形。どの版もこの形で書いていた。違う形だと一覧（list）が落ちる。
function stateProblem(value) {
  if (typeof value.active !== 'string') return '項目 active の型が違う';
  for (const key of ['packages', 'profiles', 'worlds']) if (value[key] !== undefined && !isPlainObject(value[key])) return `項目 ${key} の型が違う`;
  return '';
}
const clone = value => JSON.parse(JSON.stringify(value));
// 指定したゲーム以外のゲーム専用コマンド（game_<一覧のゲーム>_*.txt）を使う割り当てを外す。game_mode_on.txt などは共通のコマンドなので残す。
// 文字列で書いたコマンドも外す（前はコメントコマンド・投票の選択肢を文字列で書けた。処理のコピー PR6）。
function withoutOtherGameCommands(value, gameId) {
  const other = file => { const game = gameOfCommand(file); return game !== null && game !== gameId; };
  // .txt を書いていない文字列も、切り替えの確かめと BRIDGE は .txt を付けて数えるので外す（PR6 の最終レビュー）。
  if (typeof value === 'string') return other(value) ? undefined : value;
  if (!value || typeof value !== 'object') return value;
  if (other(value.commandFile)) return undefined;
  if (Array.isArray(value)) return value.map(item => withoutOtherGameCommands(item, gameId)).filter(item => item !== undefined);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withoutOtherGameCommands(item, gameId)]).filter(([, item]) => item !== undefined));
}
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
  if (!game || manifest.format !== 1 || !isGameModId(manifest.modId)) throw new Error('game.jsonのゲームID・MOD ID・形式を確認してください');
  if (manifest.bridgeEventApi !== undefined && manifest.bridgeEventApi !== 1) throw new Error('bridgeEventApiは1で指定してください');
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
    if (!isGamePackKey(c?.key) || seen.has(c.key)) throw new Error('コマンドのkeyが不正・重複しています');
    if (typeof c.title !== 'string' || !c.title.trim() || /[\r\n]/.test(c.title) || c.title.length > 100) throw new Error('コマンドの表示名が不正です');
    if (typeof c.command !== 'string' || !c.command.trim() || /[\r\n]/.test(c.command) || c.command.length > 2000 || /^(?:\/?bridge|\/?douma)\s/i.test(c.command.trim())) throw new Error('ゲームMODへ渡すコマンドは1行で指定してください（Bridgeの再呼び出しは不可）');
    if (c.destructive !== undefined && typeof c.destructive !== 'boolean') throw new Error('destructiveはtrueかfalseで指定してください');
    if (c.commonDisplay !== undefined && typeof c.commonDisplay !== 'boolean') throw new Error('commonDisplayはtrueかfalseで指定してください');
    seen.add(c.key);
    return { key: c.key, title: c.title, command: c.command.replace(/^\//, ''), category: game.modName,
      ...(c.commonDisplay === undefined ? {} : { commonDisplay: c.commonDisplay }),
      ...(c.destructive === undefined ? {} : { destructive: c.destructive }) };
  });
  const normalized = { format: 1, ...(manifest.bridgeEventApi === 1 ? { bridgeEventApi: 1 } : {}), id: game.id, modId: manifest.modId, serverJar: manifest.serverJar, clientJar: manifest.clientJar, commands };
  return { manifest: normalized, files, digest: hash(JSON.stringify(normalized) + Object.entries(files).map(([n, b]) => n + hash(b)).sort().join('')) };
}

// recordRecovery は、壊れていて戻したことの記録（main が logs/settings-recovery.log に書く）。
// removeTree は、切り替えが終わったあとに古いマップを消す関数（テストが消せないときを起こす）。
// ensureServerStopped は「マップを初期化」の確かめ。サーバーだけが止まっていればよい（BRIDGE・Minecraft は動いていてよい。埋め立て PR3）。
// missingMapHint は、初期マップが無いときの案内に足す文（開発版だけ npm run dev:refresh を出す。games_ipc.cjs が決める）。
function createGameProfiles({ storage, serverRoot, clientRoot, configPath, bridgeJar, displayJar = () => null, obsJar = () => null, bundledPackages = () => [], ensureStopped, beforeStep = () => {}, recordRecovery, now,
  removeTree = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }), ensureServerStopped = ensureStopped, missingMapHint = '', games = GAMES}) {
  const root = () => path.resolve(storage());
  const stateFile = () => path.join(root(), 'profiles.json');
  const journalFile = () => path.join(root(), 'pending-switch.json');
  // ギフト設定の「今のゲーム」（読めなければ null）。
  const configGame = () => { const config = peekJsonFile(configPath()); return config ? (config.gameProfile || 'common') : null; };
  // 写しの「今のゲーム」がギフト設定と合わないときは、今のゲームだけをギフト設定のゲームに直し、「未保存」（appliedFormat・appliedRoots を外す）にして使う
  // （設計書 6.6。2026-10-24 ユーザーの決定。PR3 の最後のレビューの重要 2）。選び直して保存しても、ほかのゲームの保存済みの設定を今の割り当てで
  // 上書きせず、登録したゲームパックとほかのゲームの保存済みの設定も残る（切り替え1回分古いだけ）。写しが無いときは、ギフト設定のゲームにした既定の記録。
  const stateStore = createSafeJsonFile({
    file: stateFile, problem: stateProblem, record: recordRecovery, now,
    adaptSource: value => {
      const game = configGame();
      if (!game || value.active === game) return value;
      const { appliedFormat: _format, appliedRoots: _roots, ...rest } = value;
      return { ...rest, active: game };
    },
    adaptedLabel: '前の正しい状態の写し（今のゲームはギフト設定に合わせた）',
    defaults: () => ({ format: 1, active: configGame() || 'common', packages: {}, profiles: {} }),
  });
  const state = () => { const value = stateStore.read(); return { ...value, packages: value.packages || {}, profiles: value.profiles || {} }; };
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
    // ギフト設定が壊れていても投げない（アプリの設定の保存・ゲームの一覧・設定のバックアップから戻す操作を止めない。設計書 6.4）。
    const config = peekJsonFile(configPath()) || {};
    return { active: current.active, saikutuMigrationNeeded: saikutu.hasLegacy(profileOf(config)), displayBundled: Boolean(displayJar()), obsBundled: Boolean(obsJar()), applied: (config.gameProfile || 'common') === current.active && current.appliedFormat === 3 && JSON.stringify(current.appliedRoots) === JSON.stringify([path.resolve(serverRoot()), path.resolve(clientRoot())]), serverMods: path.join(serverRoot(), 'mods'), clientMods: path.join(clientRoot(), 'mods'), recoveryRequired: fs.existsSync(journalFile()),
      mapResettable: mapResettable(current.active),
      games: games.map(g => ({ ...g, installed: g.id === 'common' || Boolean(current.packages[g.id]) || bundledPackages().some(p => p.id === g.id), selected: current.active === g.id })) };
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
    current.packages[id] = path.basename(target); stateStore.write(current);
    return list();
  }
  function packageFor(current, id) {
    const name = current.packages[id];
    if (!name) {
      const bundled = bundledPackages().find(p => p.id === id);
      if (bundled) { const checked = inspectPackage(bundled.folder); if (checked.manifest.id !== id) throw new Error('同梱ゲームパックのIDが不正です'); return checked; }
    }
    if (!new RegExp('^' + id + '-[a-f0-9]{64}$').test(name || '')) throw new Error('このゲームMODは未導入です。完成したゲームパックを登録してください');
    const checked = inspectPackage(path.join(root(), 'packages', name));
    if (name !== id + '-' + checked.digest) throw new Error('登録済みゲームパックが変更されています。元の配布ファイルから再登録してください');
    return checked;
  }
  const gameOf = id => games.find(g => g.id === id);
  // 前の切り替え・初期化で消せなかった古いマップを消す。消せなくても続ける（次の機会にまた消す。埋め立て PR3 の決めたこと 8）。
  function clearMapLeftovers(server) {
    const dir = path.join(server, MAP_SWITCH_DIR);
    if (!fs.existsSync(dir)) return;
    try { removeTree(dir); } catch (error) { console.warn(`[games] 前のマップを消せませんでした（次の切り替えで消します）: ${error.message}`); }
  }
  // 今の server.properties（場所・中身・level-name。無ければ world として読む）。
  const readProperties = () => {
    const file = path.join(path.resolve(serverRoot()), 'server.properties'), text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    return { file, text, level: levelNameOf(text || '') };
  };
  // 「マップを初期化」を出せるか：専用マップだけを使うゲームか、今のワールドがそのゲームの専用マップのとき（専用でないワールドは初期化しない）。
  const mapResettable = id => { const game = gameOf(id); return Boolean(game?.maps?.length) && (dedicatedOnly(game) || Boolean(ownMapOf(game, readProperties().level))); };
  // マップの入れ替えの下準備（記録を書く前。時間のかかる写しはここで済ませ、使う場所にはまだ触らない）。返すのは { step（無ければ null）, levelBefore }。
  // 専用マップを使う・level-name だけ変える・何もしない は game_maps.cjs の planMapChange が決める。reset は「マップを初期化」。
  // 配信ワールドをゲームごとに覚える（profiles.json の worlds。2026-10-30 ユーザーの決定。docs/superpowers/plans/2026-10-30-game-worlds.md）。
  async function prepareMapStep(current, id, operation, { reset = false } = {}) {
    const server = path.resolve(serverRoot()), { file: propertiesFile, text: propertiesBefore, level: currentLevel } = readProperties(), target = gameOf(id);
    const exists = level => typeof level === 'string' && level !== '' && hasWorld(path.resolve(server, level));
    // 覚えたワールドは、フォルダーがまだあれば渡す（選んだばかりで、まだ一度も起動していないワールドにも戻れるように。軽い7）。
    const saved = current.worlds?.[id];
    const remembered = typeof saved === 'string' && saved !== '' && fs.existsSync(path.resolve(server, saved)) ? saved : null;
    // haihu_world の中の、実際にあるワールド（使えるワールドが1つも無ければ、level-name を変えない。重要1）。
    const haihu = path.join(server, 'haihu_world');
    const folders = fs.existsSync(haihu) ? fs.readdirSync(haihu, { withFileTypes: true }).filter(e => e.isDirectory() && hasWorld(path.join(haihu, e.name))).map(e => e.name) : [];
    const plan = planMapChange({ games, target, switching: id !== current.active, currentLevel, reset, remembered,
      fallback: exists(current.mapReturnLevel) ? current.mapReturnLevel : null, exists, folders });
    if (!plan) return { step: null, levelBefore: currentLevel };
    // 途中の記録には、server.properties の丸ごとではなく前の level-name だけを残す（戻すときもそれだけを書く。最後のレビュー 軽い2）。
    const base = { kind: plan.kind, propertiesFile, hadProperties: propertiesBefore !== null, levelBefore: currentLevel, slot: null, use: null, fresh: false, hadUse: false };
    if (plan.kind === 'level') return { step: { ...base, levelAfter: plan.level }, levelBefore: currentLevel };
    // 「埋め立てに切り替える前に使っていたワールド」（設計書 3.3）は、ほかのゲームから入るときだけ記録する。同じゲームのままの保存・初期化では、
    // 記録が無いときだけ今のワールドを入れる（最後のレビュー 軽い1）。どのゲームかの専用マップ（直下に手で入れた umetate_lab_map も）は記録しない。
    const candidate = notDedicated(games, currentLevel) ? currentLevel : undefined;
    const returnLevel = id !== current.active ? (candidate ?? current.mapReturnLevel) : (current.mapReturnLevel ?? candidate);
    const places = mapPlaces(server, id, plan.name);
    const step = { ...base, use: places.use, hadUse: fs.existsSync(places.use), fresh: plan.fresh, returnLevel, levelAfter: plan.level };
    if (plan.fresh) {
      const pack = bundledPackages().find(p => p.id === id);
      const files = await ensureMapBackup({ serverRoot: server, gameId: id, name: plan.name, bundled: pack ? path.join(pack.folder, 'maps', plan.name) : null, remove: removeTree, hint: missingMapHint });
      step.slot = path.dirname(await stageMap({ serverRoot: server, gameId: id, name: plan.name, files, operation }));
    }
    return { step, levelBefore: currentLevel };
  }
  const applyMapStep = step => { if (step) applyMapSwap(step, beforeStep); };
  // 切り替えの記録のワールド。
  // - worlds：ゲームごとに最後に使ったワールド。切り替えるときに、前のゲームで使えるワールドだけを、前のゲームの分として覚える。
  // - mapReturnLevel：専用マップを持つゲーム（埋め立て）に入る前のワールド。入るときは残し、そのゲームから専用マップの無いゲームへ出るときは消す。
  function recordWorlds(next, current, id, step, levelBefore) {
    const switching = id !== current.active;
    if (switching && worldAllowed(games, gameOf(current.active), levelBefore)) next.worlds = { ...(current.worlds || {}), [current.active]: levelBefore };
    if (step?.kind === 'enter' && step.returnLevel) next.mapReturnLevel = step.returnLevel;
    else if (switching && dedicatedOnly(gameOf(current.active)) && !dedicatedOnly(gameOf(id))) delete next.mapReturnLevel;
  }
  // 終わったあとに、よけた古いマップ（作業のフォルダー）を消す。消せなくても切り替えは成功にする（決めたこと 8）。
  function finishMapStep(step) {
    if (!step?.slot || !fs.existsSync(step.slot)) return;
    try { removeTree(step.slot); } catch (error) { console.warn(`[games] 古いマップを消せませんでした（次の切り替えで消します）: ${error.message}`); }
  }
  function restore(journal) {
    const dirs = targets();
    if (!/^[a-f0-9-]{36}$/.test(journal.id || '') || JSON.stringify(dirs) !== JSON.stringify(journal.roots) || path.resolve(configPath()) !== journal.configPath) throw new Error('切替時の保存先へ戻してから復旧してください');
    if (journal.map) restoreMapSwap(dirs[0], journal.map, { id: journal.id, mapNames: games.flatMap(g => g.maps || []) });
    for (const dir of dirs.slice().reverse()) {
      const slot = path.join(dir, '.mygamepack-mod-switch', journal.id), mods = path.join(dir, 'mods'), old = path.join(slot, 'previous');
      if (fs.existsSync(old)) {
        if (fs.existsSync(mods)) fs.renameSync(mods, path.join(slot, 'interrupted-' + crypto.randomUUID()));
        fs.renameSync(old, mods);
      } else if (!journal.hadMods[dirs.indexOf(dir)] && fs.existsSync(mods)) {
        fs.renameSync(mods, path.join(slot, 'interrupted-' + crypto.randomUUID()));
      }
    }
    const commands = bridgeCommandsDir(path.dirname(configPath()));
    for (const [name, content] of Object.entries(journal.commandBefore || {})) {
      if (!isGameCommandFile(name)) throw new Error('切替記録のコマンド名が不正です');
      const file = path.join(commands, name);
      if (content === null) { if (fs.existsSync(file)) fs.unlinkSync(file); } else atomicWrite(file, content);
    }
    // 元に戻すときは写しを変えない（切り替えの途中の中身を写しにしない。PR3 の最後のレビューの軽い 4）。ギフト設定は切り替えで書いたときに、
    // 切り替えの前の中身が写しになっている。切り替えの前のギフト設定が壊れていたなら、その壊れた中身に戻す（壊れたファイルは .broken-… に残してある）。
    writeFileDurable(configPath(), journal.configBefore); stateStore.write(journal.stateBefore, { keepLastGood: true });
    fs.unlinkSync(journalFile());
  }
  // 切り替えの途中の記録は切り替えの間だけあるので写しを作らない。壊れていたら、別の名前で残して外し、記録する
  // （切り替えの前には戻せないので、今の記録のまま動く。ゲームを選び直す。PR3 の計画の決めたこと 5）。
  async function recover() {
    await ensureStopped();
    const pending = inspectJsonFile(journalFile());
    // 中身を読めないだけ（一瞬つかまれている・フォルダーになっている）なら外さない。MOD のフォルダーを元に戻す情報なので（PR3 の最後のレビューの軽い 6）。
    if (pending.reason && !pending.bytes) throw new Error('途中の記録を読めません。もう一度「復旧」を押してください');
    if (pending.reason) {
      const brokenFile = setAsideBrokenFile(journalFile(), { now });
      try { recordRecovery?.({ file: journalFile(), reason: pending.reason, action: 'set-aside', brokenFile }); } catch { /* 記録できなくても復旧は止めない */ }
    } else if (!pending.missing) restore(pending.value);
    return list();
  }
  // BridgeMOD・DisplayMOD・OBSMOD（全ゲームの標準装備）の jar。OBSMOD はサーバーにだけ入れる（serverOnly）。
  function commonModFiles() {
    const commonPath = bridgeJar(), commonBytes = plainFile(commonPath);
    if (!jarModIds(commonBytes).includes('bridgemod')) throw new Error('BridgeMODのビルド済みjarが必要です');
    const commonName = path.basename(commonPath);
    if (!safeName(commonName) || !commonName.endsWith('.jar')) throw new Error('BridgeMODのjarファイル名が不正です');
    const commonFiles = { [commonName]: commonBytes }, displayPath = displayJar();
    if (!displayPath) throw new Error('標準装備のDisplayMODがありません。表示MODのビルド済みjarが必要です');
    const bytes = plainFile(displayPath), name = path.basename(displayPath);
    if (!safeName(name) || !name.endsWith('.jar') || name.toLowerCase() === commonName.toLowerCase() || !jarModIds(bytes).includes('displaymod')) throw new Error('DisplayMODのjarを確認してください');
    commonFiles[name] = bytes;
    // 標準装備の OBSMOD は、サーバーにだけ入れる（Minecraft 本体には入れない。2026-10-25 ユーザーの決定）。
    // jar が無ければ入れない。そのときサーバーにあった OBSMOD も、切り替え・更新の入れ替えで外れる（開発版で ObsMod を作っていないときだけ。配布版の雛形にはいつも入っている）。
    const serverOnly = {}, obsPath = obsJar();
    if (obsPath) {
      const obsBytes = plainFile(obsPath), obsName = path.basename(obsPath);
      if (!safeName(obsName) || !obsName.endsWith('.jar') || Object.keys(commonFiles).some(n => n.toLowerCase() === obsName.toLowerCase()) || !jarModIds(obsBytes).includes('minecraft_obs_bridge')) throw new Error('OBSMODのjarを確認してください');
      serverOnly[obsName] = obsBytes;
    }
    return { shared: commonFiles, serverOnly };
  }
  // サーバー（side 0）と Minecraft（side 1）の mods に置く jar：標準装備とゲームMOD。
  function modFiles(pack, commonFiles, side) {
    const files = { ...commonFiles.shared, ...(side === 0 ? commonFiles.serverOnly : {}) };
    if (pack) { const name = pack.manifest[side === 0 ? 'serverJar' : 'clientJar']; if (Object.keys(files).some(n => n.toLowerCase() === name.toLowerCase())) throw new Error('ゲームMODと共通MODのファイル名が重複しています'); files[name] = pack.files[name]; }
    return files;
  }
  const commandFolder = () => bridgeCommandsDir(path.dirname(configPath()));
  // ゲームのコマンド（game_<id>_<key>.txt）の中身。
  function gameCommandFiles(id, pack) {
    return Object.fromEntries((pack?.manifest.commands || []).map(c => [`game_${id}_${c.key}.txt`, `# TITLE: ${c.title}\n# CATEGORY: ${c.category}\n${c.destructive ? '# DESTRUCTIVE: true\n' : ''}# DISPLAY_OWNER: ${c.commonDisplay === true ? 'bridge' : 'game'}\n${c.command.includes('{Count}') ? '# COUNT_MODE: aggregate\n' : ''}${pack.manifest.bridgeEventApi === 1 ? `# GAME_MOD: ${pack.manifest.modId}\n# GAME_KEY: ${c.key}\n` : ''}${c.command}\n`]));
  }
  function assertGameCommandKeys(pack, commandDir) {
    for (const command of pack?.manifest.commands || []) {
      if (!saikutu.FILES.has(command.key + '.txt') && fs.existsSync(path.join(commandDir, command.key + '.txt')))
        throw new Error('共通コマンドとゲームコマンドのkeyが重複しています: ' + command.key);
    }
  }
  async function activate(id) {
    if (!games.some(g => g.id === id)) throw new Error('ゲームを選択してください');
    if (fs.existsSync(journalFile())) throw new Error('前回の切替を復旧してから切り替えてください');
    await ensureStopped();
    const dirs = targets(), current = state();
    clearMapLeftovers(dirs[0]);
    const pack = id === 'common' ? null : packageFor(current, id);
    const commonFiles = commonModFiles();
    const before = fs.readFileSync(configPath(), 'utf8');
    // ギフト設定が壊れていて読めなくても止めない。切り替えた直後に壊れたとき、前のゲームを選び直して直せるように
    // （写しは前のゲームのものなので戻さない。設計書 6.6。2026-10-24 ユーザーの決定。PR3 の最後のレビューの重要 1）。
    // ゲームによらない部分（TikTok ID・つなぎ方など）はギフト設定の写し（ゲームが違っても使う）、無ければ新しい設定の雛形から取る。
    const parsed = peekJsonFile(configPath());
    const unreadable = !parsed;
    const config = parsed || clone(peekJsonFile(lastGoodPath(configPath())) || newBridgeConfig());
    const commandDir = commandFolder();
    const gameFiles = gameCommandFiles(id, pack);
    assertGameCommandKeys(pack, commandDir);
    // 切り替えで消すゲームのファイル（大文字の GAME_RUN_X.TXT も同じゲームのもの。処理のコピー PR6）。
    const oldNames = fs.existsSync(commandDir) ? fs.readdirSync(commandDir).filter(isGameCommandFile) : [];
    const next = clone(current);
    // 読めなかったギフト設定（写し・雛形で埋めたもの）で、今のゲームの保存済みの設定を上書きしない。
    // options はゲームによらない（送り方・ポートなど）ので写さない。演出・ゲーム性設定（options.gameplay）は仕掛けごとなくした（2026-10-30）。
    if (!unreadable) next.profiles[current.active] = profileOf(config);
    // Preserve the complete previous profile, and carry its bindings into mining on first selection.
    for (const [profileId, profile] of Object.entries(next.profiles)) {
      if (saikutu.hasLegacy(profile)) {
        next.legacySaikutuProfiles ||= {};
        // あとから採掘へ移したコマンド（2026-10-12 の give_haste など）の引き継ぎでも、前の退避は上書きせず別の名前で足す。
        const backupId = Object.hasOwn(next.legacySaikutuProfiles, profileId) ? `${profileId}@${new Date().toISOString()}` : profileId;
        next.legacySaikutuProfiles[backupId] = clone(profile);
        // 採掘のプロフィールを初めて作るとき、埋め立て・RUN など他のゲーム専用のコマンドは写さない（採掘では使えず、切り替えが止まる。PR #84 レビュー）。
        if (!next.profiles.saikutu) next.profiles.saikutu = withoutOtherGameCommands(saikutu.mapLegacy(profile), 'saikutu');
        next.profiles[profileId] = profileId === 'saikutu' ? saikutu.mapLegacy(profile) : saikutu.withoutLegacy(profile);
      }
    }
    const destination = id === current.active && !unreadable ? next.profiles[id] : next.profiles[id] || { mappings: [], likeEvents: [] };
    const available = new Set([...(fs.existsSync(commandDir) ? fs.readdirSync(commandDir).filter(n => isTxtName(n) && !oldNames.includes(n) && !saikutu.FILES.has(n)) : []), ...Object.keys(gameFiles)].map(n => n.toLowerCase()));
    // 確かめるのは BRIDGE が動かしうる参照だけ（command_files.cjs の commandFileRefs。保存の確かめと同じ。処理のコピー PR5）。
    for (const ref of commandFileRefs(destination)) {
      if (!available.has(ensureTxt(ref.commandFile).toLowerCase())) throw new Error(`保存済みの設定で使うコマンドがありません: ${ref.commandFile}。元のゲームパックを登録するか設定を修正してください`);
    }
    const commandBefore = Object.fromEntries([...new Set([...oldNames, ...Object.keys(gameFiles)])].map(n => [n, fs.existsSync(path.join(commandDir, n)) ? fs.readFileSync(path.join(commandDir, n), 'utf8') : null]));
    const operation = crypto.randomUUID();
    // マップの入れ替え（ほかのゲームから埋め立てに切り替えた・埋め立てから出る）の下準備。初期マップが無ければ、ここで何も変えずに止まる。
    const { step: mapStep, levelBefore } = await prepareMapStep(current, id, operation);
    fs.mkdirSync(root(), { recursive: true });
    const journal = { id: operation, roots: dirs, hadMods: dirs.map(d => fs.existsSync(path.join(d, 'mods'))), configPath: path.resolve(configPath()), configBefore: before, stateBefore: current, commandBefore,
      ...(mapStep ? { map: journalMap(mapStep) } : {}) };
    // Prepare and verify both sides before moving either current mods folder.
    for (const [i, dir] of dirs.entries()) {
      const staged = path.join(dir, '.mygamepack-mod-switch', operation, 'next'); fs.mkdirSync(staged, { recursive: true });
      const files = modFiles(pack, commonFiles, i);
      for (const [name, bytes] of Object.entries(files)) { fs.writeFileSync(path.join(staged, name), bytes); if (hash(fs.readFileSync(path.join(staged, name))) !== hash(bytes)) throw new Error('MODコピーの確認に失敗しました'); }
    }
    writeJson(journalFile(), journal);
    try {
      applyMapStep(mapStep);
      for (const [i, dir] of dirs.entries()) {
        beforeStep(i);
        const slot = path.join(dir, '.mygamepack-mod-switch', operation), mods = path.join(dir, 'mods');
        if (fs.existsSync(mods)) fs.renameSync(mods, path.join(slot, 'previous'));
        fs.renameSync(path.join(slot, 'next'), mods);
      }
      for (const key of PROFILE_KEYS) delete config[key];
      // 前の版は options.gameplay をゲーム別に写していた。profiles.json に残った options は外し、今の options（送り方・ポートなど）を上書きしない（2026-10-30）。
      const { options: _oldProfileOptions, ...bindings } = destination;
      Object.assign(config, bindings);
      config.gameProfile = id;
      for (const name of oldNames) fs.unlinkSync(path.join(commandDir, name));
      for (const [name, text] of Object.entries(gameFiles)) atomicWrite(path.join(commandDir, name), text);
      // ゲーム別に保存した設定は更新前のこともあるので、保存済みの設定と同じ直しを通して書く（2026-10-18 設計書の 7。PR3 の最終レビュー）。
      const migrated = migrateBridgeConfig(config);
      if (migrated.changes.length) console.log(`[Config] ゲームの設定を直しました: ${migrated.changes.join("、")}`);
      writeWithLastGood(configPath(), JSON.stringify(migrated.config, null, 2), { now });
      next.active = id; next.appliedRoots = dirs; next.appliedFormat = 3; recordWorlds(next, current, id, mapStep, levelBefore); stateStore.write(next);
      fs.unlinkSync(journalFile());
      finishMapStep(mapStep);
      return { ...list(), backupFolders: dirs.map(d => path.join(d, '.mygamepack-mod-switch', operation, 'previous')) };
    } catch (error) {
      try { restore(journal); } catch (rollback) { throw new Error(`切替を完了できませんでした。復旧が必要です: ${rollback.message}（原因: ${error.message}）`); }
      throw new Error(`切替に失敗したため元へ戻しました: ${error.message}`);
    }
  }
  // アプリを更新したあと、今のゲームの MOD（BridgeMOD・DisplayMOD・ゲームMOD）の jar だけを、両側で新しい版に入れ替え、
  // ゲームのコマンドも新しくする。ほかの MOD やファイルには触らない（2026-10-13 ユーザーの決定。「保存」は mods を丸ごと退避する）。
  // 入れ替えた古い jar は .mygamepack-mod-switch/<処理ID>/replaced へ退避する。途中で失敗したら両側を元に戻す。
  async function refreshMods() {
    if (fs.existsSync(journalFile())) throw new Error('前回の切替が途中で止まっています。ホームで切替前の状態に戻してください');
    if (!list().applied) throw new Error('ゲームがまだ保存されていません');
    await ensureStopped();
    const dirs = targets(), current = state(), id = current.active;
    const pack = id === 'common' ? null : packageFor(current, id);
    const commonFiles = commonModFiles(), commandDir = commandFolder(), commands = gameCommandFiles(id, pack);
    assertGameCommandKeys(pack, commandDir);
    // アプリが置く MOD かは、jar の中の MOD ID で見分ける（名前を変えた古い版も見つける）。
    const own = new Set([...RESERVED_MOD_IDS, ...(pack ? [pack.manifest.modId] : [])]);
    const plans = dirs.map((dir, side) => {
      const mods = path.join(dir, 'mods'), files = modFiles(pack, commonFiles, side);
      const names = fs.existsSync(mods) ? fs.readdirSync(mods) : [];
      const same = name => { try { return hash(plainFile(path.join(mods, name))) === hash(files[name]); } catch { return false; } };
      const ours = name => { if (!/\.jar$/i.test(name)) return false; try { return jarModIds(plainFile(path.join(mods, name))).some(m => own.has(m)); } catch { return false; } };
      const stale = names.filter(name => ours(name) && !(Object.hasOwn(files, name) && same(name)));
      const missing = Object.keys(files).filter(name => !(names.includes(name) && same(name)));
      return { dir, mods, files, stale, missing };
    });
    const changed = plans.some(p => p.stale.length || p.missing.length);
    const operation = crypto.randomUUID(), undo = [];
    try {
      if (changed) for (const p of plans) {
        const replaced = path.join(p.dir, '.mygamepack-mod-switch', operation, 'replaced');
        fs.mkdirSync(p.mods, { recursive: true });
        const putAside = name => {
          fs.mkdirSync(replaced, { recursive: true });
          fs.renameSync(path.join(p.mods, name), path.join(replaced, name));
          undo.push(() => fs.renameSync(path.join(replaced, name), path.join(p.mods, name)));
        };
        for (const name of p.stale) putAside(name);
        for (const name of p.missing) {
          const file = path.join(p.mods, name);
          // 同じ名前でアプリの MOD と分からないファイル（壊れた jar など）も、上書きせずに退避する（PR #91 再レビュー）。
          if (!p.stale.includes(name) && fs.existsSync(file) && fs.lstatSync(file).isFile()) putAside(name);
          atomicWrite(file, p.files[name]);
          undo.push(() => fs.rmSync(file, { force: true }));
          if (hash(fs.readFileSync(file)) !== hash(p.files[name])) throw new Error('MODコピーの確認に失敗しました');
        }
      }
      // ゲームのコマンドも、書けなかったら MOD ごと元に戻せるよう、前の中身を覚えてから書く（PR #91 再レビュー）。
      for (const [name, text] of Object.entries(commands)) {
        const file = path.join(commandDir, name), before = fs.existsSync(file) && fs.lstatSync(file).isFile() ? fs.readFileSync(file) : null;
        atomicWrite(file, text);
        undo.push(() => before === null ? fs.rmSync(file, { force: true }) : atomicWrite(file, before));
      }
    } catch (error) {
      let left = 0;
      for (const step of undo.reverse()) { try { step(); } catch { left++; } }
      if (left) throw new Error(`MODを入れ替えられず、${left}件を元に戻せませんでした。サーバーとMinecraftの .mygamepack-mod-switch/${operation}/replaced を確認してください（原因: ${error.message}）`);
      throw new Error(`MODを入れ替えられなかったため元へ戻しました: ${error.message}`);
    }
    return { changed, game: id };
  }
  // TOP の「マップを初期化」：今のゲームの初期マップを map_backup から写し直し、遊んだマップを消す（MOD・設定・コマンドには触らない）。
  // 途中で失敗・アプリが落ちたときは、切り替えと同じ途中の記録で戻す（mods は動かさないので commandBefore は空）。
  async function resetMap() {
    if (fs.existsSync(journalFile())) throw new Error('前回の切替を復旧してから初期化してください');
    // サーバーの止まりを先に見る（画面が、サーバーが動いている理由を先に出せるように）。
    await ensureServerStopped();
    if (!list().applied) throw new Error('ゲームを「保存」してから初期化してください');
    const current = state();
    if (!gameOf(current.active)?.maps?.length) throw new Error('このゲームには初期化できるマップがありません');
    const dirs = targets();
    clearMapLeftovers(dirs[0]);
    const operation = crypto.randomUUID();
    const { step, levelBefore } = await prepareMapStep(current, current.active, operation, { reset: true });
    // 専用マップと専用でないワールドを両方使うゲームで、今が専用でないワールドなら初期化しない（重要2）。
    if (!step) throw new Error('今の配信ワールドはこのゲームの専用マップではないので、初期化できません。「配信ワールド」でこのゲームの専用マップを選んでから押してください');
    fs.mkdirSync(root(), { recursive: true });
    const journal = { id: operation, roots: dirs, hadMods: dirs.map(d => fs.existsSync(path.join(d, 'mods'))), configPath: path.resolve(configPath()),
      configBefore: fs.readFileSync(configPath(), 'utf8'), stateBefore: current, commandBefore: {}, map: journalMap(step) };
    writeJson(journalFile(), journal);
    try {
      applyMapStep(step);
      const next = clone(current); recordWorlds(next, current, current.active, step, levelBefore); stateStore.write(next);
      fs.unlinkSync(journalFile());
    } catch (error) {
      try { restore(journal); } catch (rollback) { throw new Error(`マップを初期化できませんでした。復旧が必要です: ${rollback.message}（原因: ${error.message}）`); }
      throw new Error(`マップを初期化できなかったため元へ戻しました: ${error.message}`);
    }
    finishMapStep(step);
    return list();
  }
  // 切り替えの記録の「今のゲーム」を読むだけ（無い・壊れていれば null）。ギフト設定の写しを使ってよいかを確かめるため（設計書 6.6）。
  const peekActive = () => peekJsonFile(stateFile(), stateProblem)?.active ?? null;
  return { list, install, activate, recover, refreshMods, resetMap, peekActive };
}

module.exports = { GAMES, PROFILE_KEYS, jarModIds, inspectPackage, createGameProfiles };
