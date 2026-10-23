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
  assert.match(source, /saveCommandDraft\(/, '保存の決め方は src/lib/commandDraft.ts');
});

// 保存の決め方（上書きを聞く・書く・理由を出す）は src/lib/commandDraft.ts の saveCommandDraft。動きを通して確かめる（PR8 の最後のレビュー）。
function loadLib(relative) {
  const file = path.join(root, 'src/lib', relative);
  const { outputFiles } = require('esbuild').buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}
const draftCheck = (extra = {}) => ({ filename: 'husk.txt', commands: ['say x'], problems: [], exists: false, ...extra });

test('TXT 作成の保存: 同じ名前があれば聞き、やめたら書かない', async () => {
  const { saveCommandDraft } = loadLib('commandDraft.ts');
  const asked = [], written = [];
  const result = await saveCommandDraft({ check: draftCheck({ exists: true }), content: 'say x', confirm: message => { asked.push(message); return false; }, write: async request => { written.push(request); } });
  assert.deepEqual(asked, ['husk.txt はもうあります。上書きしますか？']);
  assert.deepEqual(written, [], 'やめたのに書いた');
  assert.equal(result.type, 'canceled');
  const yes = await saveCommandDraft({ check: draftCheck({ exists: true }), content: 'say x', confirm: () => true, write: async request => { written.push(request); } });
  assert.deepEqual(written, [{ filename: 'husk.txt', content: 'say x' }], '確かめが返した名前で書く');
  assert.equal(yes.type, 'ok');
});

test('TXT 作成の保存: 書けたら、もうある名前として扱う（続けて押すと上書きを聞く）', async () => {
  const { saveCommandDraft } = loadLib('commandDraft.ts');
  const asked = [];
  const first = await saveCommandDraft({ check: draftCheck({ filename: 'my_husk.txt' }), content: 'say x', confirm: message => { asked.push(message); return true; }, write: async () => {} });
  assert.deepEqual(asked, [], '新しい名前では聞かない');
  assert.deepEqual([first.type, first.text, first.check.exists], ['ok', '保存しました: bridge/commands/minecraft/my_husk.txt', true]);
  await saveCommandDraft({ check: first.check, content: 'say x', confirm: message => { asked.push(message); return false; }, write: async () => { throw new Error('書いてはいけない'); } });
  assert.deepEqual(asked, ['my_husk.txt はもうあります。上書きしますか？'], '前は保存のあとも「ない」のままで、聞かずに上書きした');
});

test('TXT 作成の保存: main が断ったら理由を出す。書く機能が無ければそう言う（ダウンロードはしない）', async () => {
  const { saveCommandDraft } = loadLib('commandDraft.ts');
  const rejected = await saveCommandDraft({ check: draftCheck(), content: 'say x', confirm: () => true,
    write: async () => { throw new Error("Error invoking remote method 'bridge:commands:write': Error: ゲームパックのコマンドはパックを再登録して更新してください"); } });
  assert.deepEqual([rejected.type, rejected.text], ['error', '保存できませんでした: ゲームパックのコマンドはパックを再登録して更新してください']);
  const noWriter = await saveCommandDraft({ check: draftCheck(), content: 'say x', confirm: () => true, write: undefined });
  assert.deepEqual([noWriter.type, noWriter.text], ['error', 'この画面では保存できません。アプリの中で開いてください']);
});

test('TXT 作成: 保存に失敗してもダウンロードもフォルダーを開くこともせず、確かめの結果は待つ間も出したまま', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.doesNotMatch(source, /bridgeCommandsOpenFolder|downloadText/);
  assert.doesNotMatch(source, /setCheck\(null\)/, '入力のたびに結果を消すと、問題の枠や保存ボタンがちらつく');
  assert.match(source, /!checking/, '確かめを待つ間は保存できない');
  assert.match(source, /この画面では TXT を確かめられません。アプリの中で開いてください/, '確かめの機能が無いときに理由を出す');
  assert.match(source, /confirm: \(message: string\) => window\.confirm\(message\)/);
});

test('TXT 作成: 既定の名前は標準のコマンドと重ならない', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.doesNotMatch(source, /"husk\.txt"/);
  assert.match(source, /"my_husk\.txt"/);
});

test('TXT 作成: ひな形のボタンは本当の改行を入れる（前は \\ と n の2文字を入れていた）', () => {
  const source = read('src/components/CommandSetManager.tsx');
  assert.equal(source.includes('\\\\n'), false, 'ひな形にバックスラッシュ2つと n がある');
});

// 開発用のブラウザー表示は、確かめに失敗したときも理由を捨てない（PR8 の最後のレビュー）。
test('開発用の表示: TXT の確かめの失敗の理由を出す', () => {
  const mock = read('src/lib/devApiMock.ts');
  const check = mock.slice(mock.indexOf('bridgeCommandsCheck:'), mock.indexOf('bridgeCommandsOpenFolder:'));
  assert.match(check, /\.message/, '500 の返事の message を捨てている');
});
