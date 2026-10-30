// BRIDGE の配布（差分同期・同梱 node の準備・BridgeMOD の jar・ゲーム MOD の入れ替え）・サーバーテンプレートのコピー・BRIDGE の展開（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridgeSync } = require('../bridge_sync.cjs');

function setup(t, { packaged = true, appConfig = () => ({}), clearEulerCredentials = () => {}, serverRunning = () => false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources'), server = path.join(root, 'server');
  fs.mkdirSync(path.join(resources, 'bridge'), { recursive: true });
  fs.mkdirSync(server, { recursive: true });
  let config = appConfig(server);
  const ran = [], sent = [], handlers = new Map(), writes = [];
  // zip の展開（tar.exe）の代わり。展開先に node.exe と依存パッケージを置く。
  const runProc = async (cmd, args, cwd) => {
    ran.push([cmd, ...args]);
    for (const [file, body] of [['node/node.exe', 'node'], ['node_modules/tiktok-live-connector/package.json', '{}'], ['node_modules/rcon-client/package.json', '{}']]) {
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), body);
    }
    return { out: '' };
  };
  const bridgeSync = createBridgeSync({
    app: { isPackaged: packaged, getVersion: () => '2.0.0', getPath: () => root },
    process: { resourcesPath: resources }, appDir: path.join(root, 'app', 'electron'),
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => sent.push(args) } }] },
    runProc,
    readAppConfig: () => config, writeAppConfig: (patch, options) => { writes.push([patch, options]); config = { ...config, ...patch }; },
    getBridgeBatDir: () => path.join(server, 'bridge'),
    getServerTemplatePath: () => path.join(resources, 'server', 'Douma_Craft'),
    gameProfiles: {}, gameProfileOperation: async action => action(), assertGameProfileIdle: () => {},
    serverChild: () => (serverRunning() ? {} : null), isServerPortOpen: async () => false, clearEulerCredentials,
  });
  bridgeSync.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { resources, server, ran, sent, writes, bridgeSync, config: () => config, patchConfig: patch => { config = { ...config, ...patch }; }, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('BRIDGE の実行環境: 開発版は何もしない。配布版で zip から展開するときは main から受け取った runProc で tar を動かし、進み具合を画面へ知らせる', async t => {
  const dev = setup(t, { packaged: false });
  assert.deepEqual(await dev.bridgeSync.ensureNodeRuntimeAvailable(), { ready: true, development: true });
  assert.equal(dev.ran.length, 0);
  const x = setup(t);
  const archive = path.join(x.resources, 'bridge', 'bridge-runtime.zip');
  fs.writeFileSync(archive, 'zip');
  fs.writeFileSync(path.join(x.resources, 'bridge', 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'archive', nodeExeBytes: 4 }));
  const result = await x.bridgeSync.ensureNodeRuntimeAvailable();
  assert.equal(result.reason, 'extracted');
  assert.deepEqual(x.ran, [['tar.exe', '-xf', archive, '-C', path.join(x.server, 'bridge')]]);
  assert.equal(x.sent[0][0], 'bridge:syncStatus');
  assert.equal(x.sent[0][1].phase, 'extracting-runtime');
  assert.equal(x.invoke('bridge:syncStatus').phase, 'extracting-runtime');
});

test('アプリ更新後の BRIDGE の同期: 違う版なら写して版を記録し、同じ版で展開済みなら写さない。同期の状態は作ったものごとに持つ', async t => {
  const x = setup(t, { appConfig: server => ({ setupComplete: true, serverFolder: server, bridgeVersion: '1.0.0' }) });
  const src = path.join(x.resources, 'bridge');
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.js'), '// bridge');
  fs.writeFileSync(path.join(src, 'index.bundle.cjs'), '// bundle');
  fs.writeFileSync(path.join(src, 'node', 'node.exe'), 'node');
  fs.writeFileSync(path.join(src, 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'bundle', nodeExeBytes: 4 }));
  await x.bridgeSync.ensureBridgeExtracted();
  assert.ok(fs.existsSync(path.join(x.server, 'bridge', 'index.js')));
  assert.equal(x.config().bridgeVersion, '2.0.0');
  assert.equal(x.invoke('bridge:syncStatus').state, 'done');
  await x.bridgeSync.ensureBridgeExtracted();
  assert.deepEqual([x.invoke('bridge:syncStatus').state, x.invoke('bridge:syncStatus').phase], ['current', 'skipped']);
  const other = setup(t);
  assert.equal(other.invoke('bridge:syncStatus').state, 'idle', '別に作ったものの同期の状態は変わらない');
});

