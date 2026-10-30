// アプリ設定（app-config.json）の読み書きと、その ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppConfig } = require('../app_config.cjs');
const { lastGoodPath } = require('../../bridge/safe_json_file.cjs');

function setup(t, { packaged = false, serverStarting = false, recordRecovery } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map(), records = [];
  const app = { isPackaged: packaged, getPath: () => dir, getVersion: () => '9.9.9' };
  const appConfig = createAppConfig({
    app,
    recordRecovery: recordRecovery || (entry => records.push(entry)),
    now: () => new Date(2026, 9, 23, 15, 30, 12),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => calls.push('mapIdle'),
    isServerStarting: () => serverStarting,
    getConfigPath: () => path.join(dir, 'config.minecraft.json'),
    getSettingsBackups: () => ({ create: kind => calls.push('backup:' + kind) }),
    refreshGameModsOnStartup: async () => { calls.push('refreshMods'); },
    migrateSavedConfig: () => calls.push('migrateConfig'),
  });
  appConfig.register({ handle: (name, fn) => handlers.set(name, fn) });
  const file = path.join(dir, 'app-config.json');
  return { dir, app, appConfig, calls, records, file, brokenFile: file + '.broken-20261023-153012', invoke: (name, ...args) => handlers.get(name)({}, ...args), handlers };
}

// 手動インストール（更新も含む）のあとは、初期セットアップを終えるまで設定の場所が userData/bridge の予備を指す。
// 起動のときの直しは配信者の設定に届かないので、セットアップを終えたときと保存先を変えたときにも直す（PR3 の最終レビュー）。
test('保存済みの設定の直し: 初期セットアップを終えたときと保存先を変えたときに呼ぶ。ほかの保存では呼ばない', async t => {
  const x = setup(t);
  await x.invoke('app:config:write', { minecraftPlayerName: 'Steve' });
  assert.ok(!x.calls.includes('migrateConfig'), 'セットアップ前の保存では呼ばない');
  await x.invoke('app:config:write', { setupComplete: true });
  assert.equal(x.calls.filter(c => c === 'migrateConfig').length, 1, 'セットアップを終えたとき');
  await x.invoke('app:config:write', { minecraftPlayerName: 'Alex' });
  assert.equal(x.calls.filter(c => c === 'migrateConfig').length, 1, 'ほかの保存では呼ばない');
  await x.invoke('app:config:write', { serverFolder: x.dir });
  assert.equal(x.calls.filter(c => c === 'migrateConfig').length, 2, '保存先を変えたとき');
});

// 壊れたファイルは名前を変えて残し、そのあと保存しても上書きしない（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5・9。
// 前は壊れたファイルを既定値で読み、次の保存で上書きしていた）。
test('読み込み: ファイルがない・壊れていて写しも無いときは既定値。壊れたファイルは残し、保存しても上書きしない。書き込みは今の値に足し、保存先は絶対パスにする', t => {
  const { appConfig, file, brokenFile, records } = setup(t);
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false });
  fs.writeFileSync(file, '{壊れた');
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false });
  assert.equal(fs.readFileSync(brokenFile, 'utf8'), '{壊れた');
  assert.deepEqual(records.map(entry => [entry.reason, entry.action]), [['JSON として読めない', 'defaults']]);
  appConfig.writeAppConfig({ serverFolder: 'server', authEmail: 'a@b.cd', authToken: 't', authLoginAt: 'x' });
  appConfig.writeAppConfig({ minecraftPlayerName: 'Steve' });
  assert.equal(fs.readFileSync(brokenFile, 'utf8'), '{壊れた', '保存しても壊れたファイルは残る');
  const saved = appConfig.readAppConfig();
  assert.equal(path.isAbsolute(saved.serverFolder), true);
  assert.equal(saved.minecraftPlayerName, 'Steve');
  assert.equal(appConfig.getAppConfigPath(), file);
  assert.deepEqual(Object.keys(appConfig.readPublicAppConfig()).sort(), ['minecraftPlayerName', 'serverFolder', 'setupComplete'], '画面にはログインの情報を渡さない');
});

