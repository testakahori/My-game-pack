// ゲームを切り替えたときのマップの入れ替え（埋め立て PR3。設計書 docs/superpowers/specs/2026-10-26-umetate-game-design.md の 3.3）。
// ほかのゲームから埋め立てに切り替えるたびに、map_backup の初期マップを haihu_world/umetate_lab_map に写して使う（ユーザーの決定）。
// 採掘・サバイバルに切り替えたときはマップに触らず、level-name を前のワールドに戻す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGameProfiles } = require('../game_profiles.cjs');
const { fakeModJar } = require('./fake-mod-jar.cjs');

const repo = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(repo, name), 'utf8');
// 配る物の研究室マップの、小さな見本。
const SAMPLE = { 'level.dat': 'lab level', 'region/r.0.0.mca': 'lab region', 'umetate_lab_map.json': '{"lab":true}' };
const USE = 'haihu_world/umetate_lab_map', BACKUP = 'map_backup/umetate/umetate_lab_map';

// フォルダーの中のファイルと中身（見本と比べる）。
function contents(folder) {
  if (!fs.existsSync(folder)) return null;
  return Object.fromEntries(fs.readdirSync(folder, { recursive: true }).map(n => String(n).split(path.sep).join('/'))
    .filter(n => fs.statSync(path.join(folder, n)).isFile()).sort().map(n => [n, fs.readFileSync(path.join(folder, n), 'utf8')]));
}
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

function fixture(t, { level = 'haihu_world/world', extras = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-maps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'サーバー'), client = path.join(dir, 'Minecraft'), storage = path.join(dir, 'profiles');
  for (const d of [server, client]) fs.mkdirSync(path.join(d, 'mods'), { recursive: true });
  const config = path.join(server, 'bridge', 'config.minecraft.json');
  fs.mkdirSync(path.join(path.dirname(config), 'commands/minecraft'), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ mappings: [], options: {} }));
  const properties = path.join(server, 'server.properties');
  fs.writeFileSync(properties, `motd=テスト\nlevel-name=${level}\nserver-port=25565\n`);
  put(path.join(server, 'haihu_world/world/level.dat'), 'world');
  const jarAt = (name, id) => { const file = path.join(dir, name); fs.writeFileSync(file, fakeModJar(id)); return file; };
  const bridge = jarAt('bridgemod-1.8.3.jar', 'bridgemod'), display = jarAt('displaymod-1.1.0.jar', 'displaymod');
  // 同梱の2つのパック（リポジトリの game.json と偽の jar）。埋め立てには maps/umetate_lab_map の見本。
  const packs = path.join(dir, 'game-packs');
  for (const id of ['umetate', 'saikutu']) {
    const manifest = JSON.parse(read(`game-packs/${id}/game.json`));
    put(path.join(packs, id, 'game.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(packs, id, manifest.serverJar), fakeModJar(manifest.modId));
  }
  const bundledMap = path.join(packs, 'umetate', 'maps', 'umetate_lab_map');
  for (const [name, text] of Object.entries(SAMPLE)) put(path.join(bundledMap, name), text);
  const api = createGameProfiles({ storage: () => storage, serverRoot: () => server, clientRoot: () => client, configPath: () => config,
    bridgeJar: () => bridge, displayJar: () => display, ensureStopped: async () => {},
    bundledPackages: () => ['umetate', 'saikutu'].map(id => ({ id, folder: path.join(packs, id) })), ...extras });
  const props = () => fs.readFileSync(properties, 'utf8');
  const levelName = () => props().match(/^level-name=(.*)$/m)[1];
  const setLevel = name => fs.writeFileSync(properties, props().replace(/^level-name=.*$/m, `level-name=${name}`));
  const at = name => path.join(server, name);
  const switchDir = () => { const p = at('.mygamepack-map-switch'); return fs.existsSync(p) ? fs.readdirSync(p) : []; };
  return { dir, server, client, storage, config, properties, api, props, levelName, setLevel, at, bundledMap, switchDir };
}

test('ほかのゲームから埋め立てに切り替えると、初期マップを map_backup に用意し、haihu_world/umetate_lab_map に写して level-name をそこにする', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  assert.deepEqual(contents(x.at(BACKUP)), SAMPLE);
  assert.deepEqual(contents(x.at(USE)), SAMPLE);
  assert.equal(x.levelName(), USE);
  assert.match(x.props(), /^motd=テスト$/m);
  assert.match(x.props(), /^server-port=25565$/m);
  assert.deepEqual(x.switchDir(), [], '作業のフォルダーは残さない');
});

test('埋め立てで遊んだマップは、ほかのゲームから切り替え直すと初期の状態に戻り、遊んだマップは消える', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  await x.api.activate('saikutu');
  await x.api.activate('umetate');
  assert.deepEqual(contents(x.at(USE)), SAMPLE);
  assert.deepEqual(x.switchDir(), [], '遊んだマップは消す');
});

