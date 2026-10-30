const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameProfiles, jarModIds } = require('../game_profiles.cjs');
const { retireLegacyEnvironment, replaceCommonMod } = require('../bridge_mod_migration.cjs');
const { fakeModJar: jar } = require('./fake-mod-jar.cjs');
function fixture(t, extras = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-games-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = path.join(root, 'サーバー'), client = path.join(root, 'Minecraft'), storage = path.join(root, 'profiles');
  for (const dir of [server, client]) { fs.mkdirSync(path.join(dir, 'mods'), { recursive: true }); fs.writeFileSync(path.join(dir, 'mods', 'doumacmd-old.jar'), 'original'); fs.writeFileSync(path.join(dir, 'mods', 'other.jar'), 'other mod'); }
  const config = path.join(server, 'bridge', 'config.minecraft.json'); fs.mkdirSync(path.dirname(config));
  fs.writeFileSync(config, JSON.stringify({ tiktokUsername: 'viewer', rcon: { password: 'keep-local-secret' }, options: { giftCooldownMs: 300 }, mappings: [{ giftId: '1', commandFile: 'zombie.txt', repeat: 1 }], shareEvent: { enabled: true, commandFile: 'cod.txt' } }));
  fs.mkdirSync(path.join(path.dirname(config), 'commands/minecraft'), { recursive: true });
  for (const name of ['zombie.txt', 'cod.txt']) fs.writeFileSync(path.join(path.dirname(config), 'commands/minecraft', name), 'say test');
  // 埋め立てに切り替えると初期マップを写すので、サーバーの map_backup に小さな見本を置く（アプリでは配った物から用意する。埋め立て PR3）。
  fs.mkdirSync(path.join(server, 'map_backup/umetate/umetate_lab_map'), { recursive: true }); fs.writeFileSync(path.join(server, 'map_backup/umetate/umetate_lab_map/level.dat'), 'lab');
  const bridge = path.join(root, 'bridgemod-1.3.4.jar'); fs.writeFileSync(bridge, jar('bridgemod'));
  const display = path.join(root, 'displaymod-1.0.0.jar'); fs.writeFileSync(display, jar('displaymod'));
  const api = createGameProfiles({ storage: () => storage, serverRoot: () => server, clientRoot: () => client, configPath: () => config, bridgeJar: () => bridge, displayJar: () => display, ensureStopped: async () => {}, ...extras });
  function pack(id) {
    const dir = path.join(root, id); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, id + '.jar'), jar(id + 'mod'));
    fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify({ format: 1, id, modId: id + 'mod', serverJar: id + '.jar', clientJar: id + '.jar', commands: [{ key: 'fill', title: '専用イベント', command: `${id} fill {Count} {ListenerName}` }] }));
    return dir;
  }
  return { root, server, client, config, storage, bridge, api, pack };
}

test('ゲーム未導入・不正jarでは両側のMODと設定を一切切り替えない', async t => {
  const x = fixture(t), before = fs.readFileSync(x.config, 'utf8');
  assert.equal(x.api.list().games.find(g => g.id === 'umetate').installed, false);
  await assert.rejects(x.api.activate('umetate'), /未導入/);
  const pack = x.pack('umetate'); fs.writeFileSync(path.join(pack, 'umetate.jar'), 'not a jar');
  await assert.rejects(x.api.install(pack), /jar/);
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')), ['doumacmd-old.jar', 'other.jar']);
  assert.equal(fs.readFileSync(x.config, 'utf8'), before);
});

test('ゲーム選択は両側をBridgeMODと選択ゲームだけにし、旧MODを退避し、設定をゲーム別に戻す', async t => {
  const x = fixture(t); await x.api.install(x.pack('umetate')); await x.api.install(x.pack('run'));
  const result = await x.api.activate('umetate');
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'umetate.jar']);
  for (const backup of result.backupFolders) assert.equal(fs.readFileSync(path.join(backup, 'doumacmd-old.jar'), 'utf8'), 'original');
  const command = path.join(x.server, 'bridge/commands/minecraft/game_umetate_fill.txt');
  assert.match(fs.readFileSync(command, 'utf8'), /DISPLAY_OWNER: game/);
  let config = JSON.parse(fs.readFileSync(x.config)); assert.deepEqual(config.mappings, []); assert.equal(config.shareEvent, undefined); assert.equal(config.rcon.password, 'keep-local-secret');
  config.mappings = [{ giftId: 'rose', commandFile: 'game_umetate_fill.txt', repeat: 3 }]; fs.writeFileSync(x.config, JSON.stringify(config));
  await x.api.activate('run'); assert.equal(fs.existsSync(command), false);
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'run.jar']);
  await x.api.activate('umetate'); assert.equal(JSON.parse(fs.readFileSync(x.config)).mappings[0].repeat, 3);
  await x.api.activate('common'); config = JSON.parse(fs.readFileSync(x.config)); assert.equal(config.mappings[0].commandFile, 'zombie.txt'); assert.equal(config.shareEvent.enabled, true);
});

