const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isBridgeCommandFile, commandFileProblem, commandFileRefs } = require('../../bridge/command_files.cjs');
const { validateBridgeConfig: validateForSave } = require('../config_schema.cjs');
const { validateBridgeConfig: validateForBridge } = require('../../bridge/config_schema.js');
const { planTestEvent } = require('../event_tests.cjs');

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
    commentCommands: { '!猫': 'ねこ.txt' }, poll: { options: { 1: { commandFile: 'ok.txt' } } },
  } },
  mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'ネコ.txt' }],
  likeEvents: [{ threshold: 10, commandFile: 'cod.txt' }],
  followEvent: { commandFile: 'tnt - コピー.txt' },
  roulette: { items: [{ label: '当たり', commandFile: 'あたり.txt' }] },
  commentGifts: { rules: [{ match: 'こんにちは', commandFile: 'heal.txt' }] },
  ...extra,
});

test('アプリの保存では、使えない名前の割り当てを場所付きのエラーにする', () => {
  const result = validateForSave(config());
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  for (const where of ['ギフト割り当て（バラ）', 'フォロー', 'ルーレット項目（当たり）', 'コンボ（10連）', 'コメントコマンド（「!猫」）']) assert.ok(text.includes(where), where);
  assert.ok(!text.includes('いいね（10いいねごと）'));
  assert.equal(commandFileRefs(config()).length, 9);
  // RCON はファイルを直接読むので名前の制限は掛けない。
  assert.equal(validateForSave(config({ options: { commandTransport: 'rcon' } })).ok, true);
});

test('Bridgeの起動・再読込では警告に留め、Bridge自体は起動できる', () => {
  const result = validateForBridge(config());
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.includes('ギフト割り当て（バラ）') && w.includes('実行されません')));
});

test('テスト発火でも本番と同じく使えない名前を送らない', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'command-files-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'ネコ.txt'), 'say neko\n');
  assert.throws(() => planTestEvent({}, { type: 'gift', commandFile: 'ネコ.txt' }, dir), /半角英数字/);
});
