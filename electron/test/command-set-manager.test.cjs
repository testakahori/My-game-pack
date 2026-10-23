// TXT 作成（src/components/CommandSetManager.tsx）は、main の確かめ（bridge:commands:check）と理由を使う（処理のコピー PR8）。
// 前は名前を黙って書き換え（空白を _ に、日本語を消す）、# と // の行もコマンドとして数え、保存に失敗すると main の理由を捨てて
// ファイルをダウンロードさせ、手でフォルダーへ移すよう案内していた（main の確かめを素通りする）。既定の名前 husk.txt は標準のコマンドを黙って上書きした。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function loadTs(relative) {
  const file = path.join(root, relative);
  const compiled = new Module(file, module);
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
  return compiled.exports;
}

test('ipc のエラーの文: 「Error invoking remote method …」を除き、main の理由だけにする', () => {
  const { ipcErrorMessage } = loadTs('src/lib/ipcError.ts');
  const error = new Error("Error invoking remote method 'bridge:commands:write': Error: コマンドファイル名「ネコ.txt」は使えません");
  assert.equal(ipcErrorMessage(error), 'コマンドファイル名「ネコ.txt」は使えません');
  assert.equal(ipcErrorMessage('x'), 'x');
  for (const file of ['src/components/DashboardPage.tsx', 'src/components/InitialSetupPage.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /Error invoking remote method/, file + ' に ipc のエラーの文の整え方の写しがある');
    assert.match(source, /ipcErrorMessage/, file);
  }
});

test('TXT 作成: 確かめは main に任せ、名前を書き換えず、自分で数えない', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.doesNotMatch(source, /normalizeFileName/, '名前を黙って書き換えない');
  assert.doesNotMatch(source, /commandLines/, '# と // の行もコマンドとして数えていた');
  assert.match(source, /bridgeCommandsCheck\(/);
  assert.match(source, /bridgeCommandsWrite\(\{ filename: check\.filename/, '確かめが返した名前で書く');
});

test('TXT 作成: 保存に失敗したら main の理由を出し、ダウンロードもフォルダーを開くこともしない', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.match(source, /ipcErrorMessage\(/);
  assert.doesNotMatch(source, /bridgeCommandsOpenFolder/);
  // 定義と、アプリの外（ブラウザー）で開いたときの1か所だけ。
  assert.equal(source.split('downloadText(').length - 1, 2, '失敗したときにダウンロードしている');
});

test('TXT 作成: 同じ名前のファイルがあるときは上書きの前に聞く。既定の名前は標準のコマンドと重ならない', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.match(source, /check\.exists/);
  assert.match(source, /window\.confirm\(`\$\{check\.filename\} はもうあります。上書きしますか？`\)/);
  assert.doesNotMatch(source, /"husk\.txt"/);
  assert.match(source, /"my_husk\.txt"/);
});

test('TXT 作成: ひな形のボタンは本当の改行を入れる（前は \\ と n の2文字を入れていた）', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.equal(source.includes('\\\\n'), false, 'ひな形にバックスラッシュ2つと n がある');
});
