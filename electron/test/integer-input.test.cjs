// 画面の回数と閾値の入力欄は整数だけを受け付ける（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7）。
// 丸め方は src/lib/integerInput.ts の1か所。保存済みの設定を更新のときに直す式（bridge/config_migration.cjs）と同じ結果になる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const { migrateBridgeConfig } = require('../../bridge/config_migration.cjs');
const file = path.resolve(__dirname, '../../src/lib/integerInput.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const { toRepeat, toThreshold, toWeight } = compiled.exports;

// ルーレットの項目の重みは上限なし（BRIDGE も上限が無い。強さの上限は設けない方針。処理のコピー PR9）。読み込みの式は BRIDGE の weightOf と同じ。
// 前は読み込みで数でない値が NaN になり、入力では 100 に丸めていた（保存済みの 500 は 500 のまま出た）。
test('ルーレットの重み: BRIDGE の weightOf と同じ値の一覧で同じ結果', () => {
  const { weightOf } = require('../../bridge/feature_engine.js');
  for (const value of [0, 0.5, 1, 2.5, 100, 500, -3, 'x', '', null, undefined, '7']) assert.equal(toWeight(value), weightOf(value), String(value));
});

// デスルーレットの「何回死ぬごと」の丸め方も BRIDGE（event_rules.cjs の deathRouletteEvery）と同じ（前の画面は小数のまま・文字は NaN）。
test('デスルーレットの何回死ぬごと: BRIDGE の deathRouletteEvery と同じ値の一覧で同じ結果', () => {
  const { deathRouletteEvery } = require('../../bridge/event_rules.cjs');
  const { toEveryDeaths } = compiled.exports;
  for (const value of [1, 2.9, 0, -5, 1001, 'x', '', '4', null, undefined]) assert.equal(toEveryDeaths(value, 3), deathRouletteEvery({ everyDeaths: value }), String(value));
});

test('入力欄の回数と閾値: 整数に丸める（保存済みの設定の直しと同じ式）', () => {
  assert.deepEqual([2.5, '3', 500, -1, 'x', 0, '', null].map(toRepeat), [3, 3, 100, 1, 1, 1, 1, 1]);
  assert.deepEqual([0, -5, 99.6, 'x', '', 2000000].map(toThreshold), [1, 1, 100, 1, 1, 2000000]);
});

// 画面（TypeScript）からは bridge の CJS を読まないので式は写しになる。食い違えばここで落ちる。
test('入力欄の回数と閾値: 保存済みの設定を直す式（config_migration.cjs）と同じ値の一覧で同じ結果', () => {
  const values = [2.5, 1.5, 0.5, '3', ' 7 ', 500, 101, 100, 1, 0, -1, -0.4, 'x', true, 99.5, 1e9];
  const migrated = migrateBridgeConfig({ likeEvents: values.map(value => ({ repeat: value, threshold: value })) }).config.likeEvents;
  assert.deepEqual(values.map(toRepeat), migrated.map(ev => ev.repeat));
  assert.deepEqual(values.map(toThreshold), migrated.map(ev => ev.threshold));
});

test('入力欄の回数と閾値: 画面は自分の丸め方を持たず integerInput を使う', () => {
  const root = path.resolve(__dirname, '../../src/components');
  const files = ['EventSettingsPage.tsx', 'EventSettings2Page.tsx', 'MappingEditor.tsx', 'GiftSettingsPage.tsx', 'DashboardPage.tsx'];
  for (const name of files) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    // 回数・閾値だけを見る（ルーレットの重み・デスルーレットの回数ごとは別の値）。
    for (const copy of [/repeat: Math\.(min|max)\(/, /onRepeatChange\(Math\./, /threshold: Number\(e\.target\.value\) \|\| 1/, /clampRepeat/]) {
      assert.doesNotMatch(source, copy, `${name} に回数・閾値の丸め方の写しが残っている（${copy}）`);
    }
    // ギフト設定の画面は、設定との出し入れ（src/lib/giftMappingRows.ts）を通して integerInput を使う（処理のコピー PR5）。
    assert.match(source, /from ["']\.\.\/lib\/(integerInput|giftMappingRows)["']/, `${name} が integerInput を使っていない`);
  }
  const rows = fs.readFileSync(path.resolve(__dirname, '../../src/lib/giftMappingRows.ts'), 'utf8');
  assert.match(rows, /from ["']\.\/integerInput["']/, 'giftMappingRows.ts が integerInput を使っていない');
  for (const copy of [/repeat: Math\.(min|max)\(/, /clampRepeat/]) assert.doesNotMatch(rows, copy, `giftMappingRows.ts に回数の丸め方の写しが残っている（${copy}）`);
});
