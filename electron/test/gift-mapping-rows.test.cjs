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
const { fromConfigMappings, toConfigMappings, isDisabledMapping, disabledGiftIds, DISABLED_MAPPING_MARK, mappingGiftName } = loadLib('giftMappingRows.ts');

// 画像作成のカードのギフト名（PR8 の最後のレビュー）。名前が空か giftId と同じ（名前を書かずに保存した割り当て）なら、カタログのギフト名を使う。
// 前は fromConfigMappings が空の名前を giftId で埋めるので、手で書いた名前の無い割り当てのカードに「Rose」でなく「5655」と出た。
test('画像作成のカードのギフト名: 名前が無ければカタログの名前', () => {
  assert.equal(mappingGiftName({ giftId: '5655', name: '5655' }, 'Rose'), 'Rose');
  assert.equal(mappingGiftName({ giftId: '5655', name: '' }, 'Rose'), 'Rose');
  assert.equal(mappingGiftName({ giftId: '5655', name: 'バラ' }, 'Rose'), 'バラ');
  assert.equal(mappingGiftName({ giftId: '5655', name: '' }, undefined), '5655');
});

// 無効の割り当て（手で書いた enabled: false）は、画面に「無効（動きません）」の印を出す（2026-10-23 ユーザーの決定。処理のコピー PR8）。
test('無効の割り当て: 印の文と、無効のギフトの見分け方', () => {
  assert.equal(DISABLED_MAPPING_MARK, '無効（動きません）');
  assert.equal(isDisabledMapping({ enabled: false }), true);
  assert.equal(isDisabledMapping({}), false);
  assert.equal(isDisabledMapping({ enabled: true }), false);
  assert.equal(isDisabledMapping(null), false);
  assert.deepEqual(disabledGiftIds([{ giftId: ' 5655 ', enabled: false }, { giftId: '1' }, { giftId: '2', enabled: true }]), new Set(['5655']));
});

// 編集画面で無効の割り当てのコマンドを変えて保存しても、無効のまま（GiftSettingsPage の updateMapping と同じ形でまぜる）。
test('無効の割り当て: コマンドを変えて保存しても enabled:false が残る', () => {
  const [row] = fromConfigMappings({ mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'a.txt', repeat: 1, enabled: false }] }, () => 'id');
  const updated = { ...row, ...{ giftId: '5655', name: 'バラ', commandFile: 'heal.txt', repeat: 2, commandSetLabel: 'heal.txt' } };
  assert.deepEqual(toConfigMappings([updated]), [{ giftId: '5655', name: 'バラ', commandFile: 'heal.txt', repeat: 2, enabled: false }]);
});

test('ギフト設定の画面: 設定から読んで書き戻しても enabled:false を落とさない', () => {
  const rows = fromConfigMappings({ mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: 2, enabled: false }, { giftId: '2', name: '', commandFile: 'b.txt' }, { giftId: ' ' }] }, () => 'id');
  assert.equal(rows.length, 2, 'giftId の無い行は出さない');
  assert.deepEqual(toConfigMappings(rows), [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: 2, enabled: false }, { giftId: '2', name: '2', commandFile: 'b.txt', repeat: 1 }]);
});

// 実際に使うギフト設定の画面（一覧・カタログ・MappingEditor）は、この行の giftId で同じギフトかを決める（PR5 の最終レビュー）。
// 空白の付いた保存済みの " 5655 " を「未設定」と出し、カタログから 5655 を選ぶと同じギフトの行がもう1行できていた。
test('ギフト設定の画面: giftId の前後の空白を除いて読み、書くときも除く', () => {
  const rows = fromConfigMappings({ mappings: [{ giftId: ' 5655 ', name: 'バラ', commandFile: 'a.txt', repeat: 1 }] }, () => 'id');
  assert.equal(rows[0].giftId, '5655');
  assert.equal(rows[0].name, 'バラ');
  assert.equal(toConfigMappings([{ ...rows[0], giftId: ' 5655 ' }])[0].giftId, '5655');
});
