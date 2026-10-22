// ギフト一覧（UI タブ・GiftsViewer）の読み込み・更新・画像・コピーの ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGiftsViewer } = require('../gifts_viewer.cjs');

function setup(t, { username = 'akahoridouma' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gifts-viewer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const gv = path.join(root, 'gv'), tools = path.join(root, 'tools');
  fs.mkdirSync(gv); fs.mkdirSync(tools);
  for (const file of ['fetch_gifts.cjs', 'gifts_to_html.cjs']) fs.writeFileSync(path.join(tools, file), '');
  const configPath = path.join(root, 'config.minecraft.json');
  fs.writeFileSync(configPath, JSON.stringify({ tiktokUsername: username }));
  const log = [], calls = [], sent = [], handlers = new Map();
  // 取得の道具の代わり。--out のフォルダーに、取得したギフトと HTML を書く。
  const runProc = async (cmd, args, _cwd, options = {}) => {
    log.push({ cmd, tool: path.basename(args[0]), env: options.env });
    const out = args[args.indexOf('--out') + 1];
    if (args[0].endsWith('fetch_gifts.cjs')) {
      await new Promise(resolve => setTimeout(resolve, 20));
      const gifts = [{ id: 5655, name: 'バラ', diamond_count: 1 }];
      for (const file of ['gifts.min.json', 'gifts.full.json']) fs.writeFileSync(path.join(out, file), JSON.stringify(gifts));
      fs.writeFileSync(path.join(out, 'gifts.meta.json'), JSON.stringify({ username: args[1], count: 1, generatedAt: new Date().toISOString() }));
    } else fs.writeFileSync(path.join(out, 'gifts.html'), '<html></html>');
    return { out: '' };
  };
  const viewer = createGiftsViewer({
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...args) => sent.push(args) } }] },
    shell: { openPath: async () => '' }, net: { fetch: async () => { throw new Error('通信しない'); } },
    clipboard: { writeText: () => {}, writeImage: () => {} }, nativeImage: { createFromDataURL: () => ({ isEmpty: () => false }) },
    runProc, eulerCredentials: { runtime: () => ({ env: { SIGN_API_KEY: 'fixture-key' } }) },
    getConfigPath: () => configPath, getGiftsDir: () => gv, getGiftsMinPath: () => path.join(gv, 'gifts.min.json'),
    getGiftsMetaPath: () => path.join(gv, 'gifts.meta.json'), getGiftsHtmlPath: () => path.join(gv, 'gifts.html'), ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
    getGvDataDir: () => gv, getGvSettingsPath: () => path.join(gv, 'settings.json'), getGvToolPath: name => path.join(tools, name),
    getNodeCommand: () => 'node-fixture', ensureNodeRuntimeAvailable: async () => calls.push('node-ready'),
  });
  viewer.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { gv, configPath, log, calls, sent, viewer, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('ギフトの更新: main から受け取った node・runProc・Euler の鍵で取得して画面へ知らせる。作ったものごとに更新中の状態を持つ', async t => {
  const a = setup(t), b = setup(t);
  const [first, second] = await Promise.all([a.invoke('gv:gifts:update', 'user_a'), b.invoke('gv:gifts:update', 'user_b')]);
  assert.equal(first.meta.username, 'user_a');
  assert.equal(second.meta.username, 'user_b', '別のアカウントの更新中として止めない');
  assert.deepEqual(a.log.map(call => [call.cmd, call.tool]), [['node-fixture', 'fetch_gifts.cjs'], ['node-fixture', 'gifts_to_html.cjs']]);
  assert.equal(a.log[0].env.SIGN_API_KEY, 'fixture-key');
  assert.deepEqual(a.calls, ['node-ready']);
  assert.deepEqual(a.sent.map(args => args[0]), ['gifts:updated']);
  assert.equal((await a.invoke('gv:gifts:read')).gifts[0].name, 'バラ');
});

test('起動時の自動更新: TikTok ID がなければ取らず、同じ ID で24時間以内に取ってあれば取らない', async t => {
  const x = setup(t, { username: '' });
  assert.deepEqual(await x.viewer.autoUpdateGiftsIfStale(), { skipped: 'username' });
  fs.writeFileSync(x.configPath, JSON.stringify({ tiktokUsername: '@akahoridouma' }));
  fs.writeFileSync(path.join(x.gv, 'gifts.min.json'), '[]');
  fs.writeFileSync(path.join(x.gv, 'gifts.meta.json'), JSON.stringify({ username: 'akahoridouma', count: 1, generatedAt: new Date().toISOString() }));
  assert.deepEqual(await x.viewer.autoUpdateGiftsIfStale(), { skipped: 'fresh' });
  assert.equal(x.log.length, 0);
});

// 設定の TikTok ID は入力のままの形で保存し、使う所で bridge/tiktok_id.cjs の形に整える（2026-10-18 設計書の 9。PR3 の最終レビュー）。
test('起動時の自動更新: 設定の TikTok ID は配信前チェック・BRIDGE と同じく整え（空白・@・大文字）、取った一覧の ID も同じ形で比べる', async t => {
  const x = setup(t, { username: ' @AkahoriDouma ' });
  fs.writeFileSync(path.join(x.gv, 'gifts.min.json'), '[]');
  fs.writeFileSync(path.join(x.gv, 'gifts.meta.json'), JSON.stringify({ username: 'AkahoriDouma', count: 1, generatedAt: new Date().toISOString() }));
  assert.deepEqual(await x.viewer.autoUpdateGiftsIfStale(), { skipped: 'fresh' }, '大文字で取った一覧も同じ ID の一覧');
  fs.writeFileSync(path.join(x.gv, 'gifts.meta.json'), JSON.stringify({ username: 'akahoridouma', count: 1, generatedAt: '2000-01-01T00:00:00.000Z' }));
  assert.deepEqual(await x.viewer.autoUpdateGiftsIfStale(), { ok: true });
  assert.equal((await x.invoke('gv:gifts:read')).meta.username, 'akahoridouma', '整えた形で取りにいく');
});

// 自動更新は整えた形（akahoridouma）で取りにいくので、手で押した更新（ギフト一覧タブは設定の AkahoriDouma のまま渡す）も
// 同じ形に整えて比べないと、「別のアカウントのギフトを更新中です」で止まる（最終レビューの軽い指摘の直しのレビュー）。
test('ギフトの更新: 自動更新の最中に、大文字や @ の違う同じ ID で更新しても、同じ取得に合流する', async t => {
  const x = setup(t, { username: 'AkahoriDouma' });
  const [auto, manual] = await Promise.all([x.viewer.autoUpdateGiftsIfStale(), x.invoke('gv:gifts:update', '@AkahoriDouma')]);
  assert.deepEqual(auto, { ok: true });
  assert.equal(manual.meta.username, 'akahoridouma');
  assert.equal(x.log.filter(call => call.tool === 'fetch_gifts.cjs').length, 1, '取りにいくのは1回');
});
