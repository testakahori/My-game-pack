// 運用センターの「設定復元・更新」と「詳細設定」（2026-10-30 ユーザーの決定）。
// - 「設定復元・更新」の更新の手順の3行を消す。
// - 「詳細設定」（演出・ゲーム性設定の JSON）はタブごと消す。演出・ゲーム性設定は仕掛けごとなくした（古い設定に残った options.gameplay は読まずに放っておく）。
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
const ops = fs.readFileSync(path.resolve(__dirname, '../../src/components/OperationsPage.tsx'), 'utf8');

test('運用センター: 「詳細設定」のタブと、演出・ゲーム性設定の JSON の欄は無い', () => {
  assert.doesNotMatch(ops, /詳細設定/);
  assert.doesNotMatch(ops, /演出・ゲーム性設定/);
  assert.doesNotMatch(ops, /gameplayText|GAMEPLAY_EXAMPLE/);
  for (const tab of ['MAPセーブ・ロード', 'イベントテスト', '動作設定', '設定復元・更新']) assert.match(ops, new RegExp(`"${tab}"`), tab);
});

test('運用センター: 「設定復元・更新」の更新の手順の3行は無く、ほかの文は残す', () => {
  for (const line of ['設定を保存し、BRIDGE・サーバー・Minecraftを停止します。', 'このアプリを終了し、配布者から受け取った最新版のインストーラーを実行します。', '現在と同じインストール先を選び、完了後にアプリを起動します。']) {
    assert.equal(ops.includes(line), false, line);
  }
  assert.match(ops, /アプリのバージョン・更新方法/);
  assert.match(ops, /アプリをアンインストールする必要はありません。設定とMAPはそのまま引き継ぎます。/);
});

test('運用センターの保存: 保存のときに読んだ最新の設定に、このページの options を重ねる', () => {
  const { opsConfigToSave } = loadTs('opsConfig.ts');
  const latest = { tiktokUsername: 'a', mappings: [1], options: { giftCooldownMs: 300, logUnknownGifts: true } };
  const next = opsConfigToSave(latest, { giftCooldownMs: 500 });
  assert.equal(next.options.giftCooldownMs, 500, 'このページで変えた値は書く');
  assert.equal(next.options.logUnknownGifts, true, 'このページに無い値は残す');
  assert.equal(next.tiktokUsername, 'a'); assert.deepEqual(next.mappings, [1]);
  assert.deepEqual(opsConfigToSave({}, undefined).options, {}, 'options が無くても落ちない');
  assert.match(ops, /opsConfigToSave\(latest, cfg\.options\)/);
});

// 演出・ゲーム性設定を仕掛けごとなくしたので、gameplay を外す決め方（withoutGameplay。PR #174 レビュー 軽い2）も消した（2026-10-30）。
test('運用センター：未保存かどうかは、このページの options をそのまま比べる', () => {
  assert.equal('withoutGameplay' in loadTs('opsConfig.ts'), false);
  assert.doesNotMatch(ops, /withoutGameplay|gameplay/);
  assert.match(ops, /JSON\.stringify\(\{ options: cfg\.options \|\| \{\} \}\)/);
  assert.match(ops, /JSON\.stringify\(\{ options: bridgeConfig\.options \|\| \{\} \}\)/);
  assert.doesNotMatch(ops, /const pageOptions = /, 'ページに写しを持たない');
});
