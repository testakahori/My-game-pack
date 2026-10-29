// 配信ホームのゲームの欄の選択肢は、採掘・埋め立て・RUN の3つ。サバイバル（common）は選択肢に出さないだけで、中には残す
// （まだゲームを選んでいない状態。ゲームの切り替え・ギフト設定の決まりはそのまま。2026-10-29 ユーザーの決定）。
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
const { gameChoices, shownGame, savedGame, gameDirty, gameReadyOf } = loadTs('gameChoices.ts');
const GAMES = require('../../bridge/games.json');

test('選択肢は採掘・埋め立て・RUN の順。サバイバルは games.json に残し、選べないと書く', () => {
  assert.deepEqual(gameChoices(GAMES).map(game => game.name), ['採掘', '埋め立て', 'RUN']);
  assert.equal(GAMES.find(game => game.id === 'common').selectable, false);
  for (const game of GAMES.filter(game => game.id !== 'common')) assert.equal(game.selectable, undefined, game.id);
});

// ゲームを選ばないと遊べない（新しく入れた人は「ゲームを選んでください」から始める。2026-10-29 ユーザーの決定）。
test('欄で選んでおくゲーム：今のゲームが選択肢にあればそれ。サバイバルのまま（新しく入れた人）なら、何も選ばない', () => {
  assert.equal(shownGame({ active: 'common', games: GAMES }), '');
  for (const id of ['saikutu', 'umetate', 'run']) assert.equal(shownGame({ active: id, games: GAMES }), id);
  assert.equal(shownGame({ active: 'xyz', games: GAMES }), '', '一覧に無いゲームも選んでいない扱い');
});

test('保存済みに見せるのは、保存していて今のゲームが選択肢にあるときだけ（サバイバルを保存していたら「未保存」）', () => {
  assert.equal(savedGame({ active: 'umetate', applied: true, games: GAMES }), true);
  assert.equal(savedGame({ active: 'common', applied: true, games: GAMES }), false);
  assert.equal(savedGame({ active: 'saikutu', applied: false, games: GAMES }), false);
  assert.equal(savedGame({ active: 'common', applied: false, games: GAMES }), false);
  assert.equal(savedGame({ active: 'xyz', applied: true, games: GAMES }), false);
});

// 4つの状態で、未保存の変更か（帯とページを移るときの確かめ）と、遊べるか（一括起動・BRIDGE の起動・ギフト設定）を値で確かめる（2回目のレビューの軽い5）。
test('4つの状態：新しく入れた人・採掘を選んだだけ・採掘を保存した・サバイバルを保存していた', () => {
  const status = (active, applied) => ({ active, applied, recoveryRequired: false, games: GAMES });
  const rows = [
    ['新しく入れた人で何も選んでいない', status('common', false), '', false, false],
    ['新しく入れた人が採掘を選んだ', status('common', false), 'saikutu', true, false],
    ['採掘を保存した', status('saikutu', true), 'saikutu', false, true],
    ['サバイバルを保存していた', status('common', true), '', false, false],
  ];
  for (const [label, value, selected, dirty, ready] of rows) {
    assert.equal(gameDirty(value, selected), dirty, label + '：未保存の変更か');
    assert.equal(gameReadyOf(value), ready, label + '：遊べるか');
  }
  // まだ読み込んでいない（選んだゲームも決まっていない）ときは、未保存の変更にしない（最初の読み込みに失敗したときにサバイバルを保存できた。軽い1）。
  assert.equal(gameDirty(status('common', false), null), false);
  assert.equal(gameDirty(null, 'saikutu'), false);
  assert.equal(gameReadyOf(null), false);
  assert.equal(gameReadyOf({ ...status('saikutu', true), recoveryRequired: true }), false, '切り替えの復旧が必要なら遊べない');
});

