// 配信者に配るインストーラーは `npm run release:win` の1本で作る（2026-10-24 ユーザーの決定。HANDOFF04 の「リリース手順が2つ」）。
// 前は scripts/package-windows.cjs だけを動かすと、画面のビルドや BRIDGE・サーバーの雛形・ゲームパックの準備をせずに、前に作ったものがそのまま入った。
// npm run pack:win は準備までしたが、最後に electron-builder をそのまま呼び、2回目からはサーバーの雛形の置き場が残っていて止まった。
const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const release = require('../../scripts/release-windows.cjs');
const { modJars } = require('../../scripts/mod_jars.cjs');
const jarInputs = require('../../scripts/jar_inputs.cjs');
const { checkJarInputs } = require('../../scripts/check-jar-inputs.cjs');
const { assertReleaseVersion, RELEASE_PIPELINE_ENV } = require('../../scripts/release_version.cjs');

// jar を作った時刻。どの時間帯でも今より前にする（ソースを消すとフォルダーの時刻は「今」になるので、T が未来だと消したことに気づけない。CI の UTC で落ちた）。
const T = new Date(2020, 0, 1, 12, 0, 0);
const later = new Date(T.getTime() + 60000);
// BridgeMOD のクラスを使って作る MOD の build.gradle（本物の SaikutuMod・UmetateMod と同じ書き方）。
const USES_BRIDGE = "ext.jarInputsAlso = ['BridgeMod']\napply from: '../scripts/jar_inputs.gradle'\n";

// 偽のリポジトリ：3つの MOD のソースと jar、ゲームパックの説明。
function fakeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (name, text, time = T) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    fs.utimesSync(file, time, time);
    return file;
  };
  put('package.json', JSON.stringify({ version: '1.2.3' }));
  for (const [mod, id, version] of [['BridgeMod', 'bridgemod', '1.8.0'], ['DisplayMod', 'displaymod', '1.0.0']]) {
    put(`${mod}/gradle.properties`, `mod_version=${version}\n`, new Date(T.getTime() - 60000));
    put(`${mod}/src/main/java/A.java`, 'class A {}', new Date(T.getTime() - 60000));
    put(`${mod}/build/libs/${id}-${version}.jar`, `jar ${mod}`);
  }
  put('SaikutuMod/build.gradle', USES_BRIDGE, new Date(T.getTime() - 60000));
  put('SaikutuMod/src/main/java/B.java', 'class B {}', new Date(T.getTime() - 60000));
  put('SaikutuMod/build/libs/saikutumod-2.0.0.jar', 'jar SaikutuMod');
  put('game-packs/saikutu/game.json', JSON.stringify({ serverJar: 'saikutumod-2.0.0.jar' }));
  // そうてんもんさんの MOD（OBSMOD は標準装備として同梱する。埋め立ての MOD はゲームパックで同梱する。2026-10-29 埋め立て PR2）。
  for (const [mod, id, version] of [['ObsMod', 'minecraft_obs_bridge', '2.4.7'], ['UmetateMod', 'stackinggame_events', '2.6.16']]) {
    put(`${mod}/gradle.properties`, `mod_id=${id}\nmod_version=${version}\n`, new Date(T.getTime() - 60000));
    put(`${mod}/src/main/java/C.java`, 'class C {}', new Date(T.getTime() - 60000));
    put(`${mod}/build/libs/${id}-${version}.jar`, `jar ${mod}`);
  }
  put('UmetateMod/build.gradle', USES_BRIDGE, new Date(T.getTime() - 60000));
  put('game-packs/umetate/game.json', JSON.stringify({ serverJar: 'stackinggame_events-2.6.16.jar' }));
  // フォルダーの時刻も jar より前にそろえる（ファイルを足す・消すとフォルダーの時刻が新しくなるので、それも見る）。
  const settle = folder => {
    for (const name of fs.readdirSync(folder)) if (fs.statSync(path.join(folder, name)).isDirectory()) settle(path.join(folder, name));
    fs.utimesSync(folder, new Date(T.getTime() - 60000), new Date(T.getTime() - 60000));
  };
  for (const mod of ['BridgeMod', 'DisplayMod', 'SaikutuMod', 'ObsMod', 'UmetateMod']) settle(path.join(dir, mod, 'src'));
  return { dir, put };
}