// 新しい保存先（BRIDGE の設定がまだ無い所）を作ったときだけ、この PC に残っていた前の記録を空にする（2026-10-30 ユーザーの決定「新しい保存先では空にする」・API キーも「消す」）。
// 前は、開発版と同じ %APPDATA% に残っていたマイクラID・API キーが、入れたばかりのアプリに出ていた。画面が覚えていた TikTok ユーザー名は、返す newFolder を見て画面が消す。
test('BRIDGE の展開: 新しい保存先ではマイクラID と API キーを消して印を返す。同じ保存先への入れ直し・開発版では消さない', async t => {
  let cleared = 0;
  const x = setup(t, { appConfig: () => ({ minecraftPlayerName: 'Douma_Akahori' }), clearEulerCredentials: () => { cleared += 1; } });
  const src = path.join(x.resources, 'bridge');
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.js'), '// bridge');
  fs.writeFileSync(path.join(src, 'index.bundle.cjs'), '// bundle');
  fs.writeFileSync(path.join(src, 'node', 'node.exe'), 'node');
  fs.writeFileSync(path.join(src, 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'bundle', nodeExeBytes: 4 }));
  fs.writeFileSync(path.join(src, 'config.minecraft.json'), JSON.stringify({ tiktokUsername: 'smile09351', rcon: { password: 'dev-secret' } }));
  const first = await x.invoke('bridge:extractTo', x.server);
  assert.equal(first.newFolder, true);
  assert.equal(x.config().minecraftPlayerName, '');
  assert.deepEqual(x.writes.find(([patch]) => 'minecraftPlayerName' in patch), [{ minecraftPlayerName: '' }, { forgetPrevious: true }], '前のマイクラID を設定の写しにも残さない（レビュー 軽い7）');
  assert.equal(cleared, 1, 'API キーを消す');
  assert.equal(fs.existsSync(path.join(x.server, 'bridge', '.account-reset-pending')), false, '消し終えたら印を外す');
  const written = JSON.parse(fs.readFileSync(path.join(x.server, 'bridge', 'config.minecraft.json'), 'utf8'));
  assert.deepEqual([written.tiktokUsername, written.rcon.password], ['', '']);
  x.patchConfig({ minecraftPlayerName: 'Steve' });
  const again = await x.invoke('bridge:extractTo', x.server);
  assert.equal(again.newFolder, false);
  assert.equal(x.config().minecraftPlayerName, 'Steve', '同じ保存先への入れ直しでは消さない');
  assert.equal(cleared, 1);
  let devCleared = 0;
  const dev = setup(t, { packaged: false, appConfig: () => ({ minecraftPlayerName: 'Steve' }), clearEulerCredentials: () => { devCleared += 1; } });
  assert.deepEqual(await dev.invoke('bridge:extractTo', dev.server), { ok: true, skipped: true });
  assert.deepEqual([dev.config().minecraftPlayerName, devCleared], ['Steve', 0], '開発版では何もしない');
});

test('BRIDGE の展開: API キーを消せなくても、セットアップは止めない（マイクラID は消す）', async t => {
  const x = setup(t, { appConfig: () => ({ minecraftPlayerName: 'Douma_Akahori' }), clearEulerCredentials: () => { throw new Error('APIキーを削除できませんでした。'); } });
  const src = path.join(x.resources, 'bridge');
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.bundle.cjs'), '// bundle');
  fs.writeFileSync(path.join(src, 'node', 'node.exe'), 'node');
  fs.writeFileSync(path.join(src, 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'bundle', nodeExeBytes: 4 }));
  fs.writeFileSync(path.join(src, 'config.minecraft.json'), JSON.stringify({ tiktokUsername: 'x' }));
  const result = await x.invoke('bridge:extractTo', x.server);
  assert.equal(result.newFolder, true);
  assert.equal(x.config().minecraftPlayerName, '');
});

test('BRIDGE の展開: main は API キーを消す関数を渡す', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /clearEulerCredentials: \(\) => bridgeProcess\.clearEulerKey\(\)/);
  // 「削除」ボタンと同じ1か所で、配信の確かめのキャッシュも一緒に消す（レビュー 軽い4）。
  const proc = fs.readFileSync(path.resolve(__dirname, '../bridge_process.cjs'), 'utf8');
  assert.match(proc, /function clearEulerKey\(\) \{\s*eulerCredentials\.clear\(\);\s*checkTikTokLive\.clearCache\(\);/);
  assert.match(proc, /ipcMain\.handle\('euler:clear', \(\) => \{\s*clearEulerKey\(\);/);
});

// 新しい保存先の印は、写す前に置き、失敗しうる処理を全部終えてから消す。途中で止まってやり直しても消し損なわない（PR #176 レビュー 重要1）。
// 例：完了画面の「フォルダを選択」を Minecraft サーバーが動いたまま押すと、BridgeMOD の入れ替えで止まる。サーバーを止めて選び直す。
test('BRIDGE の展開: 途中で止まってやり直しても、新しい保存先の記録は消す。消すのは失敗しうる処理を終えてから', async t => {
  let cleared = 0, running = true;
  const x = setup(t, { appConfig: () => ({ minecraftPlayerName: 'Old_Player' }), clearEulerCredentials: () => { cleared += 1; }, serverRunning: () => running });
  const src = path.join(x.resources, 'bridge');
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  fs.writeFileSync(path.join(src, 'index.bundle.cjs'), '// bundle');
  fs.writeFileSync(path.join(src, 'node', 'node.exe'), 'node');
  fs.writeFileSync(path.join(src, 'bridge-runtime-manifest.json'), JSON.stringify({ runtimeKind: 'bundle', nodeExeBytes: 4 }));
  fs.writeFileSync(path.join(src, 'config.minecraft.json'), JSON.stringify({ tiktokUsername: 'x' }));
  const mods = path.join(x.resources, 'server', 'Douma_Craft', 'mods');
  fs.mkdirSync(mods, { recursive: true });
  fs.writeFileSync(path.join(mods, 'bridgemod-1.0.0.jar'), require('./fake-mod-jar.cjs').fakeModJar('bridgemod'));
  await assert.rejects(x.invoke('bridge:extractTo', x.server), /停止/);
  assert.deepEqual([x.config().minecraftPlayerName, cleared], ['Old_Player', 0], '止まったときはまだ消さない');
  running = false;
  const retry = await x.invoke('bridge:extractTo', x.server);
  assert.equal(retry.newFolder, true, 'やり直しでも新しい保存先');
  assert.deepEqual([x.config().minecraftPlayerName, cleared], ['', 1]);
  assert.equal((await x.invoke('bridge:extractTo', x.server)).newFolder, false, '消し終えたあとは入れ直し');
  assert.equal(cleared, 1);
});
