// 画面の窓口（preload.cjs）が呼ぶ ipc の名前が、main の側にすべてあるか（2026-11-07 品質レビュー）。
// preload を読み込むテストは無く、名前を打ち間違えても、Electron を上げたときに窓口が欠けても、画面で押すまで分からなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '..');

const names = (text, pattern) => [...text.matchAll(pattern)].map(match => match[2]);

test('preload が invoke・send する ipc の名前は、main の ipcMain.handle・ipcMain.on にすべてある', () => {
  const preload = fs.readFileSync(path.join(dir, 'preload.cjs'), 'utf8');
  const main = fs.readdirSync(dir).filter(name => name.endsWith('.cjs') && name !== 'preload.cjs')
    .map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  const invoked = new Set(names(preload, /ipcRenderer\.(invoke|sendSync)\(\s*["']([^"']+)["']/g));
  const sent = new Set(names(preload, /ipcRenderer\.(send)\(\s*["']([^"']+)["']/g));
  const handled = new Set(names(main, /ipcMain\.(handle)\(\s*["']([^"']+)["']/g));
  const listened = new Set(names(main, /ipcMain\.(on)\(\s*["']([^"']+)["']/g));
  assert.ok(invoked.size > 50, '名前を読めている');
  assert.deepEqual([...invoked].filter(name => !handled.has(name)), [], 'invoke するのに main に ipcMain.handle が無い');
  assert.deepEqual([...sent].filter(name => !listened.has(name)), [], 'send するのに main に ipcMain.on が無い');
  // 名前を文字列でなく変数で渡していると、ここで見落とす。preload では文字列で書く。
  assert.doesNotMatch(preload, /ipcRenderer\.(invoke|send|sendSync)\(\s*[^"'\s]/, 'ipc の名前は文字列で書く');
});
