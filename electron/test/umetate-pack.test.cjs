// 埋め立てのゲームパック（game-packs/umetate/game.json）と配り方（埋め立て PR2。2026-10-29）。
// コマンドは UmetateMod の `umetate <名前> [回数] [送った人]` の形（PR1）。名前・題名・版を MOD と照らし、ずれたら落とす。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectPackage, createGameProfiles } = require('../game_profiles.cjs');
const { fakeModJar } = require('./fake-mod-jar.cjs');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const pack = () => JSON.parse(read('game-packs/umetate/game.json'));
const JAVA = 'UmetateMod/src/main/java/jp/streamtorearn/stackinggame/';

// UmetateKeys.java の EVENTS・LAB の List.of(...) の中の名前。
function javaList(source, name) {
  const body = source.match(new RegExp(`${name}\\s*=\\s*List\\.of\\(([^;]*?)\\);`))?.[1];
  assert.ok(body, `UmetateKeys.${name} を読めた`);
  return [...body.matchAll(/"([a-z0-9_]+)"/g)].map(m => m[1]);
}
const umetateKeys = () => { const src = read(JAVA + 'command/UmetateKeys.java'); return [...javaList(src, 'EVENTS'), ...javaList(src, 'LAB')]; };
const umetateTitles = () => Object.fromEntries([...read(JAVA + 'integration/UmetateTitles.java').matchAll(/Map\.entry\("([a-z0-9_]+)",\s*"([^"]+)"\)/g)].map(m => [m[1], m[2]]));
const modVersion = () => read('UmetateMod/gradle.properties').match(/^mod_version=(.+)$/m)[1].trim();

test('埋め立てのゲームパック: ゲームの ID・MOD の ID・jar の名前（UmetateMod の版）', () => {
  const p = pack();
  assert.equal(p.format, 1);
  assert.equal(p.id, 'umetate');
  assert.equal(p.modId, 'stackinggame_events');
  assert.equal(p.bridgeEventApi, undefined, 'BridgeMOD にコマンドを打たせる（GameEvents の受け口は使わない）');
  assert.equal(p.serverJar, `stackinggame_events-${modVersion()}.jar`);
  assert.equal(p.clientJar, p.serverJar, 'Minecraft 本体にも同じ jar（白い光と揺れの描画のため）');
});

test('埋め立てのゲームパック: コマンドは UmetateMod の18個と同じ名前・同じ順・同じ題名で、umetate <名前> {Count} {ListenerName} の形', () => {
  const p = pack(), keys = umetateKeys(), titles = umetateTitles();
  assert.equal(keys.length, 18);
  assert.deepEqual(p.commands.map(c => c.key), keys);
  assert.ok(!p.commands.some(c => c.key === 'reset'), 'reset は配信者が打つもの。ギフトには載せない');
  for (const c of p.commands) {
    assert.equal(c.title, titles[c.key], `${c.key} の題名はゲームの中の表示と同じ`);
    assert.equal(c.command, `umetate ${c.key} {Count} {ListenerName}`);
    assert.equal(c.destructive, undefined, `${c.key} に保護エリアの印を付けない（2026-10-29 ユーザーの決定「マップボッコボコにしていい」）`);
    assert.equal(c.commonDisplay, undefined, `${c.key} の表示は UmetateMod が始まったときに出す`);
  }
});

// 一時フォルダーに game.json と偽の jar を置いた、埋め立てのゲームパック。
function packFolder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umetate-pack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = pack();
  fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify(p));
  fs.writeFileSync(path.join(dir, p.serverJar), fakeModJar(p.modId));
  // 配る物の研究室マップ（埋め立てに切り替えると写す。埋め立て PR3）の小さな見本。
  fs.mkdirSync(path.join(dir, 'maps/umetate_lab_map'), { recursive: true }); fs.writeFileSync(path.join(dir, 'maps/umetate_lab_map/level.dat'), 'lab');
  return dir;
}

test('埋め立てのゲームパック: アプリのゲームパックの確かめを通る（一覧の種類は UmetateMOD）', t => {
  const checked = inspectPackage(packFolder(t));
  assert.equal(checked.manifest.id, 'umetate');
  assert.equal(checked.manifest.commands.length, 18);
  assert.ok(checked.manifest.commands.every(c => c.category === 'UmetateMOD'));
});

