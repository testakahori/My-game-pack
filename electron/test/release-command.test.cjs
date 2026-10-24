// 配信者に配るインストーラーは `npm run release:win` の1本で作る（2026-10-24 ユーザーの決定。HANDOFF04 の「リリース手順が2つ」）。
// 前は scripts/package-windows.cjs だけを動かすと、画面のビルドや BRIDGE・サーバーの雛形・ゲームパックの準備をせずに、前に作ったものがそのまま入った。
// npm run pack:win は準備までしたが、最後に electron-builder をそのまま呼び、2回目からはサーバーの雛形の置き場が残っていて止まった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const release = require('../../scripts/release-windows.cjs');
const { assertReleaseVersion } = require('../../scripts/release_version.cjs');

const T = new Date(2026, 9, 24, 12, 0, 0);
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
    put(`${mod}/build/libs/${id}-${version}.jar`, 'jar');
  }
  put('SaikutuMod/build.gradle', '', new Date(T.getTime() - 60000));
  put('SaikutuMod/src/main/java/B.java', 'class B {}', new Date(T.getTime() - 60000));
  put('SaikutuMod/build/libs/saikutumod-2.0.0.jar', 'jar');
  put('game-packs/saikutu/game.json', JSON.stringify({ serverJar: 'saikutumod-2.0.0.jar' }));
  return { dir, put };
}

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

test('リリース: 同梱する MOD の jar の名前は、準備の道具と同じ決まりで決まる', t => {
  const { dir } = fakeRepo(t);
  assert.deepEqual(release.modJars(dir).map(mod => [mod.name, path.relative(dir, mod.jar).split(path.sep).join('/')]), [
    ['BridgeMOD', 'BridgeMod/build/libs/bridgemod-1.8.0.jar'],
    ['DisplayMOD', 'DisplayMod/build/libs/displaymod-1.0.0.jar'],
    ['採掘MOD', 'SaikutuMod/build/libs/saikutumod-2.0.0.jar'],
  ]);
});

// MOD は作り直さず、MOD を変えたときに作っておいた jar を同梱する（ユーザー）。ソースが jar より新しければ、作り直し忘れとして止める。
test('リリース: MOD のソースが jar より新しい・jar が無いときは、作り直し忘れとして知らせる', t => {
  const { dir, put } = fakeRepo(t);
  assert.deepEqual(release.staleMods(dir), []);
  put('DisplayMod/src/main/java/A.java', 'class A { int changed; }', new Date(T.getTime() + 60000));
  fs.rmSync(path.join(dir, 'SaikutuMod/build/libs/saikutumod-2.0.0.jar'));
  assert.deepEqual(release.staleMods(dir).map(row => [row.name, row.reason]), [['DisplayMOD', 'ソースが jar より新しい'], ['採掘MOD', 'jar が無い']]);
});

// jar に入るのは src/main とビルドの設定だけ。契約テスト・テストのソースを直しても jar は変わらない（この作業コピーで DisplayMOD を誤って止めた）。
test('リリース: jar に入らないテストのソースが新しくても、作り直し忘れとしない', t => {
  const { dir, put } = fakeRepo(t);
  const later = new Date(T.getTime() + 60000);
  put('DisplayMod/src/contractTest/java/P.java', 'class P {}', later);
  put('SaikutuMod/src/test/java/Q.java', 'class Q {}', later);
  assert.deepEqual(release.staleMods(dir), []);
  put('BridgeMod/src/main/resources/META-INF/mods.toml', 'x', later);
  assert.deepEqual(release.staleMods(dir).map(row => row.name), ['BridgeMOD'], 'src/main の下はリソースも見る');
});

test('リリース: 作った物の置き場を空にしてから、ビルドと準備を決まった順に通し、最後にインストーラーを作る', async t => {
  const { dir, put } = fakeRepo(t);
  put('build/server-template/old.txt', 'old');
  put('build/game-packs/saikutu/old.jar', 'old');
  put('build/installer.nsh', 'keep');
  const calls = [];
  const summary = await release.runRelease({
    root: dir, local: false, outDir: path.join(dir, 'release'),
    run: step => { calls.push(['run', step, fs.existsSync(path.join(dir, 'build/server-template')), fs.existsSync(path.join(dir, 'build/game-packs'))]); },
    packageInstaller: args => { calls.push(['package', ...args]); put('release/MyGamePack-Setup-1.2.3.exe', 'exe', new Date()); },
    log: () => {},
  });
  assert.deepEqual(calls, [
    ['run', 'build', false, false], ['run', 'prepare:bridge-runtime', false, false], ['run', 'prepare:server-template', false, false], ['run', 'prepare:game-packs', false, false],
    ['package', path.join(dir, 'release')],
  ]);
  assert.equal(fs.readFileSync(path.join(dir, 'build/installer.nsh'), 'utf8'), 'keep', 'git で管理している build/ のファイルは消さない');
  const text = summary.join('\n');
  for (const part of ['1.2.3', 'MyGamePack-Setup-1.2.3.exe', 'bridgemod-1.8.0.jar', 'displaymod-1.0.0.jar', 'saikutumod-2.0.0.jar']) assert.ok(text.includes(part), part);
});

