// アプリを更新したあと、今選んでいるゲームの MOD（サーバーと Minecraft の両方）とゲームのコマンドを、
// ホームの「保存」と同じ処理で自動で新しくする（2026-10-13 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameProfiles } = require('../game_profiles.cjs');
const { refreshGameModsAfterUpdate, gameModsOutdated } = require('../game_mods_refresh.cjs');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

function jar(id) {
  const name = Buffer.from('META-INF/mods.toml'), text = Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="${id}"\nversion="1.0"\n`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(text.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(text.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + text.length, 16);
  return Buffer.concat([local, name, text, central, name, end]);
}

// アプリに同梱の採掘パック（版ごとに jar の名前とコマンドが変わる）を、アプリの更新に見立てて差し替えられる下準備。
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-mods-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = path.join(root, 'server'), client = path.join(root, 'minecraft'), storage = path.join(root, 'profiles');
  for (const dir of [server, client]) { fs.mkdirSync(path.join(dir, 'mods'), { recursive: true }); fs.writeFileSync(path.join(dir, 'mods', 'other.jar'), 'other mod'); }
  const config = path.join(server, 'bridge', 'config.minecraft.json');
  fs.mkdirSync(path.join(server, 'bridge', 'commands', 'minecraft'), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ tiktokUsername: 'viewer', options: {}, mappings: [] }));
  const bridge = path.join(root, 'bridgemod-1.7.4.jar'); fs.writeFileSync(bridge, jar('bridgemod'));
  const display = path.join(root, 'displaymod-1.1.0.jar'); fs.writeFileSync(display, jar('displaymod'));
  const pack = path.join(root, 'game-packs', 'saikutu');
  function bundle(version, keys) {
    fs.rmSync(pack, { recursive: true, force: true }); fs.mkdirSync(pack, { recursive: true });
    const name = `saikutumod-${version}.jar`;
    fs.writeFileSync(path.join(pack, name), jar('saikutumod'));
    fs.writeFileSync(path.join(pack, 'game.json'), JSON.stringify({ format: 1, bridgeEventApi: 1, id: 'saikutu', modId: 'saikutumod', serverJar: name, clientJar: name,
      commands: keys.map(key => ({ key, title: key, command: `saikutu ${key} {Count} {ListenerName}` })) }));
  }
  let blocked = null;
  const api = createGameProfiles({ storage: () => storage, serverRoot: () => server, clientRoot: () => client, configPath: () => config,
    bridgeJar: () => bridge, displayJar: () => display, bundledPackages: () => fs.existsSync(pack) ? [{ id: 'saikutu', folder: pack }] : [],
    ensureStopped: async () => { if (blocked) throw new Error(blocked); } });
  let appConfig = { gameModsVersion: '1.0.0' };
  const options = version => ({ version, readConfig: () => appConfig, writeConfig: patch => { appConfig = { ...appConfig, ...patch }; }, profiles: api });
  const mods = dir => fs.readdirSync(path.join(dir, 'mods')).sort();
  return { server, client, api, bundle, options, mods, block: message => { blocked = message; }, appConfig: () => appConfig,
    command: key => path.join(server, 'bridge', 'commands', 'minecraft', `game_saikutu_${key}.txt`) };
}

test('アプリを更新したあと最初の起動で、採掘MODをサーバーと Minecraft の両方で新しい版にし、コマンドも新しくする', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.3.jar']);
  // アプリの更新：同梱の採掘パックが新しい版になり、コマンドも増える。
  x.bundle('1.1.4', ['otosiana', 'give_haste']);
  const result = await refreshGameModsAfterUpdate(x.options('1.0.1'));
  assert.deepEqual(result, { state: 'done', game: 'saikutu' });
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.4.jar']);
  assert.ok(fs.existsSync(x.command('give_haste')), '新しい版で増えたコマンドも置く');
  assert.equal(x.appConfig().gameModsVersion, '1.0.1');
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), false);
  // 同じ版での2回目からの起動では、何もしない（「保存」と同じ処理をくり返さない）。
  x.block('呼ばれてはいけない');
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'current' });
});

test('サーバーや Minecraft が動いていて入れ替えられないときは何も変えず、ホームに出し、次の起動でもう一度試す', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  x.bundle('1.1.4', ['otosiana']);
  x.block('Minecraftを終了してから切り替えてください');
  const failed = await refreshGameModsAfterUpdate(x.options('1.0.1'));
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /Minecraftを終了/);
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.3.jar'], '何も変えない');
  assert.equal(x.appConfig().gameModsVersion, '1.0.0', '済んだことにしない');
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), true, 'ホームに「MODが古いまま」と出す');
  // 次の起動（止まっている）でもう一度試して、入れ替える。
  x.block(null);
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'done', game: 'saikutu' });
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.4.jar']);
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), false);
});

test('まだ一度もゲームを「保存」していないときは何もしない', async t => {
  const x = fixture(t);
  x.bundle('1.1.4', ['otosiana']);
  x.block('呼ばれてはいけない');
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'skipped' });
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['other.jar']);
  assert.equal(x.appConfig().gameModsVersion, '1.0.1', 'あとで「保存」すれば今の版が置かれるので、済んだことにする');
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), false);
});

test('アプリの起動で、BRIDGE の展開のあとに入れ替え、ホームへ知らせる。「保存」したら済んだことにする', () => {
  const main = read('electron/main.cjs');
  const schedule = main.slice(main.indexOf('function scheduleBridgeSync()'), main.indexOf('async function ensureBridgeExtracted()'));
  assert.match(schedule, /ensureBridgeExtracted\(\)\s*\.then\(\(\) => refreshGameModsOnStartup\(\)\)/);
  const startup = main.slice(main.indexOf('async function refreshGameModsOnStartup('), main.indexOf('async function ensureBridgeExtracted()'));
  assert.match(startup, /if \(!cfg\.setupComplete \|\| !cfg\.serverFolder\) return;/, 'セットアップ前は何もしない');
  assert.match(startup, /refreshGameModsAfterUpdate\(\{ version: app\.getVersion\(\), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation \}\)/);
  assert.match(startup, /win\.webContents\.send\("games:changed"\)/);
  assert.match(main, /ipcMain\.handle\('games:list', \(\) => \(\{ \.\.\.gameProfiles\.list\(\), modsOutdatedAfterUpdate: gameModsOutdated\(readAppConfig\(\), app\.getVersion\(\)\) \}\)\);/);
  const activate = main.slice(main.indexOf("ipcMain.handle('games:activate'"), main.indexOf("ipcMain.handle('games:recover'"));
  assert.match(activate, /writeAppConfig\(\{ gameModsVersion: app\.getVersion\(\), gameModsRefreshFailed: '' \}\);/);
  assert.match(read('electron/preload.cjs'), /onGamesChanged: \(callback\) => \{/);
  const selector = read('src/components/GameSelector.tsx');
  assert.match(selector, /api\?\.onGamesChanged\?\./, 'ホームは知らせを受けたら読み直す');
  assert.match(selector, /status\?\.modsOutdatedAfterUpdate && <p role="alert">アプリの更新でMODが古いままです。サーバーと Minecraft を止めて「保存」を押してください。<\/p>/);
});
