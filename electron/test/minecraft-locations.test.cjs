const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverMinecraftLocations: discover, validateMinecraftFolder: validate } = require('../minecraft_locations.cjs');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mygamepack-location-')));
  t.after(() => {
    assert.equal(path.dirname(root), fs.realpathSync.native(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('mygamepack-location-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const dir = name => { const folder = path.join(root, name); fs.mkdirSync(folder, { recursive: true }); return folder; };
  const appData = dir('Roaming');
  const standard = dir('Roaming/.minecraft');
  const serverRoot = dir('server');
  const profiles = (value, filename = 'launcher_profiles.json', folder = standard) => fs.writeFileSync(path.join(folder, filename), JSON.stringify(value));
  return { root, dir, appData, standard, serverRoot, profiles };
}

test('標準・起動構成・設定済み保存先を候補化し、同じ保存先をまとめる。Forgeだけ目印を付ける', async t => {
  const f = fixture(t);
  const custom = f.dir('別ドライブ相当/配信用');
  const saved = f.dir('前回の手動指定');
  f.profiles({ profiles: {
    forge: { name: 'forge', lastVersionId: '1.20.1-forge-47.4.10' },
    vanilla: { name: '通常プレイ', lastVersionId: '1.21' },
    custom: { name: '配信', lastVersionId: '1.20.1-forge-47.4.10', gameDir: custom },
    missing: { name: '以前の保存先', lastVersionId: 'fabric-loader-0.16.10-1.21', gameDir: path.join(f.root, 'missing') },
  }, authenticationDatabase: { secret: 'never-return-this-token' }, clientToken: 'private-token' });
  f.profiles({ profiles: { same: { name: '配信', lastVersionId: '1.20.1-forge-47.4.10', gameDir: custom } } }, 'launcher_profiles_microsoft_store.json');
  const raw = fs.readFileSync(path.join(f.standard, 'launcher_profiles.json'), 'utf8');
  const result = await discover({ ...f, currentFolder: saved });
  assert.equal(result.candidates.length, 4);
  const standard = result.candidates.find(c => c.path === f.standard);
  assert.equal(standard.profiles.length, 2);
  assert.equal(standard.recommended, true);
  assert.equal(standard.current, false);
  assert.equal(result.candidates[0].path, saved);
  assert.equal(result.candidates[0].current, true);
  assert.equal(result.candidates.find(c => c.path === custom).profiles.length, 1);
  assert.equal(result.candidates.find(c => !c.exists).selectable, false);
  assert.equal(result.candidates.find(c => !c.exists).recommended, false);
  assert.doesNotMatch(JSON.stringify(result), /never-return|private-token|authenticationDatabase/);
  assert.equal(fs.readFileSync(path.join(f.standard, 'launcher_profiles.json'), 'utf8'), raw);
  assert.deepEqual(fs.readdirSync(custom), [], '検索はmodsなどを作成しない');
  assert.equal(await validate(custom, { ...f, candidates: result.candidates, requireCandidate: true }), custom, '未起動でも起動構成が指定する実在フォルダーは選べる');
});

test('不正JSONがあっても別の起動構成ファイルと手動設定を確認する', async t => {
  const f = fixture(t);
  const custom = f.dir('手動設定/ゲーム');
  fs.writeFileSync(path.join(f.standard, 'launcher_profiles.json'), '{broken');
  f.profiles({ profiles: { forge: { name: 'Store版', lastVersionId: '1.20.1-forge-47.4.10', gameDir: custom } } }, 'launcher_profiles_microsoft_store.json');
  const result = await discover({ ...f, currentFolder: custom });
  assert.equal(result.warnings.length, 1);
  assert.equal(result.candidates.find(c => c.path === custom).recommended, true);
  assert.equal(result.candidates.find(c => c.path === custom).current, true);
});

test('標準保存先も起動構成もなくても、フォルダーを勝手に作らず未検出を返す', async t => {
  const f = fixture(t);
  const result = await discover({ appData: path.join(f.root, 'no-roaming'), serverRoot: f.serverRoot });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].exists, false);
  assert.equal(result.candidates[0].selectable, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(fs.existsSync(path.join(f.root, 'no-roaming')), false);
});

test('不正なgameDir・ネットワーク先・巨大ファイルを除外し、相対パスはランチャーの場所を基準にする', async t => {
  const f = fixture(t);
  const relative = f.dir('Roaming/.minecraft/instances/local');
  f.profiles({ profiles: {
    number: { name: '不正な数値', gameDir: 1 }, remote: { name: 'ネットワーク', gameDir: '\\\\not-a-server\\share' },
    web: { name: 'URL', gameDir: 'https://invalid.example/game' }, empty: null,
    relative: { name: '相対指定', gameDir: 'instances/local', lastVersionId: 'fabric-loader-0.16.10-1.21' },
  } });
  fs.writeFileSync(path.join(f.standard, 'launcher_profiles_microsoft_store.json'), 'x'.repeat(2 * 1024 * 1024 + 1));
  const result = await discover(f);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates.find(c => c.path === relative).recommended, false);
  assert.equal(result.warnings.length, 4);
  await assert.rejects(validate('https://invalid.example/game', f), /このPC内/);
});

test('サーバーと同じ場所・親子関係・modsリンク・古い候補を保存できない', async t => {
  const f = fixture(t);
  const nested = f.dir('server/client');
  for (const folder of [f.serverRoot, nested, f.root]) await assert.rejects(validate(folder, f), /サーバーの保存先とは別/);
  const linked = f.dir('linked-client');
  const other = f.dir('other-mods');
  fs.symlinkSync(other, path.join(linked, 'mods'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(validate(linked, f), /通常のフォルダーでは/);
  const stale = path.join(f.root, 'removed-folder');
  await assert.rejects(validate(stale, { ...f, candidates: [{ path: stale, selectable: true }], requireCandidate: true }), /フォルダーがありません/);
  const unknown = f.dir('unlisted');
  await assert.rejects(validate(unknown, { ...f, requireCandidate: true }), /候補を再検索/);
  await assert.rejects(validate(unknown, f), /ゲームフォルダーを選んで/);
});

test('手動選択はoptionsやmodsだけのカスタム保存先も扱い、modsそのものは拒否する', async t => {
  const f = fixture(t);
  const custom = f.dir('custom/mods');
  const folder = path.dirname(custom);
  assert.equal(await validate(folder, f), folder);
  await assert.rejects(validate(custom, f), /modsフォルダーの1つ上/);
  const options = f.dir('options-only');
  fs.writeFileSync(path.join(options, 'options.txt'), 'fullscreen:false');
  assert.equal(await validate(options, f), options);
});

test('同じ保存先のパス表記違い・リンクを実体パスにまとめる', async t => {
  const f = fixture(t);
  const real = f.dir('RealClient');
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  f.profiles({ profiles: {
    one: { name: '通常', gameDir: real, lastVersionId: '1.20.1-forge-47.4.10' },
    two: { name: 'リンク', gameDir: alias, lastVersionId: '1.20.1-forge-47.4.10' },
    ...(process.platform === 'win32' ? { three: { name: '大文字小文字', gameDir: real.toUpperCase() } } : {}),
  } });
  const result = await discover({ ...f, currentFolder: alias });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].path, real);
  assert.equal(result.candidates[0].current, true);
  assert.equal(await validate(alias, { ...f, candidates: result.candidates }), real);
});