test('壊れていたら、前の正しい状態の写しから戻す', t => {
  const { dir, appConfig, file, brokenFile, records } = setup(t);
  appConfig.writeAppConfig({ serverFolder: dir, setupComplete: true });
  appConfig.writeAppConfig({ minecraftPlayerName: 'Steve' });
  fs.writeFileSync(file, Buffer.alloc(16));
  const config = appConfig.readAppConfig();
  assert.equal(config.serverFolder, dir);
  assert.equal(config.setupComplete, true);
  assert.equal(config.minecraftPlayerName, undefined, '写しは最後の保存の1つ前の状態');
  assert.deepEqual(fs.readFileSync(brokenFile), Buffer.alloc(16));
  assert.deepEqual(records, [{ file, reason: 'JSON として読めない', action: 'restored', brokenFile }]);
});

test('壊れている: 中身が null・配列、表の項目の型の違い。表に無い項目は確かめない', t => {
  const broken = [
    ['null', 'オブジェクトでない'], ['[]', 'オブジェクトでない'],
    ['{"serverFolder":3}', '項目 serverFolder の型が違う'], ['{"setupComplete":"yes"}', '項目 setupComplete の型が違う'],
    ['{"minecraftPlayerName":null}', '項目 minecraftPlayerName の型が違う'],
  ];
  for (const [content, reason] of broken) {
    const { appConfig, file, records } = setup(t);
    fs.writeFileSync(file, content);
    assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false }, content);
    assert.deepEqual(records.map(entry => entry.reason), [reason], content);
  }
  const { appConfig, file, records } = setup(t);
  fs.writeFileSync(file, '{"serverFolder":"x","somethingElse":3}');
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: 'x', setupComplete: false, somethingElse: 3 });
  assert.deepEqual(records, []);
});

// 更新した直後の配信者の PC にある設定を、壊れていると扱わない（過去の版で書いた項目と値の型は git の履歴で確かめた）。
test('今まで書いたことのある形のファイルは、壊れていると扱わない', t => {
  const { dir, appConfig, file, records } = setup(t);
  const saved = {
    serverFolder: dir, setupComplete: true, setupRequiredByInstall: false, setupRequiredAt: '2026-10-01T09:00:00.000Z',
    minecraftPlayerName: 'Steve', minecraftLauncherPath: 'C:/XboxGames/Minecraft Launcher/Content/Minecraft.exe',
    minecraftGameFolder: path.join(dir, '.minecraft'), autoBackupOnServerStart: true,
    bridgeVersion: '1.0.50', gameModsVersion: '1.0.50', gameModsRefreshFailed: '', gameModsRefreshError: '',
    authEmail: 'op@example.com', authToken: 'a'.repeat(64), authLoginAt: '2026-10-01T09:00:00.000Z',
  };
  fs.writeFileSync(file, JSON.stringify(saved, null, 2));
  // 古いログインの項目は読まない（運営ログインはなくした）。ほかの項目はそのまま。
  const { authEmail: _email, authToken: _token, authLoginAt: _at, ...withoutLogin } = saved;
  assert.deepEqual(appConfig.readAppConfig(), withoutLogin);
  assert.deepEqual(records, []);
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.startsWith('app-config.json.')), []);
});

// アプリは getServerRoot などから何度もアプリの設定を読む。戻したあとは正しいファイルなので、もう戻さない。
test('一度戻したら、次に読むときは戻さず、記録しない', t => {
  const { dir, appConfig, file, records } = setup(t);
  appConfig.writeAppConfig({ serverFolder: dir });
  appConfig.writeAppConfig({ setupComplete: true });
  fs.writeFileSync(file, '{壊れた');
  for (let i = 0; i < 3; i++) assert.equal(appConfig.readAppConfig().serverFolder, dir);
  assert.equal(records.length, 1);
});

// 運営ログインはなくした（2026-10-24 ユーザーの決定）。配信者の PC に残っている古いログインの3項目は、読んでも返さず、次に保存したときに消える。
test('古いログインの項目: 読んでも返さず、次に保存すると消える', t => {
  const { dir, appConfig, file } = setup(t);
  fs.writeFileSync(file, JSON.stringify({ serverFolder: dir, setupComplete: true, authEmail: 'op@example.com', authToken: 'a'.repeat(64), authLoginAt: '2026-10-01T09:00:00.000Z' }));
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: dir, setupComplete: true });
  appConfig.writeAppConfig({ minecraftPlayerName: 'Steve' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { serverFolder: dir, setupComplete: true, minecraftPlayerName: 'Steve' });
});

test('記録のファイルを書けなくても、アプリの設定は読める', t => {
  const { dir, appConfig, file } = setup(t, { recordRecovery: () => { throw new Error('記録できない'); } });
  appConfig.writeAppConfig({ serverFolder: dir });
  appConfig.writeAppConfig({ setupComplete: true });
  fs.writeFileSync(file, '{壊れた');
  assert.equal(appConfig.readAppConfig().serverFolder, dir);
  assert.equal(fs.existsSync(lastGoodPath(file)), true);
});

