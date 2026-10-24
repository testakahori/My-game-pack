// そうてんもんさんの MOD を、ほかの MOD と同じ階層に取り込んで作る（2026-10-24 ユーザーの決定。HANDOFF04）。
// ObsMod/：OBSMOD v2.4.7（MOD ID minecraft_obs_bridge）。UmetateMod/：埋め立てゲームの StackingGame-Events v2.6.16（MOD ID stackinggame_events）。
// 取り込みでは中身を変えず、ビルドの設定だけをほかの MOD にそろえる（オフラインで BridgeMod/gradlew から作れるように）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const MODS = ['ObsMod', 'UmetateMod'];

test('そうてんもんさんの MOD: ForgeGradle と Forge の版は、ほかの MOD と同じ', () => {
  const forge = read('DisplayMod/build.gradle').match(/net\.minecraftforge:forge:1\.20\.1-([0-9.]+)/)[1];
  assert.equal(read('SaikutuMod/build.gradle').match(/net\.minecraftforge:forge:1\.20\.1-([0-9.]+)/)[1], forge);
  for (const mod of MODS) assert.match(read(`${mod}/gradle.properties`), new RegExp(`^forge_version=${forge.replace(/\./g, '\\.')}\\r?$`, 'm'), mod);
  for (const mod of ['DisplayMod', 'SaikutuMod', ...MODS]) assert.match(read(`${mod}/build.gradle`), /id 'net\.minecraftforge\.gradle' version '6\.0\.47'/, mod);
});

// 自分で Maven Central を足すと、Gradle がオフラインの写しを探す場所が変わり、オフラインで作れない（ForgeGradle が足すものを使う）。
test('そうてんもんさんの MOD: 依存の取り先はほかの MOD と同じ（オフラインで作れる）', () => {
  for (const mod of MODS) assert.doesNotMatch(read(`${mod}/build.gradle`), /^repositories\s*\{\s*mavenCentral\(\)\s*\}/m, mod);
});

test('そうてんもんさんの MOD: jar の横に印を書き、MOD ID と jar の名前はそうてんもんさんのまま', () => {
  for (const mod of MODS) {
    assert.match(read(`${mod}/build.gradle`), /apply from: '\.\.\/scripts\/jar_inputs\.gradle'/, mod);
    assert.match(read(`${mod}/build.gradle`), /archivesName = mod_id/, mod);
  }
  assert.match(read('ObsMod/gradle.properties'), /^mod_id=minecraft_obs_bridge\r?$/m, 'StackingGame は minecraft_obs_bridge で OBSMOD を探す');
  assert.match(read('ObsMod/gradle.properties'), /^mod_version=2\.4\.7\r?$/m);
  assert.match(read('UmetateMod/gradle.properties'), /^mod_id=stackinggame_events\r?$/m, 'GameEvents に登録するゲーム ID');
  assert.match(read('UmetateMod/gradle.properties'), /^mod_version=2\.6\.16\r?$/m);
});

// 届いたのは BridgeMOD 1.4.0 の API だけの写し（libs/）。採掘MOD と同じく、このリポジトリの BridgeMod のクラスを使って作り、API が変われば作るときに気づく。
test('埋め立ての MOD: このリポジトリの BridgeMod のクラスを使って作り、印にも BridgeMod の分を入れる', () => {
  const gradle = read('UmetateMod/build.gradle');
  assert.match(gradle, /compileOnly files\('\.\.\/BridgeMod\/build\/classes\/java\/main'\)/);
  assert.doesNotMatch(gradle, /libs\/bridgemod-api/);
  assert.match(gradle, /ext\.jarInputsAlso = \['BridgeMod'\]\s+apply from/);
  assert.ok(!fs.existsSync(path.join(root, 'UmetateMod/libs')));
});

test('そうてんもんさんの MOD: CI の mod-build で、BridgeMod のあとに作り、作った物は git に入れない', () => {
  const ci = read('.github/workflows/verify.yml');
  for (const mod of MODS) {
    const build = ci.indexOf(`working-directory: ${mod}`);
    assert.ok(build > ci.indexOf('working-directory: BridgeMod'), `${mod} は BridgeMod のあとに作る`);
    assert.ok(build < ci.indexOf('node scripts/check-jar-inputs.cjs'), `${mod} は印の照らし合わせより前に作る`);
  }
  const ignore = read('.gitignore').split(/\r?\n/);
  for (const mod of MODS) for (const dir of ['build/', '.gradle/', 'bin/', 'run-client/', 'run-server/']) assert.ok(ignore.includes(`${mod}/${dir}`), `${mod}/${dir}`);
});

test('そうてんもんさんの MOD: 作り方を AGENTS.md に書く', () => {
  const agents = read('AGENTS.md');
  for (const mod of MODS) assert.match(agents, new RegExp(mod), mod);
});
