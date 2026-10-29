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
  const configBefore = fs.readFileSync(x.config, 'utf8');
  const stateBefore = JSON.parse(fs.readFileSync(path.join(x.storage, 'profiles.json'), 'utf8'));
  // 初期化の途中で落ちた形：前のマップは slot/previous にあり、新しいマップが使う場所にあり、server.properties は書き換わった。
  const x2 = writeCrashJournal(x, { configBefore, stateBefore });
  // 落ちたあと「切替前の状態に戻す」を押すまでに、ダッシュボードでほかの設定を変えた。
  fs.writeFileSync(x.properties, x.props().replace('motd=テスト', 'motd=変えた'));
  assert.equal(x.api.list().recoveryRequired, true);
  await x.api.recover();
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played', '前のマップが戻る');
  const aside = fs.readdirSync(x2.slot).filter(n => n.startsWith('interrupted-'));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(x2.slot, aside[0], 'level.dat'), 'utf8'), 'new', '新しいマップはよけておく');
  assert.equal(x.levelName(), USE, 'level-name だけを前に戻す');
  assert.match(x.props(), /^motd=変えた$/m, 'その間に変えたほかの行は消さない');
  assert.equal(x.api.list().recoveryRequired, false);
});

// 落ちた形の途中の記録を手で作る（map を変えて、場所がおかしい記録も作れる）。
function writeCrashJournal(x, { configBefore, stateBefore, map = {} }) {
  const id = crypto.randomUUID(), slot = x.at(`.mygamepack-map-switch/${id}`);
  fs.mkdirSync(slot, { recursive: true });
  fs.renameSync(x.at(USE), path.join(slot, 'previous'));
  put(x.at(`${USE}/level.dat`), 'new');
  x.setLevel('haihu_world/changed');
  fs.writeFileSync(path.join(x.storage, 'pending-switch.json'), JSON.stringify({ id, roots: [x.server, x.client].map(p => path.resolve(p)), hadMods: [true, true],
    configPath: path.resolve(x.config), configBefore, stateBefore, commandBefore: {},
    map: { slot, use: x.at(USE), fresh: true, hadUse: true, propertiesFile: x.properties, hadProperties: true, levelBefore: USE, ...map } }));
  return { id, slot };
}

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
// 配信ワールドをゲームごとに（2026-10-30 ユーザーの決定。docs/superpowers/plans/2026-10-30-game-worlds.md）：
// 専用マップの無いゲーム（採掘など）は、覚えたワールド → 今のワールド → 専用マップを持つゲームに入る前のワールド → haihu_world/world の順。
test('planMapChange: どのときに写す・level-name だけ合わせる・戻す・何もしないか', () => {
  const { planMapChange } = require('../game_maps.cjs');
  const umetate = { id: 'umetate', maps: ['umetate_lab_map'], resetMapOnSwitch: true };
  const saikutuWithMap = { id: 'saikutu', maps: ['saikutu_a'] };
  const common = { id: 'common' }, saikutu = { id: 'saikutu', freeWorlds: true }, run = { id: 'run' };
  const games = [common, saikutu, umetate, run];
  const plan = args => planMapChange({ games, ...args });
  const enter = (name, fresh) => ({ kind: 'enter', name, level: `haihu_world/${name}`, fresh });
  const level = to => ({ kind: 'level', level: to });
  // 埋め立てにほかのゲームから入る：使う場所にマップがあっても初期に戻す。
  assert.deepEqual(plan({ target: umetate, switching: true, currentLevel: 'haihu_world/world', useReady: true }), enter('umetate_lab_map', true));
  // 同じゲームのまま。
  assert.equal(plan({ target: umetate, switching: false, currentLevel: USE, useReady: true }), null);
  assert.deepEqual(plan({ target: umetate, switching: false, currentLevel: 'haihu_world/world', useReady: true }), enter('umetate_lab_map', false));
  assert.deepEqual(plan({ target: umetate, switching: false, currentLevel: USE, useReady: false }), enter('umetate_lab_map', true));
  // 初期化のボタン。
  assert.deepEqual(plan({ target: umetate, switching: false, currentLevel: USE, useReady: true, reset: true }), enter('umetate_lab_map', true));
  // マップはあるが、切り替えで初期に戻さないゲーム（あとの採掘の形。専用マップだけ）。
  assert.deepEqual(planMapChange({ games: [common, saikutuWithMap, umetate], target: saikutuWithMap, switching: true, currentLevel: USE, useReady: true }), enter('saikutu_a', false));
  assert.deepEqual(planMapChange({ games: [common, saikutuWithMap, umetate], target: saikutuWithMap, switching: true, currentLevel: 'haihu_world/world', useReady: false }), enter('saikutu_a', true));
  // 専用マップの無いゲーム：覚えたワールドがあればそれ（切り替えたときだけ）。
  assert.deepEqual(plan({ target: saikutu, switching: true, currentLevel: USE, remembered: 'haihu_world/event', fallback: 'haihu_world/sakura' }), level('haihu_world/event'));
  assert.deepEqual(plan({ target: saikutu, switching: true, currentLevel: 'haihu_world/other', remembered: 'haihu_world/event' }), level('haihu_world/event'));
  assert.equal(plan({ target: saikutu, switching: true, currentLevel: 'haihu_world/event', remembered: 'haihu_world/event' }), null);
  assert.equal(plan({ target: saikutu, switching: false, currentLevel: 'haihu_world/other', remembered: 'haihu_world/event' }), null, '同じゲームのまま保存し直しても、覚えたワールドへ動かさない');
  // 覚えたワールドが埋め立てのマップ（使えない）なら使わない。
  assert.equal(plan({ target: saikutu, switching: true, currentLevel: 'haihu_world/other', remembered: USE }), null);
  // 覚えたワールドが無ければ、今のワールドが使えるならそのまま。使えなければ入る前のワールド、それも無ければ haihu_world/world。
  assert.equal(plan({ target: saikutu, switching: true, currentLevel: 'haihu_world/sakura' }), null);
  assert.deepEqual(plan({ target: saikutu, switching: true, currentLevel: USE, fallback: 'haihu_world/sakura' }), level('haihu_world/sakura'));
  assert.deepEqual(plan({ target: saikutu, switching: true, currentLevel: USE }), level('haihu_world/world'));
  assert.deepEqual(plan({ target: common, switching: true, currentLevel: 'umetate_lab_map' }), level('haihu_world/world'), '直下の手で入れた umetate_lab_map も埋め立てのマップ');
  // 変わる所：マップの無いゲームどうしでも、埋め立てのマップを使っていたら haihu_world/world へ移す（採掘では埋め立てのマップを使わない）。
  assert.deepEqual(plan({ target: run, switching: true, currentLevel: 'umetate_lab_map' }), level('haihu_world/world'));
});

