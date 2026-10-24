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

// 見張る範囲は画面と main のファイル全部と、作業の決まり・設定の安全の文書（最後のレビューの軽い 5。前は6つのファイルだけで、画面の「ログイン情報」の文言を見逃した）。
// app_config.cjs は、使わなくなった項目（retired）を外す所なので、そこの説明に「運営ログイン」と書いてよい。
test('運営ログイン: 画面と main のどのファイルにも、ログインの窓口・文言が残っていない', () => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const name = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(name);
    }
  };
  walk('src');
  for (const name of fs.readdirSync(path.join(root, 'electron')).filter(name => name.endsWith('.cjs'))) files.push('electron/' + name);
  assert.ok(files.length > 50, String(files.length));
  for (const name of files) {
    const text = read(name);
    assert.doesNotMatch(text, /LoginPage|readAuthState|authStatus|authLogin|authLogout|auth:status|auth:login|auth:logout|operatorAuth|isOperatorAuthed|ログイン情報/, name);
    if (name !== 'electron/app_config.cjs') assert.doesNotMatch(text, /運営ログイン/, name);
  }
  assert.doesNotMatch(read('AGENTS.md'), /operator_auth\.cjs|運営ログインのパスワード/);
  assert.doesNotMatch(read('SETTINGS_SAFETY.md'), /ログイン情報/);
});
