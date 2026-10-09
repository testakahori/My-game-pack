// 配信中の停止操作・カンマ区切り入力・使えないコマンド名の表示（画面側の判定）。
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
const { stopConfirmMessage } = loadTs('stopSafety.ts');
const { parseListInput, formatListInput, sameList } = loadTs('listInput.ts');
const { commandOptionLabel } = loadTs('commandLabel.ts');

test('停止: 動いているものを止めるときだけ確認し、配信中ならそう書く', () => {
  const stopped = { bridgeRunning: false, serverRunning: false };
  for (const target of ['all', 'bridge', 'server']) assert.equal(stopConfirmMessage(target, stopped), null);
  assert.equal(stopConfirmMessage('bridge', { bridgeRunning: false, serverRunning: true }), null);
  assert.equal(stopConfirmMessage('server', { bridgeRunning: true, serverRunning: false }), null);
  assert.match(stopConfirmMessage('bridge', { bridgeRunning: true, serverRunning: false }), /BRIDGEを停止します/);
  assert.match(stopConfirmMessage('server', { bridgeRunning: false, serverRunning: true }), /サーバーを停止します/);
  assert.match(stopConfirmMessage('all', { bridgeRunning: false, serverRunning: true }), /一括停止しますか/);
  assert.doesNotMatch(stopConfirmMessage('all', { bridgeRunning: true, serverRunning: true }), /配信中/);
  assert.match(stopConfirmMessage('all', { bridgeRunning: true, serverRunning: true, tiktokConnected: true }), /^TikTok に接続中（配信中）です。/);
});

test('カンマ区切り: 打ったカンマを消さず、読点・全角カンマでも区切る', () => {
  // 以前は値から文字列を作り直していたため、「baduser1,」の時点でカンマが消えて2件目を入力できなかった。
  assert.deepEqual(parseListInput('baduser1,'), ['baduser1']);
  assert.equal(sameList('baduser1,', ['baduser1']), true, '入力中の文字列を書き換えない');
  assert.equal(sameList('baduser1, bad', ['baduser1']), false, '外から値が変わったら書き換える');
  assert.deepEqual(parseListInput(' a , b,,c '), ['a', 'b', 'c']);
  assert.deepEqual(parseListInput('暴言、URL，宣伝'), ['暴言', 'URL', '宣伝']);
  assert.deepEqual(parseListInput('a, a, b'), ['a', 'b']);
  assert.deepEqual(parseListInput(''), []);
  assert.equal(formatListInput(['a', 'b']), 'a, b');
  assert.equal(sameList(formatListInput(['a', 'b']), ['a', 'b']), true);
});

test('コマンド候補: BridgeMOD が拒否する名前だけに印を付け、title は変えない', () => {
  assert.equal(commandOptionLabel({ name: 'cod.txt', title: 'タラ' }), 'タラ');
  assert.equal(commandOptionLabel({ name: 'cod.txt', title: '' }), 'cod.txt');
  const invalid = { name: 'ネコ.txt', title: 'ネコ', invalidName: true };
  assert.match(commandOptionLabel(invalid), /^⚠ ネコ（ファイル名を半角英数字に変えると使えます）$/);
  assert.equal(invalid.title, 'ネコ');
});
