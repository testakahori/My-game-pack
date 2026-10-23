// BRIDGE の試験台の片付けは、BRIDGE が読むほかのファイル（送り直し・ルーレットの演出）のタイマーも止める（処理のコピー PR7 の最後のレビュー）。
// 前は演出の途中でテストを終えると、当たりの送り直しが片付けたあとの偽 BridgeMOD へ続き、node --test が終わらなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('BRIDGE の試験台: ルーレットの演出の途中でテストを終えても、プロセスが終わる', () => {
  const { NODE_TEST_CONTEXT: _parent, ...env } = process.env;
  // --test を付けずに直接動かす（node:test はそのプロセスの中でテストを回す）。打ち切るときに子のプロセスを残さない。
  const result = spawnSync(process.execPath, [path.join(__dirname, 'helpers', 'fixture-ends-mid-roulette.cjs')], { encoding: 'utf8', env, timeout: 20000 });
  assert.equal(result.error?.code, undefined, '20秒で終わらなかった\n' + result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