test('埋め立てのまま保存し直しても、マップに触らない', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  await x.api.activate('umetate');
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played');
  // ダッシュボードで別のワールドにしていたら、写さずに level-name だけ埋め立てのマップに戻す。
  x.setLevel('haihu_world/world');
  await x.api.activate('umetate');
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played');
  assert.equal(x.levelName(), USE);
});

test('埋め立てから採掘に切り替えると、マップに触らずに前のワールドへ戻す', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/world');
  assert.deepEqual(contents(x.at(USE)), SAMPLE);
});

test('ダッシュボードで別のワールドを選んでいたら、埋め立てから出るときに level-name に触らない', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  x.setLevel('haihu_world/sakura');
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/sakura');
});

test('直下の umetate_lab_map を使っていたサーバー（手で入れたもの）でも、それを消さず、出るときは haihu_world/world に戻す', async t => {
  const x = fixture(t, { level: 'umetate_lab_map' });
  put(x.at('umetate_lab_map/level.dat'), 'manual');
  await x.api.activate('umetate');
  assert.equal(x.levelName(), USE);
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/world', '手で入れた umetate_lab_map には戻らない');
  assert.equal(fs.readFileSync(x.at('umetate_lab_map/level.dat'), 'utf8'), 'manual', '手で入れたマップは消さない');
});

test('map_backup が壊れていたら、配った物から写し直してから使う', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  fs.rmSync(x.at(`${BACKUP}/region/r.0.0.mca`));
  fs.writeFileSync(x.at(`${BACKUP}/level.dat`), 'broken');
  await x.api.activate('saikutu');
  await x.api.activate('umetate');
  assert.deepEqual(contents(x.at(BACKUP)), SAMPLE);
  assert.deepEqual(contents(x.at(USE)), SAMPLE);
});

test('配った物が無ければ map_backup を使い、両方無ければ何も変えずに止まる', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  fs.rmSync(path.dirname(x.bundledMap), { recursive: true, force: true });
  await x.api.activate('saikutu');
  put(x.at(`${USE}/region/played.mca`), 'played');
  await x.api.activate('umetate');
  assert.deepEqual(contents(x.at(USE)), SAMPLE, 'map_backup から写す');
  await x.api.activate('saikutu');
  fs.rmSync(x.at('map_backup'), { recursive: true, force: true });
  const snapshot = () => ({ server: fs.readdirSync(x.at('mods')).sort(), client: fs.readdirSync(path.join(x.client, 'mods')).sort(),
    config: fs.readFileSync(x.config, 'utf8'), props: x.props(), active: x.api.list().active, use: contents(x.at(USE)) });
  const before = snapshot();
  await assert.rejects(x.api.activate('umetate'), /初期マップがありません/);
  assert.deepEqual(snapshot(), before);
  assert.equal(x.api.list().recoveryRequired, false);
});

test('切り替えが途中で失敗したら、マップと level-name も元に戻す', async t => {
  let fail = false;
  const x = fixture(t, { extras: { beforeStep: i => { if (fail && i === 1) throw new Error('client locked'); } } });
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  await x.api.activate('saikutu');
  fail = true;
  await assert.rejects(x.api.activate('umetate'), /元へ戻しました.*client locked/);
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played', '前のマップに戻る');
  assert.equal(x.levelName(), 'haihu_world/world');
  assert.equal(x.api.list().active, 'saikutu');
  assert.equal(x.api.list().recoveryRequired, false);
});

