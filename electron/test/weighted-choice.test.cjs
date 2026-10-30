// RANDOM の割り当て（# RANDOM: と # WEIGHT:）の重みの読み方と抽選は bridge/weighted_choice.cjs の1か所。
// 前は bridge/feature_engine.js の先頭にあった。演出・ゲーム性設定（FeatureEngine）を消すので、この3つだけを移した（2026-10-30）。
// 期待する値は、移す前の feature_engine.js の関数で出したもの。
const test = require('node:test');
const assert = require('node:assert/strict');
const { weightOf, parseWeightedList, chooseWeighted } = require('../../bridge/weighted_choice.cjs');

test('重みの読み方（weightOf）: 有限の数だけ使い、1未満・数でない値・無限は 1。上限は無い', () => {
  assert.deepEqual([0, 0.5, 1, 2.5, 100, 500, -3, 'x', '', null, undefined, '7', Infinity, NaN, '1e3'].map(weightOf),
    [1, 1, 1, 2.5, 100, 500, 1, 1, 1, 1, 1, 7, 1, 1, 1000]);
});

test('候補の一覧（parseWeightedList）: , で分け、= か * のあとを重みとして読む。重みを書いたかも返す', () => {
  assert.deepEqual(parseWeightedList('heal.txt*1,tnt.txt*9'),
    [{ commandFile: 'heal.txt', weight: 1, explicitWeight: true }, { commandFile: 'tnt.txt', weight: 9, explicitWeight: true }]);
  assert.deepEqual(parseWeightedList('zombie.txt=abc, cod.txt=-5, heal.txt'), [{ commandFile: 'zombie.txt', weight: 1, explicitWeight: true },
    { commandFile: 'cod.txt', weight: 1, explicitWeight: true }, { commandFile: 'heal.txt', weight: 1, explicitWeight: false }]);
  assert.deepEqual(parseWeightedList(' a.txt = 3 , , b , c*0.5'), [{ commandFile: 'a.txt', weight: 3, explicitWeight: true },
    { commandFile: 'b', weight: 1, explicitWeight: false }, { commandFile: 'c', weight: 1, explicitWeight: true }]);
  assert.deepEqual(parseWeightedList('x.txt*2*3'), [{ commandFile: 'x.txt', weight: 2, explicitWeight: true }]);
  assert.deepEqual([parseWeightedList(''), parseWeightedList(null), parseWeightedList(undefined)], [[], [], []]);
});

test('抽選（chooseWeighted）: 重みの割合で選ぶ。空なら null、重みの合計が 0 や数でなければ先頭', () => {
  const items = parseWeightedList('a.txt*1,b.txt*3,c.txt*6');
  assert.deepEqual([0, 0.05, 0.1, 0.3999, 0.4, 0.99, 0.999999].map(r => chooseWeighted(items, () => r).commandFile),
    ['a.txt', 'a.txt', 'b.txt', 'b.txt', 'c.txt', 'c.txt', 'c.txt']);
  assert.equal(chooseWeighted([]), null);
  assert.equal(chooseWeighted([{ commandFile: 'z', weight: 0 }], () => 0.5).commandFile, 'z');
  assert.equal(chooseWeighted([{ commandFile: 'p', weight: NaN }, { commandFile: 'q', weight: 1 }], () => 0.5).commandFile, 'p');
  assert.ok(['a.txt', 'b.txt', 'c.txt'].includes(chooseWeighted(items).commandFile), '既定は Math.random');
});
