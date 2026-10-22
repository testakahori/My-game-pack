// BRIDGE の設定・ギフトの割り当て・テンプレート・設定のバックアップ・配信前チェック・コマンド txt の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridgeSettings } = require('../bridge_settings.cjs');
const { validateBridgeConfig } = require('../../bridge/config_schema.js');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), commands = path.join(bridge, 'commands', 'minecraft');
  fs.mkdirSync(commands, { recursive: true });
  const source = path.resolve(__dirname, '../../bridge/commands/minecraft');
  for (const name of fs.readdirSync(source).filter(name => name.endsWith('.txt'))) fs.copyFileSync(path.join(source, name), path.join(commands, name));
  fs.writeFileSync(path.join(commands, 'game_saikutu_dig.txt'), 'say dig\n');
  const configPath = path.join(bridge, 'config.minecraft.json');
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../bridge/config.minecraft.json'), 'utf8'));
  fs.writeFileSync(configPath, JSON.stringify({ ...config, tiktokUsername: 'akahoridouma', mappings: [] }));
  const calls = [], state = { bridgeRunning: false }, handlers = new Map(), dialogs = [], backedUp = [];
  const settings = createBridgeSettings({
    app: { getVersion: () => '9.9.9' }, shell: { openPath: async () => '' },
    dialog: { showMessageBox: async options => { dialogs.push(options); return { response: 0 }; } },
    getConfigPath: () => configPath, ensureConfigExists: () => {}, getBridgeBatDir: () => bridge, getServerRoot: () => root,
    getGiftsMinPath: () => path.join(root, 'gifts.min.json'), getGiftsMetaPath: () => path.join(root, 'gifts.meta.json'),
    getInstalledBridgeRoot: () => root, getBridgeDir: () => bridge,
    gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    settingsBackups: { create: kind => { calls.push('backup:' + kind); backedUp.push(fs.readFileSync(configPath, 'utf8')); }, list: () => [], restore: id => calls.push('restore:' + id) },
    readTtsSettings: () => ({ enabled: false, engine: 'voicevox' }),
    requestBridgeMod: async (...args) => { calls.push('mod:' + args.join(' ')); return { ok: true }; },
    isBridgeRunning: () => state.bridgeRunning,
  });
  settings.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, configPath, calls, state, settings, dialogs, backedUp, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

// 保存済みの設定は、アプリの更新のときに1回だけ直す（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7）。
test('保存済みの設定を更新のときに1回だけ直す: 直す前にバックアップを取って書き、知らせは1回。2回目は何もしない', async t => {
  const x = setup(t);
  const saved = JSON.parse(fs.readFileSync(x.configPath, 'utf8'));
  fs.writeFileSync(x.configPath, JSON.stringify({ ...saved,
    mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 2.5 }, { giftId: '2', name: 'ハート', commandFile: 'zombie.txt', repeat: '3' }, { giftId: '3', name: 'スター', commandFile: 'zombie.txt', repeat: 500 }],
    likeEvents: [{ threshold: 0, commandFile: 'zombie.txt', repeat: 1 }] }));
  const { changes } = x.settings.migrateSavedConfigOnStartup();
  assert.equal(changes.length, 4, changes.join('\n'));
  assert.deepEqual(x.calls, ['backup:migration']);
  assert.match(x.backedUp[0], /"repeat":2\.5/, 'バックアップは直す前の設定');
  const written = JSON.parse(fs.readFileSync(x.configPath, 'utf8'));
  assert.deepEqual([...written.mappings.map(m => m.repeat), written.likeEvents[0].threshold, written.configVersion], [3, 3, 100, 1, 2]);
  assert.deepEqual(validateBridgeConfig(written).errors, []);
  await x.settings.notifyConfigMigration(changes);
  assert.equal(x.dialogs.length, 1);
  assert.equal(x.dialogs[0].title, '設定を直しました');
  assert.match(x.dialogs[0].detail, /ギフト割り当て（バラ）の回数 2\.5 → 3/);
  assert.match(x.dialogs[0].detail, /直す前の設定は「設定のバックアップ」から戻せます。$/);
  x.calls.length = 0;
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.deepEqual(x.calls, [], '2回目はバックアップも取らない');
  await x.settings.notifyConfigMigration([]);
  assert.equal(x.dialogs.length, 1, '直したものがなければ知らせない');
});

test('TikTok ID の保存: 形が正しくない ID は止め、@ や大文字は入力のまま保存する（使う所で整える。2026-10-18 設計書の 9）', async t => {
  const x = setup(t);
  const current = await x.invoke('config:read');
  await assert.rejects(x.invoke('config:write', { ...current, tiktokUsername: 'foo-bar' }), /TikTok ID「foo-bar」の形が正しくありません/);
  await x.invoke('config:write', { ...current, tiktokUsername: ' @Foo_Bar ' });
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).tiktokUsername, ' @Foo_Bar ');
});

test('保存済みの設定を直す: 知らせは10件まで（ほかは件数）', async t => {
  const x = setup(t);
  await x.settings.notifyConfigMigration(Array.from({ length: 12 }, (_, i) => `直したもの${i + 1}`));
  assert.match(x.dialogs[0].detail, /直したもの10\nほか 2 件/);
  assert.doesNotMatch(x.dialogs[0].detail, /直したもの11/);
});

