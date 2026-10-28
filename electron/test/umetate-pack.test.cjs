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
