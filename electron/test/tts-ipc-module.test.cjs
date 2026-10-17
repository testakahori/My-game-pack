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
  const backups = [], handlers = new Map();
  const ttsIpc = createTtsIpc({
    app: { getPath: () => userData }, process: { env: {} },
    shell: { openPath: async () => '' }, spawn: () => { throw new Error('起動しない'); },
    getBridgeBatDir: () => bridge, getConfigPath: () => path.join(bridge, 'config.minecraft.json'),
    settingsBackups: { create: kind => backups.push(kind) },
  });
  ttsIpc.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { userData, bridge, backups, ttsIpc, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
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