test('マップをよけたところでアプリが落ちても、「切替前の状態に戻す」でマップと level-name が戻る', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  const propertiesBefore = x.props(), configBefore = fs.readFileSync(x.config, 'utf8');
  const stateBefore = JSON.parse(fs.readFileSync(path.join(x.storage, 'profiles.json'), 'utf8'));
  // 初期化の途中で落ちた形：前のマップは slot/previous にあり、新しいマップが使う場所にあり、server.properties は書き換わった。
  const id = crypto.randomUUID(), slot = x.at(`.mygamepack-map-switch/${id}`);
  fs.mkdirSync(slot, { recursive: true });
  fs.renameSync(x.at(USE), path.join(slot, 'previous'));
  put(x.at(`${USE}/level.dat`), 'new');
  x.setLevel('haihu_world/changed');
  fs.writeFileSync(path.join(x.storage, 'pending-switch.json'), JSON.stringify({ id, roots: [x.server, x.client].map(p => path.resolve(p)), hadMods: [true, true],
    configPath: path.resolve(x.config), configBefore, stateBefore, commandBefore: {},
    map: { slot, use: x.at(USE), fresh: true, hadUse: true, propertiesFile: x.properties, propertiesBefore } }));
  assert.equal(x.api.list().recoveryRequired, true);
  await x.api.recover();
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played', '前のマップが戻る');
  const aside = fs.readdirSync(slot).filter(n => n.startsWith('interrupted-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(slot, aside[0], 'level.dat'), 'utf8'), 'new', '新しいマップはよけておく');
  assert.equal(x.props(), propertiesBefore);
  assert.equal(x.api.list().recoveryRequired, false);
});

test('古いマップを消せなくても切り替えは成功し、次の切り替えのときに消える', async t => {
  let failRemove = false;
  const x = fixture(t, { extras: { removeTree: dir => { if (failRemove) throw new Error('busy'); fs.rmSync(dir, { recursive: true, force: true }); } } });
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  await x.api.activate('saikutu');
  failRemove = true;
  await x.api.activate('umetate');
  assert.deepEqual(contents(x.at(USE)), SAMPLE);
  const left = x.switchDir();
  assert.equal(left.length, 1, '消せなかった古いマップが残る');
  assert.equal(contents(x.at(`.mygamepack-map-switch/${left[0]}/previous`))['region/played.mca'], 'played');
  failRemove = false;
  await x.api.activate('saikutu');
  assert.deepEqual(x.switchDir(), [], '次の切り替えの始めに消す');
});

// ファイルに触らない決め方（決めたこと 1・6・7）。偽のゲームの項目で、あとで採掘に専用マップを足したときの形も確かめる。
test('planMapChange: どのときに写す・level-name だけ合わせる・戻す・何もしないか', () => {
  const { planMapChange } = require('../game_maps.cjs');
  const umetate = { id: 'umetate', maps: ['umetate_lab_map'], resetMapOnSwitch: true };
  const saikutuWithMap = { id: 'saikutu', maps: ['saikutu_a'] };
  const common = { id: 'common' }, saikutu = { id: 'saikutu' };
  const enter = (name, fresh) => ({ kind: 'enter', name, level: `haihu_world/${name}`, fresh });
  // 埋め立てにほかのゲームから入る：使う場所にマップがあっても初期に戻す。
  assert.deepEqual(planMapChange({ target: umetate, previous: common, switching: true, currentLevel: 'haihu_world/world', useReady: true }), enter('umetate_lab_map', true));
  // 同じゲームのまま。
  assert.equal(planMapChange({ target: umetate, previous: umetate, switching: false, currentLevel: USE, useReady: true }), null);
  assert.deepEqual(planMapChange({ target: umetate, previous: umetate, switching: false, currentLevel: 'haihu_world/world', useReady: true }), enter('umetate_lab_map', false));
  assert.deepEqual(planMapChange({ target: umetate, previous: umetate, switching: false, currentLevel: USE, useReady: false }), enter('umetate_lab_map', true));
  // 初期化のボタン。
  assert.deepEqual(planMapChange({ target: umetate, previous: umetate, switching: false, currentLevel: USE, useReady: true, reset: true }), enter('umetate_lab_map', true));
  // マップはあるが、切り替えで初期に戻さないゲーム（あとの採掘の形）。
  assert.deepEqual(planMapChange({ target: saikutuWithMap, previous: umetate, switching: true, currentLevel: USE, useReady: true }), enter('saikutu_a', false));
  assert.deepEqual(planMapChange({ target: saikutuWithMap, previous: common, switching: true, currentLevel: 'haihu_world/world', useReady: false }), enter('saikutu_a', true));
  // 出る：埋め立てのマップの名前のワールドを使っていたら戻す（直下の手で入れたものも）。別のワールドなら触らない。
  assert.deepEqual(planMapChange({ target: saikutu, previous: umetate, switching: true, currentLevel: USE, useReady: false }), { kind: 'leave' });
  assert.deepEqual(planMapChange({ target: common, previous: umetate, switching: true, currentLevel: 'umetate_lab_map', useReady: false }), { kind: 'leave' });
  assert.equal(planMapChange({ target: saikutu, previous: umetate, switching: true, currentLevel: 'haihu_world/sakura', useReady: false }), null);
  // マップの無いゲームどうし：手で入れた umetate_lab_map にも触らない。
  assert.equal(planMapChange({ target: saikutu, previous: common, switching: true, currentLevel: 'umetate_lab_map', useReady: false }), null);
});

test('server.properties: level-name だけを書き換え、無いときは world として読む', () => {
  const { mergeProperties, levelNameOf } = require('../server_properties.cjs');
  assert.equal(mergeProperties('a=1\r\nlevel-name=world\r\n# c\r\n', { 'level-name': 'haihu_world/x' }), 'a=1\nlevel-name=haihu_world/x\n# c\n');
  assert.equal(mergeProperties('a=1\n', { 'level-name': 'haihu_world/x' }), 'a=1\nlevel-name=haihu_world/x\n', '無いキーは最後に足す');
  assert.equal(levelNameOf(''), 'world');
  assert.equal(levelNameOf('level-name=haihu_world/x\r\n'), 'haihu_world/x');
  // initial_setup.cjs も同じものを使う（写しを持たない）。
  assert.match(read('electron/initial_setup.cjs'), /require\("\.\/server_properties\.cjs"\)/);
  assert.doesNotMatch(read('electron/initial_setup.cjs'), /function mergeProperties/);
});