// Gradle（scripts/jar_inputs.gradle）が jar の横に書くものと同じ形の印を書く。
function writeStamp(dir, modDir, inputs) {
  const mod = modJars(dir).find(row => row.dir === modDir);
  const dirs = [mod.dir, ...(mod.uses ? [mod.uses.dir] : [])];
  const recorded = inputs || Object.fromEntries(dirs.map(name => [name, jarInputs.jarInputsHash(dir, name)]));
  fs.writeFileSync(jarInputs.stampPath(mod.jar), JSON.stringify({ inputs: recorded, jar: jarInputs.sha256File(mod.jar) }));
}
const stampAll = dir => { for (const modDir of ['BridgeMod', 'DisplayMod', 'SaikutuMod', 'ObsMod', 'UmetateMod']) writeStamp(dir, modDir); };
const reasons = dir => release.staleMods(dir).map(row => [row.name, row.reason]);
const quiet = { local: false, log: () => {} };
const freshExe = (put, version = '1.2.3') => () => { put(`release/MyGamePack-Setup-${version}.exe`, 'exe', new Date()); };

test('リリース: package.json は release:win の1本で、pack:win は無い。electron-builder の版は固定', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['release:win'], 'node scripts/release-windows.cjs');
  assert.equal(pkg.scripts['pack:win'], undefined);
  const pinned = pkg.devDependencies['electron-builder'];
  assert.match(pinned, /^\d+\.\d+\.\d+$/, '^ や ~ を付けない');
  assert.equal(pinned, require(path.join(root, 'node_modules/electron-builder/package.json')).version, '入っている版と同じ');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].devDependencies['electron-builder'], pinned, 'package-lock.json も同じ');
});

test('リリース: 版は、正式なら 1.2.3 の形、試し用なら -local. を含む', () => {
  assert.doesNotThrow(() => assertReleaseVersion('1.2.3', false));
  assert.throws(() => assertReleaseVersion('1.2.3-local.1', false), /Use a stable version for a release package/);
  assert.doesNotThrow(() => assertReleaseVersion('1.2.3-local.1', true));
  assert.throws(() => assertReleaseVersion('1.2.3', true), /Use a -local\. version for a local package/);
});

