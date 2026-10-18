const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isBridgeCommandFile, commandFileProblem, commandFileRefs } = require('../../bridge/command_files.cjs');
const { validateBridgeConfig: validateForSave } = require('../config_schema.cjs');
const { validateBridgeConfig: validateForBridge } = require('../../bridge/config_schema.js');

test('BridgeMODと同じ規則でコマンドファイル名を判定する', () => {
  for (const name of ['cod.txt', 'tnt-kuusyuu.txt', 'game_umetate_tower.txt', 'roulette', 'A.TXT']) assert.ok(isBridgeCommandFile(name), name);
  for (const name of ['ネコ.txt', 'tnt - コピー.txt', 'a b.txt', '.txt', '']) assert.ok(!isBridgeCommandFile(name), name);
  assert.match(commandFileProblem('ネコ.txt'), /ネコ\.txt.*半角英数字/);
  assert.equal(commandFileProblem('cod.txt'), '');
});

const config = (extra = {}) => ({
  tiktokUsername: 'fixture', options: { commandTransport: 'bridge_mod', gameplay: {
    combo: { levels: [{ count: 10, commandFile: 'combo ネコ.txt' }] },
    likeMilestones: [{ threshold: 1000, commandFile: 'ok.txt' }],
    commentCommands: { '!猫': 'ねこ.txt' }, poll: { enabled: true, options: { 1: { commandFile: 'ok.txt' } } },
  } },
  mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'ネコ.txt' }],
  likeEvents: [{ threshold: 10, commandFile: 'cod.txt' }],
  followEvent: { commandFile: 'tnt - コピー.txt' },
  roulette: { enabled: true, items: [{ label: '当たり', commandFile: 'あたり.txt' }] },
  commentGifts: { enabled: true, rules: [{ match: 'こんにちは', commandFile: 'heal.txt' }] },
  ...extra,
});

test('アプリの保存では、新しく割り当てた使えない名前を場所付きのエラーにする', () => {
  const result = validateForSave(config());
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  for (const where of ['ギフト割り当て（バラ）', 'フォロー', 'ルーレット項目（当たり）', 'コンボ（10連）', 'コメントコマンド（「!猫」）']) assert.ok(text.includes(where), where);
  assert.ok(!text.includes('いいね（10いいねごと）'));
  assert.equal(commandFileRefs(config()).length, 9);
  // RCON はファイルを直接読むので名前の制限は掛けない。
  assert.equal(validateForSave(config({ options: { commandTransport: 'rcon' } })).ok, true);
});

test('無効にしてある設定は、Bridgeと同じく発火しないので検査しない', () => {
  const disabled = config({
    mappings: [], followEvent: { enabled: false, commandFile: 'tnt - コピー.txt' },
    likeEvents: [{ enabled: false, threshold: 10, commandFile: 'ねこ.txt' }],
    roulette: { enabled: false, items: [{ commandFile: 'あたり.txt' }] },
    deathRoulette: { items: [{ commandFile: 'あたり.txt' }] },
    commentGifts: { enabled: true, rules: [{ enabled: false, match: 'x', commandFile: 'ねこ.txt' }] },
    options: { commandTransport: 'bridge_mod', gameplay: { poll: { enabled: false, options: { 1: 'ねこ.txt' } } } },
  });
  assert.deepEqual(commandFileRefs(disabled), []);
  assert.equal(validateForSave(disabled).ok, true);
  // ギフト割り当て・コンボ・ルーレット項目は Bridge が enabled を見ずに発火するので、enabled:false でも数える。
  const ignoredFlag = config({ mappings: [{ enabled: false, giftId: '1', name: 'ハート', commandFile: 'ねこ.txt' }],
    roulette: { enabled: true, items: [{ enabled: false, label: '外れ', commandFile: 'あたり.txt' }] },
    options: { commandTransport: 'bridge_mod', gameplay: { combo: { levels: [{ enabled: false, count: 5, commandFile: 'ねこ.txt' }] } } } });
  const where = commandFileRefs(ignoredFlag).map(ref => ref.where);
  for (const expected of ['ギフト割り当て（ハート）', 'ルーレット項目（外れ）', 'コンボ（5連）']) assert.ok(where.includes(expected), expected);
});

test('前から保存されていた割り当ては警告に留め、一括起動やほかの保存を止めない', () => {
  const saved = config({ followEvent: null, roulette: null, options: { commandTransport: 'bridge_mod' } });
  // 旧版で保存した「バラ→ネコ.txt」をそのままに、ID承認やほかの設定だけを保存する。
  const result = validateForSave({ ...saved, tiktokUsername: 'changed' }, { previous: [saved] });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.includes('ギフト割り当て（バラ）') && w.includes('実行されません')));
  // 同じ名前でも、新しい場所への割り当てはエラーにする。
  const added = { ...saved, mappings: [...saved.mappings, { giftId: '1', name: 'ハート', commandFile: 'ネコ.txt' }] };
  const next = validateForSave(added, { previous: [saved] });
  assert.equal(next.ok, false);
  assert.ok(next.errors.some(e => e.includes('ギフト割り当て（ハート）')));
  assert.ok(!next.errors.some(e => e.includes('ギフト割り当て（バラ）')));
});

test('Bridgeの起動・再読込では警告に留め、Bridge自体は起動できる', () => {
  const result = validateForBridge(config());
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.includes('ギフト割り当て（バラ）') && w.includes('実行されません')));
});

// .txt の付け外しは command_files.cjs の1組の関数だけで行い、TNT.TXT のような大文字の拡張子も同じに扱う（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 4）。
test('.txt の付け外し: ensureTxt・isTxtName・bridgeCommandKey は大文字小文字を問わない', () => {
  const { ensureTxt, isTxtName, bridgeCommandKey } = require('../../bridge/command_files.cjs');
  assert.equal(ensureTxt('a'), 'a.txt');
  assert.equal(ensureTxt(' A.TXT '), 'A.TXT');
  assert.equal(ensureTxt('tnt.v2'), 'tnt.v2.txt');
  assert.equal(ensureTxt(''), '');
  assert.equal(isTxtName('A.TXT'), true);
  assert.equal(isTxtName('a.txt.bak'), false);
  assert.equal(bridgeCommandKey('TNT.TXT'), 'TNT');
});

test('.txt の付け外し: BRIDGE・アプリは自前の付け外しを持たず command_files.cjs を使う', () => {
  const root = path.resolve(__dirname, '../..');
  const files = ['bridge/index.js', 'bridge/test_fire.cjs', 'bridge/roulette.cjs',
    ...fs.readdirSync(path.join(root, 'electron')).filter(name => name.endsWith('.cjs') && name !== 'preload.cjs').map(name => 'electron/' + name)];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const copy = /endsWith\((["'])\.txt\1\)|basename\([^)]*,\s*(["'])\.txt\2\)|\/\\\.txt\$\/i\.test\(/;
    assert.equal(copy.test(source), false, file + ' に .txt の付け外しの写しが残っている');
  }
});

test('.txt の付け外し: 大文字の拡張子（TNT.TXT）の割り当ても、BridgeMOD へ送る名前は TNT', async t => {
  const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
  const bridge = await startBridgeFixture(t, { config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'TNT.TXT', repeat: 1 }] } });
  fs.writeFileSync(path.join(bridge.dir, 'commands', 'TNT.TXT'), '# TITLE: TNT\nsay tnt\n');
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g1' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.length > 0, 'gift');
  assert.deepEqual(bridge.requests.map(request => request.key), ['TNT']);
});
