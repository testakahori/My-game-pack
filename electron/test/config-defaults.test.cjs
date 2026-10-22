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
  // 手で書いた文字列でないホストは、書いていないものとして次の名前か既定へ（"false"・"[object Object]" に接続しない。PR4 の最終レビュー）。
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: false, doumaModHost: 0 }), { host: '127.0.0.1', port: 25576 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: {}, doumaModHost: ' old ' }), { host: 'old', port: 25576 });
});

// 設計書 11：BridgeMOD がコマンドを探す既定の場所（Java）は、JavaScript の既定と同じであること（PR4 の最終レビュー）。
test('コマンドの場所: BridgeMOD（BridgeMod.java）が探す既定の bridge/<場所> は、表の commandsDir と同じ', () => {
  const java = fs.readFileSync(path.resolve(__dirname, '../../BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java'), 'utf8');
  // 式の終わり（;）まで比べる（表が commands だけになったとき、Java の .resolve("commands").resolve("minecraft") の頭に当たって通らないように）。
  const chain = '.resolve("bridge")' + CONFIG_DEFAULTS.options.commandsDir.split('/').map(name => `.resolve("${name}")`).join('') + ';';
  assert.equal(java.split(chain).length - 1, 2, `BridgeMod.java が ${chain} で探していない（サーバーのフォルダーの直下と、上の階層）`);
});

// 設計書 13：1つにまとめたものは、今それを使っている所すべてが使う（自分の写しを持ち続けない）。
test('既定値の写し: BRIDGE は既定値・コマンドの場所・接続先を自分で持たず config_defaults を使う', () => {
  for (const file of ['bridge/index.js', 'bridge/live_config.cjs', 'bridge/roulette.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /(\|\||\?\?)\s*(25576|25575|8081|"127\.0\.0\.1"|"commands(\/minecraft)?")/, file);
    assert.doesNotMatch(source, /\?\?\s*(300|200|1200|5|20|60000)[,)]/, file);
    assert.doesNotMatch(source, /(bridgeModHost|doumaModHost|bridgeModPort|doumaModPort|commandsDir)\s*\|\|/, file);
    assert.doesNotMatch(source, /"minecraft", name/, file);
  }
  assert.match(fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8'), /既定値は bridge\/config_defaults\.json/);
  // ギフト割り当ての使う形は bridge/gift_mappings.cjs の1か所（処理のコピー PR5）。
  const index = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  // 送る列の名前（`gift:${giftId}`）には当てず、名前の既定（|| `gift:${…}`）だけを探す。
  assert.doesNotMatch(index, /\|\|\s*`gift:\$\{/, 'ギフト割り当ての名前の既定を自分で作らない');
  assert.equal(index.split('giftMappingsById(').length - 1, 2, '起動と再読込の両方で使う');
});

test('既定値の写し: アプリは雛形・コマンドの場所・BridgeMOD の接続先を自分で持たず config_defaults を使う', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const files = fs.readdirSync(path.resolve(__dirname, '..')).filter(name => name.endsWith('.cjs')).map(name => 'electron/' + name).concat(['vite.config.ts', 'scripts/prepare-bridge-runtime.cjs']);
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /["']commands["']\s*,\s*["']minecraft["']/, file + ' にコマンドの場所の写しがある');
    assert.doesNotMatch(source, /(bridgeModHost|doumaModHost|bridgeModPort|doumaModPort)\s*\|\|/, file + ' に BridgeMOD の接続先の写しがある');
    assert.doesNotMatch(source, /giftCooldownMs:\s*300/, file + ' に雛形の写しがある');
    assert.doesNotMatch(source, /(\|\||\?\?)\s*(25576|"commands(\/minecraft)?")/, file + ' に既定値の写しがある');
    // BRIDGE の設定側の RCON の接続先（server.properties の rcon.port は Minecraft の既定なので見ない）。
    assert.doesNotMatch(source, /rcon\??\.(host|port)\s*(\|\||\?\?)\s*("|[0-9])/, file + ' に RCON の既定値の写しがある');
  }
  assert.match(read('electron/paths.cjs'), /newBridgeConfig\(\)/);
  assert.match(read('scripts/prepare-bridge-runtime.cjs'), /newBridgeConfig\(\)/);
});

// 画面は決まりを持たず、データは bridge/ の JSON から読む（設計書 3）。古い名前（likeBatchMs・likeCatchupLimit）は BRIDGE が読んでいない。
test('画面: 運用センター・配信ホームは既定値を config_defaults.json から読み、古い名前と既定値の写しを持たない', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  for (const file of ['src/components/OperationsPage.tsx', 'src/components/DashboardPage.tsx']) {
    const source = read(file);
    assert.match(source, /import CONFIG_DEFAULTS from "\.\.\/\.\.\/bridge\/config_defaults\.json";/, file);
    assert.doesNotMatch(source, /likeBatchMs|likeCatchupLimit/, file);
    // 設定の値を読んだすぐあとに、既定値を数・文字・true/false で直接書いていないか（関係ない `|| 0` などは見ない。PR4 の最終レビュー）。
    assert.doesNotMatch(source, /(options\??\.|\bo\.|rcon\??\.)(giftCooldownMs|likeBatchWindowMs|maxLikeCatchUpPerEvent|maxCommandsPerGift|logUnknownGifts|commandsDir|rconQueueWarnSize|streakTtlMs|host|port)\s*(\?\?|\|\|)\s*("|[0-9]|true\b|false\b)/, file);
  }
  const operations = read('src/components/OperationsPage.tsx');
  // 古い名前だけの設定では、BRIDGE が使う既定値（表の値。いいねバッチなら 1200）を出す。
  for (const key of ['giftCooldownMs', 'likeBatchWindowMs', 'maxLikeCatchUpPerEvent', 'maxCommandsPerGift']) {
    assert.ok(operations.includes(`value={o.${key} ?? CONFIG_DEFAULTS.options.${key}} onChange=`), key);
  }
  assert.deepEqual([CONFIG_DEFAULTS.options.likeBatchWindowMs, CONFIG_DEFAULTS.options.maxLikeCatchUpPerEvent], [1200, 5]);
  assert.doesNotMatch(read('src/components/DashboardPage.tsx'), /commandsDir:/, '保存のたびに main が上書きするので書かない');
  assert.doesNotMatch(read('src/lib/devApiMock.ts'), /likeBatchMs|likeCatchupLimit/);
  // 1件の保存で「直す前の行」を探すときも、アプリ（gift_mapping.cjs）と同じく giftId の前後の空白を除く（処理のコピー PR5）。
  assert.match(read('src/components/GiftCommandDialog.tsx'), /String\(row\.giftId\)\.trim\(\) === giftId/);
});
