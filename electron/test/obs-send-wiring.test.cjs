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

// 帯の「変更を保存」は、このページの動作設定の保存。OBS の欄だけが未保存のときは出さない（OBS の欄は自分の保存ボタンを持つ。PR3 の最後のレビュー 重要2）。
test('OBS 連携の画面: 帯の「変更を保存」は、動作設定が未保存のときだけ出す（OBS の欄の未保存では出さない）', () => {
  const page = read('src/components/OperationsPage.tsx');
  assert.match(page, /const opsDirty = Boolean\(savedSnapshot\) && currentSnapshot !== savedSnapshot;/);
  assert.match(page, /useUnsavedChanges\(opsDirty, saving\);/);
  assert.match(page, /\{opsDirty && <button className="studio-ops-save"/);
  assert.doesNotMatch(page, /\{hasChanges && <button className="studio-ops-save"/);
});

// 運用センターの CSS は input を横いっぱいにするので、チェックボックスは既にある ops-check-row で小さく描く。見出しの下も今の欄と同じだけ空ける（重要3）。
test('OBS 連携の画面: チェックボックスは ops-check-row で描き、見出しの下を空ける', () => {
  const panel = read('src/components/ObsIntegrationSettings.tsx');
  assert.match(panel, /<label className="ops-check-row">\s*<input type="checkbox"/);
  assert.match(panel, /<div className="ops-stability-fields mt-3\.5">/);
  assert.ok(panel.includes('サーバーが動いているかは確かめられませんでした'), 'serverRunning が null のときの文');
});
