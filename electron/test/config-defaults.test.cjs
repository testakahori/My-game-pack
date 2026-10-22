// 設定（config.minecraft.json）の既定値・新しい設定の雛形・コマンドの場所・BridgeMOD の接続先は1か所
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7。処理のコピー PR4）。
// 表は bridge/config_defaults.json（画面も読む）、決める関数は bridge/config_defaults.cjs。BRIDGE・アプリ・画面が同じものを使う。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG_DEFAULTS, newBridgeConfig, commandsDirSetting, bridgeCommandsDir, bridgeModEndpoint } = require('../../bridge/config_defaults.cjs');
const { CONFIG_VERSION, migrateBridgeConfig } = require('../../bridge/config_migration.cjs');
const { validateBridgeConfig } = require('../../bridge/config_schema.js');

test('新しい設定の雛形: 今の雛形と同じ項目に今の決まりの版を付け、確かめを通り、直すものがない。呼ぶたびに別のもの', () => {
  const a = newBridgeConfig(), b = newBridgeConfig();
  a.mappings.push({}); a.options.giftCooldownMs = 1;
  assert.deepEqual([b.mappings, b.options.giftCooldownMs], [[], 300]);
  assert.deepEqual(b.options, { giftCooldownMs: 300, maxCommandsPerGift: 200, commandTransport: 'bridge_mod', bridgeModHost: '127.0.0.1', bridgeModPort: 25576, maxLikeCatchUpPerEvent: 5, logUnknownGifts: true });
  assert.deepEqual(b.rcon, { host: '127.0.0.1', port: 25575, password: '' });
  assert.equal(b.configVersion, CONFIG_VERSION);
  assert.deepEqual(validateBridgeConfig({ ...b, tiktokUsername: 'fixture' }).errors, []);
  assert.deepEqual(migrateBridgeConfig(b).changes, []);
  assert.ok(Object.isFrozen(CONFIG_DEFAULTS.options) && Object.isFrozen(CONFIG_DEFAULTS.rcon));
});

test('コマンドの場所: 書いていない・空なら commands/minecraft。相対は BRIDGE のフォルダーから、絶対はそのまま', () => {
  const base = path.resolve('bridge-dir'), standard = path.join(base, 'commands', 'minecraft');
  assert.deepEqual([bridgeCommandsDir(base), bridgeCommandsDir(base, {}), bridgeCommandsDir(base, { commandsDir: '  ' }), bridgeCommandsDir(base, { commandsDir: 3 })], [standard, standard, standard, standard]);
  assert.equal(bridgeCommandsDir(base, { commandsDir: ' commands ' }), path.join(base, 'commands'));
  const elsewhere = path.resolve('elsewhere', 'cmds');
  assert.equal(bridgeCommandsDir(base, { commandsDir: elsewhere }), elsewhere);
  assert.equal(commandsDirSetting(undefined), 'commands/minecraft');
});

test('BridgeMOD の接続先: 前後の空白を除き、旧い doumaMod* も読む。空白だけなら次の名前、なければ 127.0.0.1:25576', () => {
  assert.deepEqual(bridgeModEndpoint(undefined), { host: '127.0.0.1', port: 25576 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: ' 10.0.0.2 ', bridgeModPort: '25600' }), { host: '10.0.0.2', port: 25600 });
  assert.deepEqual(bridgeModEndpoint({ doumaModHost: 'mod.local', doumaModPort: 25601 }), { host: 'mod.local', port: 25601 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: '  ', doumaModHost: ' old ' }), { host: 'old', port: 25576 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: 'new', doumaModHost: 'old', bridgeModPort: 1, doumaModPort: 2 }), { host: 'new', port: 1 }, '新しい名前が先');
});

// 設計書 13：1つにまとめたものは、今それを使っている所すべてが使う（自分の写しを持ち続けない）。
test('既定値の写し: BRIDGE は既定値・コマンドの場所・接続先を自分で持たず config_defaults を使う', () => {
  for (const file of ['bridge/index.js', 'bridge/live_config.cjs', 'bridge/roulette.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /(\|\||\?\?)\s*(25576|25575|8081|"127\.0\.0\.1"|"commands")/, file);
    assert.doesNotMatch(source, /\?\?\s*(300|200|1200|5|20|60000)[,)]/, file);
    assert.doesNotMatch(source, /(bridgeModHost|doumaModHost|bridgeModPort|doumaModPort|commandsDir)\s*\|\|/, file);
    assert.doesNotMatch(source, /"minecraft", name/, file);
  }
  assert.match(fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8'), /既定値は bridge\/config_defaults\.json/);
});

test('既定値の写し: アプリは雛形・コマンドの場所・BridgeMOD の接続先を自分で持たず config_defaults を使う', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const files = fs.readdirSync(path.resolve(__dirname, '..')).filter(name => name.endsWith('.cjs')).map(name => 'electron/' + name).concat(['vite.config.ts', 'scripts/prepare-bridge-runtime.cjs']);
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /["']commands["']\s*,\s*["']minecraft["']/, file + ' にコマンドの場所の写しがある');
    assert.doesNotMatch(source, /(bridgeModHost|doumaModHost|bridgeModPort|doumaModPort)\s*\|\|/, file + ' に BridgeMOD の接続先の写しがある');
    assert.doesNotMatch(source, /giftCooldownMs:\s*300/, file + ' に雛形の写しがある');
  }
  assert.match(read('electron/paths.cjs'), /newBridgeConfig\(\)/);
  assert.match(read('scripts/prepare-bridge-runtime.cjs'), /newBridgeConfig\(\)/);
});
