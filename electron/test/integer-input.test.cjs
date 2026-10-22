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
const { toRepeat, toThreshold } = compiled.exports;

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
    assert.match(source, /from ["']\.\.\/lib\/integerInput["']/, `${name} が integerInput を使っていない`);
  }
});
