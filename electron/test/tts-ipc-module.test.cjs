// 読み上げの設定とエンジンの ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTtsIpc } = require('../tts_ipc.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-ipc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'userData'), bridge = path.join(root, 'bridge');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(bridge, { recursive: true });
  fs.writeFileSync(path.join(bridge, 'config.minecraft.json'), '{}');
  const backups = [], handlers = new Map(), records = [];
  const ttsIpc = createTtsIpc({
    app: { getPath: () => userData }, process: { env: {} },
    shell: { openPath: async () => '' }, spawn: () => { throw new Error('起動しない'); },
    getBridgeBatDir: () => bridge, getConfigPath: () => path.join(bridge, 'config.minecraft.json'),
    settingsBackups: { create: kind => backups.push(kind) },
    recordRecovery: entry => records.push(entry), now: () => new Date(2026, 9, 23, 15, 30, 12),
  });
  ttsIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { userData, bridge, backups, records, ttsIpc, bridgeFile: path.join(bridge, 'tts-settings.json'), userFile: path.join(userData, 'tts-settings.json'),
    invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('読み上げの設定: BRIDGE と userData の両方へ整えた値で書き、変わったときだけ自動バックアップを作る', t => {
  const x = setup(t);
  assert.deepEqual(x.invoke('tts:settings:read'), x.ttsIpc.normalizeTtsSettings({}));
  const saved = x.invoke('tts:settings:write', { engine: 'aivis', speedScale: 9 });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.engine, 'aivis');
  assert.equal(saved.settings.speedScale, 2);
  for (const file of [path.join(x.bridge, 'tts-settings.json'), path.join(x.userData, 'tts-settings.json')]) {
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved.settings);
  }
  assert.deepEqual(x.backups, ['automatic']);
  x.invoke('tts:settings:write', saved.settings);
  assert.deepEqual(x.backups, ['automatic'], '同じ設定ではバックアップを作らない');
});

test('読み上げの設定: BRIDGE の設定を正とし、なければ userData を読む', t => {
  const x = setup(t);
  fs.writeFileSync(path.join(x.userData, 'tts-settings.json'), JSON.stringify({ speakerId: 7 }));
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 7);
  fs.writeFileSync(path.join(x.bridge, 'tts-settings.json'), JSON.stringify({ speakerId: 3 }));
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 3);
  assert.equal(x.ttsIpc.getTtsSettingsPath(), path.join(x.userData, 'tts-settings.json'));
});

test('読み上げエンジンの起動: 知らないエンジンは起動しない', async t => {
  const x = setup(t);
  assert.deepEqual(await x.invoke('tts:launchEngine', 'unknown'), { ok: false, message: '未対応の読み上げエンジンです: unknown' });
});

// 読み上げの設定も、壊れていたら写しから戻し、写しも無ければ userData 側を使う（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.2。設定ファイルの PR2）。
// BRIDGE 側が壊れたら、userData 側の今の中身 → BRIDGE 側の写し → userData 側（それも無ければ既定値）の順に使う
// （2026-10-24 ユーザーの決定。PR2 の最後のレビューの重要 1。アプリはいつも2か所に同じ値を書くので、userData 側が最新）。
test('読み上げの設定: BRIDGE 側が壊れたら userData 側の今の中身で戻す。それが使えなければ写し、写しも無ければ既定値', t => {
  const x = setup(t);
  x.ttsIpc.writeTtsSettings({ enabled: false, speakerId: 5 });
  x.ttsIpc.writeTtsSettings({ enabled: false, speakerId: 6 });
  fs.writeFileSync(x.bridgeFile, '{壊れた');
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 6, 'userData 側は最後の保存');
  assert.deepEqual(x.records.map(r => [r.label, r.action, r.sourceLabel]), [['tts-settings.json（BRIDGE のフォルダー）', 'restored', 'userData の読み上げの設定']]);
  assert.equal(fs.readFileSync(x.bridgeFile, 'utf8'), fs.readFileSync(x.userFile, 'utf8'));
  // userData 側も壊れていれば、BRIDGE 側の写し（1つ前の保存）。
  fs.writeFileSync(x.bridgeFile, '{また壊れた');
  fs.writeFileSync(x.userFile, '{これも壊れた');
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 5, '写しは1つ前の保存');
  assert.equal(x.records[1].sourceLabel, undefined);
  // どれも使えなければ既定値。
  fs.writeFileSync(x.bridgeFile, '{三度目');
  for (const file of [x.bridgeFile + '.last-good', x.userFile, x.userFile + '.last-good']) fs.rmSync(file, { force: true });
  assert.deepEqual(x.ttsIpc.readTtsSettings(), x.ttsIpc.normalizeTtsSettings({}));
  assert.equal(x.records.at(-1).action, 'defaults');
  assert.equal(x.records.at(-1).defaultsLabel, 'userData の読み上げの設定（無ければ既定値）');
});

