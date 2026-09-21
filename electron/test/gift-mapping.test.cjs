const test = require('node:test');
const assert = require('node:assert/strict');
const { updateGiftMapping } = require('../gift_mapping.cjs');
const old = { giftId: 5655, name: 'バラ', commandFile: 'heal.txt', repeat: 1, custom: 'keep' };
const other = { giftId: '99', commandFile: 'tnt.txt', repeat: 2 };
const config = { tiktokUsername: 'sample', rcon: { password: 'test' }, options: { feature: true }, mappings: [old, other] };
const request = { giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 50, expected: [old] };
const commands = ['heal.txt', 'zombie.txt'];

test('editing one gift preserves current unrelated settings, gifts, order and custom fields', () => {
  const latest = structuredClone(config);
  latest.options.feature = false;
  latest.mappings[1].repeat = 30;
  const next = updateGiftMapping(latest, request, commands);
  assert.deepEqual(next, { ...latest, mappings: [{ ...old, giftId: '5655', commandFile: 'zombie.txt', repeat: 50 }, latest.mappings[1]] });
  assert.equal(latest.mappings[0].commandFile, 'heal.txt');
});
test('a stale or deleted gift must not silently overwrite newer settings', () => {
  assert.throws(() => updateGiftMapping({ ...config, mappings: [{ ...old, repeat: 4 }, other] }, request, commands), /別の操作/);
  assert.throws(() => updateGiftMapping({ ...config, mappings: [other] }, request, commands), /別の操作/);
  assert.throws(() => updateGiftMapping(config, { ...request, expected: undefined }, commands), /別の操作/);
});
test('new assignment appends once, and concurrent registration is rejected', () => {
  const add = { ...request, giftId: 'new', expected: [] };
  const next = updateGiftMapping(config, add, commands);
  assert.equal(next.mappings.length, 3);
  assert.deepEqual(next.mappings.slice(0, 2), config.mappings);
  assert.throws(() => updateGiftMapping(next, add, commands), /別の操作/);
});
test('duplicate gift registrations require cleanup rather than editing an arbitrary row', () => {
  const duplicate = { ...config, mappings: [old, { ...old }] };
  assert.throws(() => updateGiftMapping(duplicate, { ...request, expected: duplicate.mappings }, commands), /重複/);
});
test('invalid repeats and unavailable commands cannot be saved', () => {
  for (const repeat of [0, 101, 1.5, NaN, '2', null]) assert.throws(() => updateGiftMapping(config, { ...request, repeat }, commands), /整数/);
  for (const commandFile of ['missing.txt', '../heal.txt', '_internal.txt', null]) assert.throws(() => updateGiftMapping(config, { ...request, commandFile }, commands), /見つかりません/);
  for (const repeat of [1, 100]) assert.equal(updateGiftMapping(config, { ...request, repeat }, commands).mappings[0].repeat, repeat);
});
