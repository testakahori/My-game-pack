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
  const calls = [], state = { bridgeRunning: false, active: null }, handlers = new Map(), dialogs = [], backedUp = [], records = [];
  const deps = {
    app: { getVersion: () => '9.9.9' }, shell: { openPath: async () => '' },
    dialog: { showMessageBox: async options => { dialogs.push(options); return { response: 0 }; } },
    getConfigPath: () => configPath, ensureConfigExists: () => {}, getBridgeBatDir: () => bridge, getServerRoot: () => root,
    getGiftsMinPath: () => path.join(root, 'gifts.min.json'), getGiftsMetaPath: () => path.join(root, 'gifts.meta.json'),
    getInstalledBridgeRoot: () => root, getBridgeDir: () => bridge,
    gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }), peekActive: () => state.active },
    recordRecovery: entry => records.push(entry), now: () => new Date(2026, 9, 24, 10, 0, 0),
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    settingsBackups: { create: kind => { calls.push('backup:' + kind); backedUp.push(fs.readFileSync(configPath, 'utf8')); }, list: () => [], restore: id => calls.push('restore:' + id) },
    readTtsSettings: () => ({ enabled: false, engine: 'voicevox' }),
    requestBridgeMod: async (...args) => { calls.push('mod:' + args.join(' ')); return { ok: true }; },
    isBridgeRunning: () => state.bridgeRunning,
  };
  const settings = createBridgeSettings(deps);
  settings.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, configPath, calls, state, settings, deps, dialogs, backedUp, records, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
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
  // 「戻せます」とは書かない。バックアップを戻してももう一度直すので、2.5 などには戻らない（PR3 の最終レビュー）。
  assert.match(x.dialogs[0].detail, /直す前の設定は「設定のバックアップ」に「更新で直す前の自動保存」として残っています。$/);
  assert.doesNotMatch(x.dialogs[0].detail, /戻せます/);
  // 知らせの文のバックアップの名前は、画面の一覧（SettingsBackupsPanel.tsx の reasonLabel）の migration の名前と同じ。
  const panel = fs.readFileSync(path.resolve(__dirname, '../../src/components/SettingsBackupsPanel.tsx'), 'utf8');
  const label = panel.match(/reason === "migration" \? "([^"]+)"/)?.[1];
  assert.ok(label, 'SettingsBackupsPanel.tsx に migration の名前がある');
  assert.ok(x.dialogs[0].detail.includes(`「${label}」`), `知らせの文に画面の名前「${label}」がない`);
  x.calls.length = 0;
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.deepEqual(x.calls, [], '2回目はバックアップも取らない');
  await x.settings.notifyConfigMigration([]);
  assert.equal(x.dialogs.length, 1, '直したものがなければ知らせない');
});

// 演出・ゲーム性設定（options.gameplay）は仕掛けごとなくした（2026-10-30）。古い設定に残っていても読まずに放っておく。
// 前は gameplay の中の無いコマンドで、gameplay の欄が無い画面からの保存まで止まった（PR #174 のレビューの重要1）。
test('BRIDGE の設定の保存: 古い options.gameplay に無いコマンド・使えない名前が残っていても止めず、gameplay は消さずに書く', async t => {
  const x = setup(t);
  const current = await x.invoke('config:read');
  const gameplay = { combo: { levels: [{ count: 2, commandFile: 'missing.txt', repeat: 500 }] }, likeMilestones: [{ threshold: -1, commandFile: 'ネコ.txt' }],
    followMilestones: [{ threshold: 3, commandFile: 'missing.txt' }], commentCommands: { '!x': 'missing.txt' }, poll: { enabled: true, options: { 1: 'missing.txt' } } };
  await x.invoke('config:write', { ...current, options: { ...current.options, gameplay } });
  assert.deepEqual(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).options.gameplay, gameplay);
});

test('TikTok ID の保存: 形が正しくない ID は止め、@ や大文字は入力のまま保存する（使う所で整える。2026-10-18 設計書の 9）', async t => {
  const x = setup(t);
  const current = await x.invoke('config:read');
  await assert.rejects(x.invoke('config:write', { ...current, tiktokUsername: 'foo-bar' }), /TikTok ID「foo-bar」の形が正しくありません/);
  await x.invoke('config:write', { ...current, tiktokUsername: ' @Foo_Bar ' });
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).tiktokUsername, ' @Foo_Bar ');
});

