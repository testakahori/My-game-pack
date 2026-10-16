// 運営ログインと、その ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 本物のパスワードはリポジトリに置かないので、テストでは自分で作ったハッシュを渡す。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createOperatorAuth } = require('../operator_auth.cjs');

const credentials = { salt: 'test-salt', iterations: 1000, keyLen: 32,
  hash: crypto.pbkdf2Sync('test-pass', 'test-salt', 1000, 32, 'sha256').toString('hex') };

function setup() {
  let config = {}, clock = 1_000_000;
  const handlers = new Map();
  const auth = createOperatorAuth({ readAppConfig: () => config, writeAppConfig: data => { config = { ...config, ...data }; },
    credentials, now: () => clock });
  auth.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { auth, invoke: (name, ...args) => handlers.get(name)({}, ...args), config: () => config, advance: ms => { clock += ms; }, handlers };
}

test('ipc: ログインの状態・ログイン・ログアウトを登録する', () => {
  assert.deepEqual([...setup().handlers.keys()].sort(), ['auth:login', 'auth:logout', 'auth:status']);
});

test('正しいパスワードでログインし、メールアドレスとトークンを保存する（パスワードは保存しない）。ログアウトで消す', async () => {
  const { auth, invoke, config } = setup();
  assert.deepEqual(await invoke('auth:status'), { authenticated: false, email: '' });
  assert.deepEqual(await invoke('auth:login', { email: ' op@example.com ', password: 'test-pass' }), { ok: true, email: 'op@example.com' });
  assert.equal(config().authToken, auth.operatorLoginToken('op@example.com'));
  assert.ok(!JSON.stringify(config()).includes('test-pass'));
  assert.deepEqual(await invoke('auth:status'), { authenticated: true, email: 'op@example.com' });
  assert.equal(auth.isOperatorAuthed(), true);
  await invoke('auth:logout');
  assert.deepEqual(await invoke('auth:status'), { authenticated: false, email: '' });
  assert.equal(auth.isOperatorAuthed(), false);
});

test('メールアドレスの形とパスワードを確かめ、トークンが合わなければログインしていない扱い', async () => {
  const { auth, invoke, config } = setup();
  assert.match((await invoke('auth:login', { email: 'not-mail', password: 'test-pass' })).message, /メールアドレスの形式が正しくありません/);
  assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'wrong' })).message, /パスワードが違います/);
  Object.assign(config(), { authEmail: 'op@example.com', authToken: 'forged' });
  assert.deepEqual(await invoke('auth:status'), { authenticated: false, email: '' });
  assert.equal(auth.verifyOperatorPassword('test-pass'), true);
  assert.equal(auth.isValidLoginEmail('a@b.cd'), true);
});

test('失敗が5回続いたら60秒止める。過ぎたら試せて、成功したら数え直す', async () => {
  const { invoke, advance } = setup();
  for (let i = 0; i < 5; i++) assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'wrong' })).message, /パスワードが違います/);
  assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).message, /ログイン試行が多すぎます。60秒後に再試行してください/);
  advance(30_000);
  assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).message, /30秒後/);
  advance(30_001);
  assert.equal((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).ok, true);
  for (let i = 0; i < 4; i++) await invoke('auth:login', { email: 'op@example.com', password: 'wrong' });
  assert.equal((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).ok, true, '4回の失敗では止めない');
  // 成功で数え直していなければ、4回＋1回＝5回目で止まってしまう（main.cjs の分割 PR1 レビュー）。
  await invoke('auth:login', { email: 'op@example.com', password: 'wrong' });
  assert.equal((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).ok, true, '成功したら失敗の回数を数え直す');
});