// ゲーム別に保存した設定（profiles.json）も「古い設定を読み込む所」。戻すときに保存済みの設定と同じ直しを通す（PR3 の最終レビュー）。
test('ゲームの切り替え: 更新前に保存したゲーム別の設定（回数 2.5）は、戻すときに直して書く', async t => {
  const x = fixture(t); await x.api.install(x.pack('umetate'));
  await x.api.activate('umetate');
  const stateFile = path.join(x.storage, 'profiles.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  state.profiles.common.mappings = [{ giftId: '1', name: 'rose', commandFile: 'zombie.txt', repeat: 2.5 }];
  fs.writeFileSync(stateFile, JSON.stringify(state));
  await x.api.activate('common');
  const config = JSON.parse(fs.readFileSync(x.config, 'utf8'));
  assert.deepEqual([config.mappings[0].repeat, config.configVersion], [3, 2]);
});

// 演出・ゲーム性設定（options.gameplay）は仕掛けごとなくした（2026-10-30）。options はゲーム別に写さず、戻すときにも書かない。
// 前の版が profiles.json に写した options は外して戻す（外さないと、送り方・ポートなどの options を丸ごと上書きする）。
test('ゲームの切り替え: options はゲーム別に写さず、古いゲーム別の設定に残った options（gameplay）は確かめにも今の options にも使わない', async t => {
  const x = fixture(t); await x.api.install(x.pack('umetate'));
  await x.api.activate('umetate');
  const stateFile = path.join(x.storage, 'profiles.json');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(Object.hasOwn(state.profiles.common, 'options'), false, 'ゲーム別の設定に options を写さない');
  state.profiles.common.options = { gameplay: { commentCommands: { '!x': 'missing.txt' }, combo: { levels: [{ count: 2, commandFile: 'missing.txt' }] } } };
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const before = JSON.parse(fs.readFileSync(x.config, 'utf8')).options;
  await x.api.activate('common');
  assert.deepEqual(JSON.parse(fs.readFileSync(x.config, 'utf8')).options, before, '無いコマンドで止めず、options もそのまま');
});

test('片側の入替失敗で両MODフォルダ・選択中ゲーム・設定をロールバックする', async t => {
  const x = fixture(t, { beforeStep: i => { if (i === 1) throw new Error('client locked'); } });
  await x.api.install(x.pack('run')); const before = fs.readFileSync(x.config, 'utf8');
  await assert.rejects(x.api.activate('run'), /元へ戻しました.*client locked/);
  for (const dir of [x.server, x.client]) assert.equal(fs.readFileSync(path.join(dir, 'mods/doumacmd-old.jar'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(x.config, 'utf8'), before); assert.equal(x.api.list().active, 'common'); assert.equal(x.api.list().recoveryRequired, false);
});

test('ゲーム更新で保存済みのコマンドが欠ける場合は切替を止める', async t => {
  const x = fixture(t), pack = x.pack('run'); await x.api.install(pack); await x.api.activate('run');
  const config = JSON.parse(fs.readFileSync(x.config)); config.mappings = [{ giftId: '1', commandFile: 'game_run_fill.txt', repeat: 4 }]; fs.writeFileSync(x.config, JSON.stringify(config));
  const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'game.json'))); manifest.commands = [{ key: 'new_event', title: '新イベント', command: 'run next' }]; fs.writeFileSync(path.join(pack, 'game.json'), JSON.stringify(manifest));
  await x.api.install(pack); await assert.rejects(x.api.activate('run'), /保存済み.*コマンドがありません/);
  assert.equal(JSON.parse(fs.readFileSync(x.config)).mappings[0].repeat, 4);
  assert.equal(fs.existsSync(path.join(x.server, 'bridge/commands/minecraft/game_run_fill.txt')), true);
});

// 参照の数え方は command_files.cjs の commandFileRefs の1か所（処理のコピー PR5）。BRIDGE が動かすものだけを確かめる。
// 演出・ゲーム性設定（options.gameplay）は仕掛けごとなくしたので、古い設定に残っていても数えない（2026-10-30。PR #174 のレビューの重要1）。
test('ゲームの切り替えも同じ参照の数え方: 無いコマンドの割り当てがあれば止め、無効の割り当てと古い gameplay は見ない', async t => {
  const x = fixture(t), pack = x.pack('run'); await x.api.install(pack); await x.api.activate('run');
  const config = JSON.parse(fs.readFileSync(x.config));
  config.mappings = [{ giftId: '1', commandFile: 'missing.txt', repeat: 1, enabled: false }];
  config.options = { ...config.options, gameplay: { commentCommands: { '!x': 'missing.txt' }, likeMilestones: [{ threshold: 10, commandFile: 'missing.txt' }] } };
  fs.writeFileSync(x.config, JSON.stringify(config));
  await x.api.activate('run');
  const next = JSON.parse(fs.readFileSync(x.config));
  next.mappings = [{ giftId: '1', commandFile: 'missing', repeat: 1 }];
  fs.writeFileSync(x.config, JSON.stringify(next));
  await assert.rejects(x.api.activate('run'), /保存済みの設定で使うコマンドがありません: missing。/);
});

test('個数引数がないゲームコマンドは回数分実行する形式で登録する', async t => {
  const x = fixture(t), pack = x.pack('run');
  const manifest = JSON.parse(fs.readFileSync(path.join(pack, 'game.json'))); manifest.commands[0].command = 'run next'; fs.writeFileSync(path.join(pack, 'game.json'), JSON.stringify(manifest));
  await x.api.install(pack); await x.api.activate('run');
  const text = fs.readFileSync(path.join(x.server, 'bridge/commands/minecraft/game_run_fill.txt'), 'utf8');
  assert.doesNotMatch(text, /COUNT_MODE: aggregate/); assert.match(text, /DISPLAY_OWNER: game/);
});

