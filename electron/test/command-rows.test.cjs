// コマンドの一覧の1行は bridge/command_rows.cjs の1か所で作る（処理のコピー PR8）。
// アプリ（bridge:commands:readMeta・list）と開発用のブラウザー表示（vite.config.ts）が同じ関数を使い、画面は写しを持たずに印を見る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { commandListRow, checkCommandDraft } = require('../../bridge/command_rows.cjs');
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

// TXT 作成（画面の CommandSetManager）の確かめは main がこの関数で行い、画面は結果を出すだけ（処理のコピー PR8）。
// 前は画面が # と // の行もコマンドとして数え、COOLDOWN・WEIGHT を BRIDGE と違う決まりで確かめ、名前を黙って書き換えていた。
const draft = (filename, content, existingNames = []) => checkCommandDraft({ filename, content, existingNames });

test('TXT 作成の確かめ: 正しい中身は問題なし。名前は .txt を付けるだけ', () => {
  assert.deepEqual(draft(' neko ', '# TITLE: ネコ\n# COOLDOWN: 60000\n# WEIGHT: 2.5\n# SOUND: entity.player.levelup\nsay hi\n'),
    { filename: 'neko.txt', commands: ['say hi'], problems: [], exists: false });
  assert.equal(draft('neko', 'say hi', ['NEKO.TXT']).exists, true, '同じ名前（大文字小文字を問わない）があれば上書きになる');
  assert.equal(draft('neko', 'say hi', ['neko2.txt']).exists, false);
});

test('TXT 作成の確かめ: 名前の問題', () => {
  assert.deepEqual(draft('', 'say hi').problems, ['ファイル名を入力してください']);
  assert.deepEqual(draft('game_saikutu_dig', 'say hi').problems, ['ゲームパックのコマンドはパックを再登録して更新してください']);
  assert.match(draft('ネコ', 'say hi').problems[0], /ネコ\.txt.*半角英数字/);
  assert.match(draft('foo.txt.txt', 'say hi').problems[0], /\.txt が2つあります。ファイル名を foo\.txt に直してください/);
  // TXT 作成ではアプリの欄に名前を打つので、エクスプローラーの話は出さない（PR8 の最後のレビュー）。ほかの所（一覧の印など）では出す。
  assert.doesNotMatch(draft('foo.txt.txt', 'say hi').problems[0], /エクスプローラー/);
  assert.match(require('../../bridge/command_files.cjs').commandFileProblem('foo.txt.txt'), /エクスプローラー/);
});

test('TXT 作成の確かめ: コマンドの行と見出しの問題（BRIDGE と BridgeMOD が使う決まり）', () => {
  assert.deepEqual(draft('a', '# TITLE: x\n// メモ\n').problems, ['コマンドの行がありません（# と // で始まる行はコマンドになりません）']);
  for (const value of ['0.5', '-1', '60001', 'x']) {
    assert.deepEqual(draft('a', `# COOLDOWN: ${value}\nsay hi`).problems, ['# COOLDOWN は 0〜60000 の整数（ミリ秒）にしてください'], value);
  }
  for (const value of ['0.5', 'x']) {
    assert.deepEqual(draft('a', `# WEIGHT: ${value}\nsay hi`).problems, ['# WEIGHT は 1 以上の数にしてください'], value);
  }
  assert.deepEqual(draft('a', '# SOUND: a:b:c\nsay hi').problems, ['# SOUND「a:b:c」は音の ID として正しくありません（例: entity.experience_orb.pickup）']);
  assert.deepEqual(draft('a', '# PARTICLE: Minecraft:flame\nsay hi').problems, ['# PARTICLE「Minecraft:flame」は粒子の ID として正しくありません（例: minecraft:happy_villager）']);
  assert.deepEqual(draft('a', '# COOLDOWN: 0\nsay hi').problems, []);
});
