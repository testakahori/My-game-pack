// 新しい保存先を作ったとき（bridge:extractTo の freshConfig）だけ、画面が覚えていた TikTok ユーザー名を消す（2026-10-30 ユーザーの決定「新しい保存先では空にする」）。
// 覚えておく所の名前は src/lib/rememberedAccounts.ts の1か所（配信ホームと初期セットアップで同じもの）。
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

test('新しい保存先の印があるときだけ、覚えていた TikTok ユーザー名を消す', () => {
  const { TIKTOK_USER_STORAGE_KEY, forgetRememberedTikTokUser } = loadTs('rememberedAccounts.ts');
  assert.equal(TIKTOK_USER_STORAGE_KEY, 'mc_tiktok_username_unified_v1', '前の版と同じ名前（覚えていた値を見つけられる）');
  const removed = [];
  const storage = { removeItem: key => removed.push(key) };
  assert.equal(forgetRememberedTikTokUser({ ok: true, freshConfig: true }, storage), true);
  assert.deepEqual(removed, [TIKTOK_USER_STORAGE_KEY]);
  for (const result of [{ ok: true, freshConfig: false }, { ok: true, skipped: true }, undefined, null]) {
    assert.equal(forgetRememberedTikTokUser(result, storage), false, JSON.stringify(result));
  }
  assert.equal(removed.length, 1);
  assert.equal(forgetRememberedTikTokUser({ freshConfig: true }, { removeItem: () => { throw new Error('blocked'); } }), false, '消せなくても止めない');
  assert.equal(forgetRememberedTikTokUser({ freshConfig: true }, undefined), false, '保存領域が無くても止めない（画面のテストの中など）');
});

test('配信ホームは同じ名前を使い、初期セットアップは BRIDGE を置く3か所すべてで消す', () => {
  const dashboard = source('components/DashboardPage.tsx');
  assert.match(dashboard, /import \{ TIKTOK_USER_STORAGE_KEY \} from "\.\.\/lib\/rememberedAccounts";/);
  assert.doesNotMatch(dashboard, /"mc_tiktok_username_unified_v1"/, '名前の写しを持たない');
  const setup = source('components/InitialSetupPage.tsx');
  assert.equal((setup.match(/forgetRememberedTikTokUser\(await api\.bridgeExtractTo\([^)]*\)\)/g) || []).length, 3);
  assert.equal((setup.match(/await api\.bridgeExtractTo\(/g) || []).length, 3, 'BRIDGE を置く所は3か所だけ（どれも消す）');
});
