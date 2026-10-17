// main.cjs を分けたあとの行数の見張り（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md の 6）。
// main.cjs は 400 行以下、electron/ の直下のほかの .cjs は各 800 行以下。超えそうなときは、足す前に分ける（AGENTS.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LIMITS = { main: 400, other: 800 };

// wc -l と同じ数え方（改行の数。最後の行に改行がなければ1を足す）。CRLF も LF も同じ数になる。
function lineCount(text) {
  const newlines = (text.match(/\n/g) || []).length;
  return newlines + (text && !text.endsWith('\n') ? 1 : 0);
}

// dir の直下の .cjs を名前の順に見て、上限を超えたものだけを返す。下のフォルダー（test/ など）と .cjs 以外は見ない。
// ファイルの一覧は固定せず毎回読むので、新しく足したモジュールも見る。
function oversizedFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.cjs'))
    .map(entry => entry.name)
    .sort()
    .map(file => ({ file, lines: lineCount(fs.readFileSync(path.join(dir, file), 'utf8')), limit: file === 'main.cjs' ? LIMITS.main : LIMITS.other }))
    .filter(x => x.lines > x.limit);
}

test('行数の見張り: electron/main.cjs は 400 行以下、electron/ の直下のほかの .cjs は各 800 行以下', () => {
  const over = oversizedFiles(path.resolve(__dirname, '..'));
  assert.deepEqual(over, [], over.map(x => `electron/${x.file} は ${x.lines} 行（上限 ${x.limit} 行）。足す前に、仕事ごとのファイルに分けてください（AGENTS.md）。`).join('\n'));
});

test('行数の見張り: 数え方は wc -l と同じ（CRLF・最後の改行なしも）。上限ちょうどは通し、超えたファイルだけを名前の順に出す。下のフォルダーと .cjs 以外は見ない', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-size-limits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lines = (n, eol = '\r\n', last = true) => Array.from({ length: n }, (_, i) => `// ${i}`).join(eol) + (last ? eol : '');
  assert.equal(lineCount(lines(3)), 3);
  assert.equal(lineCount(lines(3, '\n')), 3);
  assert.equal(lineCount(lines(3, '\r\n', false)), 3);
  assert.equal(lineCount(''), 0);
  fs.writeFileSync(path.join(dir, 'main.cjs'), lines(401));
  fs.writeFileSync(path.join(dir, 'big.cjs'), lines(801, '\n', false));
  fs.writeFileSync(path.join(dir, 'edge.cjs'), lines(800));
  fs.writeFileSync(path.join(dir, 'new_module.cjs'), lines(900));
  fs.writeFileSync(path.join(dir, 'notes.md'), lines(5000));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'huge.test.cjs'), lines(5000));
  assert.deepEqual(oversizedFiles(dir), [
    { file: 'big.cjs', lines: 801, limit: 800 },
    { file: 'main.cjs', lines: 401, limit: 400 },
    { file: 'new_module.cjs', lines: 900, limit: 800 },
  ]);
  fs.writeFileSync(path.join(dir, 'main.cjs'), lines(400));
  assert.equal(oversizedFiles(dir).some(x => x.file === 'main.cjs'), false, '400 行ちょうどは通す');
});
