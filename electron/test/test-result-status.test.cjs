// テスト発火の結果を、手順ごとにまとめて表示する（PR #79 レビュー）。
// 1つの手順から記録が何行も出ることがある：ルーレットは当選ごとに1行、付け足しの演出が失敗したら1行足す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const file = path.resolve(__dirname, '../../src/lib/testResult.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const { stepStatus } = compiled.exports;

test('手順ごとに、その手順の記録だけを見て表示する', () => {
  // 手順0はルーレット3回、手順1は失敗（以前は手順1の行に、手順0の2行目の「送信済み」が出ていた）。
  const fired = [
    { stepIndex: 0, ok: true, message: 'a' }, { stepIndex: 0, ok: true, message: 'b' }, { stepIndex: 0, ok: true, message: 'c' },
    { stepIndex: 1, ok: false, message: 'HTTP 400' },
  ];
  assert.equal(stepStatus(fired, 0), '送信済み（3回）');
  assert.equal(stepStatus(fired, 1), 'HTTP 400');
  assert.equal(stepStatus(fired, 2), '未送信');
});

test('1行なら「送信済み」、途中で失敗したら失敗の理由を出す', () => {
  assert.equal(stepStatus([{ stepIndex: 0, ok: true, message: 'x' }], 0), '送信済み');
  // 一部だけ送れたときは、送れた回数も出す（PR #79 再レビュー）。
  assert.equal(stepStatus([{ stepIndex: 0, ok: true, message: 'x' }, { stepIndex: 0, ok: false, message: '演出の送信に失敗' }], 0), '送信済み・失敗: 演出の送信に失敗');
  assert.equal(stepStatus([{ stepIndex: 0, ok: false, message: 'HTTP 400' }], 0), 'HTTP 400', '1回も送れなければ失敗の理由だけ');
  // 当選ごとに行が出るのはルーレットだけ。送れた行が1つなら回数は出さない（音・粒子だけ失敗した手順が「1回」と読めてしまう。PR #85 レビュー）。
  assert.equal(stepStatus([{ stepIndex: 0, ok: true, message: 'x' }, { stepIndex: 0, ok: true, message: 'y' }, { stepIndex: 0, ok: false, message: 'HTTP 400' }], 0), '送信済み（2回）・失敗: HTTP 400');
  assert.equal(stepStatus(undefined, 0), '未送信');
});

test('テスト発火の画面は stepStatus で手順ごとに表示し、記録の並び順に頼らない', () => {
  const panel = fs.readFileSync(path.resolve(__dirname, '../../src/components/EventTestPanel.tsx'), 'utf8');
  assert.match(panel, /stepStatus\(result\.fired, i\)/);
  assert.doesNotMatch(panel, /result\.fired\?\.\[i\]/, '手順 i と記録の i 行目を組にしない');
});