test('途中終了の記録がある場合は切替を止め、再起動後に元の両フォルダと設定を復旧できる', async t => {
  const x = fixture(t), id = require('node:crypto').randomUUID();
  const configBefore = fs.readFileSync(x.config, 'utf8'), roots = [x.server, x.client];
  const stateBefore = { format: 1, active: 'common', packages: {}, profiles: {} };
  fs.mkdirSync(x.storage);
  fs.writeFileSync(path.join(x.storage, 'pending-switch.json'), JSON.stringify({ id, roots, hadMods: [true, true], configPath: x.config, configBefore, stateBefore, commandBefore: {} }));
  const slot = path.join(x.server, '.mygamepack-mod-switch', id); fs.mkdirSync(slot, { recursive: true });
  fs.renameSync(path.join(x.server, 'mods'), path.join(slot, 'previous')); fs.mkdirSync(path.join(x.server, 'mods')); fs.copyFileSync(x.bridge, path.join(x.server, 'mods/bridgemod-1.3.4.jar'));
  fs.writeFileSync(x.config, JSON.stringify({ mappings: [] }));
  assert.equal(x.api.list().recoveryRequired, true); await assert.rejects(x.api.activate('common'), /復旧/);
  await x.api.recover();
  for (const dir of roots) assert.equal(fs.readFileSync(path.join(dir, 'mods/doumacmd-old.jar'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(x.config, 'utf8'), configBefore); assert.equal(x.api.list().recoveryRequired, false);
});

test('登録後にゲームjarが改変されたら再登録まで切替を拒否する', async t => {
  const x = fixture(t); await x.api.install(x.pack('run'));
  const store = JSON.parse(fs.readFileSync(path.join(x.storage, 'profiles.json')));
  const jarFile = path.join(x.storage, 'packages', store.packages.run, 'run.jar');
  fs.appendFileSync(jarFile, 'changed');
  await assert.rejects(x.api.activate('run'), /変更されています/);
  assert.equal(fs.existsSync(path.join(x.client, 'mods/doumacmd-old.jar')), true);
});

test('稼働中はゲーム登録済みでも切替を開始しない', async t => {
  const x = fixture(t, { ensureStopped: async () => { throw new Error('running'); } });
  await x.api.install(x.pack('run')); await assert.rejects(x.api.activate('run'), /running/);
  assert.equal(fs.existsSync(path.join(x.server, '.mygamepack-mod-switch')), false);
});

test('ゲームパックはパス逸脱・ID不一致・重複コマンドを拒否する', async t => {
  const x = fixture(t), p = x.pack('run'), file = path.join(p, 'game.json'), original = JSON.parse(fs.readFileSync(file));
  for (const data of [{ ...original, serverJar: '../run.jar' }, { ...original, modId: 'wrongmod' }, { ...original, commands: [...original.commands, ...original.commands] }]) {
    fs.writeFileSync(file, JSON.stringify(data)); await assert.rejects(x.api.install(p));
  }
  assert.deepEqual(jarModIds(jar('bridgemod')), ['bridgemod']);
});

test('古い暗視データパックはコピーMAPのロード後も次回起動で退避し、ワールドは保持する', t => {
  const x = fixture(t), world = path.join(x.server, 'haihu_world/world');
  const pack = path.join(world, 'datapacks/NightVision_Pack'); fs.mkdirSync(path.join(pack, 'data/nv_pack/functions'), { recursive: true });
  fs.writeFileSync(path.join(pack, 'data/nv_pack/functions/tick.mcfunction'), 'effect give @a minecraft:night_vision 60 0 true');
  fs.writeFileSync(path.join(world, 'level.dat'), 'world unchanged'); fs.writeFileSync(path.join(x.server, 'server.properties'), 'level-name=haihu_world/world\n');
  assert.throws(() => retireLegacyEnvironment(x.server), /BridgeMOD/);
  assert.equal(fs.existsSync(pack), true);
  fs.copyFileSync(x.bridge, path.join(x.server, 'mods/bridgemod-1.3.4.jar'));
  retireLegacyEnvironment(x.server); assert.equal(fs.existsSync(pack), false); assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'world unchanged');
  assert.equal(fs.readdirSync(path.join(world, '.mygamepack-retired-packs')).length, 1);
});

test('BridgeMOD同期はDOUMAMODを削除せず退避し、他のMODを保持する', t => {
  const x = fixture(t); replaceCommonMod(x.bridge, x.server);
  assert.deepEqual(fs.readdirSync(path.join(x.server, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'other.jar']);
  assert.equal(fs.readdirSync(path.join(x.server, '.mygamepack-retired-mods')).length, 1);
});

// 環境構築・Forge のインストール・版が上がったあとの起動のたびに、今使っている jar の写しが退避先にたまっていた（2026-10-30 ユーザーの決定：最新の jar は退避しない）。
test('BridgeMOD同期: 同じ名前・同じ中身の jar がそろっていれば退避しない（押すたびに写しをためない）', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods');
  fs.rmSync(path.join(mods, 'doumacmd-old.jar'));
  fs.copyFileSync(x.bridge, path.join(mods, 'bridgemod-1.3.4.jar'));
  replaceCommonMod(x.bridge, x.server);
  replaceCommonMod(x.bridge, x.server);
  assert.equal(fs.existsSync(path.join(x.server, '.mygamepack-retired-mods')), false);
  assert.deepEqual(fs.readdirSync(mods).sort(), ['bridgemod-1.3.4.jar', 'other.jar']);
  assert.deepEqual(fs.readFileSync(path.join(mods, 'bridgemod-1.3.4.jar')), fs.readFileSync(x.bridge));
});

test('BridgeMOD同期: 最新の jar がそろっていても、古い版とサーバー直下の残りは退避する', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods');
  fs.copyFileSync(x.bridge, path.join(mods, 'bridgemod-1.3.4.jar'));
  fs.writeFileSync(path.join(mods, 'bridgemod-1.3.3.jar'), jar('bridgemod'));
  fs.writeFileSync(path.join(x.server, 'bridgemod-1.0.0.jar'), 'root leftover');
  replaceCommonMod(x.bridge, x.server);
  assert.deepEqual(fs.readdirSync(mods).sort(), ['bridgemod-1.3.4.jar', 'other.jar']);
  const retired = path.join(x.server, '.mygamepack-retired-mods'), [slot] = fs.readdirSync(retired);
  assert.deepEqual(fs.readdirSync(path.join(retired, slot, 'mods')).sort(), ['bridgemod-1.3.3.jar', 'doumacmd-old.jar']);
  assert.deepEqual(fs.readdirSync(path.join(retired, slot, 'root')), ['bridgemod-1.0.0.jar']);
});

// 残すと同じ MOD が2つ並び、Forge が起動しない。
test('BridgeMOD同期: 名前の違う同じ MOD は、中身が同じでも退避する', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods');
  fs.copyFileSync(x.bridge, path.join(mods, 'bridgemod-1.3.4.jar'));
  fs.copyFileSync(x.bridge, path.join(mods, 'handmade-bridge.jar'));
  replaceCommonMod(x.bridge, x.server);
  assert.deepEqual(fs.readdirSync(mods).sort(), ['bridgemod-1.3.4.jar', 'other.jar']);
  const retired = path.join(x.server, '.mygamepack-retired-mods'), [slot] = fs.readdirSync(retired);
  assert.deepEqual(fs.readdirSync(path.join(retired, slot, 'mods')).sort(), ['doumacmd-old.jar', 'handmade-bridge.jar']);
});

test('BridgeMOD同期: 同じ名前でも中身が違えば、退避して置き直す', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods');
  fs.writeFileSync(path.join(mods, 'bridgemod-1.3.4.jar'), 'broken');
  replaceCommonMod(x.bridge, x.server);
  assert.deepEqual(fs.readFileSync(path.join(mods, 'bridgemod-1.3.4.jar')), fs.readFileSync(x.bridge));
  const retired = path.join(x.server, '.mygamepack-retired-mods'), [slot] = fs.readdirSync(retired);
  assert.equal(fs.readFileSync(path.join(retired, slot, 'mods', 'bridgemod-1.3.4.jar'), 'utf8'), 'broken');
});

