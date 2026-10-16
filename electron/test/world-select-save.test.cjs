// 配信ワールドは、選び直したらすぐ保存する（アプリレビュー 2026-10-08「ワールドを選び直しても保存ボタンがない」、2026-10-16 ユーザーの決定）。
// 以前は保存が見えない隠しボタンと一括起動だけで、選び直すとページを移るたびに「未保存」と言われた。保存の結果も画面に出ていなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const home = fs.readFileSync(path.resolve(__dirname, '../../src/components/DashboardPage.tsx'), 'utf8').replace(/\r\n/g, '\n');
const between = (start, end) => {
  const from = home.indexOf(start);
  assert.ok(from >= 0, 'missing ' + start);
  return home.slice(from, home.indexOf(end, from));
};

test('ワールドを選び直したら、その場で level-name を保存する', () => {
  assert.match(home, /const setSubfolder = \(v: string\) => \{ const next = `\$\{WORLD_PREFIX\}\/\$\{v\}`; setDraft\(next\); void handleWorldSave\(next\); \};/);
  const save = between('const handleWorldSave = async (next: string) => {', '\n  };\n');
  assert.match(save, /await api\.serverPropsWrite\(\{ "level-name": next \}\);/);
  assert.match(save, /setLevelName\(next\);/);
});

test('保存できなかったら、選ぶ前のワールドに戻して理由を出す', () => {
  const save = between('const handleWorldSave = async (next: string) => {', '\n  };\n');
  assert.match(save, /catch \(e: any\) \{\s*setDraft\(levelName\);/);
  assert.match(save, /保存できませんでした。選ぶ前のワールドのままです/);
});

test('保存している間は選べない。保存の結果をカードに出す', () => {
  const card = between('<section className="cockpit-info-card cockpit-world-card">', '</section>');
  assert.match(card, /<select value=\{subfolder\} disabled=\{worldLoading \|\| worldSaving\} onChange=\{\(e\) => setSubfolder\(e\.target\.value\)\}>/);
  assert.match(card, /\{worldMsg && <small role=\{worldMsg\.type === "error" \? "alert" : "status"\}/);
  assert.match(card, /\{worldMsg\.text\}/);
});

test('見えない隠しボタンで保存しない', () => {
  const hidden = between('<div className="cockpit-hidden-actions"', '</div>');
  assert.doesNotMatch(hidden, /handleWorldSave/);
});