// jar の場所の決まりが写しになると、確かめる jar と同梱する jar がずれる（最後のレビュー 軽い1）。
test('リリース: 同梱する MOD の jar の場所は scripts/mod_jars.cjs の1か所で決め、準備の道具も同じものを使う', t => {
  const { dir } = fakeRepo(t);
  assert.deepEqual(modJars(dir).map(mod => [mod.name, path.relative(dir, mod.jar).split(path.sep).join('/')]), [
    ['BridgeMOD', 'BridgeMod/build/libs/bridgemod-1.8.0.jar'],
    ['DisplayMOD', 'DisplayMod/build/libs/displaymod-1.0.0.jar'],
    ['採掘MOD', 'SaikutuMod/build/libs/saikutumod-2.0.0.jar'],
    ['埋め立てMOD', 'UmetateMod/build/libs/stackinggame_events-2.6.16.jar'],
    ['OBSMOD', 'ObsMod/build/libs/minecraft_obs_bridge-2.4.7.jar'],
  ]);
  assert.deepEqual(modJars(dir).find(mod => mod.dir === 'UmetateMod').uses, { name: 'BridgeMOD', dir: 'BridgeMod' }, '埋め立てMOD は BridgeMOD のクラスを使って作る');
  for (const name of ['scripts/prepare-server-template.cjs', 'scripts/prepare-game-packs.cjs', 'scripts/release-windows.cjs', 'scripts/check-jar-inputs.cjs']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    assert.match(source, /require\(["']\.\/mod_jars\.cjs["']\)/, name);
    assert.doesNotMatch(source, /build["'/, ]+libs|mod_version=/, `${name} は jar の場所を自分で決めない`);
  }
});

test('リリース: mod_version が読めなければ、分かる言葉で止める（最後のレビュー 軽い8）', t => {
  const { dir, put } = fakeRepo(t);
  put('BridgeMod/gradle.properties', 'mod_id=bridgemod\n');
  assert.throws(() => modJars(dir), /BridgeMod\/gradle\.properties に mod_version がありません/);
});

// MOD は作り直さず、MOD を変えたときに作っておいた jar を同梱する（ユーザー）。ソースが jar より新しければ、作り直し忘れとして止める。
test('リリース: MOD のソースが jar より新しい・jar が無いときは、作り直し忘れとして知らせる', t => {
  const { dir, put } = fakeRepo(t);
  assert.deepEqual(release.staleMods(dir), []);
  put('DisplayMod/src/main/java/A.java', 'class A { int changed; }', later);
  fs.rmSync(path.join(dir, 'SaikutuMod/build/libs/saikutumod-2.0.0.jar'));
  assert.deepEqual(reasons(dir), [['DisplayMOD', 'ソースが jar より新しい'], ['採掘MOD', 'jar が無い']]);
});

// 埋め立ての MOD も同梱するので、jar が無ければリリースの準備で止める（埋め立て PR2）。
test('リリース: 埋め立てMOD の jar が無いときも、作り直し忘れとして知らせる', t => {
  const { dir } = fakeRepo(t);
  fs.rmSync(path.join(dir, 'UmetateMod/build/libs/stackinggame_events-2.6.16.jar'));
  assert.deepEqual(reasons(dir), [['埋め立てMOD', 'jar が無い']]);
});

test('リリース: gradle.properties だけが新しいときも止める（最後のレビュー 軽い2）', t => {
  const { dir, put } = fakeRepo(t);
  put('DisplayMod/gradle.properties', 'mod_version=1.0.0\nmod_name=Display\n', later);
  assert.deepEqual(reasons(dir), [['DisplayMOD', 'ソースが jar より新しい']]);
});

// jar に入るのは src/main・src/generated とビルドの設定だけ。契約テスト・テストのソースを直しても jar は変わらない（この作業コピーで DisplayMOD を誤って止めた）。
test('リリース: jar に入らないテストのソースが新しくても、作り直し忘れとしない', t => {
  const { dir, put } = fakeRepo(t);
  put('DisplayMod/src/contractTest/java/P.java', 'class P {}', later);
  put('SaikutuMod/src/test/java/Q.java', 'class Q {}', later);
  assert.deepEqual(release.staleMods(dir), []);
  put('BridgeMod/src/main/resources/META-INF/mods.toml', 'x', later);
  assert.deepEqual(release.staleMods(dir).map(row => row.name), ['BridgeMOD', '採掘MOD', '埋め立てMOD'], 'src/main の下はリソースも見る（採掘MOD は BridgeMOD を使って作るので一緒に止まる）');
});

test('リリース: BridgeMOD の src/generated（jar に入る資材）が新しくても止める（最後のレビュー 軽い9）', t => {
  const { dir, put } = fakeRepo(t);
  put('BridgeMod/src/generated/resources/data/x.json', '{}', later);
  assert.deepEqual(release.staleMods(dir).map(row => row.name), ['BridgeMOD', '採掘MOD', '埋め立てMOD']);
});

// ソースを消しただけ（ブランチで足したファイルが、main に戻ると消える など）でも、jar の中身とずれる（最後のレビュー 重要1）。
test('リリース: jar を作ったあとに MOD のソースを消したときも、作り直し忘れとして止める', t => {
  const { dir } = fakeRepo(t);
  fs.rmSync(path.join(dir, 'DisplayMod/src/main/java/A.java'));
  assert.deepEqual(reasons(dir), [['DisplayMOD', 'ソースが jar より新しい']]);
});

// 使う別の MOD は、Gradle が jar の印に一緒に入れる MOD（build.gradle の ext.jarInputsAlso）と同じにする。ここに写しを持つと、
// build.gradle を直したときにずれる（埋め立て PR2 の最後のレビュー 軽い6）。
test('リリース: MOD を作るときに使う別の MOD は、その MOD の build.gradle の jarInputsAlso から読む', t => {
  const { dir, put } = fakeRepo(t);
  assert.deepEqual(modJars(dir).map(mod => [mod.dir, mod.uses?.dir]), [['BridgeMod', undefined], ['DisplayMod', undefined], ['SaikutuMod', 'BridgeMod'], ['UmetateMod', 'BridgeMod'], ['ObsMod', undefined]]);
  put('UmetateMod/build.gradle', "apply from: '../scripts/jar_inputs.gradle'\n");
  assert.equal(modJars(dir).find(mod => mod.dir === 'UmetateMod').uses, undefined, 'build.gradle から消したら使わない');
  put('ObsMod/build.gradle', "ext.jarInputsAlso = ['DisplayMod']\napply from: '../scripts/jar_inputs.gradle'\n");
  assert.deepEqual(modJars(dir).find(mod => mod.dir === 'ObsMod').uses, { name: 'DisplayMOD', dir: 'DisplayMod' }, 'ゲームパックの MOD でなくても読む');
  put('ObsMod/build.gradle', "ext.jarInputsAlso = ['BridgeMod', 'DisplayMod']\n");
  assert.throws(() => modJars(dir), /ObsMod\/build\.gradle の jarInputsAlso/, '2つ以上は確かめられないので止める');
  put('ObsMod/build.gradle', "ext.jarInputsAlso = ['NoSuchMod']\n");
  assert.throws(() => modJars(dir), /ObsMod\/build\.gradle の jarInputsAlso/, '同梱しない MOD は止める');
});

// 採掘MOD は BridgeMOD のクラスを使って作る（SaikutuMod/build.gradle の compileOnly）。BridgeMOD を直したら採掘MOD も作り直す（最後のレビュー 重要2）。
test('リリース: BridgeMOD のソースが採掘MOD の jar より新しければ、採掘MOD も作り直し忘れとして止める', t => {
  const { dir, put } = fakeRepo(t);
  put('BridgeMod/src/main/java/A.java', 'class A { int api; }', later);
  put('BridgeMod/build/libs/bridgemod-1.8.0.jar', 'jar', new Date(T.getTime() + 120000));
  assert.deepEqual(reasons(dir), [['採掘MOD', 'BridgeMOD のソースが jar より新しい（採掘MOD は BridgeMOD を使って作る）'], ['埋め立てMOD', 'BridgeMOD のソースが jar より新しい（埋め立てMOD は BridgeMOD を使って作る）']]);
  put('SaikutuMod/build/libs/saikutumod-2.0.0.jar', 'jar', new Date(T.getTime() + 180000));
  assert.deepEqual(release.staleMods(dir).map(row => row.name), ['埋め立てMOD'], '埋め立てMOD も BridgeMOD を使って作るので、作り直すまで止める');
  put('UmetateMod/build/libs/stackinggame_events-2.6.16.jar', 'jar', new Date(T.getTime() + 180000));
  assert.deepEqual(release.staleMods(dir), []);
});

// MOD を作ると、Gradle が元の中身のハッシュを jar の横に書く（scripts/jar_inputs.gradle）。あれば時刻ではなく中身で比べる（最後のレビュー 軽い3）。
test('MOD の印: 中身が同じなら、時刻だけ新しくなっても止めない（git のブランチの切り替え）', t => {
  const { dir, put } = fakeRepo(t);
  stampAll(dir);
  put('DisplayMod/src/main/java/A.java', 'class A {}', later);
  put('SaikutuMod/build.gradle', USES_BRIDGE, later);
  assert.deepEqual(release.staleMods(dir), []);
});

test('MOD の印: 中身を変えた・消した・足したときは止める', t => {
  const { dir, put } = fakeRepo(t);
  stampAll(dir);
  put('DisplayMod/src/main/java/A.java', 'class A { int changed; }', new Date(T.getTime() - 120000));
  fs.rmSync(path.join(dir, 'SaikutuMod/src/main/java/B.java'));
  assert.deepEqual(reasons(dir), [['DisplayMOD', 'ソースが jar を作ったときと違う'], ['採掘MOD', 'ソースが jar を作ったときと違う']]);
  const { dir: other, put: putOther } = fakeRepo(t);
  stampAll(other);
  putOther('BridgeMod/src/generated/resources/x.json', '{}', new Date(T.getTime() - 120000));
  assert.deepEqual(release.staleMods(other).map(row => row.name), ['BridgeMOD', '採掘MOD', '埋め立てMOD']);
});

test('MOD の印: BridgeMOD の中身が採掘MOD を作ったときと違えば、採掘MOD も止める', t => {
  const { dir, put } = fakeRepo(t);
  stampAll(dir);
  put('BridgeMod/src/main/java/A.java', 'class A { int api; }');
  writeStamp(dir, 'BridgeMod');
  assert.deepEqual(reasons(dir), [['採掘MOD', 'BridgeMOD のソースが jar を作ったときと違う（採掘MOD は BridgeMOD を使って作る）'], ['埋め立てMOD', 'BridgeMOD のソースが jar を作ったときと違う（埋め立てMOD は BridgeMOD を使って作る）']]);
});

test('MOD の印: jar を作っている間にソースが変わったと書いてあれば止める', t => {
  const { dir } = fakeRepo(t);
  stampAll(dir);
  writeStamp(dir, 'DisplayMod', { DisplayMod: jarInputs.CHANGED_DURING_BUILD });
  assert.deepEqual(reasons(dir), [['DisplayMOD', 'jar を作っている間にソースが変わった']]);
});

test('MOD の印: 印が別の jar のもの（印を書かない古い作りで jar を作り直した）なら、時刻で比べる', t => {
  const { dir, put } = fakeRepo(t);
  stampAll(dir);
  put('DisplayMod/build/libs/displaymod-1.0.0.jar', 'rebuilt by an old build', T);
  assert.deepEqual(release.staleMods(dir), []);
  put('DisplayMod/src/main/java/A.java', 'class A {}', later);
  assert.deepEqual(reasons(dir), [['DisplayMOD', 'ソースが jar より新しい']]);
});

test('MOD の印: Gradle 側は3つの MOD のビルドで同じ決まりを使い、CI で JS 側と照らす', () => {
  const gradle = fs.readFileSync(path.join(root, 'scripts/jar_inputs.gradle'), 'utf8');
  for (const word of [...jarInputs.SOURCE_DIRS, ...jarInputs.SOURCE_FILES, jarInputs.CHANGED_DURING_BUILD, '.inputs.json', "'SHA-256'"]) assert.ok(gradle.includes(word), word);
  for (const mod of ['BridgeMod', 'DisplayMod', 'SaikutuMod']) {
    assert.match(fs.readFileSync(path.join(root, mod, 'build.gradle'), 'utf8'), /apply from: '\.\.\/scripts\/jar_inputs\.gradle'/, mod);
  }
  assert.match(fs.readFileSync(path.join(root, 'SaikutuMod/build.gradle'), 'utf8'), /ext\.jarInputsAlso = \['BridgeMod'\]\s+apply from/);
  const ci = fs.readFileSync(path.join(root, '.github/workflows/verify.yml'), 'utf8');
  assert.ok(ci.indexOf('node scripts/check-jar-inputs.cjs') > ci.lastIndexOf('gradlew build'), 'MOD を作ったあとに照らす');
});

// 埋め立ての MOD も CI で照らす（ObsMod・UmetateMod の取り込みの最後のレビュー 重要1。2026-10-29 からはゲームパックで同梱する）。
test('MOD の印: check-jar-inputs は、印が無い・合わない MOD を知らせる（埋め立ての MOD も）', t => {
  const { dir } = fakeRepo(t);
  assert.deepEqual(checkJarInputs(dir).map(row => row.name), ['BridgeMOD', 'DisplayMOD', '採掘MOD', '埋め立てMOD', 'OBSMOD']);
  stampAll(dir);
  writeStamp(dir, 'UmetateMod', { UmetateMod: jarInputs.jarInputsHash(dir, 'UmetateMod'), BridgeMod: 'x' });
  assert.deepEqual(checkJarInputs(dir).map(row => row.name), ['埋め立てMOD'], '埋め立ての MOD は BridgeMod の分も照らす');
});

test('MOD の印: check-jar-inputs は、印が合えば何も知らせない', t => {
  const { dir } = fakeRepo(t);
  stampAll(dir);
  assert.deepEqual(checkJarInputs(dir), []);
  writeStamp(dir, 'SaikutuMod', { SaikutuMod: jarInputs.jarInputsHash(dir, 'SaikutuMod'), BridgeMod: 'x' });
  assert.deepEqual(checkJarInputs(dir).map(row => row.name), ['採掘MOD']);
});

test('リリース: 作った物の置き場を空にしてから、ビルドと準備を決まった順に通し、最後にインストーラーを作る', async t => {
  const { dir, put } = fakeRepo(t);
  put('build/server-template/old.txt', 'old');
  put('build/game-packs/saikutu/old.jar', 'old');
  put('GiftsViewer/tools-bundled/old.cjs', 'old');
  put('build/installer.nsh', 'keep');
  const gone = () => ['build/server-template', 'build/game-packs', 'GiftsViewer/tools-bundled'].every(name => !fs.existsSync(path.join(dir, name)));
  const calls = [];
  const summary = await release.runRelease({
    ...quiet, root: dir, outDir: path.join(dir, 'release'),
    run: step => { calls.push(['run', step, gone()]); },
    packageInstaller: args => { calls.push(['package', ...args]); freshExe(put)(); },
  });
  assert.deepEqual(calls, [
    ['run', 'build', true], ['run', 'prepare:bridge-runtime', true], ['run', 'prepare:server-template', true], ['run', 'prepare:game-packs', true],
    // ゲームの初期マップ（埋め立ての研究室マップ）は、パックの置き場に入れるので、パックのあと（埋め立て PR3）。
    ['run', 'prepare:game-maps', true],
    ['package', path.join(dir, 'release')],
  ]);
  assert.equal(fs.readFileSync(path.join(dir, 'build/installer.nsh'), 'utf8'), 'keep', 'git で管理している build/ のファイルは消さない');
  const text = summary.join('\n');
  for (const part of ['1.2.3', 'MyGamePack-Setup-1.2.3.exe', 'bridgemod-1.8.0.jar', 'displaymod-1.0.0.jar', 'saikutumod-2.0.0.jar', 'minecraft_obs_bridge-2.4.7.jar', '作った元:']) assert.ok(text.includes(part), part);
});

// 配る物に本当に初期マップが入ったかを、最後の表示で見せる（埋め立て PR3 の最後のレビュー 軽い8）。
test('リリース: 最後の表示に、配る物に入ったゲームの初期マップのファイルの数と大きさを出す。入っていなければそう出す', async t => {
  for (const withMap of [true, false]) {
    const { dir, put } = fakeRepo(t);
    const summary = await release.runRelease({
      ...quiet, root: dir, outDir: path.join(dir, 'release'),
      run: step => {
        if (withMap && step === 'prepare:game-maps') { put('build/game-packs/umetate/maps/umetate_lab_map/level.dat', 'x'.repeat(1024)); put('build/game-packs/umetate/maps/umetate_lab_map/region/r.0.0.mca', 'y'.repeat(2048)); }
      },
      packageInstaller: () => freshExe(put)(),
    });
    const line = summary.find(row => row.startsWith('埋め立ての初期マップ umetate_lab_map: '));
    assert.ok(line, summary.join('\n'));
    assert.equal(line, withMap ? '埋め立ての初期マップ umetate_lab_map: 2 ファイル・3.0 KB' : '埋め立ての初期マップ umetate_lab_map: 入っていません');
  }
});

// 配る物の bridge に、git で管理していないファイル（開発機の残り物）が入っていれば、名前を並べて知らせる。止めない
// （前の版には _op.txt・ゲームのコマンドの写し・.omc が入っていた。2026-10-29 ユーザーの決定）。
test('リリース: 最後の表示に、配る物の bridge に入った git に無いファイルの名前を出す。無ければ「なし」', async t => {
  for (const kind of ['extra', 'none', 'missing']) {
    const { dir, put } = fakeRepo(t);
    const summary = await release.runRelease({
      ...quiet, root: dir, outDir: path.join(dir, 'release'),
      // git の bridge のファイル（bridge から見た道）。build/bridge-bundle の中身も、入っているべきもの。
      bridgeFiles: () => ['index.js', 'commands/minecraft/tnt.txt'],
      run: step => { if (step === 'prepare:bridge-runtime') put('build/bridge-bundle/index.bundle.cjs', '//'); },
      packageInstaller: () => {
        freshExe(put)();
        if (kind === 'missing') return;
        const files = ['index.js', 'index.bundle.cjs', 'commands/minecraft/tnt.txt', ...(kind === 'extra' ? ['commands/minecraft/_op.txt', 'commands/minecraft/.omc/state/a.json'] : [])];
        for (const file of files) put(`release/win-unpacked/resources/bridge/${file}`, 'x');
      },
    });
    const line = summary.find(row => row.startsWith('配る物の bridge'));
    assert.equal(line, {
      extra: '配る物の bridge に git に無いファイルがあります（2 件）: commands/minecraft/.omc/state/a.json、commands/minecraft/_op.txt',
      none: '配る物の bridge の git に無いファイル: なし',
      missing: '配る物の bridge: win-unpacked が無いので確かめていません',
    }[kind], summary.join('\n'));
  }
});

test('リリース: MOD の作り直し忘れがあれば、何も作らずに止める', async t => {
  const { dir, put } = fakeRepo(t);
  put('BridgeMod/src/main/java/A.java', 'class A { int changed; }', later);
  const calls = [];
  await assert.rejects(release.runRelease({ ...quiet, root: dir, outDir: path.join(dir, 'release'), run: step => calls.push(step), packageInstaller: () => calls.push('package') }),
    /BridgeMOD.*ソースが jar より新しい.*作り直してから/s);
  assert.deepEqual(calls, []);
});

test('リリース: 作った物の置き場を消せないときは、開いているものを閉じるよう案内し、何も作らない（最後のレビュー 軽い5）', async t => {
  const { dir } = fakeRepo(t);
  const calls = [];
  const remove = () => { throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); };
  await assert.rejects(release.runRelease({ ...quiet, root: dir, outDir: path.join(dir, 'release'), remove, run: step => calls.push(step), packageInstaller: () => calls.push('package') }),
    /build\/server-template を消せません（EBUSY）.*閉じてから/s);
  assert.deepEqual(calls, []);
  assert.deepEqual(release.REMOVE_OPTIONS, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }, 'ふだんは何度か試し直す');
});

test('リリース: 最後の表示に、どのコミットから作ったかと、コミットしていない変更の数を出す（最後のレビュー 軽い6）', async t => {
  const { dir, put } = fakeRepo(t);
  const git = (...args) => cp.execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  git('init', '-q', '-b', 'release-test');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'release-test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('add', 'package.json');
  git('commit', '-q', '-m', 'test');
  const head = git('rev-parse', '--short', 'HEAD');
  put('package.json', JSON.stringify({ version: '1.2.3', changed: true }));
  const summary = await release.runRelease({ ...quiet, root: dir, outDir: path.join(dir, 'release'), run: () => {}, packageInstaller: freshExe(put) });
  assert.ok(summary.includes(`作った元: ${head}（release-test）・コミットしていない変更 1 件`), summary.join('\n'));
});

// package-windows.cjs を直接動かすと、ビルドと準備をせずに前に作ったものが入る（前の一番の問題。最後のレビュー 重要3）。
test('インストーラー: package-windows.cjs は release:win（試し用は package-local.cjs）からしか動かない', () => {
  // 存在しない npm を渡す。止める仕掛けが壊れても、本物のインストーラー作りは始まらずにすぐ止まる。
  const env = { ...process.env, npm_execpath: path.join(root, 'no-such-npm-cli.js') };
  delete env[RELEASE_PIPELINE_ENV];
  const direct = cp.spawnSync(process.execPath, [path.join(root, 'scripts/package-windows.cjs')], { cwd: root, env, encoding: 'utf8' });
  assert.equal(direct.status, 1);
  assert.match(direct.stderr, /npm run release:win/);
  // 合図があれば先へ進む（ここでは版が試し用でないので、作る前に止まる）。
  const piped = cp.spawnSync(process.execPath, [path.join(root, 'scripts/package-windows.cjs'), '--local'], { cwd: root, env: { ...env, [RELEASE_PIPELINE_ENV]: '1' }, encoding: 'utf8' });
  assert.notEqual(piped.status, 0);
  assert.match(piped.stderr, /Use a -local\. version for a local package/);
});

test('リリース: main は引数から出力先と試し用かを決め、npm と package-windows.cjs を合図つきで呼ぶ（最後のレビュー 軽い2）', async t => {
  const { dir, put } = fakeRepo(t);
  assert.deepEqual(release.releaseOptions([], dir), { local: false, outDir: path.join(dir, 'release') });
  assert.deepEqual(release.releaseOptions(['--local'], dir), { local: true, outDir: path.join(dir, 'release-local') });
  assert.deepEqual(release.releaseOptions(['out dir', '--local'], dir), { local: true, outDir: path.resolve('out dir') });
  const cli = path.join(dir, 'npm-cli.js');
  const calls = [];
  await release.main([], { root: dir, cli, log: () => {}, exec: (args, options) => {
    calls.push([args.map(arg => path.basename(arg)), options.cwd, options.env.npm_execpath, options.env[RELEASE_PIPELINE_ENV]]);
    if (args[0].endsWith('package-windows.cjs')) freshExe(put)();
  } });
  assert.deepEqual(calls, [
    ...release.RELEASE_STEPS.map(step => [['npm-cli.js', 'run', step], dir, cli, '1']),
    [['package-windows.cjs', 'release'], dir, cli, '1'],
  ]);
});

test('試し用の版: package-local.cjs は release-windows の main に、出力先と --local を渡す（最後のレビュー 軽い2）', async () => {
  const mainPath = require.resolve('../../scripts/release-windows.cjs');
  const localPath = require.resolve('../../scripts/package-local.cjs');
  const saved = { module: require.cache[mainPath], argv: process.argv };
  let received;
  require.cache[mainPath] = { id: mainPath, filename: mainPath, loaded: true, exports: { main: async argv => { received = argv; } } };
  delete require.cache[localPath];
  try {
    process.argv = [process.argv[0], localPath, 'out-local'];
    require(localPath);
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    require.cache[mainPath] = saved.module;
    process.argv = saved.argv;
    delete require.cache[localPath];
  }
  assert.deepEqual(received, ['out-local', '--local']);
});

// 実機で、electron-builder が失敗しても終了コードが 0 のまま返り、「.exe が見つからない」と出して成功で終わった（10-24）。
test('リリース: 今回のインストーラーができていなければ、成功にしない（前の回の .exe が残っていても、版が違っても）', async t => {
  const { dir, put } = fakeRepo(t);
  const outDir = path.join(dir, 'release');
  const run = () => {};
  await assert.rejects(release.runRelease({ ...quiet, root: dir, outDir, run, packageInstaller: () => {} }), /インストーラー（\.exe）ができていません/);
  put('release/MyGamePack-Setup-1.2.3.exe', 'old', new Date(Date.now() - 3600000));
  await assert.rejects(release.runRelease({ ...quiet, root: dir, outDir, run, packageInstaller: () => {} }), /インストーラー（\.exe）ができていません/);
  await assert.rejects(release.runRelease({ ...quiet, root: dir, outDir, run, packageInstaller: freshExe(put, '9.9.9') }), /インストーラー（\.exe）ができていません/);
});

// electron-builder の一時フォルダー（temp-file）が付ける async-exit-hook は、終わる直前に process.exit(0) を呼ぶ。process.exitCode = 1 は消える（10-24 実機）。
test('インストーラー: electron-builder が失敗したら、終了コード 1 で返す', () => {
  const tempFile = require.resolve('temp-file', { paths: [require.resolve('app-builder-lib', { paths: [root] })] });
  const exitHook = require.resolve('async-exit-hook', { paths: [tempFile] });
  const probe = how => cp.spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(exitHook)})(() => {});` +
    `Promise.reject(new Error('x')).catch(() => { ${how} });`], { encoding: 'utf8' }).status;
  assert.equal(probe('process.exitCode = 1;'), 0, 'exitCode だけでは 0 で終わる（だから使わない）');
  assert.equal(probe('process.exit(1);'), 1);
  const source = fs.readFileSync(path.join(root, 'scripts/package-windows.cjs'), 'utf8');
  assert.match(source, /\}\)\.catch\(\s*error\s*=>\s*\{[^}]*process\.exit\(1\)/, 'build() の失敗は process.exit(1) で返す');
  assert.doesNotMatch(source, /process\.exitCode/);
  assert.match(source, /npm ci --ignore-scripts/, '依存が合わないときは npm ci --ignore-scripts で直すと案内する');
});

test('リリース: 途中の手順が失敗したら、インストーラーを作らない', async t => {
  const { dir } = fakeRepo(t);
  const calls = [];
  await assert.rejects(release.runRelease({ ...quiet, root: dir, outDir: path.join(dir, 'release'),
    run: step => { calls.push(step); if (step === 'prepare:bridge-runtime') throw new Error('準備に失敗'); }, packageInstaller: () => calls.push('package') }), /準備に失敗/);
  assert.deepEqual(calls, ['build', 'prepare:bridge-runtime']);
});

test('リリース: 試し用の版も同じ流れを通し、版が合わなければ何もしない', async t => {
  const { dir } = fakeRepo(t);
  const calls = [];
  await assert.rejects(release.runRelease({ ...quiet, local: true, root: dir, outDir: path.join(dir, 'out'), run: step => calls.push(step), packageInstaller: () => calls.push('package') }), /-local\./);
  assert.deepEqual(calls, []);
  assert.match(fs.readFileSync(path.join(root, 'scripts/package-windows.cjs'), 'utf8'), /release_version\.cjs/, '版の決まりは1か所');
});

test('文書: 配布の手順は release:win と公式 HP。GitHub Release と pack:win の話は残っていない', () => {
  const manual = fs.readFileSync(path.join(root, 'docs/手動配布とアプリ更新.md'), 'utf8');
  assert.match(manual, /npm run release:win/);
  assert.match(manual, /公式 HP/);
  assert.doesNotMatch(manual, /GitHub ?Release/);
  // npm ci の案内は CI・docs/ローカル更新.md と同じ形にし、ジャンクションへの注意も書く（最後のレビュー 軽い4）。
  assert.match(manual, /npm ci --ignore-scripts/);
  assert.match(manual, /ジャンクション/);
  assert.match(manual, /\.inputs\.json/);
  for (const name of ['docs/手動配布とアプリ更新.md', 'docs/ローカル更新.md', 'docs/採掘MODと統一コマンド.md', 'AGENTS.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /pack:win/, name);
  }
});
