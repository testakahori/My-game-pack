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
  const examples = [{ mappings: [file] }, { likeEvents: [file] }, { roulette: { items: [file] } }, { deathRoulette: { items: [file] } }, { commentGifts: { rules: [file] } }, ...['shareEvent','followEvent','memberEvent','unmappedGiftEvent'].map(key => ({ [key]: file })), { options: { gameplay: { likeMilestones: [file], combo: { levels: [file] } } } }];
  for (const value of examples) {
    assert.throws(() => assertGameCommands(value, names, status('common')), /使えないコマンド/);
    assert.doesNotThrow(() => assertGameCommands({ ...value, gameProfile: 'saikutu' }, names, status('saikutu')));
  }
});
test('ゲーム切替前の画面からの保存・移行前の旧コマンド・存在しないファイルを拒否する', () => {
  assert.throws(() => assertGameCommands({ gameProfile: 'common' }, names, status('saikutu')), /切り替わっています/);
  for (const commandFile of ['get_ender_pearl.txt','missing.txt','_gamerules.txt','../cod.txt']) assert.throws(() => assertGameCommands({ gameProfile: 'saikutu', commandFile }, names, status('saikutu')));
});
