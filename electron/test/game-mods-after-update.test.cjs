// アプリを更新したあと、今選んでいるゲームの MOD（BridgeMOD・DisplayMOD・ゲームMOD）の jar を、サーバーと Minecraft の両方で
// 新しい版に自動で入れ替え、ゲームのコマンドも新しくする。ほかの MOD やファイルには触らない（2026-10-13 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameProfiles } = require('../game_profiles.cjs');
const { refreshGameModsAfterUpdate, gameModsOutdated } = require('../game_mods_refresh.cjs');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

function jar(id, version = '1.0') {
  const name = Buffer.from('META-INF/mods.toml'), text = Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="${id}"\nversion="${version}"\n`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(text.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(text.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + text.length, 16);
  return Buffer.concat([local, name, text, central, name, end]);
}

// アプリに同梱の BridgeMOD・採掘パック（版ごとに jar の名前とコマンドが変わる）を、アプリの更新に見立てて差し替えられる下準備。
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-mods-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = path.join(root, 'server'), client = path.join(root, 'minecraft'), storage = path.join(root, 'profiles');
  for (const dir of [server, client]) fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  const config = path.join(server, 'bridge', 'config.minecraft.json');
  fs.mkdirSync(path.join(server, 'bridge', 'commands', 'minecraft'), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ tiktokUsername: 'viewer', options: {}, mappings: [] }));
  let bridge;
  function bridgeVersion(version) { bridge = path.join(root, `bridgemod-${version}.jar`); fs.writeFileSync(bridge, jar('bridgemod', version)); }
  bridgeVersion('1.7.4');
  const display = path.join(root, 'displaymod-1.1.0.jar'); fs.writeFileSync(display, jar('displaymod'));
  const pack = path.join(root, 'game-packs', 'saikutu');
  function bundle(version, keys) {
    fs.rmSync(pack, { recursive: true, force: true }); fs.mkdirSync(pack, { recursive: true });
    const name = `saikutumod-${version}.jar`;
    fs.writeFileSync(path.join(pack, name), jar('saikutumod', version));
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
  return { server, client, storage, api, bundle, bridgeVersion, options, mods, block: message => { blocked = message; }, appConfig: () => appConfig,
    command: key => path.join(server, 'bridge', 'commands', 'minecraft', `game_saikutu_${key}.txt`) };
}

test('アプリを更新したあと最初の起動で、採掘MODを両側で新しい版にし、コマンドも新しくする。ほかの MOD には触らない', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  // 「保存」のあとに、自分で足した MOD とファイル。
  fs.writeFileSync(path.join(x.client, 'mods', 'minimap.jar'), jar('minimap'));
  fs.writeFileSync(path.join(x.server, 'mods', 'notes.txt'), 'memo');
  // アプリの更新：同梱の採掘パックが新しい版になり、コマンドも増える。
  x.bundle('1.1.4', ['otosiana', 'give_haste']);
  const result = await refreshGameModsAfterUpdate(x.options('1.0.1'));
  assert.deepEqual(result, { state: 'done', game: 'saikutu', changed: true });
  assert.deepEqual(x.mods(x.server), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'notes.txt', 'saikutumod-1.1.4.jar']);
  assert.deepEqual(x.mods(x.client), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'minimap.jar', 'saikutumod-1.1.4.jar']);
  // 古い版は消さずに退避する。
  for (const dir of [x.server, x.client]) {
    const replaced = fs.readdirSync(path.join(dir, '.mygamepack-mod-switch')).map(op => path.join(dir, '.mygamepack-mod-switch', op, 'replaced')).filter(p => fs.existsSync(p));
    assert.deepEqual(replaced.flatMap(p => fs.readdirSync(p)), ['saikutumod-1.1.3.jar'], 'BridgeMOD・DisplayMOD は同じ版なので動かさない');
  }
  assert.ok(fs.existsSync(x.command('give_haste')), '新しい版で増えたコマンドも置く');
  assert.equal(x.appConfig().gameModsVersion, '1.0.1');
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), false);
  // 同じ版での2回目からの起動では何もしない。
  x.block('呼ばれてはいけない');
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'current' });
});

test('BridgeMOD の版が上がったら、両側の古い BridgeMOD を新しい版に入れ替える（サバイバルでも）', async t => {
  const x = fixture(t);
  await x.api.activate('common');
  x.bridgeVersion('1.7.5');
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'done', game: 'common', changed: true });
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.5.jar', 'displaymod-1.1.0.jar']);
});

test('片側で書けなかったら、両側とも元に戻す', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  x.bundle('1.1.4', ['otosiana']);
  // Minecraft 側に、新しい jar と同じ名前のフォルダーがあって書けない。
  fs.mkdirSync(path.join(x.client, 'mods', 'saikutumod-1.1.4.jar'));
  const failed = await refreshGameModsAfterUpdate(x.options('1.0.1'));
  assert.equal(failed.state, 'failed');
  assert.deepEqual(x.mods(x.server), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.3.jar'], 'サーバー側も元に戻す');
  assert.deepEqual(x.mods(x.client), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.3.jar', 'saikutumod-1.1.4.jar']);
  assert.ok(fs.statSync(path.join(x.client, 'mods', 'saikutumod-1.1.4.jar')).isDirectory(), '元からあったものには触らない');
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), true);
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
  assert.match(x.appConfig().gameModsRefreshError, /Minecraftを終了/, 'ホームに理由も出す（PR #91 レビュー）');
  // 次の起動（止まっている）でもう一度試して、入れ替える。
  x.block(null);
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'done', game: 'saikutu', changed: true });
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.4.jar']);
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), false);
  assert.equal(x.appConfig().gameModsRefreshError, '');
});

test('ゲームのコマンドを書けなかったら、入れ替えた MOD も元に戻す（PR #91 再レビュー）', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  x.bundle('1.1.4', ['otosiana']);
  fs.rmSync(x.command('otosiana')); fs.mkdirSync(x.command('otosiana'));
  const failed = await refreshGameModsAfterUpdate(x.options('1.0.1'));
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /元へ戻しました/);
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.3.jar']);
});

test('同じ名前でもアプリの MOD と分からないファイル（壊れた jar など）は、上書きせずに退避する（PR #91 再レビュー）', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  x.bundle('1.1.4', ['otosiana']);
  fs.writeFileSync(path.join(x.client, 'mods', 'saikutumod-1.1.4.jar'), 'broken copy');
  assert.equal((await refreshGameModsAfterUpdate(x.options('1.0.1'))).state, 'done');
  assert.deepEqual(x.mods(x.client), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.4.jar']);
  const replaced = fs.readdirSync(path.join(x.client, '.mygamepack-mod-switch')).map(op => path.join(x.client, '.mygamepack-mod-switch', op, 'replaced')).filter(p => fs.existsSync(p));
  assert.equal(fs.readFileSync(path.join(replaced[0], 'saikutumod-1.1.4.jar'), 'utf8'), 'broken copy');
});

test('MOD が新しい版と同じなら何も動かさず、コマンドだけそろえて済んだことにする', async t => {
  const x = fixture(t);
  x.bundle('1.1.4', ['otosiana']);
  await x.api.activate('saikutu');
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'done', game: 'saikutu', changed: false });
  for (const dir of [x.server, x.client]) assert.equal(fs.existsSync(path.join(dir, '.mygamepack-mod-switch')) && fs.readdirSync(path.join(dir, '.mygamepack-mod-switch')).some(op => fs.existsSync(path.join(dir, '.mygamepack-mod-switch', op, 'replaced'))), false, '退避フォルダーを作らない');
  assert.equal(x.appConfig().gameModsVersion, '1.0.1');
});

test('前回の切替が途中で止まっているときは入れ替えず、ホームに出す', async t => {
  const x = fixture(t);
  x.bundle('1.1.3', ['otosiana']);
  await x.api.activate('saikutu');
  fs.writeFileSync(path.join(x.storage, 'pending-switch.json'), '{}');
  const failed = await refreshGameModsAfterUpdate(x.options('1.0.1'));
  assert.equal(failed.state, 'failed');
  assert.match(failed.error, /途中で止まって/);
  for (const dir of [x.server, x.client]) assert.deepEqual(x.mods(dir), ['bridgemod-1.7.4.jar', 'displaymod-1.1.0.jar', 'saikutumod-1.1.3.jar']);
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), true);
});

test('まだ一度もゲームを「保存」していないときは何もしない', async t => {
  const x = fixture(t);
  fs.writeFileSync(path.join(x.client, 'mods', 'minimap.jar'), jar('minimap'));
  x.bundle('1.1.4', ['otosiana']);
  x.block('呼ばれてはいけない');
  assert.deepEqual(await refreshGameModsAfterUpdate(x.options('1.0.1')), { state: 'skipped' });
  assert.deepEqual(x.mods(x.server), []);
  assert.deepEqual(x.mods(x.client), ['minimap.jar']);
  assert.equal(x.appConfig().gameModsVersion, '1.0.1', 'あとで「保存」すれば今の版が置かれるので、済んだことにする');
  assert.equal(gameModsOutdated(x.appConfig(), '1.0.1'), false);
});

test('アプリの起動と、手動インストールのあとの初期セットアップの完了で入れ替え、ホームへ知らせる。「保存」したら済んだことにする', () => {
  const main = read('electron/main.cjs');
  const schedule = main.slice(main.indexOf('function scheduleBridgeSync()'), main.indexOf('async function ensureBridgeExtracted()'));
  assert.match(schedule, /ensureBridgeExtracted\(\)\s*\.then\(\(\) => refreshGameModsOnStartup\(\)\)/);
  const startup = main.slice(main.indexOf('async function refreshGameModsOnStartup('), main.indexOf('async function ensureBridgeExtracted()'));
  assert.match(startup, /if \(!app\.isPackaged\) return;/, '開発版では何もしない（アプリ設定は配布版と同じ場所）');
  assert.match(startup, /if \(!cfg\.setupComplete \|\| !cfg\.serverFolder\) return;/, 'セットアップ前は何もしない');
  assert.match(startup, /refreshGameModsAfterUpdate\(\{ version: app\.getVersion\(\), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation \}\)/);
  assert.match(startup, /win\.webContents\.send\("games:changed", \{ state: result\.state, changed: result\.changed === true \}\)/);
  // 手動インストール（更新も含む）は初期セットアップをやり直すので、起動時には入れ替えない。セットアップを終えたら入れ替える（PR #91 レビュー）。
  const write = main.slice(main.indexOf('ipcMain.handle("app:config:write"'), main.indexOf('// IPC: 運営ログイン認証'));
  assert.match(write, /const wasSetupComplete = readAppConfig\(\)\.setupComplete === true;/);
  assert.match(write, /if \(!wasSetupComplete && readAppConfig\(\)\.setupComplete === true\) setTimeout\(\(\) => \{ refreshGameModsOnStartup\(\)\.catch\(/);
  assert.match(read('electron/game_mods_refresh.cjs'), /await run\(\(\) => profiles\.refreshMods\(\)\);/, '「保存」の activate ではなく、jar だけを入れ替える');
  // ホームのゲームの状態は、どの応答でも「MODが古いまま」とその理由を含める（PR #91 再レビュー）。
  assert.match(main, /function gamesStatus\(\) \{\s*const cfg = readAppConfig\(\);\s*return \{ \.\.\.gameProfiles\.list\(\), modsOutdatedAfterUpdate: gameModsOutdated\(cfg, app\.getVersion\(\)\), modsRefreshError: cfg\.gameModsRefreshError \|\| '' \};/);
  assert.match(main, /ipcMain\.handle\('games:list', \(\) => gamesStatus\(\)\);/);
  const activate = main.slice(main.indexOf("ipcMain.handle('games:activate'"), main.indexOf("ipcMain.handle('games:recover'"));
  assert.match(activate, /if \(app\.isPackaged\) \{\s*try \{ writeAppConfig\(\{ gameModsVersion: app\.getVersion\(\), gameModsRefreshFailed: '', gameModsRefreshError: '' \}\); \}/, '開発版では書かない。書けなくても切替は成功として返す');
  assert.match(activate, /return \{ \.\.\.result, \.\.\.gamesStatus\(\) \};/);
  // 「今すぐ入れ替える」：「保存」と違ってほかの MOD を退避しない、アプリの更新に合わせた入れ替えをもう一度試す（PR #91 再レビュー）。
  const now = main.slice(main.indexOf("ipcMain.handle('games:refreshMods'"), main.indexOf("ipcMain.handle('games:clientFolders'"));
  assert.match(now, /refreshGameModsAfterUpdate\(\{ version: app\.getVersion\(\), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation \}\)/);
  assert.match(now, /if \(result\.state === 'failed'\) throw new Error\(result\.error\);/);
  assert.match(read('electron/preload.cjs'), /gamesRefreshMods: \(\) => ipcRenderer\.invoke\('games:refreshMods'\),/);
  assert.match(read('electron/preload.cjs'), /onGamesChanged: \(callback\) => \{\s*const listener = \(_event, result\) => callback\(result\);/);
  const selector = read('src/components/GameSelector.tsx');
  const listener = selector.slice(selector.indexOf('api?.onGamesChanged?.'), selector.indexOf('async function run('));
  assert.match(listener, /if \(!alive\) return;/, '画面を閉じたあとに届いた結果では書き換えない');
  // 設定は書き換えないので読み直さない（読み直すと画面ごと作り直され、知らせが消える。PR #91 再レビュー）。
  assert.match(listener, /if \(result\?\.state === 'done' && result\.changed\) setMessage\('アプリの更新に合わせて、ゲームのMODを新しい版に入れ替えました。'\);/);
  assert.doesNotMatch(listener, /onChanged/);
  assert.match(selector, /status\?\.modsOutdatedAfterUpdate && <div role="alert" className="game-selector-pending">/);
  assert.match(selector, /サーバーと Minecraft を止めてから「今すぐ入れ替える」を押してください（ほかのMODはそのまま残ります。次にアプリを起動したときも自動で試します）。/);
  assert.match(selector, /onClick=\{refreshModsNow\}>今すぐ入れ替える<\/button>/);
});