test('埋め立てのゲームパック: 埋め立てを選んで保存すると、UmetateMod がサーバーと本体の両方に入り、OBSMOD はサーバーにだけ。コマンドのファイルはコマンドを打つ形', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umetate-activate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'サーバー'), client = path.join(dir, 'Minecraft'), storage = path.join(dir, 'profiles');
  for (const d of [server, client]) fs.mkdirSync(path.join(d, 'mods'), { recursive: true });
  const config = path.join(server, 'bridge', 'config.minecraft.json');
  fs.mkdirSync(path.join(path.dirname(config), 'commands/minecraft'), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ mappings: [], options: {} }));
  const jarAt = (name, id) => { const file = path.join(dir, name); fs.writeFileSync(file, fakeModJar(id)); return file; };
  const bridge = jarAt('bridgemod-1.8.3.jar', 'bridgemod'), display = jarAt('displaymod-1.1.0.jar', 'displaymod'), obs = jarAt('minecraft_obs_bridge-2.4.8.jar', 'minecraft_obs_bridge');
  const folder = packFolder(t);
  const api = createGameProfiles({ storage: () => storage, serverRoot: () => server, clientRoot: () => client, configPath: () => config,
    bridgeJar: () => bridge, displayJar: () => display, obsJar: () => obs, ensureStopped: async () => {}, bundledPackages: () => [{ id: 'umetate', folder }] });
  assert.equal(api.list().games.find(g => g.id === 'umetate').installed, true, '同梱のパックがあれば選べる');
  await api.activate('umetate');
  const jarName = pack().serverJar;
  assert.ok(fs.existsSync(path.join(server, 'mods', jarName)), 'サーバーに UmetateMod');
  assert.ok(fs.existsSync(path.join(client, 'mods', jarName)), 'Minecraft 本体にも UmetateMod');
  assert.ok(fs.existsSync(path.join(server, 'mods', 'minecraft_obs_bridge-2.4.8.jar')) && !fs.existsSync(path.join(client, 'mods', 'minecraft_obs_bridge-2.4.8.jar')), 'OBSMOD はサーバーにだけ');
  const commands = path.join(path.dirname(config), 'commands/minecraft');
  const voidbomb = fs.readFileSync(path.join(commands, 'game_umetate_voidbomb.txt'), 'utf8');
  for (const line of ['# TITLE: ボイドボム', '# CATEGORY: UmetateMOD', '# DISPLAY_OWNER: game', '# COUNT_MODE: aggregate']) assert.ok(voidbomb.includes(line), line);
  assert.doesNotMatch(voidbomb, /# GAME_MOD:|# DESTRUCTIVE:/, 'GameEvents の受け口は使わず、保護エリアの印も付けない');
  assert.equal(voidbomb.trim().split(/\r?\n/).at(-1), 'umetate voidbomb {Count} {ListenerName}');
  assert.equal(fs.readdirSync(commands).filter(n => n.startsWith('game_umetate_')).length, 18);
});

// 配り方（埋め立て PR2 の Task 2）：パックを作る台本は採掘と埋め立ての2つを作る。アプリは同梱の2つを見つける。
// どのゲームにパックがあるかは bridge/games.json の modDir の1か所（設計書 13：ほかの所は自分の一覧を持たない）。
test('配り方: ゲームパックのあるゲームは、games.json の modDir（埋め立て・採掘）', () => {
  const games = JSON.parse(read('bridge/games.json'));
  assert.deepEqual(games.filter(g => g.modDir).map(g => [g.id, g.modDir]), [['saikutu', 'SaikutuMod'], ['umetate', 'UmetateMod']]);
  for (const g of games.filter(g => g.modDir)) assert.ok(fs.existsSync(path.join(root, 'game-packs', g.id, 'game.json')), `${g.id} のゲームパックがある`);
});

