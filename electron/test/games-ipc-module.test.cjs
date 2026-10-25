// ゲームの選択・切り替え・Minecraft の保存先の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGamesIpc } = require('../games_ipc.cjs');
const { switchBlockedMessage } = require('../minecraft_processes.cjs');

function setup(t, { packaged = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'games-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appDir = path.join(root, 'app', 'electron'), server = path.join(root, 'server'), resources = path.join(root, 'resources');
  fs.mkdirSync(server, { recursive: true });
  const configPath = path.join(root, 'config.minecraft.json');
  fs.writeFileSync(configPath, '{}');
  const busy = { map: '', setup: false, starting: false, stopping: false, bridge: false, serverRunning: false, minecraft: { running: false, processes: [] } };
  const handlers = new Map();
  const gamesIpc = createGamesIpc({
    app: { isPackaged: packaged, getPath: name => path.join(root, name), getVersion: () => '9.9.9' },
    process: { resourcesPath: resources }, appDir,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    readAppConfig: () => ({}), writeAppConfig: () => {},
    getServerRoot: () => server, getConfigPath: () => configPath,
    getServerTemplatePath: () => path.join(resources, 'server-template'),
    assertMapIdle: () => { if (busy.map) throw new Error(busy.map); },
    isInitialSetupRunning: () => busy.setup, isServerStarting: () => busy.starting, isServerStopping: () => busy.stopping,
    isBridgeActive: () => busy.bridge,
    getServerProcessStatus: async () => ({ running: busy.serverRunning }),
    getMinecraftProcessStatus: async strict => { assert.equal(strict, true); return busy.minecraft; },
  });
  gamesIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, server, appDir, resources, busy, gamesIpc, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('ゲームの選択の記録の場所: userData/game-profiles/<サーバーの場所の sha256 の先頭16文字>（式を変えると、更新したあと今の記録が見つからなくなる）', t => {
  const x = setup(t);
  const hash = require('node:crypto').createHash('sha256').update(path.resolve(x.server)).digest('hex').slice(0, 16);
  assert.equal(x.gamesIpc.getGameProfilesDir(), path.join(x.root, 'userData', 'game-profiles', hash));
});

test('ゲームの操作: 進行中は作業中で、重ねず、設定の保存も止める。終われば（失敗でも）作業中でなくなる', async t => {
  const x = setup(t);
  let release;
  const running = x.gamesIpc.gameProfileOperation(() => new Promise(resolve => { release = resolve; }));
  assert.equal(x.gamesIpc.isGameProfileBusy(), true);
  await assert.rejects(x.gamesIpc.gameProfileOperation(async () => {}), /ゲームの操作が進行中です/);
  assert.throws(() => x.gamesIpc.assertGameProfileIdle(), /ゲームの切替中、または切替の復旧が必要です/);
  release('done');
  assert.equal(await running, 'done');
  assert.equal(x.gamesIpc.isGameProfileBusy(), false);
  await assert.rejects(x.gamesIpc.gameProfileOperation(async () => { throw new Error('失敗'); }), /失敗/);
  assert.equal(x.gamesIpc.isGameProfileBusy(), false);
  x.gamesIpc.assertGameProfileIdle();
});

test('ゲームの切り替え: MAP・初期セットアップ・サーバー・BRIDGE・Minecraft のどれかが動いていれば止める（main から受け取った関数で見る）', async t => {
  const x = setup(t);
  const status = await x.invoke('games:recover');
  assert.equal(status.recoveryRequired, false);
  assert.ok('modsOutdatedAfterUpdate' in status);
  x.busy.map = 'MAPを保存・読込中です。完了までお待ちください。';
  await assert.rejects(x.invoke('games:recover'), /MAPを保存・読込中です。/);
  x.busy.map = '';
  for (const key of ['setup', 'starting', 'stopping', 'bridge', 'serverRunning']) {
    x.busy[key] = true;
    await assert.rejects(x.invoke('games:recover'), /サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください/, key);
    x.busy[key] = false;
  }
  x.busy.minecraft = { running: true, processes: ['javaw.exe'] };
  await assert.rejects(x.invoke('games:recover'), { message: switchBlockedMessage(['javaw.exe']) });
});

test('同梱のゲームと DisplayMOD の場所: 開発版はリポジトリ、配布版は resources（main から受け取った appDir・process で決める）', async t => {
  const put = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}'); };
  const saikutu = status => status.games.find(game => game.id === 'saikutu').installed;
  const dev = setup(t);
  put(path.resolve(dev.appDir, '..', 'build', 'game-packs', 'saikutu', 'game.json'));
  put(path.resolve(dev.appDir, '..', 'DisplayMod', 'build', 'libs', 'displaymod-1.2.0.jar'));
  let status = await dev.invoke('games:list');
  assert.equal(saikutu(status), true);
  assert.equal(status.displayBundled, true);
  const packaged = setup(t, { packaged: true });
  status = await packaged.invoke('games:list');
  assert.equal(saikutu(status), false);
  assert.equal(status.displayBundled, false);
  put(path.join(packaged.resources, 'game-packs', 'saikutu', 'game.json'));
  put(path.join(packaged.resources, 'server-template', 'mods', 'displaymod-1.2.0.jar'));
  status = await packaged.invoke('games:list');
  assert.equal(saikutu(status), true);
  assert.equal(status.displayBundled, true);
});

// 標準装備の OBSMOD の場所：開発版はリポジトリの ObsMod/build/libs、配布版は雛形の mods（2026-10-25。最後のレビュー 軽い8）。
test('同梱の OBSMOD の場所: 開発版はリポジトリ、配布版は雛形の mods', async t => {
  const put = file => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}'); };
  const dev = setup(t);
  assert.equal((await dev.invoke('games:list')).obsBundled, false);
  put(path.resolve(dev.appDir, '..', 'ObsMod', 'build', 'libs', 'minecraft_obs_bridge-2.4.8.jar'));
  assert.equal((await dev.invoke('games:list')).obsBundled, true);
  const packaged = setup(t, { packaged: true });
  assert.equal((await packaged.invoke('games:list')).obsBundled, false);
  put(path.join(packaged.resources, 'server-template', 'mods', 'minecraft_obs_bridge-2.4.8.jar'));
  assert.equal((await packaged.invoke('games:list')).obsBundled, true);
});
