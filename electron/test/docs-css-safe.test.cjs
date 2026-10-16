// Tailwind（npm run build）は、src/index.css が読む範囲を絞っていないので、git が追跡しているファイル全体からクラス名の候補を拾う。
// どこかに「\ のあとに 16進数」（Windows の場所など）があると CSS の文字コードとして読まれ、
// Unicode の範囲（0x10FFFF）を超えるとビルドが止まる（2026-10-17、計画書に書いた scratchpad の場所で起きた）。
// 読む範囲を絞る（src/index.css の source()）までは、追跡しているテキストファイル全体をここで確かめる（PR1 の最終レビュー M1）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');

test('追跡しているテキストファイルに、CSS で読めない「\\ + 16進数」（0x10FFFF を超える文字コード）を書かない', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const bad = [];
  for (const file of files) {
    let buf;
    try { buf = fs.readFileSync(path.join(root, file)); } catch { continue; }
    if (buf.includes(0)) continue; // 画像などの文字でないファイルは見ない
    for (const match of buf.toString('utf8').matchAll(/\\([0-9a-fA-F]{1,6})/g)) {
      if (parseInt(match[1], 16) > 0x10ffff) bad.push(`${file}: \\${match[1]}`);
    }
  }
  assert.deepEqual(bad, [], 'Windows の場所は / 区切りで書くか、16進数の前の \\ を避ける');
});