test('本文: アプリの設定を fs で直接読み書きせず、既定値は表の1か所。main は記録をつなぐ', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app_config.cjs'), 'utf8');
  assert.doesNotMatch(source, /writeFileSync|readFileSync/);
  assert.doesNotMatch(source, /serverFolder: ""/);
  assert.match(source, /require\("\.\/app_config_fields\.json"\)/);
  assert.match(source, /createSafeJsonFile\(/);
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /createSettingsRecoveryLog\(/);
  assert.match(main, /"settings-recovery\.log"/);
  assert.match(main, /recordRecovery:/);
});

test('画面からの書き込みは決まった項目・型だけ', () => {
  const { sanitizeRendererAppConfigUpdate } = createAppConfig({ app: { getPath: () => os.tmpdir() } });
  assert.deepEqual(sanitizeRendererAppConfigUpdate({ setupComplete: true, minecraftPlayerName: 'Steve' }), { setupComplete: true, minecraftPlayerName: 'Steve' });
  assert.throws(() => sanitizeRendererAppConfigUpdate({ authToken: 'x' }), /変更できないアプリ設定です: authToken/);
  assert.throws(() => sanitizeRendererAppConfigUpdate({ setupComplete: 'yes' }), /setupComplete must be a boolean/);
  assert.throws(() => sanitizeRendererAppConfigUpdate({ serverFolder: 'x'.repeat(4097) }), /serverFolder must be a string/);
});

test('ipc: 版・手動配布の知らせ・設定の読み書きを登録する', async t => {
  const { invoke, handlers } = setup(t);
  assert.deepEqual([...handlers.keys()].sort(), ['app:config:read', 'app:config:write', 'app:version', 'updater:check', 'updater:install', 'updater:status']);
  assert.equal(await invoke('app:version'), '9.9.9');
  assert.equal((await invoke('updater:check')).state, 'manual');
  assert.deepEqual([(await invoke('updater:install')).ok, (await invoke('updater:install')).version], [false, '9.9.9']);
  assert.deepEqual(await invoke('app:config:write', { minecraftPlayerName: 'Alex' }), { ok: true });
  assert.equal((await invoke('app:config:read')).minecraftPlayerName, 'Alex');
  await assert.rejects(invoke('app:config:write', null), /data must be an object/);
});

test('保存先は止まっているときだけ変える。サーバーの起動中は理由を返す', async t => {
  const { invoke, calls } = setup(t, { serverStarting: true });
  await assert.rejects(invoke('app:config:write', { serverFolder: 'other' }), /サーバーの起動中は保存先を変更できません。/);
  assert.deepEqual(calls, ['gameProfileIdle', 'mapIdle']);
});