test('保存済みの設定を直す: 直すものがなければバックアップなしで版だけ書く。設定が無い・読めないときは何もしない。保存はいつも版を書く', async t => {
  const x = setup(t);
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.deepEqual(x.calls, []);
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).configVersion, 2);
  fs.writeFileSync(x.configPath, '{broken');
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.equal(fs.readFileSync(x.configPath, 'utf8'), '{broken');
  fs.rmSync(x.configPath);
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.equal(fs.existsSync(x.configPath), false, '設定のファイルを作らない');
  const y = setup(t);
  const { configVersion, ...withoutVersion } = JSON.parse(fs.readFileSync(y.configPath, 'utf8'));
  await y.invoke('config:write', withoutVersion);
  assert.equal(JSON.parse(fs.readFileSync(y.configPath, 'utf8')).configVersion, 2);
});

test('BRIDGE の設定の保存: 先にゲームの切り替え中でないかを確かめ、中身が変わったときだけ自動バックアップを作る', async t => {
  const x = setup(t);
  await x.invoke('config:write', await x.invoke('config:read'));
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).options.commandsDir, path.join(x.bridge, 'commands', 'minecraft'));
  x.calls.length = 0;
  await x.invoke('config:write', await x.invoke('config:read'));
  assert.deepEqual(x.calls, ['gameProfileIdle'], '同じ中身ではバックアップを作らない');
  await x.invoke('config:write', { ...(await x.invoke('config:read')), tiktokUsername: 'another_id' });
  assert.deepEqual(x.calls, ['gameProfileIdle', 'gameProfileIdle', 'backup:automatic']);
  x.calls.length = 0;
  x.invoke('settings:backups:restore', 'b1');
  assert.deepEqual(x.calls, ['gameProfileIdle', 'restore:b1']);
});

test('コマンド txt: 選んでいるゲームのコマンドだけを出し、ゲームパックのものは書かず、書く前にバックアップを作る', async t => {
  const x = setup(t);
  const names = x.invoke('bridge:commands:list').map(row => row.name);
  assert.ok(names.includes('zombie.txt'));
  assert.ok(!names.includes('game_saikutu_dig.txt'), 'サバイバルではゲームパックのコマンドを出さない');
  await assert.rejects(x.invoke('bridge:commands:write', { filename: 'game_saikutu_dig.txt', content: '' }), /ゲームパックのコマンドはパックを再登録して更新してください/);
  x.calls.length = 0;
  await x.invoke('bridge:commands:write', { filename: 'my_cmd.txt', content: '# TITLE: 自作\nsay hi\n' });
  assert.deepEqual(x.calls, ['gameProfileIdle', 'backup:automatic']);
  assert.equal(x.invoke('bridge:commands:readMeta').find(row => row.name === 'my_cmd.txt').title, '自作');
});

// 題名はルーレットの項目名・ギフト画像にそのまま使われる。空の # TITLE: で次の行を拾うと、配信画面に「# CATEGORY: 妨害」と出ていた（2026-10-18）。
test('コマンドの一覧: 空の # TITLE: は次の行を拾わずファイル名に戻り、BOM 付き・小文字のキーの題名と説明も読む', t => {
  const x = setup(t);
  const commands = path.join(x.bridge, 'commands', 'minecraft');
  fs.writeFileSync(path.join(commands, 'empty_title.txt'), '# TITLE:\n# CATEGORY: 妨害\nsay hi\n');
  fs.writeFileSync(path.join(commands, 'bom_title.txt'), '\ufeff# title: ねこ\n//\n// 説明\nsummon cat\n');
  const rows = x.invoke('bridge:commands:readMeta');
  const row = name => rows.find(item => item.name === name);
  assert.deepEqual([row('empty_title.txt').title, row('empty_title.txt').category], ['empty_title.txt', '妨害']);
  assert.deepEqual([row('bom_title.txt').title, row('bom_title.txt').description], ['ねこ', '説明']);
});

test('配信前チェック: BRIDGE の稼働・BridgeMOD の応答・読み上げは main から受け取った関数で見る。同時に押しても1回だけ調べる', async t => {
  const x = setup(t);
  const first = x.invoke('preflight:run'), second = x.invoke('preflight:run');
  assert.equal(first, second);
  const report = await first;
  const check = (result, id) => result.checks.find(row => row.id === id);
  assert.equal(check(report, 'bridge').detail, 'Bridgeを起動し、TikTok LIVE接続後に再チェックしてください。');
  assert.equal(check(report, 'mod').status, 'ok');
  assert.equal(check(report, 'tts').status, 'skip');
  assert.deepEqual(x.calls.filter(call => call.startsWith('mod:')), ['mod:GET /bridge/status']);
  x.state.bridgeRunning = true;
  fs.writeFileSync(path.join(x.bridge, 'runtime-status.json'), JSON.stringify({ tiktok: { state: 'connected', username: 'akahoridouma' } }));
  assert.equal(check(await x.invoke('preflight:run'), 'bridge').status, 'ok');
});
