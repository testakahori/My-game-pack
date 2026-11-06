// npm run release:win の確かめ（scripts/release_checks.cjs。2026-11-06 品質レビュー）を、小さな偽の置き場で確かめる。
// 1.0.48 のインストーラーには、Mojang のサーバー本体と対応表（mappings）・開発の BRIDGE の設定・作った人のプレイヤーの記録・
// package-lock.json と違う版の tiktok-live-connector が入っていた。どれも、作ったあとに見つけて止める。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const checks = require('../../scripts/release_checks.cjs');
const { newBridgeConfig } = require('../../bridge/config_defaults.cjs');
const { levelDat } = require('./fake-level-dat.cjs');

const asar = require(require.resolve('@electron/asar', { paths: [path.dirname(require.resolve('app-builder-lib/package.json'))] }));

// exe・dll の版の情報（VS_VERSION_INFO と VS_FIXEDFILEINFO）だけを持つ偽の exe。
function fakeExe(version) {
  const [a, b, c, d = 0] = version.split('.').map(Number);
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  fixed.writeUInt32LE(0x00010000, 4);
  fixed.writeUInt32LE(a * 65536 + b, 8);
  fixed.writeUInt32LE(c * 65536 + d, 12);
  return Buffer.concat([Buffer.from('MZ fake exe'), Buffer.alloc(5), Buffer.alloc(6), Buffer.from('VS_VERSION_INFO\0', 'utf16le'), Buffer.alloc(2), fixed]);
}

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => { asar.uncacheAll(); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

function writer(base) {
  return (name, content = name) => {
    const file = path.join(base, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    return file;
  };
}

// 偽のリポジトリと、そこから作った正しい配る物（release/win-unpacked）。
async function fakeRelease(t, { asarFiles = {} } = {}) {
  const root = tempDir(t, 'release-checks-');
  const put = writer(root);
  put('package.json', JSON.stringify({ version: '1.2.3', build: { productName: 'MyGamePack Bridge UI' } }));
  put('bridge/package-lock.json', JSON.stringify({ packages: { 'node_modules/tiktok-live-connector': { version: '2.5.0' }, 'node_modules/rcon-client': { version: '4.2.5' } } }));
  put('BridgeMod/gradle.properties', 'mod_version=1.8.0\n');
  put('DisplayMod/gradle.properties', 'mod_version=1.0.0\n');
  put('ObsMod/gradle.properties', 'mod_id=minecraft_obs_bridge\nmod_version=2.4.7\n');
  put('game-packs/saikutu/game.json', JSON.stringify({ serverJar: 'saikutumod-2.0.0.jar' }));
  put('game-packs/umetate/game.json', JSON.stringify({ serverJar: 'stackinggame_events-2.6.16.jar' }));
  const jars = {
    common: [put('BridgeMod/build/libs/bridgemod-1.8.0.jar', 'bridge jar'), put('DisplayMod/build/libs/displaymod-1.0.0.jar', 'display jar'), put('ObsMod/build/libs/minecraft_obs_bridge-2.4.7.jar', 'obs jar')],
    saikutu: put('SaikutuMod/build/libs/saikutumod-2.0.0.jar', 'saikutu jar'),
    umetate: put('UmetateMod/build/libs/stackinggame_events-2.6.16.jar', 'umetate jar'),
  };
  const outDir = path.join(root, 'release');
  const resources = path.join(outDir, 'win-unpacked', 'resources');
  const ship = writer(resources);
  put('release/win-unpacked/MyGamePack Bridge UI.exe', fakeExe('1.2.3.0'));
  put('release/MyGamePack-Bridge-UI-Setup-1.2.3.exe', 'installer');
  const app = writer(path.join(root, 'app-src'));
  app('package.json', JSON.stringify({ version: '1.2.3' }));
  app('electron/main.cjs', '// main');
  for (const [name, content] of Object.entries(asarFiles)) app(name, content);
  await asar.createPackage(path.join(root, 'app-src'), path.join(resources, 'app.asar'));
  ship('bridge/index.js');
  ship('bridge/commands/minecraft/tnt.txt');
  ship('bridge/commands/minecraft/_gamerules.txt');
  ship('bridge/config.minecraft.json', JSON.stringify(newBridgeConfig(), null, 2));
  ship('bridge/bridge-runtime-manifest.json', JSON.stringify({ dependencies: { 'tiktok-live-connector': '2.5.0', 'rcon-client': '4.2.5' } }));
  ship('bridge/node/node.exe', fakeExe('24.22.0.0'));
  const template = 'server/Douma_Craft';
  for (const name of ['forge-1.20.1-47.4.10-installer.jar', 'jdk-21.0.4+7/bin/java.exe', 'jdk-21.0.4+7/bin/javaw.exe', 'jdk-21.0.4+7/lib/modules', 'run.bat', 'run.sh', 'setup.bat', 'user_jvm_args.txt']) ship(`${template}/${name}`);
  for (const jar of jars.common) ship(`${template}/mods/${path.basename(jar)}`, fs.readFileSync(jar));
  ship('game-packs/saikutu/game.json', '{}');
  ship('game-packs/saikutu/saikutumod-2.0.0.jar', fs.readFileSync(jars.saikutu));
  ship('game-packs/umetate/game.json', '{}');
  ship('game-packs/umetate/stackinggame_events-2.6.16.jar', fs.readFileSync(jars.umetate));
  const map = 'game-packs/umetate/maps/umetate_lab_map';
  ship(`${map}/level.dat`, levelDat({ player: false }));
  ship(`${map}/region/r.0.0.mca`);
  ship(`${map}/data/raids.dat`);
  ship(`${map}/umetate_lab_map.json`, '{}');
  return { root, outDir, resources, put, ship, jars, template, map };
}

test('配る物の確かめ: 正しく作った物には、問題を出さない', async t => {
  const { root, outDir } = await fakeRelease(t);
  assert.deepEqual(checks.outputProblems({ root, outDir }), []);
});

test('配る物の確かめ: 置き場が無ければ、それだけを知らせる', t => {
  const root = tempDir(t, 'release-checks-');
  assert.deepEqual(checks.outputProblems({ root, outDir: path.join(root, 'release') }), [`配る物の置き場がありません: ${path.join(root, 'release', 'win-unpacked', 'resources')}`]);
});

test('配る物の確かめ: 作業の道具の記録・開発機の残り物・開発用のファイル・開発の設定・違う版の部品を見つける', async t => {
  const { root, outDir, ship } = await fakeRelease(t, { asarFiles: { '.claude/settings.local.json': '{}' } });
  ship('bridge/commands/minecraft/.omc/state/a.json', '{}');
  ship('server/Douma_Craft/jdk-21.0.4+7/.OMC/x', 'x');
  ship('bridge/commands/minecraft/_op.txt', 'op Developer');
  ship('bridge/commands/minecraft/game_umetate_flood.txt', 'x');
  ship('bridge/commands/minecraft/game_mode_on.txt', '共通のコマンドは配ってよい');
  ship('bridge/telnet_test.js');
  ship('bridge/ui_server.js');
  ship('bridge/bridge起動.bat');
  ship('bridge/config.minecraft.json', JSON.stringify({ ...newBridgeConfig(), mappings: [{ giftId: '5655', name: 'Rose', commandFile: 'zombie.txt' }] }));
  ship('bridge/bridge-runtime-manifest.json', JSON.stringify({ dependencies: { 'tiktok-live-connector': '2.4.3', 'rcon-client': '4.2.5' } }));
  assert.deepEqual(checks.outputProblems({ root, outDir }).sort(), [
    '作業の道具の記録が入っています: resources/bridge/commands/minecraft/.omc',
    '作業の道具の記録が入っています: resources/bridge/commands/minecraft/.omc/state',
    '作業の道具の記録が入っています: resources/bridge/commands/minecraft/.omc/state/a.json',
    '作業の道具の記録が入っています: resources/server/Douma_Craft/jdk-21.0.4+7/.OMC',
    '作業の道具の記録が入っています: resources/server/Douma_Craft/jdk-21.0.4+7/.OMC/x',
    '作業の道具の記録が入っています: app.asar/.claude',
    '作業の道具の記録が入っています: app.asar/.claude/settings.local.json',
    '配らないファイルが入っています: resources/bridge/commands/minecraft/_op.txt',
    '配らないファイルが入っています: resources/bridge/commands/minecraft/game_umetate_flood.txt',
    '配らないファイルが入っています: resources/bridge/telnet_test.js',
    '配らないファイルが入っています: resources/bridge/ui_server.js',
    '配らないファイルが入っています: resources/bridge/bridge起動.bat',
    'BRIDGE の設定（bridge/config.minecraft.json）が、空の既定の設定（newBridgeConfig）と違います（開発の設定が入った？）',
    'BRIDGE に入った tiktok-live-connector は 2.4.3、bridge/package-lock.json は 2.5.0',
  ].sort());
});

test('配る物の確かめ: サーバーの雛形の Mojang のファイル・libraries・足りないファイル・違う MOD を見つける', async t => {
  const { root, outDir, ship, template, jars } = await fakeRelease(t);
  ship(`${template}/libraries/net/minecraft/server/1.20.1/server-1.20.1.jar`, 'mojang');
  ship(`${template}/libraries/de/oceanlabs/mcp/mcp_config/1.20.1/mcp_config-1.20.1-mappings.txt`, 'mappings');
  fs.rmSync(path.join(outDir, 'win-unpacked/resources', template, 'jdk-21.0.4+7/bin/javaw.exe'));
  fs.rmSync(path.join(outDir, 'win-unpacked/resources', template, 'forge-1.20.1-47.4.10-installer.jar'));
  ship(`${template}/mods/stackinggame_events-2.6.16.jar`, 'game mod');
  ship(`${template}/mods/${path.basename(jars.common[1])}`, 'old display jar');
  assert.deepEqual(checks.outputProblems({ root, outDir }), [
    `Mojang のサーバー本体か対応表（mappings）が入っています: resources/${template}/libraries/de/oceanlabs/mcp/mcp_config/1.20.1/mcp_config-1.20.1-mappings.txt`,
    `Mojang のサーバー本体か対応表（mappings）が入っています: resources/${template}/libraries/net/minecraft/server/1.20.1/server-1.20.1.jar`,
    `サーバーの雛形に libraries が入っています（初回の環境構築で取りに行く決まり）: resources/${template}/libraries`,
    'サーバーの雛形に forge-1.20.1-47.4.10-installer.jar がありません',
    'サーバーの雛形に jdk-21.0.4+7/bin/javaw.exe がありません',
    'サーバーの雛形の mods が違います（入っている: bridgemod-1.8.0.jar、displaymod-1.0.0.jar、minecraft_obs_bridge-2.4.7.jar、stackinggame_events-2.6.16.jar／入れる: bridgemod-1.8.0.jar、displaymod-1.0.0.jar、minecraft_obs_bridge-2.4.7.jar）',
    'DisplayMOD の jar が build/libs のものと違います: displaymod-1.0.0.jar',
  ]);
});

test('配る物の確かめ: ゲームパックの違う jar と、初期マップのプレイヤーの記録を見つける', async t => {
  const { root, outDir, ship, map } = await fakeRelease(t);
  ship('game-packs/saikutu/saikutumod-2.0.0.jar', 'old saikutu jar');
  fs.rmSync(path.join(outDir, 'win-unpacked/resources/game-packs/umetate/stackinggame_events-2.6.16.jar'));
  ship(`${map}/level.dat`, levelDat());
  ship(`${map}/level.dat_old`, levelDat());
  ship(`${map}/session.lock`, 'x');
  ship(`${map}/playerdata/x.dat`, 'x');
  ship(`${map}/stats/x.json`, '{}');
  ship(`${map}/data/playerdata/keep.dat`, '地図の中身は配ってよい');
  assert.deepEqual(checks.outputProblems({ root, outDir }).sort(), [
    '採掘のゲームパックの jar が build/libs のものと違います: saikutumod-2.0.0.jar',
    '埋め立てのゲームパックに MOD の jar がありません',
    `初期マップに配らないものが入っています: resources/${map}/level.dat_old`,
    `初期マップに配らないものが入っています: resources/${map}/session.lock`,
    `初期マップに配らないものが入っています: resources/${map}/playerdata`,
    `初期マップに配らないものが入っています: resources/${map}/playerdata/x.dat`,
    `初期マップに配らないものが入っています: resources/${map}/stats`,
    `初期マップに配らないものが入っています: resources/${map}/stats/x.json`,
    `初期マップの level.dat に作った人のプレイヤーの記録（Data.Player）が入っています: resources/${map}/level.dat`,
  ].sort());
  ship(`${map}/level.dat`, 'not gzip');
  assert.ok(checks.outputProblems({ root, outDir }).some(problem => problem.startsWith('初期マップの level.dat を確かめられません（level.dat を読めません')));
});

test('配る物の確かめ: app.asar と exe の版が package.json と違えば知らせる。試し用の版は exe の数字の部分で比べる', async t => {
  const { root, outDir, put } = await fakeRelease(t, { asarFiles: { 'package.json': JSON.stringify({ version: '1.2.2' }) } });
  put('release/win-unpacked/MyGamePack Bridge UI.exe', fakeExe('1.2.2.0'));
  assert.deepEqual(checks.outputProblems({ root, outDir }), ['app.asar の版が 1.2.2（package.json は 1.2.3）', 'アプリの exe の版が 1.2.2.0（package.json は 1.2.3）']);
  put('package.json', JSON.stringify({ version: '1.2.2-local.1', build: { productName: 'MyGamePack Bridge UI' } }));
  assert.deepEqual(checks.outputProblems({ root, outDir }), ['app.asar の版が 1.2.2（package.json は 1.2.2-local.1）']);
  fs.rmSync(path.join(outDir, 'win-unpacked/MyGamePack Bridge UI.exe'));
  assert.ok(checks.outputProblems({ root, outDir }).includes(`アプリの exe の版を読めません: ${path.join(outDir, 'win-unpacked', 'MyGamePack Bridge UI.exe')}`));
});

test('exe の版: VS_VERSION_INFO の FileVersion を読む。無ければ null', t => {
  const dir = tempDir(t, 'release-checks-exe-');
  const put = writer(dir);
  assert.equal(checks.exeFileVersion(put('a.exe', fakeExe('1.0.48.0'))), '1.0.48.0');
  assert.equal(checks.exeFileVersion(put('b.exe', Buffer.concat([Buffer.from('VS_VERSION_INFO\0', 'utf16le'), Buffer.alloc(40)]))), null, '印（0xFEEF04BD）が無い');
  assert.equal(checks.exeFileVersion(put('c.exe', 'MZ')), null);
  assert.equal(checks.exeFileVersion(path.join(dir, 'missing.exe')), null);
});

test('作る前の確かめ: コミットしていない変更があれば止める。試し用の版だけ --allow-dirty で作れる', () => {
  const clean = { commit: 'a'.repeat(40), short: 'aaaaaaa', branch: 'main', changes: [] };
  const dirty = { ...clean, changes: [' M package.json', 'M  bridge/index.js'] };
  assert.doesNotThrow(() => checks.assertCleanTree(clean, { local: false, allowDirty: false }));
  assert.throws(() => checks.assertCleanTree(dirty, { local: false, allowDirty: false }), /コミットしていない変更が 2 件.*\n-  M package\.json\n- M  bridge\/index\.js\n.*--allow-dirty/s);
  assert.throws(() => checks.assertCleanTree(dirty, { local: true, allowDirty: false }), /コミットしていない変更が 2 件/, '試し用の版も、合図が無ければ止める');
  assert.doesNotThrow(() => checks.assertCleanTree(dirty, { local: true, allowDirty: true }));
  assert.doesNotThrow(() => checks.assertCleanTree(null, { local: true, allowDirty: true }));
  assert.throws(() => checks.assertCleanTree(clean, { local: false, allowDirty: true }), /試し用の版（-local\.）だけ/);
  assert.throws(() => checks.assertCleanTree(null, { local: false, allowDirty: false }), /git の情報が取れない/);
  const many = { ...clean, changes: Array.from({ length: 25 }, (_, i) => ` M f${i}.js`) };
  const message = (() => { try { checks.assertCleanTree(many, { local: false, allowDirty: false }); } catch (error) { return error.message; } })();
  assert.match(message, /25 件/);
  assert.match(message, /f19\.js\n- …\n/);
  assert.doesNotMatch(message, /f20\.js/, '多いときは先頭の 20 件だけを並べる');
  // 開発版が書き換える設定（配る物には入らない）は止める数に入れない。日本語の名前は崩さない（2026-11-06 レビュー 重要1・軽い5）。
  const calls = [];
  const fakeGit = (...args) => {
    calls.push(args.join(' '));
    if (args.includes('status')) return [' M bridge/config.minecraft.json', ' M bridge/tts-settings.json', ' M docs/手動配布とアプリ更新.md'].join('\n');
    return args.includes('--short') ? 'ccccccc' : args.includes('--abbrev-ref') ? 'main' : 'c'.repeat(40);
  };
  const state = checks.gitState('unused', fakeGit);
  assert.deepEqual(state.changes, [' M docs/手動配布とアプリ更新.md']);
  assert.deepEqual(state.devOnly, [' M bridge/config.minecraft.json', ' M bridge/tts-settings.json']);
  assert.ok(calls.some(call => call.startsWith('-c core.quotepath=false status')), calls.join(' / '));
  assert.doesNotThrow(() => checks.assertCleanTree({ ...state, changes: [] }, { local: false, allowDirty: false }), '開発用の設定だけなら止めない');
  assert.equal(checks.ALLOW_DIRTY_FLAG, '--allow-dirty');
  assert.equal(checks.ALLOW_DIRTY_ENV, 'MYGAMEPACK_RELEASE_ALLOW_DIRTY');
});

// 偽の npm プロジェクト（package.json・package-lock.json・node_modules）。
function fakeProject(base, { installed }) {
  const put = writer(base);
  put('package.json', JSON.stringify({ dependencies: { 'tiktok-live-connector': '2.5.0', 'rcon-client': '^4.2.5' }, devDependencies: { esbuild: '^0.28.1' } }));
  put('package-lock.json', JSON.stringify({ packages: { '': {}, 'node_modules/tiktok-live-connector': { version: '2.5.0' }, 'node_modules/rcon-client': { version: '4.2.5' }, 'node_modules/esbuild': { version: '0.28.1' } } }));
  for (const [name, version] of Object.entries(installed)) put(`node_modules/${name}/package.json`, JSON.stringify({ name, version }));
}

test('作る前の確かめ: node_modules の版が package-lock.json と違う・入っていないものを見つける', t => {
  const dir = tempDir(t, 'release-checks-deps-');
  fakeProject(dir, { installed: { 'tiktok-live-connector': '2.4.3', esbuild: '0.28.1' } });
  assert.deepEqual(checks.lockMismatches(dir), ['rcon-client: node_modules に入っていません（package-lock.json は 4.2.5）', 'tiktok-live-connector: node_modules は 2.4.3、package-lock.json は 2.5.0']);
  fakeProject(dir, { installed: { 'tiktok-live-connector': '2.5.0', 'rcon-client': '4.2.5', esbuild: '0.28.1' } });
  assert.deepEqual(checks.lockMismatches(dir), []);
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ packages: {} }));
  assert.equal(checks.lockMismatches(dir).length, 3, 'package-lock.json に無いものも知らせる');
});

