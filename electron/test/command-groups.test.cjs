// コマンドを選ぶ欄は、分類（# CATEGORY:）の見出しごとに並べる。ギフト設定だけでなく、いいね・フォローとルーレット・コメントも同じ（2026-10-30 ユーザーの決定「ギフト設定と同じ分類」）。
// 分類の決め方は src/lib/commandGroups.ts の1か所。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
function loadTs(relative) {
  const file = path.resolve(__dirname, '../../src/lib', relative);
  const compiled = new Module(file, module);
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
  return compiled.exports;
}
const source = relative => fs.readFileSync(path.resolve(__dirname, '../../src', relative), 'utf8');

test('分類の名前：お助け→お助け系、妨害→妨害系、「|」の後ろは見ない、無ければその他', () => {
  const { commandCategory } = loadTs('commandGroups.ts');
  assert.equal(commandCategory('お助け'), 'お助け系');
  assert.equal(commandCategory('妨害'), '妨害系');
  assert.equal(commandCategory('敵対MOB|強い'), '敵対MOB');
  assert.equal(commandCategory(' 天変地異 '), '天変地異');
  assert.equal(commandCategory(''), 'その他');
  assert.equal(commandCategory(undefined), 'その他');
});

test('分類ごとにまとめる：見出しは五十音などの順、中はもとの並び', () => {
  const { groupCommandsByCategory } = loadTs('commandGroups.ts');
  const files = [{ name: 'b.txt', category: '妨害系' }, { name: 'a.txt', category: 'お助け系' }, { name: 'c.txt' }, { name: 'd.txt', category: '妨害' }];
  const groups = groupCommandsByCategory(files);
  assert.deepEqual(groups.map(([category]) => category), [...new Set(['妨害系', 'お助け系', 'その他'])].sort((a, b) => a.localeCompare(b, 'ja')));
  assert.deepEqual(groups.find(([category]) => category === '妨害系')[1].map(file => file.name), ['b.txt', 'd.txt']);
});

test('3つの画面のコマンドを選ぶ欄は、同じまとめ方で見出しごとに並べる', () => {
  const mapping = source('components/MappingEditor.tsx');
  assert.match(mapping, /from "\.\.\/lib\/commandGroups"/);
  assert.doesNotMatch(mapping, /const commandCategory = /, 'ギフト設定に分類の決め方の写しを持たない');
  assert.match(mapping, /<optgroup key=\{group\.category\} label=\{commandGroupLabel\(group\.category, group\.files\.length\)\} className="command-optgroup">/);
  for (const page of ['components/EventSettingsPage.tsx', 'components/EventSettings2Page.tsx']) {
    const text = source(page);
    assert.match(text, /groupCommandsByCategory\(commandFiles\)/, page);
    assert.match(text, /<optgroup key=\{category\} label=\{commandGroupLabel\(category, files\.length\)\} className="command-optgroup">/, page);
    assert.match(text, /type CommandFile = \{[^}]*category\?: string/, page);
  }
});

// 見出しが項目と同じ色だと見出しに見えない（2026-10-30 ユーザーの決定「色と【】で目立たせる」）。【分類】（件数）の形にし、黄色の太字・濃い帯で出す。見出しは選べない（optgroup）。
test('見出しの文字は【分類】（件数）。見出しは黄色の太字・濃い帯、項目はふつうの色', () => {
  const { commandGroupLabel } = loadTs('commandGroups.ts');
  assert.equal(commandGroupLabel('妨害系', 9), '【妨害系】（9）');
  assert.equal(commandGroupLabel('その他', 1), '【その他】（1）');
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
  assert.match(css, /select optgroup\.command-optgroup \{[^}]*color: #ffd166;[^}]*font-weight: 800;[^}]*background: #13263b;/);
  assert.match(css, /select optgroup\.command-optgroup option \{[^}]*color: #edf6ff;[^}]*font-weight: 400;/);
});
