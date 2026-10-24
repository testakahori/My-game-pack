// 運営ログインはなくした（2026-10-24 ユーザーの決定）。誰が使えるかは公式 HP で決める（購入者に番号を渡し、HP にログインしてインストールしてもらう）。
// 前は、公開リポジトリから誰でもダウンロードできる代わりに、パスワードを知っている人だけが遊べるようにしていた。
// ただしパスワードのハッシュとトークンの作り方がアプリの中にあり、インストーラーを手に入れた人はパスワードなしでログインの状態を作れた（HANDOFF04 の P8）。
// アプリを開くとすぐに使え、ログインの画面・確かめ・ipc の窓口がどこにも残っていないことを見張る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('運営ログイン: ログインの画面と確かめのファイルは無い', () => {
  for (const name of ['src/components/LoginPage.tsx', 'src/lib/authState.ts', 'electron/operator_auth.cjs']) {
    assert.equal(fs.existsSync(path.join(root, name)), false, name);
  }
});

test('運営ログイン: 画面・preload・型・開発用の偽物・main に、ログインの窓口が残っていない', () => {
  for (const name of ['src/App.tsx', 'electron/preload.cjs', 'src/types/electron.d.ts', 'src/lib/devApiMock.ts', 'electron/main.cjs', 'electron/server_process.cjs']) {
    assert.doesNotMatch(read(name), /LoginPage|readAuthState|authStatus|authLogin|authLogout|auth:status|auth:login|auth:logout|operatorAuth|isOperatorAuthed/, name);
  }
});