function fakeRepo(t, { umetateJar = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umetate-repo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (name, content) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  for (const id of ['saikutu', 'umetate']) put(`game-packs/${id}/game.json`, read(`game-packs/${id}/game.json`));
  put('BridgeMod/gradle.properties', 'mod_version=1.8.3\n');
  put('DisplayMod/gradle.properties', 'mod_version=1.1.0\n');
  put('ObsMod/gradle.properties', 'mod_id=minecraft_obs_bridge\nmod_version=2.4.8\n');
  put('UmetateMod/gradle.properties', `mod_id=stackinggame_events\nmod_version=${modVersion()}\n`);
  const saikutu = JSON.parse(read('game-packs/saikutu/game.json'));
  put(`SaikutuMod/build/libs/${saikutu.serverJar}`, fakeModJar('saikutumod'));
  if (umetateJar) put(`UmetateMod/build/libs/${pack().serverJar}`, fakeModJar('stackinggame_events'));
  return dir;
}

test('配り方: パックを作る台本は、採掘と埋め立ての2つを作り、どちらもゲームパックの確かめを通る', t => {
  const { prepareGamePacks } = require('../../scripts/prepare-game-packs.cjs');
  const dir = fakeRepo(t);
  const made = prepareGamePacks(dir);
  assert.deepEqual(made.map(folder => path.relative(dir, folder).split(path.sep).join('/')), ['build/game-packs/saikutu', 'build/game-packs/umetate']);
  for (const folder of made) assert.doesNotThrow(() => inspectPackage(folder), folder);
  assert.ok(fs.existsSync(path.join(dir, 'build/game-packs/umetate', pack().serverJar)));
});

test('配り方: 埋め立ての MOD の jar が無ければ、UmetateMod を作るように言って止める', t => {
  const { prepareGamePacks } = require('../../scripts/prepare-game-packs.cjs');
  assert.throws(() => prepareGamePacks(fakeRepo(t, { umetateJar: false })), /UmetateMod/);
});

test('配り方: 採掘を選んでいるとき、アプリの更新で入れ替えるのは採掘MOD だけ。同梱の埋め立てMOD は入れない', async t => {
  const { refreshGameModsAfterUpdate } = require('../game_mods_refresh.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umetate-refresh-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'server'), client = path.join(dir, 'minecraft'), storage = path.join(dir, 'profiles');
  for (const d of [server, client]) fs.mkdirSync(path.join(d, 'mods'), { recursive: true });
  const config = path.join(server, 'bridge', 'config.minecraft.json');
  fs.mkdirSync(path.join(path.dirname(config), 'commands/minecraft'), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ mappings: [], options: {} }));
  const jarAt = (name, id) => { const file = path.join(dir, name); fs.writeFileSync(file, fakeModJar(id)); return file; };
  const bridge = jarAt('bridgemod-1.8.3.jar', 'bridgemod'), display = jarAt('displaymod-1.1.0.jar', 'displaymod');
  // 同梱の2つのパック（リポジトリの game.json。jar の名前だけ版ごとに変える）。
  const packs = path.join(dir, 'game-packs');
  const bundle = (id, jarName) => {
    const folder = path.join(packs, id), p = { ...JSON.parse(read(`game-packs/${id}/game.json`)), serverJar: jarName, clientJar: jarName };
    fs.rmSync(folder, { recursive: true, force: true }); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'game.json'), JSON.stringify(p));
    fs.writeFileSync(path.join(folder, jarName), fakeModJar(p.modId));
  };
  bundle('umetate', 'stackinggame_events-1.0.0.jar'); bundle('saikutu', 'saikutumod-1.0.0.jar');
  const api = createGameProfiles({ storage: () => storage, serverRoot: () => server, clientRoot: () => client, configPath: () => config,
    bridgeJar: () => bridge, displayJar: () => display, ensureStopped: async () => {},
    bundledPackages: () => ['umetate', 'saikutu'].map(id => ({ id, folder: path.join(packs, id) })) });
  await api.activate('saikutu');
  // アプリの更新：同梱の2つのパックがどちらも新しい版になる。
  bundle('umetate', 'stackinggame_events-1.0.1.jar'); bundle('saikutu', 'saikutumod-1.0.1.jar');
  let appConfig = { gameModsVersion: '1.0.0' };
  const result = await refreshGameModsAfterUpdate({ version: '1.0.1', readConfig: () => appConfig, writeConfig: patch => { appConfig = { ...appConfig, ...patch }; }, profiles: api });
  assert.deepEqual(result, { state: 'done', game: 'saikutu', changed: true });
  for (const d of [server, client]) {
    const names = fs.readdirSync(path.join(d, 'mods'));
    assert.ok(names.includes('saikutumod-1.0.1.jar'), `${d} の採掘MOD は新しい版`);
    assert.deepEqual(names.filter(n => n.startsWith('stackinggame_events')), [], `${d} に埋め立てMOD を入れない`);
  }
  assert.deepEqual(fs.readdirSync(path.join(path.dirname(config), 'commands/minecraft')).filter(n => n.startsWith('game_umetate_')), [], '埋め立てのコマンドも置かない');
});

test('配り方: アプリは同梱のゲームパック（採掘・埋め立て）を、配る物でも開発版でも見つける', t => {
  const { bundledGamePacks } = require('../bundled_game_packs.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umetate-bundled-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resources = path.join(dir, 'resources'), appDir = path.join(dir, 'repo', 'electron');
  const game = (base, id) => { fs.mkdirSync(path.join(base, id), { recursive: true }); fs.writeFileSync(path.join(base, id, 'game.json'), '{}'); };
  assert.deepEqual(bundledGamePacks({ packaged: true, resourcesPath: resources, appDir }), [], '何も無ければ空');
  game(path.join(resources, 'game-packs'), 'umetate');
  assert.deepEqual(bundledGamePacks({ packaged: true, resourcesPath: resources, appDir }), [{ id: 'umetate', folder: path.join(resources, 'game-packs', 'umetate') }], '片方だけならそれだけ');
  game(path.join(resources, 'game-packs'), 'saikutu');
  assert.deepEqual(bundledGamePacks({ packaged: true, resourcesPath: resources, appDir }).map(p => p.id), ['saikutu', 'umetate'], 'games.json の順（採掘・埋め立て）');
  for (const id of ['saikutu', 'umetate']) game(path.join(dir, 'repo', 'build', 'game-packs'), id);
  assert.deepEqual(bundledGamePacks({ packaged: false, resourcesPath: resources, appDir }), ['saikutu', 'umetate'].map(id => ({ id, folder: path.join(dir, 'repo', 'build', 'game-packs', id) })), '開発版は build/game-packs');
  const ipc = read('electron/games_ipc.cjs');
  assert.match(ipc, /bundledGamePacks\(/);
  assert.doesNotMatch(ipc, /'game-packs', 'saikutu'|game-packs\/saikutu/, '採掘を決め打ちしない');
});
