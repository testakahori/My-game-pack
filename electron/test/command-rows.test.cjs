// コマンドの一覧の1行は bridge/command_rows.cjs の1か所で作る（処理のコピー PR8）。
// アプリ（bridge:commands:readMeta・list）と開発用のブラウザー表示（vite.config.ts）が同じ関数を使い、画面は写しを持たずに印を見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { commandListRow } = require('../../bridge/command_rows.cjs');
const { sameCommandFile } = require('../../bridge/command_files.cjs');

test('コマンドの一覧の1行: 題名・分類・説明文・チャットの名前', () => {
  assert.deepEqual(commandListRow('neko.txt', '# TITLE: ネコ\n# CATEGORY: 妨害\n// 説明\nsay hi\n'),
    { name: 'neko.txt', title: 'ネコ', category: '妨害', description: '説明', chatKey: 'neko' });
});

test('コマンドの一覧の1行: ルーレットは大文字小文字を問わず印を付ける（前は画面が === "roulette.txt" で除いていた）', () => {
  const row = commandListRow('Roulette.TXT', '# TITLE: くじ\n');
  assert.equal(row.roulette, true);
  assert.equal(row.title, 'くじ');
  assert.equal('roulette' in commandListRow('roulette2.txt', ''), false);
});

test('コマンドの一覧の1行: 使えない名前には印と直し方の文。読めなければ題名は名前', () => {
  const row = commandListRow('foo.txt.txt', null);
  assert.equal(row.invalidName, true);
  assert.match(row.invalidReason, /\.txt が2つあります/);
  assert.equal(row.title, 'foo.txt.txt');
  assert.deepEqual([row.category, row.description], ['', '']);
});

test('同じコマンドファイルか: .txt の有無・大文字小文字・前後の空白を問わない', () => {
  assert.equal(sameCommandFile('Neko.TXT', 'neko'), true);
  assert.equal(sameCommandFile(' neko.txt ', 'NEKO.txt'), true);
  assert.equal(sameCommandFile('neko', 'neko2'), false);
  assert.equal(sameCommandFile('', ''), false);
  assert.equal(sameCommandFile(null, undefined), false);
});
