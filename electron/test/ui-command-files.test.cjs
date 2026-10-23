// 画面のコマンドの探し方（.txt の有無・大文字小文字を問わない）は src/lib/commandFiles.ts の1か所（処理のコピー PR8）。
// 画面（TypeScript）からは bridge の CJS を読まないので、bridge/command_files.cjs の写しになる。食い違えばここで落ちる（integerInput.ts と同じ形）。
// 前は画像作成・ギフト設定の一覧・ルーレットの項目などが === で探し、手で書いた Neko.TXT や neko（.txt なし）の割り当てに題名が出なかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const bridge = require('../../bridge/command_files.cjs');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'src/lib/commandFiles.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const ui = compiled.exports;

// フォルダー付きの名前も入れる（commandFileStem は bridge の bridgeCommandStem と同じくフォルダーを除かない。PR8 の最後のレビュー）。
const values = ['a', ' A.TXT ', 'tnt.v2', '', 0, null, undefined, 'foo.txt.txt', 'Neko.TXT', 'neko', 'neko.txt', 'ネコ.txt', '.txt', 'roulette', 'a/b.txt', 'a\\b.txt', '　neko　'];

test('画面のコマンドの探し方: bridge/command_files.cjs と同じ例で同じ結果', () => {
  for (const value of values) {
    assert.equal(ui.ensureTxt(value), bridge.ensureTxt(value), JSON.stringify(value));
    assert.equal(ui.commandFileStem(ui.ensureTxt(value)), bridge.bridgeCommandStem(bridge.ensureTxt(value)), JSON.stringify(value));
    for (const other of values) assert.equal(ui.sameCommandFile(value, other), bridge.sameCommandFile(value, other), JSON.stringify([value, other]));
  }
});

test('画面のコマンドの探し方: findCommandFile は .txt の有無・大文字小文字を問わずに見つける', () => {
  const list = [{ name: 'neko.txt', title: 'ネコ' }, { name: 'inu.txt', title: 'イヌ' }];
  assert.equal(ui.findCommandFile(list, 'Neko.TXT')?.title, 'ネコ');
  assert.equal(ui.findCommandFile(list, 'neko')?.title, 'ネコ');
  assert.equal(ui.findCommandFile(list, 'saru'), undefined);
  assert.equal(ui.findCommandFile(list, ''), undefined);
});

test('画面のコマンドの探し方: 画面は自分の探し方とルーレットの判定を持たない', () => {
  const copies = [
    /replace\(\/\\\.txt\$\/i/, /endsWith\(["']\.txt["']\)/, /[!=]==\s*["']roulette\.txt["']/,
    /f\.name === value/, /file\.name === v\b/, /c\.name === m\.commandFile/, /titleMap\[/,
  ];
  for (const name of ['ImageEditorPage.tsx', 'MappingEditor.tsx', 'EventSettings2Page.tsx', 'EventSettingsPage.tsx', 'CommandsListPage.tsx']) {
    const source = fs.readFileSync(path.join(root, 'src/components', name), 'utf8');
    for (const copy of copies) assert.doesNotMatch(source, copy, `${name} に写しが残っている（${copy}）`);
  }
  // ルーレットは main が付けた印（bridge/command_rows.cjs の roulette）で除く。
  for (const name of ['CommandsListPage.tsx', 'EventSettings2Page.tsx']) {
    assert.match(fs.readFileSync(path.join(root, 'src/components', name), 'utf8'), /!\w+\.roulette\b/, name);
  }
});