// ワールドの指定（world）も保存先と同じく止める。MAP の作業中は MAP の理由で止まり、サーバーの判定まで進まない（PR1 の最終レビュー M5）。
test('world の指定も止める。MAP の作業中は MAP の理由で止め、サーバーの判定まで進まない', async t => {
  const starting = setup(t, { serverStarting: true });
  await assert.rejects(starting.invoke('app:config:write', { world: 'w' }), /サーバーの起動中は保存先を変更できません。/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  const appConfig = createAppConfig({
    app: { isPackaged: false, getPath: () => dir, getVersion: () => '9.9.9' },
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => { throw new Error('MAP の保存・読込中です。'); },
    isServerStarting: () => { calls.push('serverStarting'); return true; },
    getConfigPath: () => path.join(dir, 'config.minecraft.json'),
    getSettingsBackups: () => ({ create: () => {} }),
    refreshGameModsOnStartup: async () => {},
  });
  appConfig.register({ handle: (name, fn) => handlers.set(name, fn) });
  await assert.rejects(handlers.get('app:config:write')({}, { serverFolder: 'other' }), /MAP の保存・読込中です。/);
  assert.deepEqual(calls, ['gameProfileIdle']);
});

test('自動バックアップの切り替えでは、設定があれば先にバックアップする。初期セットアップを終えたら MOD を入れ替える', async t => {
  const { dir, invoke, calls } = setup(t);
  fs.writeFileSync(path.join(dir, 'config.minecraft.json'), '{}');
  await invoke('app:config:write', { autoBackupOnServerStart: true });
  assert.ok(calls.includes('backup:automatic'));
  await invoke('app:config:write', { setupComplete: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(calls.includes('refreshMods'));
});

test('インストーラーの印は配布版でだけ受け取り、初期セットアップをやり直す', t => {
  for (const packaged of [false, true]) {
    const { dir, appConfig } = setup(t, { packaged });
    fs.writeFileSync(path.join(dir, 'require-initial-setup.flag'), '');
    appConfig.writeAppConfig({ setupComplete: true, serverFolder: dir });
    appConfig.consumeInstallerSetupReset();
    assert.equal(fs.existsSync(path.join(dir, 'require-initial-setup.flag')), !packaged);
    assert.equal(appConfig.readAppConfig().setupComplete, !packaged);
    assert.equal(appConfig.readAppConfig().serverFolder, dir, '保存先は残す');
  }
});

// 画面の型の宣言は、main と同じ表（app_config_fields.json）から型を取る（2026-10-23 設計書の 6.1）。
// 前は手で書いていて、画面が書けない setupRequiredAt を書けるとし、main が返す minecraftGameFolder などが抜けていた。
test('型の宣言は表を使い、画面が書ける項目が main と同じ。ログインの項目は無い', () => {
  const dts = fs.readFileSync(path.join(__dirname, '../../src/types/electron.d.ts'), 'utf8');
  const table = require('../app_config_fields.json');
  assert.match(dts, /typeof import\("\.\.\/\.\.\/electron\/app_config_fields\.json"\)/);
  // JSON の配列からは型の名前を取り出せないので、型の宣言にも名前を並べ、表と同じかをここで見張る。
  const keys = name => {
    const match = dts.match(new RegExp(`type ${name} = ([^;]+);`));
    assert.ok(match, `${name} が無い`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).sort();
  };
  assert.deepEqual(keys('AppConfigWritableKey'), [...table.rendererWritable].sort());
  assert.doesNotMatch(dts, /AppConfigPrivateKey|authEmail|authToken|authLoginAt/, '運営ログインの項目は型にも無い');
  assert.deepEqual([...table.retired].sort(), ['authEmail', 'authLoginAt', 'authToken']);
  const start = dts.indexOf('appConfigRead:');
  const block = dts.slice(start, dts.indexOf('Promise<{ ok: true }>', dts.indexOf('appConfigWrite:')));
  assert.ok(start >= 0 && block.length > 0);
  assert.doesNotMatch(block, /serverFolder: string;|setupRequiredAt: string;/, '項目を手で書かない');
});

test('書く: 表の型と違う値は書かず、今のアプリの設定はそのまま', t => {
  const { dir, appConfig, file } = setup(t);
  appConfig.writeAppConfig({ serverFolder: dir });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => appConfig.writeAppConfig({ minecraftGameFolder: null }), /項目 minecraftGameFolder の型が違う/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

// 書く値に古いログインの項目が入っていても書かない（最後のレビューの軽い 6）。
test('古いログインの項目: 書く値に入っていても書かない', t => {
  const { dir, appConfig, file } = setup(t);
  appConfig.writeAppConfig({ serverFolder: dir, authEmail: 'op@example.com', authToken: 't', authLoginAt: 'x' });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort(), ['serverFolder', 'setupComplete']);
});

// 新しい保存先で前の人のマイクラID を空にしたとき、「前の正しい状態の写し」（.last-good）にも残さない。設定が壊れて写しから戻ったときに出てこないように（PR #176 レビュー 軽い7）。
test('アプリの設定: forgetPrevious で書くと、前の中身を写しに残さない', t => {
  const x = setup(t);
  x.appConfig.writeAppConfig({ minecraftPlayerName: 'Old_Player' });
  x.appConfig.writeAppConfig({ serverFolder: x.dir });
  x.appConfig.writeAppConfig({ minecraftPlayerName: '' }, { forgetPrevious: true });
  assert.equal(JSON.parse(fs.readFileSync(x.file, 'utf8')).minecraftPlayerName, '');
  assert.equal(JSON.parse(fs.readFileSync(lastGoodPath(x.file), 'utf8')).minecraftPlayerName, '');
  x.appConfig.writeAppConfig({ minecraftPlayerName: 'Steve' });
  assert.equal(JSON.parse(fs.readFileSync(lastGoodPath(x.file), 'utf8')).minecraftPlayerName, '', 'ふだんは前の中身を写しに残す');
});
