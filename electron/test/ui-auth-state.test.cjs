// 画面のログイン状態の確かめ（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 7）。
// 前は確かめそのものが失敗すると（アプリの設定の中身が null のときなど）、「旧preload等ではブロックせず通す」としてログイン済みにしていた。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const root = path.resolve(__dirname, '../..');
const file = path.join(root, 'src/lib/authState.ts');
const compiled = new Module(file, module);
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
const { readAuthState } = compiled.exports;

test('ログイン状態: 確かめが失敗したらログイン画面', async () => {
  assert.equal(await readAuthState({ authStatus: async () => { throw new Error('読めない'); } }), 'unauthed');
});

test('ログイン状態: authenticated が true のときだけ通す', async () => {
  assert.equal(await readAuthState({ authStatus: async () => ({ authenticated: true }) }), 'authed');
  for (const authenticated of ['yes', 1, undefined]) {
    assert.equal(await readAuthState({ authStatus: async () => ({ authenticated }) }), 'unauthed', String(authenticated));
  }
  assert.equal(await readAuthState({ authStatus: async () => undefined }), 'unauthed');
});

test('ログイン状態: 窓口が無いときもログイン画面', async () => {
  assert.equal(await readAuthState(undefined), 'unauthed');
  assert.equal(await readAuthState({}), 'unauthed');
});

test('本文: App.tsx は readAuthState を使い、ログイン済みにするのはログインに成功したときだけ', () => {
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  assert.match(app, /readAuthState\(/);
  assert.equal(app.split('setAuthState("authed")').length - 1, 1, 'onLoginSuccess の1回だけ');
  assert.match(app, /onLoginSuccess=\{\(\) => setAuthState\("authed"\)\}/);
});
