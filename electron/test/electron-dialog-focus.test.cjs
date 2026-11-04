// Electron 43.7.6 より前は、Windows で確認の窓（window.confirm・alert）を閉じると、ページにフォーカスが戻らなかった
// （electron/electron#31917。43.7.6 で直った）。その間は選ぶ欄（select）が開いてもすぐ閉じ、アプリを再起動するまで選べなかった。
// 2026-11-04、ギフト設定でコマンドが選べなくなった（ユーザーの報告。ギフトを ✖ で消したあとの「保存されていない変更があります」など）。
// 試験の窓で 43.2.0 は毎回フォーカスが戻らず、43.8.7 は戻った。ユーザーの決定で 43.8.7 に上げた。下げないための確かめ。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');

// 直った版の始まり（大きい番号ごと）。ほかの大きい番号に上げるときは、その版で直っているかを確かめてから足す。
const FIXED_FROM = { 43: [43, 7, 6] };
function hasFix(version) {
  const parts = String(version).split('.').map(Number);
  const fixed = FIXED_FROM[parts[0]];
  if (!fixed) return false;
  for (let i = 1; i < fixed.length; i++) if (parts[i] !== fixed[i]) return parts[i] > fixed[i];
  return true;
}

test('Electron は確認の窓のあとにフォーカスが戻る版（43.7.6 以上）', () => {
  const declared = require(path.join(root, 'package.json')).devDependencies.electron;
  assert.match(declared, /^\d+\.\d+\.\d+$/, '版は固定で書く（インストーラーはこの版で作る）');
  assert.ok(hasFix(declared), 'package.json の electron が ' + declared + '（直った版か、確かめていない大きい番号）');
  const locked = require(path.join(root, 'package-lock.json')).packages['node_modules/electron'].version;
  assert.equal(locked, declared, 'package-lock.json と package.json の版が違う');
  assert.equal(hasFix('43.2.0'), false);
  assert.equal(hasFix('43.7.5'), false);
  assert.equal(hasFix('43.7.6'), true);
  assert.equal(hasFix('44.0.0'), false, '確かめていない大きい番号は通さない');
});
