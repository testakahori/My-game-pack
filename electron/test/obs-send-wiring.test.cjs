// OBS 連携の配線：窓口（obs:get・obs:set）を main でつなぎ、preload・画面の型・開発用の偽物にも足し、運用センターの「動作設定」に欄を置く（2026-10-25）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('OBS 連携の配線: main は窓口をつなぎ、サーバーの起動にアプリの設定を渡す', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /require\('\.\/obs_ipc\.cjs'\)/);
  assert.match(main, /obsSend: \(\) => obsSendSettings\.settingsFromConfig\(readAppConfig\(\)\)/);
});

test('OBS 連携の配線: preload・画面の型・開発用の偽物の3つに obsGet・obsSet がある', () => {
  assert.match(read('electron/preload.cjs'), /obsGet: \(\) => ipcRenderer\.invoke\('obs:get'\),/);
  assert.match(read('electron/preload.cjs'), /obsSet: \(settings\) => ipcRenderer\.invoke\('obs:set', settings\),/);
  const types = read('src/types/electron.d.ts');
  assert.match(types, /obsGet: \(\) => Promise<ObsSendStatus>;/);
  assert.match(types, /obsSet: \(settings: \{ enabled: boolean; endpoint: string \}\) => Promise<ObsSendSaveResult>;/);
  const mock = read('src/lib/devApiMock.ts');
  assert.match(mock, /obsGet: async \(\) =>/);
  assert.match(mock, /obsSet: async \(/);
});

test('OBS 連携の画面: 運用センターの「動作設定」に欄を置き、保存しないままの移動は止める', () => {
  const page = read('src/components/OperationsPage.tsx');
  const safety = page.slice(page.indexOf('hidden={opsTab !== "safety"}'), page.indexOf('<div className="ops-bottom-grid">'));
  assert.match(safety, /<ObsIntegrationSettings \/>/);
  const panel = read('src/components/ObsIntegrationSettings.tsx');
  assert.match(panel, /api\.obsGet\(\)/);
  assert.match(panel, /api\.obsSet\(/);
  assert.match(panel, /useUnsavedChanges\(/);
  assert.ok(panel.includes('次にサーバーを起動したときに効きます'));
  assert.ok(panel.includes('OBS ツールへイベントを送る'));
});
