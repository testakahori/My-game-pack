// 無効のギフト割り当て（設定ファイルで enabled: false）に「無効（動きません）」の印を出す（2026-10-23 ユーザーの決定。処理のコピー PR8）。
// 出す所：ギフト設定の一覧（登録済みのカード）とカタログ（タイル）・画像作成・ギフト設定の編集。画面での切り替えは作らない。
// 前は無効の割り当ても普通の割り当てと同じに見え、ギフトが来ても動かない理由が画面から分からなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const React = require('react');
const { renderToString } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

// MappingEditor は保存していない変更の見張り（UnsavedChangesProvider）の中でしか描けない。同じ束にまとめ、同じ context を使う。
function loadMappingEditor() {
  const contents = "export { default as MappingEditor } from './components/MappingEditor'; export { UnsavedChangesProvider } from './UnsavedChanges';";
  const { outputFiles } = buildSync({ stdin: { contents, resolveDir: path.join(root, 'src'), loader: 'tsx', sourcefile: 'mapping-editor-entry.tsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', jsx: 'automatic', external: ['react', 'react-dom'], logLevel: 'silent' });
  const file = path.join(root, 'src/mapping-editor-entry.cjs');
  const compiled = new Module(file, module);
  compiled.paths = Module._nodeModulePaths(path.join(root, 'src'));
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}

const row = (giftId, extra = {}) => ({ id: 'row-' + giftId, giftId, name: 'ギフト' + giftId, commandFile: 'heal.txt', repeat: 1, commandSetLabel: 'heal.txt', ...extra });
const count = (html, text) => html.split(text).length - 1;

test('ギフト設定の一覧と編集: 無効の割り当てのカードと、編集中の無効のギフトに印を出す', () => {
  globalThis.window = { mygamepack: {}, addEventListener() {}, removeEventListener() {} };
  const { MappingEditor, UnsavedChangesProvider } = loadMappingEditor();
  const render = props => renderToString(React.createElement(UnsavedChangesProvider, null, React.createElement(MappingEditor, props)));
  const mappings = [row('5655', { enabled: false }), row('1')];
  const html = render({ mappings, defaultGiftId: '5655', defaultGiftName: 'バラ' });
  assert.equal(count(html, '無効（動きません）'), 2, '登録済みのカード（無効の1つ）と、編集中のギフト');
  assert.match(html, /保存しても無効のままです/);
  const enabledOnly = render({ mappings: [row('1')], defaultGiftId: '1' });
  assert.equal(count(enabledOnly, '無効（動きません）'), 0);
  assert.doesNotMatch(enabledOnly, /保存しても無効のままです/);
});

test('カタログ・プレビュー・画像作成: 無効の割り当てに印を出し、パネルの絵には描かない', () => {
  for (const file of ['src/components/GiftsGridSection.tsx', 'src/components/GiftSettingsPage.tsx', 'src/components/ImageEditorPage.tsx']) {
    const source = read(file);
    assert.match(source, /<DisabledMappingMark\b/, file + ' が印を出していない');
    assert.match(source, /isDisabledMapping\(|disabledGiftIds\(/, file + ' が無効の見分け方を使っていない');
  }
  assert.match(read('src/components/GiftsGridSection.tsx'), /<DisabledMappingMark compact/, 'カタログのタイルは小さい印');
  assert.match(read('src/components/ImageEditorPage.tsx'), /fromConfigMappings\(/, '画像作成も割り当てを同じ形で読む（giftId の空白を除き、enabled を落とさない）');
  for (const file of ['src/lib/giftPanel.ts', 'src/lib/giftPanelCanvas.ts']) {
    assert.doesNotMatch(read(file), /DisabledMappingMark|DISABLED_MAPPING_MARK|無効（動きません）/, file + '（パネルの絵）に印を描かない');
  }
  const mark = read('src/components/DisabledMappingMark.tsx');
  assert.match(mark, /DISABLED_MAPPING_HINT/, 'マウスを載せると、設定ファイルで直す方法が出る');
  assert.match(read('src/lib/giftMappingRows.ts'), /enabled: false を消してください/);
});