test('ゲームの欄：選択肢・選んでおくゲーム・未保存の判断・状態の文は gameChoices.ts を使い、サバイバルの説明を出さない', () => {
  const ui = source('components/GameSelector.tsx');
  assert.match(ui, /import \{ gameChoices, gameDirty, savedGame, shownGame \} from '\.\.\/lib\/gameChoices';/);
  assert.match(ui, /\(status \? gameChoices\(status\.games\) : \[/, '選択肢はサバイバルを除く');
  assert.equal((ui.match(/setSelected\(shownGame\(next\)\)/g) || []).length, 2, '読み込んだとき・保存したときは選んでおくゲームにする');
  // 新しく入れた人が何も選んでいないときは未保存にしない（採掘を選べば未保存になる）。まだ読み込んでいないうちは、選んだゲームは null。
  assert.match(ui, /useState<string \| null>\(null\)/);
  assert.match(ui, /const dirty = gameDirty\(status, selected\);/);
  // あとから読み直したとき（最初の読み込みに失敗したあと・アプリの更新で MOD を入れ替えたあと）は、まだ選んでいなければ選んでおくゲームにする。
  assert.equal((ui.match(/setSelected\(current => current \?\? shownGame\(next\)\)/g) || []).length, 6);
  assert.doesNotMatch(ui, /selected === 'common'/, 'もう通らない分かれ道は残さない');
  assert.match(ui, /const canResetMap = Boolean\(status && savedGame\(status\) && status\.mapResettable\);/);
  assert.match(ui, /\{ id: '', name: '読み込み中', installed: true \}/, '読み込み中に（未導入）を付けない');
  assert.match(ui, /savedGame\(status\) \? `適用済み：/);
  // 何も選んでいないときは「選んでください」を出し（「ゲームを選んでください」は欄の幅に入らず切れた）、「保存」は押せない（選んだゲームが無いので game が無い）。
  assert.match(ui, /<option value="" disabled>選んでください<\/option>/);
  assert.match(ui, /disabled=\{busy \|\| scanning \|\| !game\?\.installed/);
  // サバイバルを保存していたパソコンも、ゲームを選んで保存し直すまで一括起動・BRIDGE の起動・ギフト設定を使えない。
  assert.match(source('App.tsx'), /const gameReady = gameReadyOf\(gameStatus\);/);
  // 画面に出る文だけを見る（コメントは除く）。
  const shown = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(shown, /サバイバル/, 'サバイバルの説明を出さない');
  assert.match(source('types/electron.d.ts'), /selectable\?: boolean/);
  // 採掘へ移したコマンドの案内：何も選んでいないときは、選んで「保存」するよう案内する（「今のゲームのまま」は押せない。軽い3）。
  assert.match(ui, /採掘などのゲームを選んで「保存」を押すと/);
});

// サバイバルを保存していたパソコンでも、ゲームを選んで保存し直すまで、ギフト設定を書く・試すボタンを押せない（中の確かめはサバイバルを保存済みと見る。軽い2）。
test('ゲームを保存するまで：動作設定の保存・設定のバックアップの復元・テスト発火・「IDを承認する」も押せない', () => {
  const app = source('App.tsx'), ops = source('components/OperationsPage.tsx');
  assert.match(app, /<OperationsPage [^>]*gameReady=\{gameReady\}/);
  assert.match(ops, /disabled=\{saving \|\| !gameReady\} onClick=\{save\}>動作設定を保存</);
  assert.match(ops, /<EventTestPanel [^>]*gameReady=\{gameReady\}/);
  assert.match(ops, /<SettingsBackupsPanel [^>]*gameReady=\{gameReady\}/);
  const test = source('components/EventTestPanel.tsx');
  assert.match(test, /if \(busy \|\| hasChanges \|\| !bridgeRunning \|\| !gameReady\) return;/);
  assert.equal((test.match(/disabled=\{hasChanges \|\| !bridgeRunning \|\| !gameReady\}/g) || []).length, 2);
  const backups = source('components/SettingsBackupsPanel.tsx');
  assert.match(backups, /onClick=\{restore\} disabled=\{busy \|\| loading \|\| !selectedRow \|\| !gameReady\}/);
  assert.match(backups, /if \(!selectedRow \|\| busy \|\| !gameReady \|\| !confirmDiscard\(\)\) return;/);
  const dash = source('components/DashboardPage.tsx');
  assert.match(dash, /onClick=\{handleApplyBridge\} disabled=\{applyBusy \|\| !startReady\}/);
  // 押せない理由を出す。
  for (const [name, text] of [['動作設定', ops], ['テスト発火', test], ['バックアップの復元', backups], ['IDを承認する', dash]]) {
    assert.match(text, /ゲームを選んで「保存」すると/, name + '：押せない理由');
  }
});