test('作る前の確かめ: npm ls の問題を並べる。直下と bridge の両方を見る', t => {
  assert.deepEqual(checks.npmLsProblems('x', () => ({ status: 0, stdout: '{}' })), []);
  assert.deepEqual(checks.npmLsProblems('x', () => ({ status: 1, stdout: JSON.stringify({ problems: ['invalid: tiktok-live-connector@2.4.3 x\\bridge\\node_modules\\tiktok-live-connector'] }) })),
    ['invalid: tiktok-live-connector@2.4.3 x\\bridge\\node_modules\\tiktok-live-connector']);
  assert.deepEqual(checks.npmLsProblems('x', () => ({ status: 1, stdout: 'not json' })), ['npm ls が失敗しました（終了コード 1）']);
  const root = tempDir(t, 'release-checks-deps-');
  fakeProject(root, { installed: { 'tiktok-live-connector': '2.5.0', 'rcon-client': '4.2.5', esbuild: '0.28.1' } });
  fakeProject(path.join(root, 'bridge'), { installed: { 'tiktok-live-connector': '2.4.3', 'rcon-client': '4.2.5', esbuild: '0.28.1' } });
  const seen = [];
  const problems = checks.dependencyProblems(root, dir => { seen.push(dir); return dir.endsWith('bridge') ? { status: 1, stdout: JSON.stringify({ problems: ['invalid: tiktok-live-connector@2.4.3'] }) } : { status: 0, stdout: '{}' }; });
  assert.deepEqual(seen, [root, path.join(root, 'bridge')]);
  assert.deepEqual(problems, ['bridge/ tiktok-live-connector: node_modules は 2.4.3、package-lock.json は 2.5.0', 'bridge/ invalid: tiktok-live-connector@2.4.3']);
  assert.throws(() => checks.assertDependencies(problems), /合わないので、インストーラーを作りません.*bridge\/ tiktok-live-connector.*npm ci --ignore-scripts/s);
  assert.doesNotThrow(() => checks.assertDependencies([]));
});

