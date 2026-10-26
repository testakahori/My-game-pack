// そうてんもんさんの MOD を、ほかの MOD と同じ階層に取り込んで作る（2026-10-24 ユーザーの決定。HANDOFF04）。
// ObsMod/：OBSMOD（v2.4.7 から取り込み、2.4.8 で MyGamePack の標準装備にした。MOD ID minecraft_obs_bridge）。UmetateMod/：埋め立てゲームの StackingGame-Events v2.6.16（MOD ID stackinggame_events）。
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
// settings.gradle（プラグインの取り先）も DisplayMod と同じにする（最後のレビュー 軽い7）。
test('そうてんもんさんの MOD: build.gradle でも settings.gradle でも Maven Central を足さない（オフラインで作れる）', () => {
  // settings.gradle は、プロジェクトの名前のほかは DisplayMod と同じ。
  const settings = name => read(name).replace(/rootProject\.name = '[^']*'/, '').replace(/\s+/g, ' ').trim();
  for (const mod of MODS) {
    assert.doesNotMatch(read(`${mod}/build.gradle`), /^repositories\s*\{\s*mavenCentral\(\)\s*\}/m, mod);
    assert.equal(settings(`${mod}/settings.gradle`), settings('DisplayMod/settings.gradle'), mod);
  }
});

// Java のツールチェーンを 17 にそろえる（無いと、Gradle を動かす JDK（21 など）でコンパイルされる。最後のレビュー 軽い1）。
test('そうてんもんさんの MOD: Java 17 のツールチェーンで作る（ほかの MOD と同じ）', () => {
  for (const mod of ['DisplayMod', 'SaikutuMod', ...MODS]) assert.match(read(`${mod}/build.gradle`), /java\.toolchain\.languageVersion = JavaLanguageVersion\.of\(17\)/, mod);
  for (const mod of MODS) assert.doesNotMatch(read(`${mod}/build.gradle`), /sourceCompatibility/, `${mod}：ツールチェーンと一緒に使えない`);
});

