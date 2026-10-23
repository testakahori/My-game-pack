// コマンド txt の見出し行（# TITLE: など）の読み方は1つ（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 5）。
// 例の一覧は bridge/test/fixtures/command-text.json。BridgeMOD・SaikutuMod（Java）も scripts/test-bridge-contracts.cjs で同じ一覧に通す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCommandText, trimText } = require('../../bridge/command_text.cjs');
const root = path.resolve(__dirname, '../..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'bridge/test/fixtures/command-text.json'), 'utf8'));

test('見出し行の決まり: 例の一覧のとおりに読む（BRIDGE・アプリ・MOD で同じ）', () => {
  for (const c of cases) assert.deepEqual(parseCommandText(c.text), { meta: c.meta, commands: c.commands, description: c.description }, c.name);
});

// BOM の例は、見えない文字が消えても期待する結果が変わらない。消えたらテストが黙って通らないように、文字そのものを確かめる（PR1 の最終レビュー）。
test('見出し行の決まり: 例の一覧の BOM・全角空白・NBSP の例は、ほんとうにその文字で始まる', () => {
  const text = name => cases.find(c => c.name === name).text;
  assert.equal(text('先頭の BOM と1行目の DESTRUCTIVE').charCodeAt(0), 0xfeff);
  assert.deepEqual(Array.from(text('行頭の BOM・全角空白・NBSP と行末の全角空白').slice(0, 3), ch => ch.charCodeAt(0)), [0xfeff, 0x3000, 0xa0]);
});

test('見出し行の決まり: テストと例の一覧には、見えない文字をそのまま書かず \\u のエスケープで書く', () => {
  const invisible = new RegExp('[' + [0xfeff, 0x3000, 0xa0, 0x200b, 0x2028, 0x2029].map(code => String.fromCharCode(code)).join('') + ']');
  for (const file of ['bridge/test/fixtures/command-text.json', 'electron/test/command-text.test.cjs', 'electron/test/bridge-settings-module.test.cjs']) {
    assert.equal(invisible.test(fs.readFileSync(path.join(root, file), 'utf8')), false, file);
  }
});

test('見出し行の決まり: 前後から除く空白は JavaScript の trim と同じ（BOM・全角空白・NBSP を含む）', () => {
  assert.equal(trimText('\ufeff\u3000\u00a0 a \t\u2028'), 'a');
  assert.equal(trimText('a\u200bb'), 'a\u200bb', '幅のない空白（U+200B）は空白ではない');
});

// テストも txt を自分で読まない（設計書の 5。PR1 の最終レビュー）。見出し・説明文の正規表現と、# と // の行を除く正規表現の写しを探す。
test('見出し行の決まり: テストも見出し・説明文・コマンドの行を自分の正規表現で読まず command_text.cjs を使う', () => {
  const copy = /\^#\\s\*|\^\\\/\\\/\\s\*|\(#\|\\\/\\\/\)/;
  for (const name of fs.readdirSync(path.join(root, 'electron', 'test')).filter(file => file.endsWith('.cjs') && file !== 'command-text.test.cjs')) {
    assert.equal(copy.test(fs.readFileSync(path.join(root, 'electron', 'test', name), 'utf8')), false, 'electron/test/' + name + ' に読み方の写しが残っている');
  }
});

test('見出し行の決まり: BRIDGE・アプリの一覧・ルーレット・開発用の一覧は、自分の写しを持たず command_text.cjs を使う', () => {
  // アプリと開発用の一覧は、1行を bridge/command_rows.cjs の commandListRow で作る（その中で command_text.cjs を読む。処理のコピー PR8）。
  assert.match(fs.readFileSync(path.join(root, 'bridge/command_rows.cjs'), 'utf8'), /require\("\.\/command_text\.cjs"\)/);
  for (const file of ['bridge/index.js', 'electron/bridge_settings.cjs', 'bridge/roulette.cjs', 'vite.config.ts', 'bridge/command_rows.cjs']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /command_(text|rows)\.cjs/, file + ': command_text.cjs（一覧の1行は command_rows.cjs）を読む');
    assert.doesNotMatch(source, /\^#\\s\*|\^\\\/\\\/\\s\*/, file + ': 見出し・説明文の正規表現の写しを持たない');
  }
});
