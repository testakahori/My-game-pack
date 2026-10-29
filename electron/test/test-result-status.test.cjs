// テスト発火の結果を、手順ごとにまとめて表示する（PR #79 レビュー）。
// 1つの手順から結果が何行も出ることがある（ルーレットは当たりごとに1行）。結果の文は BRIDGE が決める（2026-10-16）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const file = path.resolve(__dirname, '../../src/lib/testResult.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const { stepStatus, stepLines } = compiled.exports;
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8');
const accepted = 'BridgeMOD が受け付けました';

test('手順ごとに、その手順の結果だけを見て出し、同じ結果はまとめて回数を添える', () => {
  // 手順0はルーレット3回、手順1は失敗、手順2は回している途中。
  const fired = [
    { stepIndex: 0, state: 'delivered', message: accepted }, { stepIndex: 0, state: 'delivered', message: accepted }, { stepIndex: 0, state: 'delivered', message: accepted },
    { stepIndex: 1, state: 'failed', message: 'HTTP 400' },
    { stepIndex: 2, state: 'pending', message: 'ルーレットを回しています（当たりは回したあとに送ります）' },
  ];
  assert.equal(stepStatus(fired, 0), 'BridgeMOD が受け付けました（3回）');
  assert.equal(stepStatus(fired, 1), 'HTTP 400');
  assert.equal(stepStatus(fired, 2), 'ルーレットを回しています（当たりは回したあとに送ります）');
  assert.equal(stepStatus(fired, 3), '未送信');
  assert.equal(stepStatus(undefined, 0), '未送信');
  assert.equal(stepStatus([{ stepIndex: 0, state: 'delivered', message: accepted }, { stepIndex: 0, state: 'failed', message: 'HTTP 400' }], 0), 'BridgeMOD が受け付けました・HTTP 400');
});

test('同じ内容（見出し・コマンド・回数・結果）の手順が続くときは1行にまとめる（ギフト100個で100行にしない）', () => {
  const steps = [1, 2, 3].map(() => ({ label: 'バラ', commandFile: 'zombie.txt', count: 5 })).concat([{ label: 'コンボ', commandFile: 'combo.txt', count: 1 }]);
  const fired = steps.map((_, stepIndex) => ({ stepIndex, state: 'delivered', message: accepted }));
  assert.deepEqual(stepLines(steps, fired), ['バラ → zombie.txt ×5 / BridgeMOD が受け付けました（×3回）', 'コンボ → combo.txt ×1 / BridgeMOD が受け付けました']);
  assert.deepEqual(stepLines(steps.slice(0, 2), fired.slice(0, 1)), ['バラ → zombie.txt ×5 / BridgeMOD が受け付けました', 'バラ → zombie.txt ×5 / 未送信'], '結果が違えばまとめない');
  assert.deepEqual(stepLines(undefined, undefined), []);
});

test('型の宣言: テスト発火の結果は、BRIDGE が返す形（state・commandFile・count）と bridgeStopped を持つ（最後のレビュー Minor #6）', () => {
  const line = read('src/types/electron.d.ts').split('\n').find(text => text.includes('testEvent: (event:'));
  assert.match(line, /bridgeStopped\?: boolean/);
  assert.match(line, /state\?: 'delivered' \| 'pending' \| 'failed' \| 'discarded'/);
  assert.doesNotMatch(line, /fired\?: Array<\{ ok: boolean/);
});

test('テスト発火の画面: BRIDGE が止まっていると押せず理由を出す。結果は stepLines で出し、手順 i と結果の i 行目を組にしない', () => {
  const panel = read('src/components/EventTestPanel.tsx');
  // ゲームを保存するまでも押せない（ゲームを選ばないと遊べない。2026-10-29 ユーザーの決定）。理由は保存のほうを先に出す。
  assert.match(panel, /export default function EventTestPanel\(\{ onTested, bridgeRunning, gameReady \}: \{ onTested: \(\) => Promise<void>; bridgeRunning: boolean; gameReady: boolean \}\)/);
  assert.equal((panel.match(/disabled=\{hasChanges \|\| !bridgeRunning \|\| !gameReady\}/g) || []).length, 2, '2つのボタン');
  assert.match(panel, /if \(busy \|\| hasChanges \|\| !bridgeRunning \|\| !gameReady\) return;/);
  assert.match(panel, /: !bridgeRunning \? <p className="ops-test-note" role="status">BRIDGE を起動すると試せます。<\/p> : null\}/);
  assert.match(panel, /stepLines\(result\.steps, result\.fired\)\.map\(\(line, i\) => <p key=\{i\}>\{line\}<\/p>\)/);
  assert.doesNotMatch(panel, /result\.fired\?\.\[i\]/);
  assert.match(panel, /本番と同じく、元のギフト・いいね・フォロー・コメントの設定も一緒に動きます。/);
  assert.match(panel, /条件確認・発火には BRIDGE の起動が必要です（本番と同じ処理で試します）。/);
  assert.match(read('src/components/OperationsPage.tsx'), /<EventTestPanel onTested=\{refresh\} bridgeRunning=\{bridgeProcess\.running === true\} gameReady=\{gameReady\} \/>/);
});
