// 画面のウィンドウ・CSP・ウィンドウ操作の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 閉じる確認・移動の制限・権限の拒否・CSP は、分ける前と同じであることを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAppWindow } = require('../window.cjs');

function setup({ isDev = false, busy = false } = {}) {
  const calls = { opened: [], dialogs: [], headers: null, permissionCheck: null, permissionRequest: null, devtools: false, onChannels: new Map() };
  const windowListeners = {}, contentsListeners = {};
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.webContents = {
        setWindowOpenHandler: fn => { this.openHandler = fn; },
        on: (name, fn) => { contentsListeners[name] = fn; },
        openDevTools: () => { calls.devtools = true; },
      };
    }
    on(name, fn) { windowListeners[name] = fn; }
    loadFile(file) { calls.loaded = file; }
    static fromWebContents(sender) { return sender.win; }
  }
  const session = { defaultSession: {
    webRequest: { onHeadersReceived: fn => { calls.headers = fn; } },
    setPermissionCheckHandler: fn => { calls.permissionCheck = fn; },
    setPermissionRequestHandler: fn => { calls.permissionRequest = fn; },
  } };
  const dialog = { showMessageBox: (_win, options) => { calls.dialogs.push(options.title); return Promise.resolve(); }, showMessageBoxSync: () => 0 };
  const shell = { openExternal: url => { calls.opened.push(url); return Promise.resolve(); } };
  const appDir = path.join(path.parse(process.cwd()).root, 'app', 'electron');
  const appWindow = createAppWindow({ BrowserWindow: FakeWindow, session, dialog, shell, appDir, isDev, isBusy: () => busy });
  appWindow.register({ on: (name, fn) => calls.onChannels.set(name, fn) });
  return { appWindow, calls, windowListeners, contentsListeners, appDir };
}

test('ウィンドウ: 枠なし・サンドボックス・preload を付け、dist/index.html を開く。権限はすべて断る', () => {
  const { appWindow, calls, appDir } = setup();
  const win = appWindow.createWindow();
  assert.equal(win.options.frame, false);
  assert.deepEqual(win.options.webPreferences, { preload: path.join(appDir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true });
  assert.equal(calls.loaded, path.join(appDir, '..', 'dist', 'index.html'));
  assert.equal(calls.permissionCheck(), false);
  let granted = null;
  calls.permissionRequest(null, 'media', value => { granted = value; });
  assert.equal(granted, false);
  assert.equal(calls.devtools, false, '開発版でなければ開発者ツールを開かない');
});

test('作業中は閉じない（保存・準備中の知らせを出す）。作業中でなければ閉じる', () => {
  for (const busy of [true, false]) {
    const { appWindow, calls, windowListeners } = setup({ busy });
    appWindow.createWindow();
    let prevented = false;
    windowListeners.close({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, busy);
    assert.deepEqual(calls.dialogs, busy ? ['保存・準備中です'] : []);
  }
});

test('移動は index.html だけ。外部リンクは http(s) だけを OS のブラウザで開き、それ以外は開かない', () => {
  const { appWindow, calls, contentsListeners, appDir } = setup();
  const win = appWindow.createWindow();
  const index = pathToFileURL(path.join(appDir, '..', 'dist', 'index.html')).href;
  const navigate = url => { let prevented = false; contentsListeners['will-navigate']({ preventDefault: () => { prevented = true; } }, url); return prevented; };
  assert.equal(navigate(index + '#/home'), false, 'アプリの中のページ（#）は移動できる');
  assert.equal(navigate(pathToFileURL(path.join(appDir, 'other.html')).href), true);
  assert.equal(navigate('https://example.com/a'), true);
  assert.deepEqual(win.openHandler({ url: 'http://example.com/b' }), { action: 'deny' });
  win.openHandler({ url: 'javascript:alert(1)' });
  win.openHandler({ url: 'ms-settings:privacy' });
  assert.deepEqual(calls.opened, ['https://example.com/a', 'http://example.com/b']);
});

test('CSP は開発版（ELECTRON_DEV=1）では付けず、それ以外では付ける', () => {
  const dev = setup({ isDev: true });
  dev.appWindow.installProdOnlyCsp();
  assert.equal(dev.calls.headers, null);
  const prod = setup();
  prod.appWindow.installProdOnlyCsp();
  let headers = null;
  prod.calls.headers({ responseHeaders: { a: ['b'] } }, value => { headers = value.responseHeaders; });
  assert.deepEqual(headers.a, ['b']);
  assert.match(headers['Content-Security-Policy'][0], /^default-src 'self'; script-src 'self';/);
});

test('ipc: 最小化・最大化の切り替え・閉じるを登録する', () => {
  const { calls } = setup();
  assert.deepEqual([...calls.onChannels.keys()].sort(), ['window:close', 'window:maximizeToggle', 'window:minimize']);
  const done = [];
  let maximized = false;
  const win = { minimize: () => done.push('min'), close: () => done.push('close'), isMaximized: () => maximized,
    maximize: () => { done.push('max'); maximized = true; }, unmaximize: () => { done.push('unmax'); maximized = false; } };
  const event = { sender: { win } };
  calls.onChannels.get('window:minimize')(event);
  calls.onChannels.get('window:maximizeToggle')(event);
  calls.onChannels.get('window:maximizeToggle')(event);
  calls.onChannels.get('window:close')(event);
  assert.deepEqual(done, ['min', 'max', 'unmax', 'close']);
  calls.onChannels.get('window:close')({ sender: {} });
});