// 起動のとき以外（初期セットアップを終えたとき・保存先を変えたとき・BRIDGE を起動する前）に呼ぶ直し。直したらその場で知らせ、失敗しても呼んだ側を止めない。
test('保存済みの設定を直す（起動のとき以外）: 直して知らせる。バックアップが取れなければ書かずにログだけ残し、例外を出さない', async t => {
  const x = setup(t);
  const saved = JSON.parse(fs.readFileSync(x.configPath, 'utf8'));
  fs.writeFileSync(x.configPath, JSON.stringify({ ...saved, mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 2.5 }] }));
  assert.deepEqual(x.settings.ensureSavedConfigMigrated(), ['ギフト割り当て（バラ）の回数 2.5 → 3']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(x.dialogs.length, 1);
  assert.deepEqual(x.settings.ensureSavedConfigMigrated(), [], '2回目は何もしない');
  const broken = setup(t);
  const before = JSON.stringify({ ...saved, mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 2.5 }] });
  fs.writeFileSync(broken.configPath, before);
  const failing = createBridgeSettings({ ...broken.deps, settingsBackups: { create: () => { throw new Error('disk full'); } } });
  assert.deepEqual(failing.ensureSavedConfigMigrated(), []);
  assert.equal(fs.readFileSync(broken.configPath, 'utf8'), before, 'バックアップが取れなければ書かない');
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
  // 読めないときは、前の正しい状態の写し（上で版を書いたときにできた）から戻す。写しが無ければ置いたまま（前は何もしなかった。設定ファイルの PR3）。
  fs.writeFileSync(x.configPath, '{broken');
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).configVersion, 2, '写しから戻して版を書く');
  fs.rmSync(x.configPath + '.last-good');
  fs.writeFileSync(x.configPath, '{broken2');
  assert.deepEqual(x.settings.migrateSavedConfigOnStartup().changes, []);
  assert.equal(fs.readFileSync(x.configPath, 'utf8'), '{broken2', '写しが無ければ置いたまま');
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

