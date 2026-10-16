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

test('保存できなかったら、保存を始める前のワールドに戻して理由を出す', () => {
  const save = between('const handleWorldSave = async (next: string) => {', '\n  };\n');
  // 戻し先は保存を始めた時点の値（一括起動が途中で保存しても、古い値に戻さない。PR #105 レビュー）。
  assert.match(save, /const previous = levelName;/);
  assert.match(save, /catch \(e: any\) \{\s*setDraft\(previous\);/);
  assert.match(save, /保存できませんでした。選ぶ前のワールドのままです/);
});

// 一括起動と同じく、サーバーが動いている間はワールドを変えない（PR #105 レビュー）。
test('サーバーが動いている間はワールドを選べず、理由を出す。保存の直前にももう一度確かめる', () => {
  const save = between('const handleWorldSave = async (next: string) => {', '\n  };\n');
  const check = save.indexOf('if ((await api.serverProcessStatus?.())?.running) throw new Error("サーバーが動いているため、ワールドを変えられません。停止してから選んでください。");');
  assert.ok(check >= 0 && check < save.indexOf('await api.serverPropsWrite('), '書く前に確かめる');
  const card = between('<section className="cockpit-info-card cockpit-world-card">', '</section>');
  assert.match(card, /\{serverProc\.running === true && <small className="cockpit-world-msg">サーバーの動作中はワールドを変えられません。停止してから選んでください。<\/small>\}/);
});

test('保存している間・一括起動の間・サーバーの動作中は選べない。保存の結果をカードに出す', () => {
  const card = between('<section className="cockpit-info-card cockpit-world-card">', '</section>');
  assert.match(card, /<select value=\{subfolder\} disabled=\{worldLoading \|\| worldSaving \|\| allStartBusy \|\| serverProc\.running === true\} onChange=\{\(e\) => setSubfolder\(e\.target\.value\)\}>/);
  assert.match(card, /\{worldMsg && <small role=\{worldMsg\.type === "error" \? "alert" : "status"\}/);
  assert.match(card, /\{worldMsg\.text\}/);
});

test('見えない隠しボタンで保存しない', () => {
  const hidden = between('<div className="cockpit-hidden-actions"', '</div>');
  assert.doesNotMatch(hidden, /handleWorldSave/);
});