test('使えるワールド：専用マップを持つゲームはその専用マップだけ。採掘などは、どのゲームの専用マップでもないワールド全部と自分の専用マップ', () => {
  const { worldAllowed, worldsForGame } = require('../game_maps.cjs');
  const GAMES = require('../../bridge/games.json');
  const folders = ['world', 'event', 'my_build', 'umetate_lab_map'];
  assert.deepEqual(worldsForGame(GAMES, 'umetate', folders), ['umetate_lab_map']);
  assert.deepEqual(worldsForGame(GAMES, 'saikutu', folders), ['world', 'event', 'my_build']);
  assert.deepEqual(worldsForGame(GAMES, 'run', folders), ['world', 'event', 'my_build'], 'RUN は専用マップができるまで採掘と同じ');
  assert.deepEqual(worldsForGame(GAMES, 'common', folders), ['world', 'event', 'my_build']);
  assert.equal(GAMES.find(game => game.id === 'saikutu').freeWorlds, true, '採掘は専用でないワールドも使う');
  // あとで採掘に専用マップを足したとき：自分の専用マップも、専用でないワールドも使う。ほかのゲームでは採掘の専用マップを出さない。
  const later = GAMES.map(game => game.id === 'saikutu' ? { ...game, maps: ['saikutu_event'] } : game);
  assert.deepEqual(worldsForGame(later, 'saikutu', [...folders, 'saikutu_event']), ['world', 'event', 'my_build', 'saikutu_event']);
  assert.deepEqual(worldsForGame(later, 'run', [...folders, 'saikutu_event']), ['world', 'event', 'my_build']);
  // あとで RUN に専用マップを足したとき：RUN は RUN の専用マップだけ。採掘では RUN の専用マップを出さない。
  const withRun = GAMES.map(game => game.id === 'run' ? { ...game, maps: ['run_course'] } : game);
  assert.deepEqual(worldsForGame(withRun, 'run', [...folders, 'run_course']), ['run_course']);
  assert.deepEqual(worldsForGame(withRun, 'saikutu', [...folders, 'run_course']), ['world', 'event', 'my_build']);
  // 名前は haihu_world/<名前> の最後の名前で見る。
  assert.equal(worldAllowed(GAMES, GAMES.find(game => game.id === 'saikutu'), 'haihu_world/umetate_lab_map'), false);
  assert.equal(worldAllowed(GAMES, GAMES.find(game => game.id === 'saikutu'), 'haihu_world/event'), true);
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

// 「マップを初期化」（TOP のボタン。マップのあるゲームに出す。サバイバルには出さない。2026-10-29 ユーザーの決定）。
test('マップを初期化すると、今の埋め立てのマップが初期の状態に戻り、遊んだマップは消える', async t => {
  const x = fixture(t);
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  const commands = path.join(path.dirname(x.config), 'commands/minecraft');
  const snapshot = () => ({ server: fs.readdirSync(x.at('mods')).sort(), client: fs.readdirSync(path.join(x.client, 'mods')).sort(),
    config: fs.readFileSync(x.config, 'utf8'), commands: fs.readdirSync(commands).sort(), active: x.api.list().active, applied: x.api.list().applied });
  const before = snapshot();
  await x.api.resetMap();
  assert.deepEqual(contents(x.at(USE)), SAMPLE);
  assert.equal(x.levelName(), USE);
  assert.deepEqual(snapshot(), before, 'MOD・設定・コマンドのファイル・今のゲームは変えない');
  assert.deepEqual(x.switchDir(), []);
});

test('マップを初期化できないとき：保存前・マップの無いゲーム・途中の記録があるときは、何も変えずに止まる', async t => {
  const x = fixture(t);
  const props = x.props();
  await assert.rejects(x.api.resetMap(), /「保存」してから/);
  for (const id of ['saikutu', 'common']) {
    await x.api.activate(id);
    await assert.rejects(x.api.resetMap(), /初期化できるマップがありません/, id);
  }
  assert.equal(x.props(), props);
  assert.equal(fs.existsSync(x.at(USE)), false);
  fs.writeFileSync(path.join(x.storage, 'pending-switch.json'), '{}');
  await assert.rejects(x.api.resetMap(), /復旧/);
});

test('マップの初期化が途中で失敗したら元に戻す', async t => {
  let failMap = false;
  const x = fixture(t, { extras: { beforeStep: step => { if (step === 'map' && failMap) throw new Error('map locked'); } } });
  await x.api.activate('umetate');
  put(x.at(`${USE}/region/played.mca`), 'played');
  failMap = true;
  await assert.rejects(x.api.resetMap(), /元へ戻しました.*map locked/);
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played');
  assert.equal(x.levelName(), USE);
  assert.equal(x.api.list().recoveryRequired, false);
});

test('マップの初期化はサーバーの止まりだけを見る（BRIDGE・Minecraft が動いていてもよい）', async t => {
  let blockSwitch = false, blockServer = false;
  const x = fixture(t, { extras: {
    ensureStopped: async () => { if (blockSwitch) throw new Error('切替は止めてから'); },
    ensureServerStopped: async () => { if (blockServer) throw new Error('サーバーを止めてから'); },
  } });
  await x.api.activate('umetate');
  blockSwitch = true;
  await x.api.resetMap();
  blockServer = true;
  put(x.at(`${USE}/region/played.mca`), 'played');
  await assert.rejects(x.api.resetMap(), /サーバーを止めてから/);
  assert.equal(contents(x.at(USE))['region/played.mca'], 'played');
});

// 画面（ソースの文字を読む。今のテストと同じ書き方）。
test('画面: TOP の「マップを初期化」は、マップのあるゲームを保存したときに出し、先にサーバーを確かめてから確かめの画面を出す', () => {
  assert.match(read('electron/preload.cjs'), /gamesResetMap: \(\) => ipcRenderer\.invoke\('games:resetMap'\),/);
  const types = read('src/types/electron.d.ts');
  assert.match(types, /gamesResetMap: \(\) => Promise<GameStatus>;/);
  assert.match(types, /maps\?: string\[\]/);
  assert.match(types, /resetMapOnSwitch\?: boolean/);
  const ui = read('src/components/GameSelector.tsx');
  assert.ok(ui.includes('マップを初期化'));
  const reset = ui.slice(ui.indexOf('async function resetMap'), ui.indexOf('async function', ui.indexOf('async function resetMap') + 1));
  assert.ok(reset.includes('serverProcessStatus') && reset.includes('window.confirm('), 'resetMap の中でサーバーを確かめ、確かめの画面を出す');
  assert.ok(reset.indexOf('serverProcessStatus') < reset.indexOf('window.confirm('), 'サーバーが動いていたら、確かめの画面より先に理由を出す');
  assert.match(reset, /api\.gamesResetMap\(\)/);
  // ボタンは maps で出す（resetMapOnSwitch ではない。あとで採掘にマップを足したときも出るように）。保存の前の知らせは resetMapOnSwitch。
  // 保存済みかは、ほかの判断と同じ savedGame（サバイバルを保存していても保存済みに見せない。2026-10-29）。
  assert.match(ui, /const canResetMap = Boolean\(status && savedGame\(status\) && activeGame\?\.maps\?\.length\)/);
  assert.match(ui, /resetMapOnSwitch/);
  // 「くわしく」：配信ワールドはゲームごとに覚える（前は「MAPは変更しません」。2026-10-30）。
  assert.match(ui, /配信ワールドはゲームごとに覚え、切り替えると、そのゲームで前に使っていたワールドに戻します/);
  assert.doesNotMatch(ui, /MAPは変更しません{/);
  assert.match(read('src/lib/devApiMock.ts'), /gamesResetMap:/);
});

// ---- 最後のレビュー（opus）を受けて足したテスト（重要1・軽い1〜6） ----

test('埋め立ての前のワールド（haihu_world/sakura）に戻り、そのワールドが無くなっていれば haihu_world/world に戻す', async t => {
  const x = fixture(t, { level: 'haihu_world/sakura' });
  put(x.at('haihu_world/sakura/level.dat'), 'sakura');
  await x.api.activate('saikutu');
  await x.api.activate('umetate');
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/sakura', '記録した前のワールドへ戻す');
  await x.api.activate('umetate');
  fs.rmSync(x.at('haihu_world/sakura'), { recursive: true, force: true });
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/world', '前のワールドが無ければ haihu_world/world');
});

// ---- 配信ワールドをゲームごとに（2026-10-30 ユーザーの決定） ----

// RUN のパックはリポジトリに無いので、偽のパックを登録する（専用マップはまだ無い）。
async function installRun(x) {
  const folder = path.join(x.dir, 'run-pack');
  put(path.join(folder, 'game.json'), JSON.stringify({ format: 1, id: 'run', modId: 'runmod', serverJar: 'run.jar', clientJar: 'run.jar', commands: [{ key: 'race', title: 'レース', command: 'run race' }] }));
  fs.writeFileSync(path.join(folder, 'run.jar'), fakeModJar('runmod'));
  await x.api.install(folder);
}
const savedWorlds = x => JSON.parse(fs.readFileSync(path.join(x.storage, 'profiles.json'), 'utf8')).worlds;

test('採掘で選んだワールド（haihu_world/event）は、埋め立てをはさんで採掘に戻すとそのワールドに戻る', async t => {
  const x = fixture(t);
  put(x.at('haihu_world/event/level.dat'), 'event');
  await x.api.activate('saikutu');
  x.setLevel('haihu_world/event');
  await x.api.activate('umetate');
  assert.equal(x.levelName(), USE);
  assert.equal(savedWorlds(x).saikutu, 'haihu_world/event', '採掘の分として覚える');
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/event');
});

test('ワールドはゲームごとに覚える：採掘（event）→ RUN（other）→ 採掘は event、RUN は other', async t => {
  const x = fixture(t);
  await installRun(x);
  for (const name of ['event', 'other']) put(x.at(`haihu_world/${name}/level.dat`), name);
  await x.api.activate('saikutu');
  x.setLevel('haihu_world/event');
  await x.api.activate('run');
  assert.equal(x.levelName(), 'haihu_world/event', 'RUN の分はまだ無いので、今のワールドのまま');
  x.setLevel('haihu_world/other');
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/event', '採掘の分に戻る');
  await x.api.activate('run');
  assert.equal(x.levelName(), 'haihu_world/other', 'RUN の分に戻る');
  assert.deepEqual(savedWorlds(x), { common: 'haihu_world/world', saikutu: 'haihu_world/event', run: 'haihu_world/other' });
});

test('覚えたワールドが消えていたら、今のワールド（使えなければ入る前のワールド・haihu_world/world）にする', async t => {
  const x = fixture(t);
  await installRun(x);
  put(x.at('haihu_world/event/level.dat'), 'event');
  await x.api.activate('saikutu');
  x.setLevel('haihu_world/event');
  await x.api.activate('run');
  fs.rmSync(x.at('haihu_world/event'), { recursive: true, force: true });
  x.setLevel('haihu_world/world');
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/world', '覚えた event は無いので、今のワールドのまま');
});

test('切り替えに失敗したら、ワールドもゲームごとの記録も元に戻る', async t => {
  let fail = false;
  const x = fixture(t, { extras: { beforeStep: step => { if (fail && step === 1) throw new Error('client locked'); } } });
  put(x.at('haihu_world/event/level.dat'), 'event');
  await x.api.activate('saikutu');
  x.setLevel('haihu_world/event');
  await x.api.activate('umetate');
  const before = savedWorlds(x);
  fail = true;
  await assert.rejects(x.api.activate('saikutu'), /元へ戻しました.*client locked/);
  assert.equal(x.levelName(), USE, 'ワールドは切り替えの前のまま');
  assert.deepEqual(savedWorlds(x), before, '記録も切り替えの前のまま');
  fail = false;
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/event');
});

test('埋め立てのまま保存し直しても・初期化しても、「埋め立ての前のワールド」は変わらない', async t => {
  const x = fixture(t, { level: 'haihu_world/sakura' });
  for (const name of ['sakura', 'event', 'event2']) put(x.at(`haihu_world/${name}/level.dat`), name);
  await x.api.activate('umetate');
  x.setLevel('haihu_world/event');
  await x.api.activate('umetate');
  x.setLevel('haihu_world/event2');
  await x.api.resetMap();
  await x.api.activate('saikutu');
  assert.equal(x.levelName(), 'haihu_world/sakura', '埋め立てに切り替える前に使っていたワールド（設計書 3.3）');
});

test('初めて埋め立てに入るときに途中で失敗したら、写したマップを残さない', async t => {
  const x = fixture(t, { extras: { beforeStep: step => { if (step === 'map') throw new Error('map locked'); } } });
  await assert.rejects(x.api.activate('umetate'), /元へ戻しました.*map locked/);
  assert.equal(fs.existsSync(x.at(USE)), false, '前は無かったので、写したマップは使う場所から外す');
  assert.equal(x.levelName(), 'haihu_world/world');
  assert.equal(x.api.list().recoveryRequired, false);
});

test('途中で失敗したとき、その間に書き換えた server.properties のほかの行は残し、level-name だけを戻す', async t => {
  let fail = false;
  const x = fixture(t, { extras: { beforeStep: i => {
    if (!fail || i !== 1) return;
    fs.writeFileSync(x.properties, fs.readFileSync(x.properties, 'utf8').replace('motd=テスト', 'motd=変えた'));
    throw new Error('client locked');
  } } });
  await x.api.activate('umetate');
  fail = true;
  await assert.rejects(x.api.activate('saikutu'), /元へ戻しました.*client locked/);
  assert.equal(x.levelName(), USE, 'level-name は前（埋め立てのマップ）に戻る');
  assert.match(x.props(), /^motd=変えた$/m, '切り替えの間に変わったほかの行は消さない');
});

test('途中の記録のマップの場所がおかしければ、復旧は止まり、ほかのフォルダーを動かさない', async t => {
  for (const [label, map] of [
    ['サーバーの外の slot', dir => ({ slot: path.join(dir, 'outside') })],
    ['別の処理の slot', x => ({ slot: x.at(`.mygamepack-map-switch/${crypto.randomUUID()}`) })],
    ['マップでない use', x => ({ use: x.at('haihu_world/world') })],
    ['別の server.properties', dir => ({ propertiesFile: path.join(dir, 'server.properties') })],
    ['level-name の記録が無い', () => ({ levelBefore: 5 })],
  ]) {
    const x = fixture(t);
    await x.api.activate('umetate');
    const outside = path.join(x.dir, 'outside');
    put(path.join(outside, 'previous/keep.txt'), 'keep');
    const configBefore = fs.readFileSync(x.config, 'utf8'), stateBefore = JSON.parse(fs.readFileSync(path.join(x.storage, 'profiles.json'), 'utf8'));
    const arg = label === 'サーバーの外の slot' || label === '別の server.properties' ? x.dir : x;
    writeCrashJournal(x, { configBefore, stateBefore, map: map(arg) });
    await assert.rejects(x.api.recover(), /マップの場所が不正/, label);
    assert.equal(fs.readFileSync(path.join(outside, 'previous/keep.txt'), 'utf8'), 'keep', label);
    assert.equal(fs.readFileSync(x.at('haihu_world/world/level.dat'), 'utf8'), 'world', label);
  }
});

test('map_backup の古い方を消せなくても map_backup は欠けず、残りものは次の機会に消す', async t => {
  let failOld = false;
  const x = fixture(t, { extras: { removeTree: dir => { if (failOld && path.basename(dir).startsWith('.old-')) throw new Error('busy'); fs.rmSync(dir, { recursive: true, force: true }); } } });
  await x.api.activate('umetate');
  fs.writeFileSync(x.at(`${BACKUP}/level.dat`), 'broken');
  put(x.at('map_backup/umetate/.staging-left/level.dat'), 'left');
  failOld = true;
  await x.api.activate('saikutu');
  await x.api.activate('umetate');
  assert.deepEqual(contents(x.at(BACKUP)), SAMPLE, 'map_backup は配った物と同じ（半分にならない）');
  const left = () => fs.readdirSync(x.at('map_backup/umetate')).filter(n => n !== 'umetate_lab_map');
  assert.equal(left().filter(n => n.startsWith('.old-')).length, 1, '消せなかった古い方が残る');
  assert.equal(left().filter(n => n.startsWith('.staging-')).length, 0, '前に残った写しかけは消す');
  failOld = false;
  fs.writeFileSync(x.at(`${BACKUP}/level.dat`), 'broken');
  await x.api.activate('saikutu');
  await x.api.activate('umetate');
  assert.deepEqual(left(), [], '次の機会に消す');
});

test('マップのフォルダーをほかのアプリがつかんでいたら、少し待って試し直し、だめなら何を閉じればよいかを日本語で出す', t => {
  const { applyMapSwap } = require('../game_maps.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-maps-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const use = path.join(dir, 'haihu_world/umetate_lab_map'), slot = path.join(dir, 'slot');
  put(path.join(use, 'level.dat'), 'played'); put(path.join(slot, 'next/level.dat'), 'new');
  let calls = 0;
  const rename = () => { calls++; const error = new Error('EPERM: operation not permitted, rename'); error.code = 'EPERM'; throw error; };
  assert.throws(() => applyMapSwap({ fresh: true, use, slot, levelAfter: USE, propertiesFile: path.join(dir, 'server.properties') }, () => {}, { rename, wait: () => {} }),
    /ほかのアプリが使っています.*エクスプローラーなどで開いていたら閉じて/);
  assert.equal(calls, 4, '3回まで試し直す');
  let flaky = 0;
  applyMapSwap({ fresh: true, use, slot, levelAfter: USE, propertiesFile: path.join(dir, 'server.properties') }, () => {},
    { rename: (a, b) => { if (flaky++ < 2) { const error = new Error('EBUSY'); error.code = 'EBUSY'; throw error; } fs.renameSync(a, b); }, wait: () => {} });
  assert.equal(fs.readFileSync(path.join(use, 'level.dat'), 'utf8'), 'new', '一瞬つかまれていただけなら、試し直して通る');
});

test('初期マップが無いときの案内：配るアプリでは開発者向けの文を出さず、開発版だけ npm run dev:refresh を出す', async t => {
  for (const [hint, dev] of [[undefined, false], ['（開発版では npm run dev:refresh を動かしてください）', true]]) {
    const x = fixture(t, { extras: hint === undefined ? {} : { missingMapHint: hint } });
    fs.rmSync(path.dirname(x.bundledMap), { recursive: true, force: true });
    const error = await x.api.activate('umetate').then(() => null, e => e);
    assert.match(error.message, /初期マップがありません/);
    assert.equal(/npm run dev:refresh/.test(error.message), dev);
  }
  assert.match(read('electron/games_ipc.cjs'), /missingMapHint: app\.isPackaged \? '' : '（開発版では npm run dev:refresh を動かしてください）'/);
});
