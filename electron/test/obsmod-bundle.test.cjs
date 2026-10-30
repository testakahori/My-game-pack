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

const { fakeModJar: jar } = require('./fake-mod-jar.cjs');

test('OBSMOD: 同梱する MOD の一覧に入り、サーバーにだけ入れる印を持つ（release:win も確かめて同梱する）', () => {
  const mods = require('../../scripts/mod_jars.cjs');
  const { modJars } = mods;
  const obs = modJars(root).find(mod => mod.dir === 'ObsMod');
  assert.equal(path.basename(obs.jar), 'minecraft_obs_bridge-2.4.8.jar');
  assert.equal(obs.name, 'OBSMOD');
  assert.equal(obs.serverOnly, true);
  assert.equal(modJars(root).filter(mod => mod.serverOnly).length, 1, 'サーバーにだけ入れるのは OBSMOD だけ');
  assert.equal(mods.buildOnlyModJars, undefined, '作るが同梱しない MOD は無くなった（埋め立ての MOD はゲームパックで同梱する。2026-10-29 埋め立て PR2）');
});

test('OBSMOD: サーバーの雛形の mods に入れる（準備の道具は jar の場所を mod_jars から取る）', t => {
  const { prepareServerTemplate } = require('../../scripts/prepare-server-template.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-template-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source'), target = path.join(dir, 'template');
  // GiftStream_Pack が無いサーバーからでも作れる（配らなくした。2026-10-30）。
  for (const name of ['jdk-21.0.4+7', 'libraries', 'mods']) fs.mkdirSync(path.join(source, name), { recursive: true });
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

// サーバーにだけある MOD は、本体に無くても「MOD が合わない」と言わせない（無いと、本体のサーバー一覧で赤い×が付く。最後のレビュー 重要1）。
test('OBSMOD: 本体に無くても、サーバー一覧で MOD が合わないと出さない（DisplayMOD・採掘MOD と同じ）', () => {
  const block = name => read(name).split(/\[\[mods\]\]/)[1].split(/\[\[dependencies/)[0];
  for (const name of ['ObsMod/src/main/resources/META-INF/mods.toml', 'DisplayMod/src/main/resources/META-INF/mods.toml', 'SaikutuMod/src/main/resources/META-INF/mods.toml']) {
    assert.match(block(name), /^displayTest="IGNORE_SERVER_VERSION"\r?$/m, name);
  }
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

// 手で入れた名前の違う OBSMOD（OBSMOD-handmade.jar など）も、jar の中の MOD ID で見つけて退避する。残すと同じ MOD が2つ並び、Forge が起動しない（最後のレビュー 軽い5）。
test('OBSMOD: 名前の違う OBSMOD も、jar の中の MOD ID で見つけて退避する（ほかの MOD は残す）', t => {
  const { replaceCommonMod } = require('../bridge_mod_migration.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-handmade-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const server = path.join(dir, 'server');
  fs.mkdirSync(path.join(server, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(server, 'mods', 'OBSMOD-handmade.jar'), jar('minecraft_obs_bridge'));
  fs.writeFileSync(path.join(server, 'mods', 'other.jar'), jar('othermod'));
  fs.writeFileSync(path.join(server, 'mods', 'notes.txt'), 'keep');
  const next = path.join(dir, 'minecraft_obs_bridge-2.4.8.jar');
  fs.writeFileSync(next, jar('minecraft_obs_bridge'));
  replaceCommonMod(next, server, 'minecraft_obs_bridge');
  assert.deepEqual(fs.readdirSync(path.join(server, 'mods')).sort(), ['minecraft_obs_bridge-2.4.8.jar', 'notes.txt', 'other.jar']);
});

// OBSMOD が読む場所は、PR3 でアプリが書く場所との決まり（最後のレビュー 軽い8）。
test('OBSMOD: 設定を読む場所は config/minecraft_obs_bridge/obs-send.properties', () => {
  assert.match(read('ObsMod/src/main/java/jp/streamtorearn/obsmodule/core/ObsRuntime.java'), /FMLPaths\.CONFIGDIR\.get\(\)\.resolve\("minecraft_obs_bridge"\)\.resolve\(ObsSendSettings\.FILE_NAME\)/);
  assert.match(read('ObsMod/src/main/java/jp/streamtorearn/obsmodule/config/ObsSendSettings.java'), /FILE_NAME = "obs-send\.properties"/);
});

// オフなら、OBSMOD の窓口（ゲーム MOD から呼ぶ ObsApi）と遭遇の知らせは、何もせずに戻る（オフでもイベントごとに警告を出していた。最後のレビュー 軽い10）。
// 通信の仕組み（HttpClient）は、はじめて送るときに作る（オフなら作らない。軽い11）。
test('OBSMOD: オフなら、窓口と遭遇の知らせは何もせずに戻り、通信の仕組みも作らない', () => {
  const api = read('ObsMod/src/main/java/jp/streamtorearn/obsmodule/api/ObsApi.java');
  for (const method of ['publishLifecycle', 'publishEncounter']) {
    const body = api.slice(api.indexOf(`public static boolean ${method}(`));
    assert.match(body.slice(0, body.indexOf('\n', body.indexOf('{') + 1) + 200), /if \(!ObsBridgeMod\.RUNTIME\.http\.enabled\(\)\) return true;/, method);
  }
  assert.match(read('ObsMod/src/main/java/jp/streamtorearn/obsmodule/core/EventPublisher.java'), /if\(!http\.enabled\(\)\)return;/);
  assert.doesNotMatch(read('ObsMod/src/main/java/jp/streamtorearn/obsmodule/http/ObsControllerClient.java'), /private final HttpClient client=HttpClient\.newBuilder/);
});

test('OBSMOD: 文書と画面の言葉を、サーバーにだけ入れる・既定でオフに合わせる', () => {
  const switching = read('docs/BridgeMODとゲーム切替.md');
  assert.ok(switching.includes('bridgemod・doumacmd・displaymod・minecraft_obs_bridge・ゲームMOD'), 'アプリが置く MOD を見分ける MOD ID');
  assert.ok(switching.includes('BridgeMOD・DisplayMOD・OBSMOD（サーバーだけ）・ゲームMODの構成'));
  assert.ok(read('src/components/GameSelector.tsx').includes('OBSMOD'), '画面の標準装備の説明');
  assert.match(read('ObsMod/README.md'), /^# OBSMOD v2\.4\.8/m);
  assert.doesNotMatch(read('scripts/check-jar-inputs.cjs'), /ObsMod・UmetateMod/);
  assert.match(read('scripts/mod_jars.cjs'), /serverOnly は目印/);
});