// 写しは「1つ前の保存」なので、「あり→なし」と1回保存しただけだと写しは「あり」のまま（PR2 の最後のレビューの重要 1）。
test('読み上げの設定: 読み上げを切った直後に BRIDGE 側が壊れても、切ったまま', t => {
  const x = setup(t);
  x.ttsIpc.writeTtsSettings({ enabled: true });
  x.ttsIpc.writeTtsSettings({ enabled: false });
  assert.equal(JSON.parse(fs.readFileSync(x.bridgeFile + '.last-good', 'utf8')).enabled, true, '写しは「あり」');
  fs.writeFileSync(x.bridgeFile, '{壊れた');
  assert.equal(x.ttsIpc.readTtsSettings().enabled, false);
});

test('読み上げの設定: userData 側が壊れていても写しから戻す', t => {
  const x = setup(t);
  x.ttsIpc.writeTtsSettings({ speakerId: 8 });
  x.ttsIpc.writeTtsSettings({ speakerId: 9 });
  fs.unlinkSync(x.bridgeFile);
  fs.writeFileSync(x.userFile, 'null');
  assert.equal(x.ttsIpc.readTtsSettings().speakerId, 8);
  assert.deepEqual(x.records.map(r => [r.label, r.reason, r.action]), [['tts-settings.json（userData）', 'オブジェクトでない', 'restored']]);
});

// 古い版は画面の値をそのまま書いていた（処理のコピー PR9 で整えるようになった）。値の型では壊れていると決めない（PR2 の計画の決めたこと 1）。
test('読み上げの設定: 古い版の、画面の値をそのまま書いたファイルは壊れていると扱わない', t => {
  const x = setup(t);
  fs.writeFileSync(x.bridgeFile, JSON.stringify({ speakerId: '3', speedScale: '1.5', enabled: false }));
  const settings = x.ttsIpc.readTtsSettings();
  assert.deepEqual([settings.speakerId, settings.speedScale, settings.enabled], [3, 1.5, false]);
  assert.deepEqual(x.records, []);
  assert.deepEqual(fs.readdirSync(x.bridge).filter(name => name.includes('.broken-')), []);
});

test('読み上げの設定: 書くと2か所とも写しを残す', t => {
  const x = setup(t);
  const first = x.ttsIpc.writeTtsSettings({ speakerId: 1 });
  x.ttsIpc.writeTtsSettings({ speakerId: 2 });
  for (const file of [x.bridgeFile, x.userFile]) assert.deepEqual(JSON.parse(fs.readFileSync(file + '.last-good', 'utf8')), first, file);
});

test('本文: 読み上げの設定を fs で直接読み書きしない。main は記録をつなぐ', () => {
  const source = fs.readFileSync(path.join(__dirname, '../tts_ipc.cjs'), 'utf8');
  assert.doesNotMatch(source, /writeFileSync|readFileSync/);
  assert.match(source, /createSafeJsonFile\(/);
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  assert.match(main.slice(main.indexOf('createTtsIpc({'), main.indexOf('});', main.indexOf('createTtsIpc({'))), /recordRecovery:/);
});
