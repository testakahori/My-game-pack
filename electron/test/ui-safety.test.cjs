// 配信中の停止操作・カンマ区切り入力・使えないコマンド名の表示（画面側の判定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { buildSync, transformSync } = require('esbuild');

function loadTs(relative) {
  const file = path.resolve(__dirname, '../../src/lib', relative);
  const compiled = new Module(file, module);
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
  return compiled.exports;
}
// 画面部品は src/lib の読み込みごと1ファイルにまとめ、react はアプリと同じものを使う。
function loadComponent(relative) {
  const file = path.resolve(__dirname, '../../src/components', relative);
  const { outputFiles } = buildSync({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node20', jsx: 'automatic', external: ['react', 'react-dom'], logLevel: 'silent' });
  const compiled = new Module(file, module);
  compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(outputFiles[0].text, file);
  return compiled.exports;
}
const source = relative => fs.readFileSync(path.resolve(__dirname, '../../src', relative), 'utf8');
const { stopConfirmMessage, stopState, keepLastKnown, runningLabel, runStop } = loadTs('stopSafety.ts');
const { parseListInput, formatListInput, sameList, listInputOnBlur, hasJapaneseComma, COMMA_ONLY } = loadTs('listInput.ts');
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

test('停止: 状態を取得できないときは動いているものとして確認し、失敗しても前回の値を残す', () => {
  // サーバーのポート確認がタイムアウトすると状態の取得ごと失敗し、停止パネルが消えて BRIDGE を止められなかった。
  const unknown = stopState(null, null);
  assert.deepEqual(unknown, { bridgeRunning: null, serverRunning: null, tiktokConnected: false });
  for (const target of ['all', 'bridge', 'server']) assert.match(stopConfirmMessage(target, unknown), /状態を確認できていません/);
  assert.match(stopConfirmMessage('all', { bridgeRunning: false, serverRunning: null }), /^サーバーの状態を確認できていません/);
  assert.doesNotMatch(stopConfirmMessage('bridge', { bridgeRunning: true, serverRunning: null }), /確認できていません/, 'BRIDGEだけ止めるときはサーバーの不明を書かない');
  const rejected = { status: 'rejected', reason: new Error('サーバーの稼働状態を確認できません。') };
  assert.equal(keepLastKnown(null, rejected), null, '一度も取れていなければ不明のまま');
  const last = { running: true, managed: true };
  assert.equal(keepLastKnown(last, rejected), last, '取得に失敗したら前回の値を残す');
  assert.deepEqual(keepLastKnown(last, { status: 'fulfilled', value: { running: false } }), { running: false });
  assert.equal(keepLastKnown(last, { status: 'fulfilled', value: null }), last);
});

test('停止: アプリの外で起動したサーバーは止める対象に数えない', () => {
  // server:stop はアプリ外のサーバーを断るので、一括停止で呼ぶと BRIDGE は止まったのに「停止が完了していません」になっていた。
  const external = stopState({ running: true }, { running: true, managed: false });
  assert.equal(external.serverRunning, false);
  assert.equal(stopConfirmMessage('server', external), null);
  assert.doesNotMatch(stopConfirmMessage('all', external), /サーバー/);
  assert.equal(stopConfirmMessage('all', stopState({ running: false }, { running: true, managed: false })), null);
  assert.equal(stopState({ running: false }, { running: true, managed: true }).serverRunning, true);
  assert.equal(stopState({ running: false }, { running: true }).serverRunning, true, 'managed の無い応答は止められるものとして扱う');
  assert.equal(stopState({ running: false }, { running: false, managed: false }).serverRunning, false);
  assert.equal(stopState({ running: true, tiktok: { state: 'connected' } }, null).tiktokConnected, true);
});

test('停止パネル: 状態をまだ取得できていなくてもパネルを出し、停止ボタンを押せる', () => {
  const { renderToString } = require('react-dom/server');
  const React = require('react');
  const { default: StopPanel } = loadComponent('StopPanel.tsx');
  globalThis.window = { mygamepack: {} };
  try {
    const html = renderToString(React.createElement(StopPanel));
    assert.match(html, /class="stop-panel"/);
    // 最初の確認（tasklist を待つので数秒かかる）が返るまでは「確認中」。以前は全項目が「不明」になり、動いているかもしれないという注意まで出ていた。
    assert.match(html, /BRIDGE：<b>確認中<\/b>/);
    assert.match(html, /サーバー：<b>確認中<\/b>/);
    assert.match(html, /Minecraft：<b>確認中<\/b>/);
    assert.doesNotMatch(html, /不明/);
    assert.doesNotMatch(html, /disabled/, '確認中でも停止ボタンを無効にしない');
  } finally {
    delete globalThis.window;
  }
});

test('停止パネル: BRIDGE停止はサーバーに触れず、押したボタンを出どころとして渡す', async () => {
  // 2026-10-10、BRIDGE停止だけを押したはずがサーバーも止まった（原因は未特定）。どのボタンが何を呼ぶかをここで固定する。
  const panel = source('components/StopPanel.tsx');
  for (const [target, label] of [['all', '一括停止'], ['bridge', 'BRIDGE停止'], ['server', 'サーバー停止']]) {
    assert.match(panel, new RegExp(`onClick=\\{\\(\\) => stop\\("${target}"\\)\\}>■ ${label}</button>`), label);
  }
  assert.match(panel, /runStop\(api, target, state\.serverRunning\)/);
  const run = async (target, serverRunning) => {
    const calls = [];
    const api = { bridgeStop: async origin => { calls.push(`bridgeStop ${origin}`); }, serverStop: async origin => { calls.push(`serverStop ${origin}`); } };
    const notice = await runStop(api, target, serverRunning);
    return { calls, notice };
  };
  for (const serverRunning of [true, null, false]) {
    assert.deepEqual((await run('bridge', serverRunning)).calls, ['bridgeStop stop-panel:bridge'], `サーバー: ${serverRunning}`);
  }
  assert.deepEqual((await run('all', true)).calls, ['bridgeStop stop-panel:all', 'serverStop stop-panel:all']);
  assert.deepEqual((await run('all', null)).calls, ['bridgeStop stop-panel:all', 'serverStop stop-panel:all'], '不明なら動いているものとして止める');
  assert.deepEqual((await run('all', false)).calls, ['bridgeStop stop-panel:all'], '止まっている・アプリ外のサーバーは呼ばない');
  assert.deepEqual((await run('server', null)).calls, ['serverStop stop-panel:server']);
  assert.deepEqual((await run('bridge', true)).notice, { type: 'ok', text: '停止しました。' });

  const failing = { bridgeStop: async () => { throw new Error('止まらない'); }, serverStop: async () => {} };
  assert.deepEqual(await runStop(failing, 'all', true), { type: 'error', text: '停止が完了していません。BRIDGE停止: 止まらない' });
});

test('停止パネル: 「不明」は取得に失敗して前回の値もない項目だけ', () => {
  assert.equal(runningLabel(undefined, '稼働中'), '確認中');
  assert.equal(runningLabel(null, '稼働中'), '不明');
  assert.equal(runningLabel(true, '起動中'), '起動中');
  assert.equal(runningLabel(false, '稼働中'), '停止中');
  const rejected = { status: 'rejected', reason: new Error('timeout') };
  // まだ一度も返ってきていない（undefined）項目の確認が失敗したら、確認中から不明へ移る。
  assert.equal(keepLastKnown(undefined, rejected), null);
  assert.equal(keepLastKnown(undefined, { status: 'fulfilled', value: null }), null, 'minecraftStatus が無いときも確認中のまま残さない');
  assert.equal(runningLabel(stopState(keepLastKnown(undefined, rejected), null).bridgeRunning, '稼働中'), '不明');
  // 確認中の項目も、停止前の確認では動いているかもしれないものとして扱う。
  assert.match(stopConfirmMessage('all', stopState(undefined, undefined)), /BRIDGEとサーバーの状態を確認できていません/);
});

test('停止パネル: 作り直したパネルが描画から effect までの間に停止が終わっても「停止しています」のまま固まらない', () => {
  // 停止中に作り直したパネルは busy=true で始まる。effect より前に停止が終わると follow が呼ばれず、全ボタンが押せないままだった。
  const panel = source('components/StopPanel.tsx');
  assert.match(panel, /useState\(\(\) => stopping !== null\)/);
  const effect = panel.slice(panel.indexOf('mounted.current = true;'), panel.indexOf('}, [refresh, follow]);'));
  assert.match(effect, /if \(stopping\) follow\(stopping\);\s*else setBusy\(false\);/);
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

test('カンマ区切り: 欄から離れたら区切り直した値を保存値にも渡し、ミュートは半角カンマだけで区切る', () => {
  // 「暴言、URL、宣伝」を1件として保存した古い設定は、表示だけ3件に区切られて保存値と食い違っていた。
  assert.deepEqual(listInputOnBlur('暴言、URL、宣伝', ['暴言、URL、宣伝']), { text: '暴言, URL, 宣伝', values: ['暴言', 'URL', '宣伝'] });
  assert.deepEqual(listInputOnBlur('a, b,', ['a', 'b']), { text: 'a, b', values: null }, '同じ内容なら親へ渡し直さない');
  assert.deepEqual(listInputOnBlur('a, a', ['a', 'a']), { text: 'a', values: ['a'] });
  // ミュートはニックネームでも照合するので、読点の入った名前を2件に分けない。
  assert.equal(COMMA_ONLY, ',');
  assert.deepEqual(parseListInput('ゆき、だよ, baduser，2', COMMA_ONLY), ['ゆき、だよ', 'baduser，2']);
  assert.equal(sameList('ゆき、だよ, x', ['ゆき、だよ', 'x'], COMMA_ONLY), true, '保存済みの読点入りの名前を入力中に分けない');
  assert.deepEqual(listInputOnBlur('ゆき、だよ', ['ゆき、だよ'], COMMA_ONLY), { text: 'ゆき、だよ', values: null });
});

test('画面: 操作盤が出ない間の停止パネルと、カンマ区切りの欄', () => {
  const app = source('App.tsx');
  const start = app.indexOf('className="game-required"');
  assert.ok(start >= 0, 'game-required の表示がある');
  assert.match(app.slice(start, app.indexOf('</section>', start)), /<StopPanel\b/);
  const operations = source('components/OperationsPage.tsx');
  assert.match(operations, /label="ミュートユーザー（半角カンマ区切り）">\s*<ListInput values=\{o\.mutedUsers[^\n]*separators=\{COMMA_ONLY\}/);
  assert.match(operations, /label="TTS NGワード（カンマ区切り）">\s*<ListInput values=\{o\.ttsNgWords/);
});

test('ミュート欄: 「、」「，」が入っていたら、区切りにならないと欄の下に出す', () => {
  // 日本語入力のままカンマキーを押すと「、」になり、半角カンマだけで区切るミュート欄では2つの名前が黙って1件になっていた。
  assert.equal(hasJapaneseComma(parseListInput('baduser1、baduser2', COMMA_ONLY)), true);
  assert.equal(hasJapaneseComma(parseListInput('baduser1，baduser2', COMMA_ONLY)), true);
  assert.equal(hasJapaneseComma(parseListInput('baduser1, baduser2', COMMA_ONLY)), false);
  assert.equal(hasJapaneseComma([]), false);
  const operations = source('components/OperationsPage.tsx');
  const start = operations.indexOf('label="ミュートユーザー（半角カンマ区切り）"');
  const field = operations.slice(start, operations.indexOf('label="TTS NGワード', start));
  assert.match(field, /\{hasJapaneseComma\(o\.mutedUsers \|\| \[\]\) && <small[^>]*>「、」「，」は区切りになりません。区切るときは半角の「,」を使ってください/);
});

test('配信ホーム: アプリの外で起動したサーバーは「■ サーバー停止」を押せない', () => {
  // server:stop はアプリ外のサーバーを断るので、押すとエラーになっていた（理由は一括操作の下の注意に出ている）。
  const dashboard = source('components/DashboardPage.tsx');
  assert.match(dashboard, /<button type="button" onClick=\{handleServerStop\} disabled=\{[^}]*serverProc\.managed === false[^}]*\}>■ サーバー停止<\/button>/);
  assert.match(dashboard, /このアプリを開く前からサーバーが動いています。/);
});

test('コマンド候補: BridgeMOD が拒否する名前だけに印を付け、title は変えない', () => {
  assert.equal(commandOptionLabel({ name: 'cod.txt', title: 'タラ' }), 'タラ');
  assert.equal(commandOptionLabel({ name: 'cod.txt', title: '' }), 'cod.txt');
  const invalid = { name: 'ネコ.txt', title: 'ネコ', invalidName: true };
  assert.match(commandOptionLabel(invalid), /^⚠ ネコ（ファイル名を半角英数字に変えると使えます）$/);
  assert.equal(invalid.title, 'ネコ');
});
