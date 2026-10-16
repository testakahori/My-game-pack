// Tailwind（npm run build）は、リポジトリの文書からもクラス名の候補を拾う。
// 文書に「\ のあとに 16進数」（Windows の場所など）があると CSS の文字コードとして読まれ、
// Unicode の範囲（0x10FFFF）を超えるとビルドが止まる（2026-10-17、計画書に書いた scratchpad の場所 \2ce3430a… で起きた）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
function markdownFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith('.md') ? [full] : [];
  });
}

test('文書に、CSS で読めない「\\ + 16進数」（0x10FFFF を超える文字コード）を書かない', () => {
  const files = [...markdownFiles(path.join(root, 'docs')), ...markdownFiles(path.join(root, 'HANDOFF')),
    ...fs.readdirSync(root).filter(name => name.endsWith('.md')).map(name => path.join(root, name))];
  const bad = [];
  for (const file of files) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/\\([0-9a-fA-F]{1,6})/g)) {
      if (parseInt(match[1], 16) > 0x10ffff) bad.push(`${path.relative(root, file)}: \\${match[1]}`);
    }
  }
  assert.deepEqual(bad, [], '場所は / 区切りで書くか、16進数の前の \\ を避ける');
});