// Windows では大文字小文字だけ違う名前も同じファイルとして読める。その jar を退避したあと、mods から最新の jar が消えたままにしない（PR #166 レビュー 重要1）。
test('BridgeMOD同期: 大文字小文字だけ違う名前の jar があっても、mods に最新の jar が残る', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods');
  fs.rmSync(path.join(mods, 'doumacmd-old.jar'));
  fs.copyFileSync(x.bridge, path.join(mods, 'BridgeMod-1.3.4.jar'));
  replaceCommonMod(x.bridge, x.server);
  assert.deepEqual(fs.readdirSync(mods).sort(), ['bridgemod-1.3.4.jar', 'other.jar']);
  assert.deepEqual(fs.readFileSync(path.join(mods, 'bridgemod-1.3.4.jar')), fs.readFileSync(x.bridge));
});

// 前は、書く前に止まったとき（ウイルス対策が jar をつかんでいて退避できない、など）にも mods の同じ名前の jar を消していた。
test('BridgeMOD同期: 退避の途中で止まったら、退避したものを元へ戻し、元からある同じ名前の jar は消さない', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods'), rename = fs.renameSync;
  fs.writeFileSync(path.join(mods, 'bridgemod-1.3.4.jar'), 'broken');
  fs.writeFileSync(path.join(x.server, 'bridgemod-1.0.0.jar'), 'root leftover');
  let calls = 0;
  t.mock.method(fs, 'renameSync', (from, to) => { calls += 1; if (calls === 2) throw new Error('locked'); return rename(from, to); });
  assert.throws(() => replaceCommonMod(x.bridge, x.server), /locked/);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(path.join(x.server, 'bridgemod-1.0.0.jar'), 'utf8'), 'root leftover', '1つ目に退避した直下の jar は直下へ戻る');
  assert.equal(fs.readFileSync(path.join(mods, 'bridgemod-1.3.4.jar'), 'utf8'), 'broken');
  assert.deepEqual(fs.readdirSync(mods).sort(), ['bridgemod-1.3.4.jar', 'doumacmd-old.jar', 'other.jar']);
  assert.equal(fs.existsSync(path.join(x.server, '.mygamepack-retired-mods')), false, '空の退避フォルダーを残さない（レビュー 軽い2）');
});

test('BridgeMOD同期: 書き込みが途中で失敗したら、書きかけを消して元の jar に戻す（元が無ければ何も残さない）', t => {
  const write = fs.writeFileSync;
  const failWrite = () => t.mock.method(fs, 'writeFileSync', file => { write(file, 'partial'); throw new Error('disk full'); });
  const x = fixture(t), mods = path.join(x.server, 'mods');
  fs.writeFileSync(path.join(mods, 'bridgemod-1.3.4.jar'), 'broken');
  failWrite();
  assert.throws(() => replaceCommonMod(x.bridge, x.server), /disk full/);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(path.join(mods, 'bridgemod-1.3.4.jar'), 'utf8'), 'broken');
  assert.deepEqual(fs.readdirSync(mods).sort(), ['bridgemod-1.3.4.jar', 'doumacmd-old.jar', 'other.jar']);
  assert.equal(fs.existsSync(path.join(x.server, '.mygamepack-retired-mods')), false);
  const y = fixture(t), yMods = path.join(y.server, 'mods');
  failWrite();
  assert.throws(() => replaceCommonMod(y.bridge, y.server), /disk full/);
  t.mock.restoreAll();
  assert.deepEqual(fs.readdirSync(yMods).sort(), ['doumacmd-old.jar', 'other.jar'], '書きかけを残さない');
});

// 元へ戻す処理のどこかが失敗しても、残りは戻し、最初のエラーを伝える（レビュー 軽い3）。
test('BridgeMOD同期: 書きかけを消せなくても、退避したものは元へ戻し、最初のエラーを投げる', t => {
  const x = fixture(t), mods = path.join(x.server, 'mods'), write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', file => { write(file, 'partial'); throw new Error('disk full'); });
  t.mock.method(fs, 'unlinkSync', () => { throw new Error('locked'); });
  assert.throws(() => replaceCommonMod(x.bridge, x.server), /disk full/);
  t.mock.restoreAll();
  assert.ok(fs.existsSync(path.join(mods, 'doumacmd-old.jar')), '退避した jar は mods へ戻る');
});

module.exports = { jar };

test('表示MODを独立jarで両側に配置し、共通表示あり／なしをゲームコマンドごとに保存する', async t => {
  let display;
  const x = fixture(t, { displayJar: () => display });
  display = path.join(x.root, 'displaymod-1.0.0.jar'); fs.writeFileSync(display, jar('displaymod'));
  const folder = x.pack('umetate'), file = path.join(folder, 'game.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.commands.push({ key: 'instant', title: '即時イベント', command: 'umetate instant {Count}', commonDisplay: true });
  fs.writeFileSync(file, JSON.stringify(manifest)); await x.api.install(folder);
  const status = await x.api.activate('umetate'); assert.equal(status.displayBundled, true); assert.equal(status.applied, true);
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'umetate.jar']);
  const commands = path.join(x.server, 'bridge/commands/minecraft');
  assert.match(fs.readFileSync(path.join(commands, 'game_umetate_fill.txt'), 'utf8'), /DISPLAY_OWNER: game/);
  assert.match(fs.readFileSync(path.join(commands, 'game_umetate_instant.txt'), 'utf8'), /DISPLAY_OWNER: bridge/);
  manifest.commands[0].commonDisplay = 'false'; fs.writeFileSync(file, JSON.stringify(manifest));
  await assert.rejects(x.api.install(folder), /commonDisplay/);
});

test('標準の表示MODがなければ切替を止め、不正な表示jarも変更前に拒否する', async t => {
  let display;
  const x = fixture(t, { displayJar: () => display });
  await assert.rejects(x.api.activate('common'), /DisplayMOD/); assert.equal(x.api.list().displayBundled, false);
  const before = fs.readFileSync(x.config, 'utf8');
  display = path.join(x.root, 'displaymod-1.0.0.jar'); fs.writeFileSync(display, jar('wrongmod'));
  await assert.rejects(x.api.activate('common'), /DisplayMOD/);
  assert.equal(fs.readFileSync(x.config, 'utf8'), before);
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')), ['doumacmd-old.jar', 'other.jar']);
});