test('そうてんもんさんの MOD: jar の横に印を書き、MOD ID と jar の名前はそうてんもんさんのまま', () => {
  for (const mod of MODS) {
    assert.match(read(`${mod}/build.gradle`), /apply from: '\.\.\/scripts\/jar_inputs\.gradle'/, mod);
    assert.match(read(`${mod}/build.gradle`), /archivesName = mod_id/, mod);
  }
  assert.match(read('ObsMod/gradle.properties'), /^mod_id=minecraft_obs_bridge\r?$/m, 'StackingGame は minecraft_obs_bridge で OBSMOD を探す');
  assert.match(read('ObsMod/gradle.properties'), /^mod_version=2\.4\.8\r?$/m);
  assert.match(read('UmetateMod/gradle.properties'), /^mod_id=stackinggame_events\r?$/m, 'GameEvents に登録するゲーム ID');
  assert.match(read('UmetateMod/gradle.properties'), /^mod_version=2\.6\.23\r?$/m);
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

// OBSMOD は標準装備として同梱する MOD に移った（2026-10-25。electron/test/obsmod-bundle.test.cjs）。埋め立ての MOD はまだ同梱しないが、CI の印の照らし合わせ（scripts/check-jar-inputs.cjs）は見る（最後のレビュー 重要1）。
test('そうてんもんさんの MOD: 作るが同梱しない MOD として、jar の場所を1か所で決める', () => {
  const { buildOnlyModJars } = require('../../scripts/mod_jars.cjs');
  assert.deepEqual(buildOnlyModJars(root).map(mod => [mod.dir, path.basename(mod.jar), mod.uses?.dir]), [
    ['UmetateMod', 'stackinggame_events-2.6.23.jar', 'BridgeMod'],
  ]);
  assert.match(read('scripts/check-jar-inputs.cjs'), /buildOnlyModJars/);
});

// イベントの一覧（events.master.json）から、3つの Java を作る。届いた道具（tools/sync_event_master.py）を scripts/sync-event-master.cjs に移した（最後のレビュー 軽い2）。
test('イベントの一覧: 2つの MOD の写しと、そこから作る3つの Java が、一覧とずれていない', () => {
  const sync = require('../../scripts/sync-event-master.cjs');
  assert.deepEqual(sync.driftedFiles(root), []);
  assert.equal(read('ObsMod/src/main/resources/event-master/events.master.json'), read('UmetateMod/src/main/resources/event-master/events.master.json'));
  for (const name of ['UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/EventMasterKeys.java', 'ObsMod/src/main/java/jp/streamtorearn/obsmodule/catalog/EventMaster.java']) {
    assert.match(read(name), /by scripts\/sync-event-master\.cjs/, name);
  }
});

test('イベントの一覧: 届いた道具と同じ決まりで、一覧の誤りを止める', () => {
  const { validateMaster } = require('../../scripts/sync-event-master.cjs');
  const data = JSON.parse(read('UmetateMod/src/main/resources/event-master/events.master.json'));
  assert.doesNotThrow(() => validateMaster(data));
  const broken = JSON.parse(JSON.stringify(data));
  broken.events[1].startKey = broken.events[0].startKey;
  delete broken.events[2].encounterKey;
  broken.events[3].targetMode = 'SKY';
  assert.throws(() => validateMaster(broken), /duplicate startKey: aquatower[\s\S]*events\[2\] missing: encounterKey[\s\S]*events\[3\]\.targetMode invalid: SKY/);
});

// 埋め立ての MOD は、OBSMOD を MOD ID と、クラス名・メソッド名（リフレクション）で探す。名前を変えると OBS への通知が黙って止まる（最後のレビュー 軽い3）。
test('埋め立ての MOD が OBSMOD を探す名前は、OBSMOD の宣言と合う', () => {
  const integration = read('UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/IntegrationService.java');
  const constant = name => integration.match(new RegExp(`${name} = "([^"]+)"`))[1];
  const className = constant('OBS_API_CLASS');
  const api = read(`ObsMod/src/main/java/${className.split('.').join('/')}.java`);
  assert.ok(api.includes(`package ${className.slice(0, className.lastIndexOf('.'))};`), 'パッケージ');
  assert.ok(api.includes(`public final class ${className.slice(className.lastIndexOf('.') + 1)} `), 'クラス名');
  for (const method of [constant('OBS_API_METHOD'), constant('OBS_ENCOUNTER_API_METHOD')]) {
    assert.match(api, new RegExp(`public static boolean ${method}[(]Object [a-zA-Z]+, Map<String, [?]> [a-zA-Z]+[)]`), method);
  }
  const obsId = read('ObsMod/gradle.properties').match(/^mod_id=(.+?)\r?$/m)[1];
  assert.ok(integration.includes(`isLoaded("${obsId}")`), 'MOD ID で OBSMOD を探す');
  const agents = read('AGENTS.md');
  for (const word of [className, 'publishLifecycle', 'publishEncounter', obsId]) assert.ok(agents.includes(word), `AGENTS.md に ${word}`);
});

// mods.toml は BridgeMOD 1.4.0 以上を許す。新しい API を使ったら bridge_api_version を上げる（最後のレビュー 軽い4）。
test('埋め立ての MOD が使う BridgeMOD の API は GameEvents だけ（1.4.0 にある）', () => {
  const uses = [];
  const visit = dir => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) visit(p);
      else if (name.endsWith('.java')) uses.push(...(fs.readFileSync(p, 'utf8').match(/jp[.]douma[.]bridgemod[\w.]*/g) || []));
    }
  };
  visit(path.join(root, 'UmetateMod/src/main/java'));
  assert.deepEqual([...new Set(uses)], ['jp.douma.bridgemod.api.GameEvents']);
  assert.match(read('UmetateMod/gradle.properties'), /^bridge_api_version=1[.]4[.]0\r?$/m);
  assert.match(read('AGENTS.md'), /bridge_api_version/);
});

