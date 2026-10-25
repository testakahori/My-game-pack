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

function ipc(t, { serverRunning = false, serverFolder = true } = {}) {
  const server = tempDir(t);
  let config = {};
  const handlers = new Map();
  const api = createObsIpc({
    readAppConfig: () => ({ ...config }),
    writeAppConfig: next => { config = { ...config, ...next }; },
    getServerRoot: () => (serverFolder ? server : path.join(server, 'missing')),
    isServerRunning: async () => serverRunning,
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
