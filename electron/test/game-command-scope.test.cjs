const test = require('node:test');
const assert = require('node:assert/strict');
const { availableGameCommands, assertGameCommands } = require('../game_command_scope.cjs');
const names = ['zombie.txt', 'cod.txt', 'roulette.txt', 'get_ender_pearl.txt', 'game_saikutu_get_ender_pearl.txt', 'game_run_race.txt', 'game_umetate_fill.txt', '_gamerules.txt'];
const status = active => ({ active, applied: true, recoveryRequired: false });
test('ゲーム保存前・復旧中には候補を返さず設定も保存できない', () => {
  for (const state of [null, { ...status('common'), applied: false }, { ...status('common'), recoveryRequired: true }]) {
    assert.deepEqual(availableGameCommands(names, state), []);
    assert.throws(() => assertGameCommands({ mappings: [] }, names, state), /TOP/);
  }
});
test('サバイバルは共通のみ、各ゲームにはそのMODのコマンドだけを追加する', () => {
  const common = ['zombie.txt', 'cod.txt', 'roulette.txt'];
  for (const [game, specific] of [['common', []], ['saikutu', ['game_saikutu_get_ender_pearl.txt']], ['run', ['game_run_race.txt']], ['umetate', ['game_umetate_fill.txt']]]) {
    assert.deepEqual(availableGameCommands(names, status(game)), [...common, ...specific]);
  }
});
test('全イベント種別で別ゲームの参照を拒否し、採掘ではエンダーパールを保存できる', () => {
  const file = { commandFile: 'game_saikutu_get_ender_pearl.txt' };
  // ルーレット・デスルーレット・コメントギフト・投票は、有効にしてあるときだけ BRIDGE が動かすので確かめる（処理のコピー PR5）。
  const examples = [{ mappings: [file] }, { likeEvents: [file] }, { roulette: { enabled: true, items: [file] } }, { deathRoulette: { enabled: true, items: [file] } }, { commentGifts: { enabled: true, rules: [file] } }, ...['shareEvent','followEvent','memberEvent','unmappedGiftEvent'].map(key => ({ [key]: file })), { options: { gameplay: { likeMilestones: [file], combo: { levels: [file] } } } },
    { options: { gameplay: { commentCommands: { '!x': file.commandFile } } } }, { options: { gameplay: { poll: { enabled: true, options: { 1: file.commandFile } } } } }];
  for (const value of examples) {
    assert.throws(() => assertGameCommands(value, names, status('common')), /使えないコマンド/);
    assert.doesNotThrow(() => assertGameCommands({ ...value, gameProfile: 'saikutu' }, names, status('saikutu')));
  }
});
test('ゲーム切替前の画面からの保存・移行前の旧コマンド・存在しないファイルを拒否する', () => {
  assert.throws(() => assertGameCommands({ gameProfile: 'common' }, names, status('saikutu')), /切り替わっています/);
  for (const commandFile of ['get_ender_pearl.txt','missing.txt','_gamerules.txt','../cod.txt']) assert.throws(() => assertGameCommands({ gameProfile: 'saikutu', mappings: [{ giftId: '1', commandFile }] }, names, status('saikutu')), commandFile);
});

test('BRIDGE が動かさない設定は確かめず、名前は .txt・前後の空白・大文字小文字を区別しない（処理のコピー PR5）', () => {
  const other = 'game_saikutu_get_ender_pearl.txt';
  for (const value of [{ mappings: [{ commandFile: other, enabled: false }] }, { roulette: { items: [{ commandFile: other }] } }, { likeEvents: [{ commandFile: 'missing.txt', enabled: false }] }]) {
    assert.doesNotThrow(() => assertGameCommands(value, names, status('common')), JSON.stringify(value));
  }
  for (const commandFile of ['cod', ' cod.txt ', 'COD.txt']) assert.doesNotThrow(() => assertGameCommands({ mappings: [{ giftId: '1', commandFile }] }, names, status('common')), commandFile);
  assert.throws(() => assertGameCommands({ mappings: [{ giftId: '1', name: 'バラ', commandFile: other }] }, names, status('common')), /使えないコマンドです: game_saikutu_get_ender_pearl\.txt（ギフト割り当て（バラ））/);
});

test('大文字の拡張子（TNT.TXT）のコマンドも候補に出す（.txt は大文字小文字を問わない。2026-10-18）', () => {
  assert.ok(availableGameCommands(['TNT.TXT', 'zombie.txt'], status('common')).includes('TNT.TXT'));
});