// 届いたフォルダー（約 50MB）を、公開のリポジトリに誤って入れない（最後のレビュー 軽い5）。IDE が作るファイルも入れない（軽い11）。
test('届いたフォルダーと IDE が作るファイルは git に入れない', () => {
  const ignore = read('.gitignore').split(/\r?\n/);
  for (const line of ['docs/soutenmon/StreamToEarn_code/', '.idea/', '*.iml', '.project', '.classpath', '.settings/']) assert.ok(ignore.includes(line), line);
});

// 画面の CSS は、画面のソース（src・index.html）だけからクラス名を拾う。MOD の Java や文書を読まない（最後のレビュー 軽い6）。
test('Tailwind は画面のソースだけを読む', () => {
  const css = read('src/index.css');
  assert.match(css, /^@import "tailwindcss" source[(]none[)];/m);
  assert.match(css, /^@source "[.][.]\/index[.]html";/m);
  assert.match(css, /^@source "[.][.]\/src";/m);
});

// 届いたものの tools/selftest にあった、Forge なしで動く確かめ（requestId の二重実行の防止・遭遇の重複の抑え）を、CI の mod-build で動かす（最後のレビュー 軽い9）。
test('そうてんもんさんの確かめ（selftest）を取り込み、CI の mod-build で動かす', () => {
  for (const name of ['UmetateMod/src/contractTest/java/LedgerSmokeTest.java', 'ObsMod/src/contractTest/java/ObsDedupeSmokeTest.java']) assert.ok(fs.existsSync(path.join(root, name)), name);
  assert.match(read('.github/workflows/verify.yml'), /node scripts\/test-soutenmon-contracts[.]cjs/);
  assert.match(read('scripts/test-soutenmon-contracts.cjs'), /LedgerSmokeTest/);
});

// BridgeMod を作り忘れたら、分かる言葉で止める（届いたときは API の jar が無いと止めていた。最後のレビュー 軽い10）。
test('埋め立ての MOD: BridgeMod を先に作っていなければ、そう言って止める', () => {
  assert.match(read('UmetateMod/build.gradle'), /Build BridgeMod first/);
});

test('そうてんもんさんの MOD: 作り方と決まりを AGENTS.md に書く', () => {
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('SaikutuMod・DisplayMod・ObsMod・UmetateMod：`BridgeMod/gradlew -p <MODのフォルダー> build`'));
  assert.ok(agents.includes('README が指す docs・tools は取り込んでいません'), '取り込んだ README が指すものが無いことを書く（最後のレビュー 軽い8）');
  assert.ok(agents.includes('node scripts/sync-event-master.cjs'));
});

// 実サーバーの検証の台本は、使い捨てのフォルダーに libraries のジャンクション（今までは本物の配信サーバーの libraries）を作る。
// 残したままだと、フォルダーをまとめて消したときに先の本物の libraries まで消えるおそれがあるので、終わったらジャンクションだけを外す
// （2026-10-26 に9つ残っていたのを見つけた。埋め立て PR1 の Task 0）。
test('埋め立ての MOD: 実サーバーの検証の台本は、終わったら libraries のジャンクションだけを外す', () => {
  const script = read('UmetateMod/tools/run-lab-probe.ps1');
  const tail = script.slice(script.lastIndexOf('} finally {'));
  assert.match(tail, /LinkType -eq 'Junction'/, '外すのはジャンクションのときだけ');
  assert.match(tail, /\[IO\.Directory\]::Delete\(\$[A-Za-z]+, \$false\)/, 'ジャンクションそのものだけを外す（中身は消さない）');
  assert.doesNotMatch(script, /Remove-Item[^\r\n]*-Recurse/, 'フォルダーや libraries をまとめて消さない');
});