test('記録: インストーラーの SHA-256 と大きさ、作った元、Electron・同梱の Node・JDK・Forge の版、MOD の jar、ゲームパックのファイルの数を書く', async t => {
  const { root, outDir, put, map } = await fakeRelease(t);
  put('node_modules/electron/package.json', JSON.stringify({ version: '43.8.7' }));
  const installer = path.join(outDir, 'MyGamePack-Bridge-UI-Setup-1.2.3.exe');
  const state = { commit: 'b'.repeat(40), short: 'bbbbbbb', branch: 'main', changes: [] };
  const manifest = checks.releaseManifest({ root, outDir, installer, state, local: false, allowDirty: false });
  const sha = checks.sha256File;
  assert.deepEqual({ ...manifest, createdAt: 'x' }, {
    version: '1.2.3', local: false, createdAt: 'x', commit: state.commit, branch: 'main', uncommittedChanges: [], allowDirty: false,
    installer: { file: 'MyGamePack-Bridge-UI-Setup-1.2.3.exe', bytes: 9, sha256: sha(installer) },
    electron: '43.8.7', bundledNode: 'v24.22.0', jdk: ['jdk-21.0.4+7'], forge: '1.20.1-47.4.10',
    mods: ['bridgemod-1.8.0.jar', 'displaymod-1.0.0.jar', 'minecraft_obs_bridge-2.4.7.jar'].map(name => {
      const file = path.join(outDir, 'win-unpacked/resources/server/Douma_Craft/mods', name);
      return { file: name, bytes: fs.statSync(file).size, sha256: sha(file) };
    }),
    gamePacks: [
      { id: 'saikutu', files: 2, jar: { file: 'saikutumod-2.0.0.jar', bytes: 11, sha256: sha(path.join(root, 'SaikutuMod/build/libs/saikutumod-2.0.0.jar')) }, maps: [] },
      { id: 'umetate', files: 6, jar: { file: 'stackinggame_events-2.6.16.jar', bytes: 11, sha256: sha(path.join(root, 'UmetateMod/build/libs/stackinggame_events-2.6.16.jar')) }, maps: [{ name: 'umetate_lab_map', files: 4 }] },
    ],
  });
  assert.match(manifest.createdAt, /^\d{4}-\d\d-\d\dT/);
  assert.ok(fs.existsSync(path.join(outDir, 'win-unpacked/resources', map, 'level.dat')));
  const file = checks.writeManifest(outDir, manifest);
  assert.equal(file, path.join(outDir, '1.2.3-manifest.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), manifest);
  // 8MB より大きいファイルも、少しずつ読んで同じハッシュを出す。
  const big = put('big.bin', Buffer.alloc(9 * 1024 * 1024 + 7, 1));
  assert.equal(sha(big), require('node:crypto').createHash('sha256').update(fs.readFileSync(big)).digest('hex'));
});