test('表示MOD更新はBridgeMOD・ゲームMODを保持し、以前の表示jarを退避する', t => {
  const x = fixture(t); replaceCommonMod(x.bridge, x.server);
  fs.writeFileSync(path.join(x.server, 'mods/displaymod-0.9.0.jar'), jar('displaymod'));
  const display = path.join(x.root, 'displaymod-1.0.0.jar'); fs.writeFileSync(display, jar('displaymod'));
  replaceCommonMod(display, x.server, 'displaymod');
  assert.deepEqual(fs.readdirSync(path.join(x.server, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'other.jar']);
});


// サバイバルは中に残し（まだゲームを選んでいない状態）、配信ホームの選択肢には出さない（selectable: false。2026-10-29 ユーザーの決定）。
test('ゲームの一覧（サバイバルは選択肢に出さない）とサバイバルの標準2MODを両方へ適用する', async t => {
  const x = fixture(t);
  assert.deepEqual(x.api.list().games.map(g => [g.name, g.selectable !== false]), [['サバイバル', false], ['採掘', true], ['埋め立て', true], ['RUN', true]]);
  await x.api.activate('common');
  for (const dir of [x.server,x.client]) assert.deepEqual(fs.readdirSync(path.join(dir,'mods')).sort(), ['bridgemod-1.3.4.jar','displaymod-1.0.0.jar']);
});
test('採掘は同梱パックから選べて既存のギフト・ルーレット設定を引き継ぐ', async t => {
  let folder;
  const x = fixture(t, { bundledPackages: () => folder ? [{ id:'saikutu',folder }] : [] });
  folder = x.pack('saikutu');
  const file = path.join(folder,'game.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.bridgeEventApi = 1; manifest.commands = [{ key:'otosiana',title:'落とし穴',command:'saikutu otosiana {Count} {ListenerName}' }];
  fs.writeFileSync(file,JSON.stringify(manifest));
  const config = JSON.parse(fs.readFileSync(x.config));
  config.mappings.push({ giftId:'rose',commandFile:'otosiana.txt',repeat:5 });
  config.roulette = { enabled:true,items:[{commandFile:'otosiana.txt',weight:2},{commandFile:'zombie.txt',weight:1}] };
  fs.writeFileSync(x.config,JSON.stringify(config));
  assert.equal(x.api.list().saikutuMigrationNeeded,true);
  assert.equal(x.api.list().games.find(g=>g.id==='saikutu').installed,true);
  await x.api.activate('saikutu');
  const active = JSON.parse(fs.readFileSync(x.config));
  assert.equal(active.mappings[1].commandFile,'game_saikutu_otosiana.txt'); assert.equal(active.mappings[1].repeat,5);
  assert.equal(active.roulette.items[0].commandFile,'game_saikutu_otosiana.txt');
  assert.match(fs.readFileSync(path.join(x.server,'bridge/commands/minecraft/game_saikutu_otosiana.txt'),'utf8'), /GAME_MOD: saikutumod/);
  for (const dir of [x.server,x.client]) assert.deepEqual(fs.readdirSync(path.join(dir,'mods')).sort(), ['bridgemod-1.3.4.jar','displaymod-1.0.0.jar','saikutu.jar']);
  await x.api.activate('common');
  const survival = JSON.parse(fs.readFileSync(x.config)); assert.equal(survival.mappings.length,1); assert.equal(survival.roulette.items.length,1);
  await x.api.activate('saikutu'); assert.equal(JSON.parse(fs.readFileSync(x.config)).mappings[1].repeat,5);
  const saved = JSON.parse(fs.readFileSync(path.join(x.storage,'profiles.json'))); assert.equal(saved.legacySaikutuProfiles.common.mappings[1].commandFile,'otosiana.txt');
});
test('あとから採掘へ移したコマンドの引き継ぎでも、前の引き継ぎの退避を上書きしない（2026-10-12）', async t => {
  let folder;
  const x = fixture(t, { bundledPackages: () => folder ? [{ id:'saikutu',folder }] : [] });
  folder = x.pack('saikutu');
  const file = path.join(folder,'game.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.bridgeEventApi = 1; manifest.commands = [{ key:'otosiana',title:'落とし穴',command:'saikutu otosiana {Count} {ListenerName}' }];
  fs.writeFileSync(file,JSON.stringify(manifest));
  // 1回目：最初の14件（otosiana）の引き継ぎ。
  const config = JSON.parse(fs.readFileSync(x.config));
  config.mappings.push({ giftId:'rose',commandFile:'otosiana.txt',repeat:5 });
  fs.writeFileSync(x.config,JSON.stringify(config));
  await x.api.activate('saikutu');
  await x.api.activate('common');
  // 2回目：あとから移した採掘速度上昇（give_haste）をサバイバルで割り当てていた。
  const survival = JSON.parse(fs.readFileSync(x.config));
  survival.mappings.push({ giftId:'pass',commandFile:'give_haste.txt',repeat:1 });
  fs.writeFileSync(x.config,JSON.stringify(survival));
  await x.api.activate('saikutu');
  const saved = JSON.parse(fs.readFileSync(path.join(x.storage,'profiles.json')));
  assert.equal(saved.legacySaikutuProfiles.common.mappings.some(m => m.commandFile === 'otosiana.txt'), true, '1回目の退避は残る');
  const later = Object.entries(saved.legacySaikutuProfiles).filter(([key]) => key.startsWith('common@'));
  assert.equal(later.length, 1, '2回目の退避は別の名前で足す');
  assert.equal(later[0][1].mappings.some(m => m.commandFile === 'give_haste.txt'), true);
  await x.api.activate('common');
  assert.equal(JSON.parse(fs.readFileSync(x.config)).mappings.some(m => m.commandFile === 'give_haste.txt'), false, 'サバイバルからは外す');
});

test('埋め立て・RUN のプロフィールから採掘のプロフィールを初めて作るとき、そのゲーム専用のコマンドは写さない（PR #84 レビュー）', async t => {
  let folder;
  const x = fixture(t, { bundledPackages: () => folder ? [{ id:'saikutu',folder }] : [] });
  await x.api.install(x.pack('umetate'));
  folder = x.pack('saikutu');
  const file = path.join(folder,'game.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.bridgeEventApi = 1; manifest.commands = [{ key:'give_haste',title:'採掘速度上昇',command:'saikutu give_haste {Count} {ListenerName}' }];
  fs.writeFileSync(file,JSON.stringify(manifest));
  await x.api.activate('umetate');
  // 埋め立てで、埋め立て専用のコマンドと、あとから採掘へ移した採掘速度上昇を割り当てていた。
  const umetate = JSON.parse(fs.readFileSync(x.config));
  umetate.mappings = [{ giftId:'rose',commandFile:'game_umetate_fill.txt',repeat:1 }, { giftId:'pass',commandFile:'give_haste.txt',repeat:2 }];
  fs.writeFileSync(x.config,JSON.stringify(umetate));
  await x.api.activate('saikutu');   // 以前は「保存済みの設定で使うコマンドがありません: game_umetate_fill.txt」で切り替えられなかった
  const mining = JSON.parse(fs.readFileSync(x.config));
  assert.deepEqual(mining.mappings.map(m => m.commandFile), ['game_saikutu_give_haste.txt']);
  assert.equal(mining.mappings[0].repeat, 2);
  await x.api.activate('umetate');
  assert.deepEqual(JSON.parse(fs.readFileSync(x.config)).mappings.map(m => m.commandFile), ['game_umetate_fill.txt'], '埋め立ての専用コマンドは埋め立てに残る');
});

// ゲーム専用の判定は bridge/game_commands.cjs の1か所（処理のコピー PR6）。前は /^game_[a-z0-9]+_/ で、共通の game_mode_on.txt も外していた。
test('採掘のプロフィールを初めて作るとき、共通の game_mode_on.txt は残す', async t => {
  let folder;
  const x = fixture(t, { bundledPackages: () => folder ? [{ id:'saikutu',folder }] : [] });
  await x.api.install(x.pack('umetate'));
  folder = x.pack('saikutu');
  const file = path.join(folder,'game.json'), manifest = JSON.parse(fs.readFileSync(file));
  manifest.bridgeEventApi = 1; manifest.commands = [{ key:'give_haste',title:'採掘速度上昇',command:'saikutu give_haste {Count} {ListenerName}' }];
  fs.writeFileSync(file,JSON.stringify(manifest));
  await x.api.activate('umetate');
  fs.writeFileSync(path.join(x.server, 'bridge/commands/minecraft/game_mode_on.txt'), 'say mode\n');
  const umetate = JSON.parse(fs.readFileSync(x.config));
  umetate.mappings = [{ giftId:'rose',commandFile:'game_mode_on.txt',repeat:1 }, { giftId:'pass',commandFile:'give_haste.txt',repeat:1 }];
  fs.writeFileSync(x.config,JSON.stringify(umetate));
  await x.api.activate('saikutu');
  const mining = JSON.parse(fs.readFileSync(x.config));
  assert.deepEqual(mining.mappings.map(m => m.commandFile), ['game_mode_on.txt', 'game_saikutu_give_haste.txt']);
});

// ゲームの切り替えで入れ替える（消す）のは、パックが作れる名前（大文字小文字は区別しない）だけ（PR6 の最終レビュー）。
test('ゲームの切り替え: 大文字のゲームのファイルは入れ替え、手で作った . や - のある名前は消さない', async t => {
  const x = fixture(t), pack = x.pack('run'); await x.api.install(pack); await x.api.activate('run');
  const dir = path.join(x.server, 'bridge/commands/minecraft');
  for (const name of ['game_run_notes.v2.txt', 'game_run_my-notes.txt', 'GAME_RUN_EXTRA.TXT']) fs.writeFileSync(path.join(dir, name), 'say x\n');
  await x.api.activate('common');
  assert.deepEqual(['game_run_notes.v2.txt', 'game_run_my-notes.txt'].map(name => fs.existsSync(path.join(dir, name))), [true, true], '手で作った名前は残す');
  assert.equal(fs.readdirSync(dir).includes('GAME_RUN_EXTRA.TXT'), false, 'パックが作れる名前（大文字）は入れ替える');
});

test('bridgeコマンド名が共通MODと重なるゲームは変更前に拒否する', async t => {
  const x = fixture(t), folder = x.pack('run'), file = path.join(folder,'game.json');
  const manifest = JSON.parse(fs.readFileSync(file)); manifest.commands[0].key = 'zombie'; fs.writeFileSync(file,JSON.stringify(manifest));
  await x.api.install(folder); await assert.rejects(x.api.activate('run'), /重複.*zombie/);
  assert.equal(fs.existsSync(path.join(x.server,'mods/other.jar')),true);
});


test('全イベント設定をゲーム別に復元し、個数・送信条件も混ぜない', async t => {
  const x = fixture(t); await x.api.install(x.pack('saikutu'));
  await x.api.activate('common');
  const common = JSON.parse(fs.readFileSync(x.config));
  const simple = { commandFile: 'cod.txt', repeat: 2, enabled: true };
  Object.assign(common, { likeEvents: [{ ...simple, threshold: 100 }], unmappedGiftEvent: simple, followEvent: simple, memberEvent: simple,
    roulette: { items: [simple] }, deathRoulette: { items: [simple] }, commentGifts: { rules: [{ ...simple, match: 'hi' }] } });
  fs.writeFileSync(x.config, JSON.stringify(common));
  await x.api.activate('saikutu');
  const mining = JSON.parse(fs.readFileSync(x.config));
  assert.deepEqual(mining.mappings, []);
  assert.equal(mining.options.giftCooldownMs, 300);
  mining.deathRoulette = { items: [{ commandFile: 'game_saikutu_fill.txt', repeat: 3 }] };
  fs.writeFileSync(x.config, JSON.stringify(mining));
  await x.api.activate('common'); assert.deepEqual(JSON.parse(fs.readFileSync(x.config)), common);
  await x.api.activate('saikutu'); assert.deepEqual(JSON.parse(fs.readFileSync(x.config)), mining);
});
test('保存先・設定のゲームが変わったら未保存として扱う', async t => {
  const x = fixture(t); assert.equal(x.api.list().applied, false);
  await x.api.activate('common'); assert.equal(x.api.list().applied, true);
  const config = JSON.parse(fs.readFileSync(x.config)); config.gameProfile = 'run'; fs.writeFileSync(x.config, JSON.stringify(config));
  assert.equal(x.api.list().applied, false);
});

// ゲームの切り替えの記録（profiles.json・pending-switch.json）も、壊れていたら写しから戻し、ギフト設定が壊れていても一覧を止めない
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.4〜6.6。設定ファイルの PR3）。
function withRecords(t) {
  const records = [];
  const x = fixture(t, { recordRecovery: entry => records.push(entry), now: () => new Date(2026, 9, 24, 10, 0, 0) });
  return { ...x, records, state: path.join(x.storage, 'profiles.json'), journal: path.join(x.storage, 'pending-switch.json') };
}

test('切り替えの記録: 壊れていたら写しから戻す', async t => {
  const x = withRecords(t);
  await x.api.install(x.pack('umetate'));
  await x.api.activate('umetate');
  await x.api.activate('umetate');
  fs.writeFileSync(x.state, '{壊れた');
  const list = x.api.list();
  assert.equal(list.active, 'umetate');
  assert.equal(list.games.find(g => g.id === 'umetate').installed, true, '登録したゲームパックも戻る');
  assert.deepEqual(x.records.map(r => r.action), ['restored']);
});

// 切り替えは、ギフト設定を書いてから記録を書く。写しは書く前の中身なので、切り替えた直後に記録が壊れると、写しは前のゲームのまま。
// そのまま戻してゲームを選び直すと、今の割り当てを前のゲームの保存済みの設定として上書きする（設計書 6.6）。写しは使い、今のゲームだけを
// ギフト設定のゲームに直して「未保存」にする。登録したゲームパック・ほかのゲームの保存済みの設定は残る（2026-10-24 ユーザーの決定。PR3 の最後のレビューの重要 2）。
test('切り替えの記録: 写しのゲームがギフト設定と合わなければ、今のゲームだけギフト設定に合わせて使う。選び直して保存しても、ほかのゲームの保存済みの設定を上書きしない', async t => {
  const x = withRecords(t);
  await x.api.install(x.pack('umetate')); await x.api.install(x.pack('run'));
  await x.api.activate('umetate');
  await x.api.activate('run');
  const config = JSON.parse(fs.readFileSync(x.config, 'utf8'));
  config.mappings = [{ giftId: 'rose', commandFile: 'game_run_fill.txt', repeat: 2 }];
  fs.writeFileSync(x.config, JSON.stringify(config));
  assert.equal(JSON.parse(fs.readFileSync(x.state + '.last-good', 'utf8')).active, 'umetate', '写しは前のゲーム');
  fs.writeFileSync(x.state, '{壊れた');
  const list = x.api.list();
  assert.equal(list.active, 'run', 'ギフト設定のゲームで動く');
  assert.equal(list.applied, false, '未保存になる');
  assert.equal(list.games.find(g => g.id === 'umetate').installed, true, '登録したゲームパックは残る');
  assert.deepEqual(x.records.map(r => [r.action, r.sourceLabel]), [['restored', '前の正しい状態の写し（今のゲームはギフト設定に合わせた）']]);
  await x.api.activate('run');
  const saved = JSON.parse(fs.readFileSync(x.state, 'utf8'));
  assert.notEqual(saved.profiles.umetate?.mappings?.[0]?.commandFile, 'game_run_fill.txt', 'RUN の割り当てを埋め立ての保存済みの設定にしない');
  assert.equal(saved.profiles.run.mappings[0].commandFile, 'game_run_fill.txt');
  await x.api.activate('umetate');
  assert.equal(JSON.parse(fs.readFileSync(x.config, 'utf8')).gameProfile, 'umetate', '前のゲームも選べる');
});

test('切り替えの記録: 形の違う記録（active が数）は壊れていると扱う', t => {
  const x = withRecords(t);
  fs.mkdirSync(x.storage, { recursive: true });
  fs.writeFileSync(x.state, JSON.stringify({ format: 1, active: 3, packages: {}, profiles: {} }));
  assert.equal(x.api.list().active, 'common');
  assert.deepEqual(x.records.map(r => r.reason), ['項目 active の型が違う']);
});

test('一覧: ギフト設定が壊れていても投げない', t => {
  const x = withRecords(t);
  fs.writeFileSync(x.config, '{壊れた');
  const list = x.api.list();
  assert.equal(list.applied, false);
  assert.equal(list.recoveryRequired, false);
  assert.equal(x.api.peekActive(), null, '記録が無いときは null');
});

// 切り替えの途中の記録は切り替えの間だけあるので写しを作らない。壊れていたら、ホームの「復旧」で外す（PR3 の計画の決めたこと 5）。
test('復旧: 壊れた途中の記録は外して記録し、そのあと切り替えられる', async t => {
  const x = withRecords(t);
  fs.mkdirSync(x.storage, { recursive: true });
  fs.writeFileSync(x.journal, '{壊れた');
  assert.equal(x.api.list().recoveryRequired, true);
  const after = await x.api.recover();
  assert.equal(after.recoveryRequired, false);
  assert.ok(fs.readdirSync(x.storage).some(name => name.startsWith('pending-switch.json.broken-')));
  assert.deepEqual(x.records.map(r => [r.action, r.reason]), [['set-aside', 'JSON として読めない']]);
  await x.api.activate('common');
  assert.equal(x.api.peekActive(), 'common');
});

test('本文: 切り替えの記録を readJson・writeJson で読み書きせず、ギフト設定は writeWithLastGood で書く', () => {
  const source = fs.readFileSync(path.join(__dirname, '../game_profiles.cjs'), 'utf8');
  for (const old of ['readJson(stateFile()', 'writeJson(stateFile()', 'readJson(configPath()', 'atomicWrite(configPath()']) assert.ok(!source.includes(old), old);
  assert.match(source, /writeWithLastGood\(configPath\(\)/);
  const ipc = fs.readFileSync(path.join(__dirname, '../games_ipc.cjs'), 'utf8');
  assert.match(ipc, /recordRecovery/);
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = main.indexOf('createGamesIpc({');
  assert.match(main.slice(start, main.indexOf('});', start)), /recordRecovery:/);
});

// ゲームを切り替えた直後にギフト設定が壊れると、写しは前のゲームのものなので使わない（6.6）。そのときもゲームを選び直して直せるように、
// ギフト設定が読めなくても切り替えを止めない。ゲームによらない部分は写し（無ければ雛形）から取り、今のゲームの保存済みの設定は上書きしない
// （2026-10-24 ユーザーの決定。PR3 の最後のレビューの重要 1）。
test('切り替え: 切り替えた直後にギフト設定が壊れても、前のゲームを選び直して直せる', async t => {
  const x = withRecords(t);
  await x.api.install(x.pack('umetate')); await x.api.install(x.pack('run'));
  await x.api.activate('umetate');
  const config = JSON.parse(fs.readFileSync(x.config, 'utf8'));
  config.mappings = [{ giftId: 'rose', commandFile: 'game_umetate_fill.txt', repeat: 4 }];
  fs.writeFileSync(x.config, JSON.stringify(config));
  await x.api.activate('run');
  fs.writeFileSync(x.config, '{壊れた');
  await x.api.activate('umetate');
  const restored = JSON.parse(fs.readFileSync(x.config, 'utf8'));
  assert.equal(restored.gameProfile, 'umetate');
  assert.equal(restored.mappings[0].repeat, 4, '埋め立ての保存済みの割り当てで戻る');
  assert.equal(restored.tiktokUsername, 'viewer', 'ゲームによらない部分は写しから');
  assert.equal(restored.rcon.password, 'keep-local-secret');
  const saved = JSON.parse(fs.readFileSync(x.state, 'utf8'));
  assert.equal(saved.profiles.run, undefined, '読めなかった設定で RUN の保存済みの設定を作らない');
  assert.ok(fs.readdirSync(path.dirname(x.config)).some(name => name.startsWith('config.minecraft.json.broken-')), '壊れたファイルは残る');
});

// 切り替えに失敗して元に戻すときは、ギフト設定・記録の写しを切り替えの途中の中身にしない（PR3 の最後のレビューの軽い 4）。
test('切り替え: 失敗して元に戻しても、写しは切り替えの前のまま', async t => {
  const x = withRecords(t);
  await x.api.install(x.pack('umetate'));
  await x.api.activate('common');
  let failures = 0;
  const rename = fs.renameSync;
  t.after(() => { fs.renameSync = rename; });
  fs.renameSync = (from, to) => { if (to === x.state && failures < 5) { failures++; throw Object.assign(new Error('EPERM'), { code: 'EPERM' }); } return rename(from, to); };
  await assert.rejects(x.api.activate('umetate'), /切替に失敗したため元へ戻しました/);
  fs.renameSync = rename;
  assert.equal(JSON.parse(fs.readFileSync(x.config, 'utf8')).gameProfile, 'common');
  assert.equal(JSON.parse(fs.readFileSync(x.config + '.last-good', 'utf8')).gameProfile || 'common', 'common', 'ギフト設定の写しを切り替えの途中の中身にしない');
  assert.equal(JSON.parse(fs.readFileSync(x.state, 'utf8')).active, 'common');
});

// 一瞬読めなかっただけの途中の記録は外さない（MOD のフォルダーを元に戻す情報なので。PR3 の最後のレビューの軽い 6）。
test('復旧: 途中の記録を読めないときは外さず、もう一度押してもらう', async t => {
  const x = withRecords(t);
  fs.mkdirSync(x.journal, { recursive: true });
  await assert.rejects(x.api.recover(), /途中の記録を読めません。もう一度「復旧」を押してください/);
  assert.equal(fs.existsSync(x.journal), true);
  assert.deepEqual(x.records, []);
});

// OBSMOD は標準装備だが、入れるのはサーバーにだけ（Minecraft 本体には入れない。OBSMOD はサーバーで起きたことを OBS ツールへ送る MOD。2026-10-25 ユーザーの決定）。
function withObs(t) {
  let obs = null;
  const x = fixture(t, { obsJar: () => obs });
  const obsJar = (version, id = 'minecraft_obs_bridge') => { obs = path.join(x.root, `minecraft_obs_bridge-${version}.jar`); fs.writeFileSync(obs, jar(id)); return obs; };
  return { ...x, obsJar };
}
const mods = dir => fs.readdirSync(path.join(dir, 'mods')).sort();

test('ゲームの切り替え: OBSMOD はサーバーにだけ入れ、Minecraft 本体には入れない', async t => {
  const x = withObs(t); x.obsJar('2.4.8');
  await x.api.install(x.pack('umetate'));
  await x.api.activate('umetate');
  assert.deepEqual(mods(x.server), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'minecraft_obs_bridge-2.4.8.jar', 'umetate.jar']);
  assert.deepEqual(mods(x.client), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'umetate.jar']);
  await x.api.activate('common');
  assert.deepEqual(mods(x.server), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'minecraft_obs_bridge-2.4.8.jar']);
  assert.deepEqual(mods(x.client), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar']);
});

test('アプリの更新のあとの入れ替え: サーバーの OBSMOD を新しくし、Minecraft 本体に残った OBSMOD は外す', async t => {
  const x = withObs(t); x.obsJar('2.4.7');
  await x.api.install(x.pack('umetate'));
  await x.api.activate('umetate');
  fs.writeFileSync(path.join(x.client, 'mods', 'minecraft_obs_bridge-2.4.6.jar'), jar('minecraft_obs_bridge'));
  x.obsJar('2.4.8');
  await x.api.refreshMods();
  assert.deepEqual(mods(x.server), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'minecraft_obs_bridge-2.4.8.jar', 'umetate.jar']);
  assert.deepEqual(mods(x.client), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar', 'umetate.jar']);
});

test('ゲームの切り替え: OBSMOD の jar の中身が OBSMOD でなければ、どちらも切り替えない', async t => {
  const x = withObs(t); x.obsJar('2.4.8', 'displaymod');
  await x.api.install(x.pack('umetate'));
  await assert.rejects(x.api.activate('umetate'), /OBSMOD/);
  for (const dir of [x.server, x.client]) assert.deepEqual(mods(dir), ['doumacmd-old.jar', 'other.jar']);
});

// 開発版で ObsMod を作っていない（OBSMOD の jar が無い）ときは入れない。サーバーにあった OBSMOD も、切り替えで外れる（配布版の雛形にはいつも入っている。最後のレビュー 軽い6）。
test('ゲームの切り替え: OBSMOD の jar が無いときは入れず、サーバーにあった OBSMOD も外れる', async t => {
  const x = withObs(t);
  fs.writeFileSync(path.join(x.server, 'mods', 'minecraft_obs_bridge-2.4.7.jar'), jar('minecraft_obs_bridge'));
  await x.api.activate('common');
  assert.deepEqual(mods(x.server), ['bridgemod-1.3.4.jar', 'displaymod-1.0.0.jar']);
});