test('リリース: MOD の作り直し忘れがあれば、何も作らずに止める', async t => {
  const { dir, put } = fakeRepo(t);
  put('BridgeMod/src/main/java/A.java', 'class A { int changed; }', new Date(T.getTime() + 60000));
  const calls = [];
  await assert.rejects(release.runRelease({ root: dir, local: false, outDir: path.join(dir, 'release'), run: step => calls.push(step), packageInstaller: () => calls.push('package'), log: () => {} }),
    /BridgeMOD.*ソースが jar より新しい.*作り直してから/s);
  assert.deepEqual(calls, []);
});

// 実機で、electron-builder が失敗しても終了コードが 0 のまま返り、「.exe が見つからない」と出して成功で終わった（10-24）。
test('リリース: 今回のインストーラーができていなければ、成功にしない（前の回の .exe が残っていても）', async t => {
  const { dir, put } = fakeRepo(t);
  const outDir = path.join(dir, 'release');
  const run = () => {};
  await assert.rejects(release.runRelease({ root: dir, local: false, outDir, run, packageInstaller: () => {}, log: () => {} }),
    /インストーラー（\.exe）ができていません/);
  put('release/MyGamePack-Setup-1.2.3.exe', 'old', new Date(Date.now() - 3600000));
  await assert.rejects(release.runRelease({ root: dir, local: false, outDir, run, packageInstaller: () => {}, log: () => {} }),
    /インストーラー（\.exe）ができていません/);
});

// electron-builder の一時フォルダー（temp-file）が付ける async-exit-hook は、終わる直前に process.exit(0) を呼ぶ。process.exitCode = 1 は消える（10-24 実機）。
test('インストーラー: electron-builder が失敗したら、終了コード 1 で返す', () => {
  const cp = require('node:child_process');
  const tempFile = require.resolve('temp-file', { paths: [require.resolve('app-builder-lib', { paths: [root] })] });
  const exitHook = require.resolve('async-exit-hook', { paths: [tempFile] });
  const probe = how => cp.spawnSync(process.execPath, ['-e',
    `require(${JSON.stringify(exitHook)})(() => {});` +
    `Promise.reject(new Error('x')).catch(() => { ${how} });`], { encoding: 'utf8' }).status;
  assert.equal(probe('process.exitCode = 1;'), 0, 'exitCode だけでは 0 で終わる（だから使わない）');
  assert.equal(probe('process.exit(1);'), 1);
  const source = fs.readFileSync(path.join(root, 'scripts/package-windows.cjs'), 'utf8');
  assert.match(source, /\.catch\(error => \{ console\.error\(error\); process\.exit\(1\); \}\)/);
  assert.doesNotMatch(source, /process\.exitCode/);
  assert.match(source, /npm ci/, '依存が合わないときは npm ci で直すと案内する');
});

test('リリース: 途中の手順が失敗したら、インストーラーを作らない', async t => {
  const { dir } = fakeRepo(t);
  const calls = [];
  await assert.rejects(release.runRelease({ root: dir, local: false, outDir: path.join(dir, 'release'),
    run: step => { calls.push(step); if (step === 'prepare:bridge-runtime') throw new Error('準備に失敗'); }, packageInstaller: () => calls.push('package'), log: () => {} }), /準備に失敗/);
  assert.deepEqual(calls, ['build', 'prepare:bridge-runtime']);
});

test('リリース: 試し用の版も同じ流れを通し、版が合わなければ何もしない', async t => {
  const { dir } = fakeRepo(t);
  const calls = [];
  await assert.rejects(release.runRelease({ root: dir, local: true, outDir: path.join(dir, 'out'), run: step => calls.push(step), packageInstaller: () => calls.push('package'), log: () => {} }), /-local\./);
  assert.deepEqual(calls, []);
  assert.match(fs.readFileSync(path.join(root, 'scripts/package-local.cjs'), 'utf8'), /release-windows\.cjs/);
  assert.match(fs.readFileSync(path.join(root, 'scripts/package-windows.cjs'), 'utf8'), /release_version\.cjs/, '版の決まりは1か所');
});

test('文書: 配布の手順は release:win と公式 HP。GitHub Release と pack:win の話は残っていない', () => {
  const manual = fs.readFileSync(path.join(root, 'docs/手動配布とアプリ更新.md'), 'utf8');
  assert.match(manual, /npm run release:win/);
  assert.match(manual, /公式 HP/);
  assert.doesNotMatch(manual, /GitHub ?Release/);
  for (const name of ['docs/手動配布とアプリ更新.md', 'docs/ローカル更新.md', 'docs/採掘MODと統一コマンド.md', 'AGENTS.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, name), 'utf8'), /pack:win/, name);
  }
});
