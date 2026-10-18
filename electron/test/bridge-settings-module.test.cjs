// BRIDGE の設定・ギフトの割り当て・テンプレート・設定のバックアップ・配信前チェック・コマンド txt の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridgeSettings } = require('../bridge_settings.cjs');

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
  const calls = [], state = { bridgeRunning: false }, handlers = new Map();
  const settings = createBridgeSettings({
    app: { getVersion: () => '9.9.9' }, dialog: {}, shell: { openPath: async () => '' },
    getConfigPath: () => configPath, ensureConfigExists: () => {}, getBridgeBatDir: () => bridge, getServerRoot: () => root,
    getGiftsMinPath: () => path.join(root, 'gifts.min.json'), getGiftsMetaPath: () => path.join(root, 'gifts.meta.json'),
    getInstalledBridgeRoot: () => root, getBridgeDir: () => bridge,
    gameProfiles: { list: () => ({ applied: true, recoveryRequired: false, active: 'common' }) },
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    settingsBackups: { create: kind => calls.push('backup:' + kind), list: () => [], restore: id => calls.push('restore:' + id) },
    readTtsSettings: () => ({ enabled: false, engine: 'voicevox' }),
    requestBridgeMod: async (...args) => { calls.push('mod:' + args.join(' ')); return { ok: true }; },
    isBridgeRunning: () => state.bridgeRunning,
  });
  settings.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { bridge, configPath, calls, state, settings, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

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
  fs.writeFileSync(path.join(commands, 'bom_title.txt'), '﻿# title: ねこ\n//\n// 説明\nsummon cat\n');
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
