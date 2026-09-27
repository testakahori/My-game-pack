const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGameProfiles, jarModIds } = require('../game_profiles.cjs');
const { retireLegacyEnvironment, replaceCommonMod } = require('../bridge_mod_migration.cjs');

function jar(id) {
  const name = Buffer.from('META-INF/mods.toml'), text = Buffer.from(`modLoader="javafml"\n[[mods]]\nmodId="${id}"\nversion="1.0"\n`);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(text.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(text.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + text.length, 16);
  return Buffer.concat([local, name, text, central, name, end]);
}
function fixture(t, extras = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-games-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = path.join(root, 'サーバー'), client = path.join(root, 'Minecraft'), storage = path.join(root, 'profiles');
  for (const dir of [server, client]) { fs.mkdirSync(path.join(dir, 'mods'), { recursive: true }); fs.writeFileSync(path.join(dir, 'mods', 'doumacmd-old.jar'), 'original'); fs.writeFileSync(path.join(dir, 'mods', 'other.jar'), 'other mod'); }
  const config = path.join(server, 'bridge', 'config.minecraft.json'); fs.mkdirSync(path.dirname(config));
  fs.writeFileSync(config, JSON.stringify({ tiktokUsername: 'viewer', rcon: { password: 'keep-local-secret' }, options: { giftCooldownMs: 300 }, mappings: [{ giftId: '1', commandFile: 'zombie.txt', repeat: 1 }], shareEvent: { enabled: true, commandFile: 'cod.txt' } }));
  fs.mkdirSync(path.join(path.dirname(config), 'commands/minecraft'), { recursive: true });
  for (const name of ['zombie.txt', 'cod.txt']) fs.writeFileSync(path.join(path.dirname(config), 'commands/minecraft', name), 'say test');
  const bridge = path.join(root, 'bridgemod-1.3.4.jar'); fs.writeFileSync(bridge, jar('bridgemod'));
  const api = createGameProfiles({ storage: () => storage, serverRoot: () => server, clientRoot: () => client, configPath: () => config, bridgeJar: () => bridge, ensureStopped: async () => {}, ...extras });
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
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'umetate.jar']);
  for (const backup of result.backupFolders) assert.equal(fs.readFileSync(path.join(backup, 'doumacmd-old.jar'), 'utf8'), 'original');
  const command = path.join(x.server, 'bridge/commands/minecraft/game_umetate_fill.txt');
  assert.match(fs.readFileSync(command, 'utf8'), /DISPLAY_OWNER: game/);
  let config = JSON.parse(fs.readFileSync(x.config)); assert.deepEqual(config.mappings, []); assert.equal(config.shareEvent, undefined); assert.equal(config.rcon.password, 'keep-local-secret');
  config.mappings = [{ giftId: 'rose', commandFile: 'game_umetate_fill.txt', repeat: 3 }]; fs.writeFileSync(x.config, JSON.stringify(config));
  await x.api.activate('run'); assert.equal(fs.existsSync(command), false);
  for (const dir of [x.server, x.client]) assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['bridgemod-1.3.4.jar', 'run.jar']);
  await x.api.activate('umetate'); assert.equal(JSON.parse(fs.readFileSync(x.config)).mappings[0].repeat, 3);
  await x.api.activate('common'); config = JSON.parse(fs.readFileSync(x.config)); assert.equal(config.mappings[0].commandFile, 'zombie.txt'); assert.equal(config.shareEvent.enabled, true);
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

module.exports = { jar };
