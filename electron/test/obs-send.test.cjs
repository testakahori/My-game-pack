// OBS 連携：標準装備の OBSMOD が OBS ツールへ送るかを、運用センターの「動作設定」で決める（2026-10-25 ユーザーの決定。HANDOFF04 の PR3）。
// 決めた内容はアプリの設定（app-config.json の obsSendEnabled・obsSendEndpoint）に残し、サーバーの
// config/minecraft_obs_bridge/obs-send.properties に書く（OBSMOD 2.4.8 の ObsSendSettings が、サーバーの起動のときに読む）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const obs = require('../obs_send.cjs');
const { createObsIpc } = require('../obs_ipc.cjs');

const tempDir = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-send-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('OBS 連携: 送り先は http・https の URL だけ。空なら既定の送り先', () => {
  assert.equal(obs.DEFAULT_ENDPOINT, 'http://127.0.0.1:3000/event');
  assert.equal(obs.normalizeEndpoint(''), '');
  assert.equal(obs.normalizeEndpoint('   '), '');
  for (const ok of ['http://127.0.0.1:3000/event', 'https://obs.example:443/event', 'HTTP://192.168.0.5:3000/event', 'http://[::1]:3000/event', 'http://localhost:3000/event?a=1&b=2']) {
    assert.equal(obs.normalizeEndpoint(` ${ok} `), ok, ok);
  }
  const bad = [
    ['ftp://192.168.0.5/event', /http:\/\/ か https:\/\//],
    ['192.168.0.5:3000/event', /http:\/\/ か https:\/\//],
    ['http://', /http:\/\/ か https:\/\//],
    ['http://user:pw@127.0.0.1:3000/event', /ユーザー名・パスワード/],
    ['http://127.0.0.1:3000/ev ent', /使えない文字/],
    ['http://127.0.0.1:3000/ev\\ent', /使えない文字/],
    ['http://例え.jp/event', /使えない文字/],
    ['http://127.0.0.1:3000/event\nenabled=true', /使えない文字/],
    [`http://127.0.0.1/${'a'.repeat(2000)}`, /長すぎ/],
  ];
  for (const [value, message] of bad) assert.throws(() => obs.normalizeEndpoint(value), message, value);
});

// JS の URL は寛容に直して読むが、OBSMOD（Java の URI）はそのまま読み、ホストが無い・構文の誤りなら既定の送り先に置き換える。
// OBSMOD でそのまま使えない送り先は、アプリでも断る（PR3 の最後のレビュー 重要1。ObsSendParity が Java で照らす）。
test('OBS 連携: OBSMOD でそのまま使えない送り先は断る（打ち間違い・ホスト名・IP の書き方・% の書き方）', () => {
  const mismatched = [
    'http:/192.168.0.5:3000/event', 'http:192.168.0.5:3000/event', 'http:///192.168.0.5:3000/event',
    'http://my_host:3000/event', 'http://a..b/event', 'http://a-.example/event', 'http://-a.example/event', 'http://foo.1abc/event',
    'http://./event', 'http://../event', 'http://*.example/event', 'http://a!b/event', 'http://a~b/event',
    'http://127.1:3000/event', 'http://0x7f.0.0.1/event', 'http://127.0.0.1.:3000/event', 'http://%31%32%37.0.0.1/event', 'http://ex%41mple.com/event',
    'http://@127.0.0.1:3000/event', 'http://:@127.0.0.1:3000/event',
    'http://127.0.0.1:3000/100%', 'http://127.0.0.1:3000/%zz', 'http://127.0.0.1:3000/a[0]', 'http://127.0.0.1:3000/#a#b',
    'http://256.1.1.1/event', 'http://127.0.0.1:65536/event', 'http://[fe80::1%25eth0]/event',
  ];
  for (const value of mismatched) assert.throws(() => obs.normalizeEndpoint(value), Error, value);
  for (const ok of ['HtTp://127.0.0.1:3000/event', 'http://[::ffff:127.0.0.1]:3000/event', 'http://localhost.:3000/event', 'http://127.0.0.1:/event', 'http://obs-tool.local:3000/event', 'http://192.168.0.5:3000/%E3%82%A2?x=1#top']) {
    assert.equal(obs.normalizeEndpoint(ok), ok, ok);
  }
});

test('OBS 連携: OBSMOD に渡すファイルは UTF-8・BOM なしの2行（送り先が空なら既定を書く）', t => {
  assert.equal(obs.propertiesText({ enabled: true, endpoint: '' }), 'enabled=true\nendpoint=http://127.0.0.1:3000/event\n');
  assert.equal(obs.propertiesText({ enabled: false, endpoint: 'http://192.168.0.5:3000/event' }), 'enabled=false\nendpoint=http://192.168.0.5:3000/event\n');
  assert.deepEqual(obs.settingsFromConfig({}), { enabled: false, endpoint: '' });
  assert.deepEqual(obs.settingsFromConfig({ obsSendEnabled: true, obsSendEndpoint: 'http://192.168.0.5:3000/event' }), { enabled: true, endpoint: 'http://192.168.0.5:3000/event' });
  const server = tempDir(t);
  const file = obs.writeObsSend(server, { enabled: true, endpoint: '' });
  assert.equal(file, path.join(server, 'config', 'minecraft_obs_bridge', 'obs-send.properties'));
  const bytes = fs.readFileSync(file);
  assert.notEqual(bytes[0], 0xef, 'BOM を付けない');
  assert.equal(bytes.toString('utf8'), 'enabled=true\nendpoint=http://127.0.0.1:3000/event\n');
  obs.writeObsSend(server, { enabled: false, endpoint: '' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'enabled=false\nendpoint=http://127.0.0.1:3000/event\n', '書き直す');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['obs-send.properties'], '書きかけのファイルを残さない');
});

function ipc(t, { serverRunning = false, serverFolder = true, runningFails = false, runBat = true } = {}) {
  const server = tempDir(t);
  if (runBat) fs.writeFileSync(path.join(server, 'run.bat'), '');
  let config = {};
  const handlers = new Map();
  const api = createObsIpc({
    readAppConfig: () => ({ ...config }),
    writeAppConfig: next => { config = { ...config, ...next }; },
    getServerRoot: () => (serverFolder ? server : path.join(server, 'missing')),
    isServerRunning: async () => { if (runningFails) throw new Error('connect EHOSTUNREACH'); return serverRunning; },
  });
  api.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { server, config: () => config, invoke: (name, ...args) => handlers.get(name)({}, ...args), file: path.join(server, 'config', 'minecraft_obs_bridge', 'obs-send.properties') };
}

test('OBS 連携の窓口: obs:get は今の設定と既定の送り先を返す', async t => {
  const x = ipc(t);
  assert.deepEqual(await x.invoke('obs:get'), { enabled: false, endpoint: '', defaultEndpoint: 'http://127.0.0.1:3000/event', serverRunning: false });
});

test('OBS 連携の窓口: obs:set は確かめてからアプリの設定とサーバーのファイルに書く', async t => {
  const x = ipc(t);
  assert.deepEqual(await x.invoke('obs:set', { enabled: true, endpoint: ' http://192.168.0.5:3000/event ' }), { ok: true, serverRunning: false, wroteServer: true });
  assert.deepEqual(x.config(), { obsSendEnabled: true, obsSendEndpoint: 'http://192.168.0.5:3000/event' });
  assert.equal(fs.readFileSync(x.file, 'utf8'), 'enabled=true\nendpoint=http://192.168.0.5:3000/event\n');
  assert.deepEqual(await x.invoke('obs:get'), { enabled: true, endpoint: 'http://192.168.0.5:3000/event', defaultEndpoint: 'http://127.0.0.1:3000/event', serverRunning: false });
});

test('OBS 連携の窓口: 送り先やオン・オフがおかしければ、何も書かずに理由を返す', async t => {
  const x = ipc(t);
  await assert.rejects(x.invoke('obs:set', { enabled: true, endpoint: 'http://user:pw@127.0.0.1:3000/event' }), /ユーザー名・パスワード/);
  await assert.rejects(x.invoke('obs:set', { enabled: 'yes', endpoint: '' }), /オン・オフ/);
  await assert.rejects(x.invoke('obs:set', null), /オン・オフ/);
  assert.deepEqual(x.config(), {});
  assert.equal(fs.existsSync(x.file), false);
});

test('OBS 連携の窓口: サーバーが動いている間に保存したら、次の起動で効くと知らせる。サーバーのフォルダーが無ければアプリの設定だけ残す', async t => {
  const running = ipc(t, { serverRunning: true });
  assert.deepEqual(await running.invoke('obs:set', { enabled: true, endpoint: '' }), { ok: true, serverRunning: true, wroteServer: true });
  const missing = ipc(t, { serverFolder: false });
  assert.deepEqual(await missing.invoke('obs:set', { enabled: true, endpoint: '' }), { ok: true, serverRunning: false, wroteServer: false });
  assert.deepEqual(missing.config(), { obsSendEnabled: true, obsSendEndpoint: '' });
});

test('OBS 連携: アプリの設定の項目（画面から直接は書かせない。窓口で確かめてから書く）', () => {
  const fields = JSON.parse(fs.readFileSync(path.join(root, 'electron/app_config_fields.json'), 'utf8'));
  assert.equal(fields.fields.obsSendEnabled, false);
  assert.equal(fields.fields.obsSendEndpoint, '');
  assert.ok(!fields.rendererWritable.includes('obsSendEnabled') && !fields.rendererWritable.includes('obsSendEndpoint'));
});

// サーバーが動いているかは知らせのための情報。確かめられない（ポートの確かめが失敗した）ときも、読む・保存するは失敗させない（PR3 の最後のレビュー 重要4）。
test('OBS 連携の窓口: サーバーが動いているかを確かめられなくても、読めて、保存もできる（null で知らせる）', async t => {
  const x = ipc(t, { runningFails: true });
  assert.deepEqual(await x.invoke('obs:get'), { enabled: false, endpoint: '', defaultEndpoint: 'http://127.0.0.1:3000/event', serverRunning: null });
  assert.deepEqual(await x.invoke('obs:set', { enabled: true, endpoint: '' }), { ok: true, serverRunning: null, wroteServer: true });
  assert.equal(fs.readFileSync(x.file, 'utf8'), 'enabled=true\nendpoint=http://127.0.0.1:3000/event\n');
});

// 書きかけを残さない（置き換えに失敗しても一時ファイルを消す。アプリの丈夫な書き方 writeFileDurable を使う。PR3 の最後のレビュー 軽い1）。
test('OBS 連携: 書けなかったときも一時ファイルを残さない', t => {
  const server = tempDir(t);
  fs.mkdirSync(obs.obsSendFile(server), { recursive: true });
  assert.throws(() => obs.writeObsSend(server, { enabled: true, endpoint: '' }));
  assert.deepEqual(fs.readdirSync(path.dirname(obs.obsSendFile(server))), ['obs-send.properties'], 'ファイルの代わりにフォルダーがあるだけ（.tmp は残らない）');
});

// 手で直すなどして壊れたアプリの設定の送り先は使わない（改行や \ が入ると properties の中身が変わる。軽い3）。
test('OBS 連携: アプリの設定の送り先がおかしければ、既定の送り先にする', () => {
  assert.deepEqual(obs.settingsFromConfig({ obsSendEnabled: false, obsSendEndpoint: 'http://x/\nenabled=true' }), { enabled: false, endpoint: '' });
  assert.deepEqual(obs.settingsFromConfig({ obsSendEnabled: true, obsSendEndpoint: 'http:/192.168.0.5:3000/event' }), { enabled: true, endpoint: '' });
});

// どこが悪いかが分かる文にする（軽い5・10）。
test('OBS 連携: 断るときの文は、直す所が分かる', () => {
  assert.throws(() => obs.normalizeEndpoint('http://256.1.1.1/event'), /ホスト名・IP アドレス/);
  assert.throws(() => obs.normalizeEndpoint('http://127.0.0.1:65536/event'), /ポートは 0〜65535/);
  assert.throws(() => obs.normalizeEndpoint('http://127.0.0.1:3000/100%'), /% のあとは16進数2桁/);
});

test('OBS 連携の窓口: 渡す値の形がおかしければ断る（軽い4）', async t => {
  const x = ipc(t);
  await assert.rejects(x.invoke('obs:set', { enabled: true, endpoint: ['http://192.168.0.5:3000/event'] }), /送り先/);
  await assert.rejects(x.invoke('obs:set', [true, '']), /オン・オフ/);
  // enabled を持つ配列も断る（配列は普通のオブジェクトとして扱わない）。
  await assert.rejects(x.invoke('obs:set', Object.assign([], { enabled: true, endpoint: '' })), /オン・オフ/);
  assert.deepEqual(x.config(), {});
});

// サーバーのファイルが書けなくても、アプリの設定には残る。起動の直前にも書くので、失敗とせずに知らせる（軽い2）。
test('OBS 連携の窓口: サーバーのファイルが書けなくても、アプリの設定に保存して、書けなかったことを知らせる', async t => {
  const x = ipc(t);
  fs.mkdirSync(x.file, { recursive: true });
  const result = await x.invoke('obs:set', { enabled: true, endpoint: '' });
  assert.equal(result.ok, true);
  assert.equal(result.wroteServer, false);
  assert.match(result.serverWriteError, /サーバーのファイルを書けませんでした/);
  assert.deepEqual(x.config(), { obsSendEnabled: true, obsSendEndpoint: '' });
});

// サーバーでないフォルダー（run.bat が無い）には書かない（軽い9）。
test('OBS 連携の窓口: run.bat の無いフォルダーには書かない', async t => {
  const x = ipc(t, { runBat: false });
  assert.deepEqual(await x.invoke('obs:set', { enabled: true, endpoint: '' }), { ok: true, serverRunning: false, wroteServer: false });
  assert.equal(fs.existsSync(x.file), false);
});
