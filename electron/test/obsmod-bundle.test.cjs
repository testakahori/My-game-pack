// OBSMOD（そうてんもんさんの minecraft_obs_bridge）を、DisplayMOD と同じ標準装備としてアプリに同梱する。入れるのはサーバーにだけ
// （Minecraft 本体には入れない。OBSMOD はサーバーで起きたことを OBS ツールへ送る MOD なので）。OBS ツールへの送信は既定でオフ
// （2026-10-24〜25 ユーザーの決定。HANDOFF04 の「そうてんもんさんの OBSMOD と埋め立ての MOD を取り込む」の PR2）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

function jar(id) {
  const name = Buffer.from('META-INF/mods.toml'), text = Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="${id}"\nversion="1.0"\n`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(text.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(text.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + text.length, 16);
  return Buffer.concat([local, name, text, central, name, end]);
}

test('OBSMOD: 同梱する MOD の一覧に入り、サーバーにだけ入れる印を持つ（release:win も確かめて同梱する）', () => {
  const { modJars, buildOnlyModJars } = require('../../scripts/mod_jars.cjs');
  const obs = modJars(root).find(mod => mod.dir === 'ObsMod');
  assert.equal(path.basename(obs.jar), 'minecraft_obs_bridge-2.4.8.jar');
  assert.equal(obs.name, 'OBSMOD');
  assert.equal(obs.serverOnly, true);
  assert.equal(modJars(root).filter(mod => mod.serverOnly).length, 1, 'サーバーにだけ入れるのは OBSMOD だけ');
  assert.deepEqual(buildOnlyModJars(root).map(mod => mod.dir), ['UmetateMod'], '作るが同梱しないのは埋め立ての MOD だけ');
});

test('OBSMOD: サーバーの雛形の mods に入れる（準備の道具は jar の場所を mod_jars から取る）', t => {
  const { prepareServerTemplate } = require('../../scripts/prepare-server-template.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-template-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), target = path.join(dir, 'template');
  for (const name of ['jdk-21.0.4+7', 'libraries', 'mods', 'GiftStream_Pack']) fs.mkdirSync(path.join(source, name), { recursive: true });
  for (const name of ['forge-1.20.1-47.4.10-installer.jar', 'run.bat', 'run.sh', 'setup.bat', 'user_jvm_args.txt']) fs.writeFileSync(path.join(source, name), 'x');
  fs.writeFileSync(path.join(source, 'mods', 'minecraft_obs_bridge-2.4.7.jar'), 'old');
  const put = (name, text) => { const file = path.join(dir, name); fs.writeFileSync(file, text); return file; };
  const bridge = put('bridgemod-1.8.3.jar', 'b'), display = put('displaymod-1.1.0.jar', 'd'), obs = put('minecraft_obs_bridge-2.4.8.jar', 'o');
  assert.throws(() => prepareServerTemplate(source, target, bridge, display, path.join(dir, 'missing.jar')), /ObsMod/);
  assert.equal(fs.existsSync(target), false);
  prepareServerTemplate(source, target, bridge, display, obs);
  assert.deepEqual(fs.readdirSync(path.join(target, 'mods')).sort(), ['bridgemod-1.8.3.jar', 'displaymod-1.1.0.jar', 'minecraft_obs_bridge-2.4.8.jar']);
  assert.match(read('scripts/prepare-server-template.cjs'), /modJar\(root, "ObsMod"\)/);
});

test('OBSMOD: 古い OBSMOD を退避して、サーバーの mods の OBSMOD を入れ替える', t => {
  const { replaceCommonMod } = require('../bridge_mod_migration.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-replace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'server');
  fs.mkdirSync(path.join(server, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(server, 'mods', 'minecraft_obs_bridge-2.4.7.jar'), 'old');
  fs.writeFileSync(path.join(server, 'mods', 'displaymod-1.1.0.jar'), 'keep');
  const next = path.join(dir, 'minecraft_obs_bridge-2.4.8.jar');
  fs.writeFileSync(next, jar('displaymod'));
  assert.throws(() => replaceCommonMod(next, server, 'minecraft_obs_bridge'), /minecraft_obs_bridge/, 'jar の中の MOD ID を確かめる');
  fs.writeFileSync(next, jar('minecraft_obs_bridge'));
  replaceCommonMod(next, server, 'minecraft_obs_bridge');
  assert.deepEqual(fs.readdirSync(path.join(server, 'mods')).sort(), ['displaymod-1.1.0.jar', 'minecraft_obs_bridge-2.4.8.jar']);
  const retired = path.join(server, '.mygamepack-retired-mods');
  assert.equal(fs.readdirSync(retired).length, 1, '古い OBSMOD は退避する（消さない）');
});

test('OBSMOD: アプリの同期と、ゲームの切り替えの jar の探し方にも入れる', () => {
  const sync = read('electron/bridge_sync.cjs');
  assert.match(sync, /\/\^minecraft_obs_bridge-\[0-9\.\]\+\\\.jar\$\/i/);
  assert.match(sync, /replaceCommonMod\(path\.join\(srcMods, obs\), serverFolder, 'minecraft_obs_bridge'\)/);
  const ipc = read('electron/games_ipc.cjs');
  assert.match(ipc, /obsJar: \(\) =>/);
  assert.match(ipc, /'ObsMod', 'build', 'libs'/);
  assert.match(ipc, /\/\^minecraft_obs_bridge-\[0-9\.\]\+\\\.jar\$\//);
});

// ゲーム MOD ではない（アプリの MOD）。ゲームパックとして登録させず、ゲームの切り替えでアプリの MOD として扱う。
test('OBSMOD: 「ゲーム MOD ではない」一覧に入れる（BRIDGE と BridgeMOD の両方。BridgeMOD 1.8.3）', () => {
  const { isGameModId, RESERVED_MOD_IDS } = require('../../bridge/game_commands.cjs');
  assert.ok(RESERVED_MOD_IDS.includes('minecraft_obs_bridge'));
  assert.equal(isGameModId('minecraft_obs_bridge'), false);
  assert.match(read('BridgeMod/src/main/java/jp/douma/bridgemod/api/GameEvents.java'), /RESERVED_MOD_IDS = Set\.of\("bridgemod", "displaymod", "doumacmd", "minecraft_obs_bridge"\)/);
  const cases = JSON.parse(read('bridge/test/fixtures/game-mod-ids.json'));
  assert.ok(cases.some(c => c.id === 'minecraft_obs_bridge' && c.ok === false), '契約テストで BRIDGE と BridgeMOD の結果をそろえる');
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.8\.3\r?$/m);
});

test('OBSMOD 2.4.8: obs-send.properties でオンのときだけ OBS ツールへ送る', () => {
  assert.match(read('ObsMod/gradle.properties'), /^mod_version=2\.4\.8\r?$/m);
  const runtime = read('ObsMod/src/main/java/jp/streamtorearn/obsmodule/core/ObsRuntime.java');
  assert.match(runtime, /ObsSendSettings\.read\(/);
  assert.match(runtime, /http\.setEnabled\(send\.enabled\(\)\)/);
  assert.match(read('scripts/test-soutenmon-contracts.cjs'), /ObsSendSettingsTest/, '送らないことは Forge なしの確かめで動かして確かめる');
});

test('OBSMOD: 開発用の作り直し（npm run dev:refresh）でも作る', () => {
  const { steps } = require('../../scripts/refresh-dev.cjs');
  assert.ok(steps({ windows: true }).some(step => step.title === 'ObsMod の jar'));
});

test('OBSMOD: 標準装備でサーバーにだけ入ること、送信は既定でオフのことを文書に書く', () => {
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('obs-send.properties'));
  assert.ok(read('docs/BridgeMODとゲーム切替.md').includes('OBSMOD'));
});
