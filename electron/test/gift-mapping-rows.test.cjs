// ギフト設定の画面が設定（config.minecraft.json）の割り当てを読み書きする形（src/lib/giftMappingRows.ts）。
// 手で書いた enabled: false を、読み込みと保存のたびに落とさない（2026-10-18 設計書の 10。処理のコピー PR5）。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

// src/lib の読み込みごと1ファイルにまとめて読む（ui-safety.test.cjs の loadComponent と同じ）。
function loadLib(relative) {
  const file = path.resolve(__dirname, '../../src/lib', relative);
  const { outputFiles } = buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}
const { fromConfigMappings, toConfigMappings } = loadLib('giftMappingRows.ts');

test('ギフト設定の画面: 設定から読んで書き戻しても enabled:false を落とさない', () => {
  const rows = fromConfigMappings({ mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: 2, enabled: false }, { giftId: '2', name: '', commandFile: 'b.txt' }, { giftId: ' ' }] }, () => 'id');
  assert.equal(rows.length, 2, 'giftId の無い行は出さない');
  assert.deepEqual(toConfigMappings(rows), [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: 2, enabled: false }, { giftId: '2', name: '2', commandFile: 'b.txt', repeat: 1 }]);
});