// TXT 作成の確かめ（処理のコピー PR8）。同じ名前のファイルがあるかは、コマンドの場所の txt 全部と比べる。
test('コマンド txt: bridge:commands:check は確かめの結果と、同じ名前のファイルがあるかを返す', async t => {
  const x = setup(t);
  assert.equal((await x.invoke('bridge:commands:check', { filename: 'husk', content: 'say x' })).exists, true, '標準の husk.txt がある');
  const fresh = await x.invoke('bridge:commands:check', { filename: 'my_new_cmd', content: 'say x' });
  assert.deepEqual(fresh, { filename: 'my_new_cmd.txt', commands: ['say x'], problems: [], exists: false });
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

// いいね・フォローとルーレット・コメントの選ぶ欄も分類ごとに並べるので、候補（bridge:commands:list）にも分類を届ける。分類の無いコマンドの形は変えない（2026-10-30）。
test('コマンド txt: 候補の一覧に分類（# CATEGORY:）を入れる。分類の無いものには入れない', async t => {
  const x = setup(t);
  await x.invoke('bridge:commands:write', { filename: 'helper_cmd.txt', content: '# TITLE: 助け\n# CATEGORY: お助け系\nsay hi\n' });
  await x.invoke('bridge:commands:write', { filename: 'plain_cmd.txt', content: '# TITLE: ふつう\nsay hi\n' });
  const rows = x.invoke('bridge:commands:list');
  assert.deepEqual(rows.find(row => row.name === 'helper_cmd.txt'), { name: 'helper_cmd.txt', title: '助け', category: 'お助け系' });
  assert.deepEqual(rows.find(row => row.name === 'plain_cmd.txt'), { name: 'plain_cmd.txt', title: 'ふつう' });
});

// ゲーム専用の判定は bridge/game_commands.cjs の1か所（処理のコピー PR6）。チャットの名前もアプリが付けて画面へ渡す。
test('コマンド txt: ゲーム専用の名前は大文字でも書かず、game_mode_on.txt のような共通の名前は書ける。一覧にチャットの名前を付ける', async t => {
  const x = setup(t);
  for (const filename of ['GAME_RUN_X.TXT', 'game_saikutu_dig.txt']) {
    await assert.rejects(x.invoke('bridge:commands:write', { filename, content: '' }), /ゲームパックのコマンドはパックを再登録して更新してください/, filename);
  }
  await x.invoke('bridge:commands:write', { filename: 'game_mode_on.txt', content: 'say on\n' });
  const rows = x.invoke('bridge:commands:readMeta');
  assert.equal(rows.find(row => row.name === 'game_mode_on.txt').chatKey, 'game_mode_on');
  assert.equal(rows.find(row => row.name === 'zombie.txt').chatKey, 'zombie');
  // 採掘では、ゲーム専用のコマンドのチャットの名前からゲームの頭を除く（BridgeMOD の publicKey と同じ。PR6 の最終レビュー）。
  x.deps.gameProfiles.list = () => ({ applied: true, recoveryRequired: false, active: 'saikutu' });
  assert.equal(x.invoke('bridge:commands:readMeta').find(row => row.name === 'game_saikutu_dig.txt').chatKey, 'dig');
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

// ギフト設定が壊れていたら、起動のとき・BRIDGE を起動する前・画面が読むときに写しから戻す。写しが使えなければ雛形を作らず、
// 壊れたファイルを置いたままにする（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.4・6.6。設定ファイルの PR3）。
const brokenCopies = x => fs.readdirSync(x.bridge).filter(name => name.startsWith('config.minecraft.json.broken-'));

test('ギフト設定: 壊れていたら起動のときに写しから戻す', async t => {
  const x = setup(t);
  const saved = JSON.parse(fs.readFileSync(x.configPath, 'utf8'));
  await x.invoke('config:write', { ...saved, options: { ...saved.options, giftCooldownMs: 301 } });
  await x.invoke('config:write', { ...saved, options: { ...saved.options, giftCooldownMs: 302 } });
  fs.writeFileSync(x.configPath, '{壊れた');
  x.settings.migrateSavedConfigOnStartup();
  assert.equal(JSON.parse(fs.readFileSync(x.configPath, 'utf8')).options.giftCooldownMs, 301, '写しは1つ前の保存');
  assert.deepEqual(x.records.map(r => r.action), ['restored']);
  assert.equal(brokenCopies(x).length, 1);
});

test('ギフト設定: 写しが無ければ、雛形を作らずに壊れたファイルを置いたまま', async t => {
  const x = setup(t);
  fs.writeFileSync(x.configPath, '{壊れた');
  assert.doesNotThrow(() => x.settings.migrateSavedConfigOnStartup());
  await assert.rejects(x.invoke('config:read'), '画面は今までどおり読めない');
  assert.equal(fs.readFileSync(x.configPath, 'utf8'), '{壊れた', '置いたまま');
  assert.equal(brokenCopies(x).length, 1);
  assert.deepEqual(x.records.map(r => r.action), ['kept'], '何度呼んでも記録は1回');
});

test('ギフト設定: 写しのゲームが今のゲームと合わなければ戻さない（設計書 6.6）', t => {
  for (const [game, restored] of [['saikutu', false], ['run', true]]) {
    const x = setup(t);
    x.state.active = 'run';
    const saved = JSON.parse(fs.readFileSync(x.configPath, 'utf8'));
    fs.writeFileSync(x.configPath + '.last-good', JSON.stringify({ ...saved, gameProfile: game }));
    fs.writeFileSync(x.configPath, '{壊れた');
    x.settings.migrateSavedConfigOnStartup();
    assert.equal(fs.readFileSync(x.configPath, 'utf8') === '{壊れた', !restored, game);
    assert.equal(x.records[0].action, restored ? 'restored' : 'kept', game);
  }
});

test('ギフト設定: 確かめのエラーがあっても壊れているとは扱わない', t => {
  const x = setup(t);
  fs.writeFileSync(x.configPath, JSON.stringify({ tiktokUsername: 'foo-bar', mappings: [] }));
  x.settings.migrateSavedConfigOnStartup();
  assert.deepEqual(x.records, []);
  assert.deepEqual(brokenCopies(x), []);
});

test('ギフト設定: 書くと写しを残す', async t => {
  const x = setup(t);
  const saved = JSON.parse(fs.readFileSync(x.configPath, 'utf8'));
  await x.invoke('config:write', { ...saved, options: { ...saved.options, giftCooldownMs: 311 } });
  const first = fs.readFileSync(x.configPath, 'utf8');
  await x.invoke('config:write', { ...saved, options: { ...saved.options, giftCooldownMs: 312 } });
  assert.equal(fs.readFileSync(x.configPath + '.last-good', 'utf8'), first);
});

test('本文: ギフト設定を書く所は writeWithLastGood、新しいファイルを作る所は atomicWrite・writeFileDurable', () => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  for (const name of ['bridge_settings.cjs', 'command_migration.cjs']) {
    const source = read(name);
    assert.ok(!source.includes('atomicWrite(configPath') && !source.includes('atomicWrite(getConfigPath()'), name);
    assert.match(source, /writeWithLastGood\(/, name);
  }
  assert.ok(!read('paths.cjs').includes('fs.writeFileSync(configPath'));
  assert.ok(!read('bridge_sync.cjs').includes('fs.writeFileSync(dstConfigPath'));
  const main = read('main.cjs');
  const start = main.indexOf('createBridgeSettings({');
  assert.match(main.slice(start, main.indexOf('});', start)), /recordRecovery:/);
});
