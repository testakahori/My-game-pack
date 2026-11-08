// アプリ本体（main）の console.warn・console.error を userData/logs/main-YYYYMMDD.log に残す（electron/main_log.cjs。2026-11-07 品質レビュー）。
// 配信中に main で起きたエラーは、これまで画面にもファイルにも残らなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMainLog } = require('../main_log.cjs');
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8');

function setup(t, { now = new Date(2026, 10, 7, 12, 0, 0), openPath = async () => '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'main-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const printed = [], opened = [], handlers = new Map();
  const clock = { now };
  const target = Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => printed.push([level, ...args])]));
  const mainLog = createMainLog({
    app: { getPath: name => { assert.equal(name, 'userData'); return root; } },
    shell: { openPath: async dir => { opened.push(dir); return openPath(dir); } },
    target, now: () => clock.now,
  });
  mainLog.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, dir: path.join(root, 'logs'), printed, opened, clock, target, mainLog, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('main のログ: console.warn・console.error を日ごとの main-YYYYMMDD.log に残し、console.log は残さない。画面への出力はそのまま', t => {
  const x = setup(t);
  x.mainLog.install();
  x.mainLog.install();
  x.target.log('ふつうのログ');
  x.target.warn('[Config]', '注意');
  x.target.error('[stats] 失敗', { code: 'EBUSY' });
  x.target.error('signApiKey=abc123 で失敗');
  x.clock.now = new Date(2026, 10, 8, 0, 0, 1);
  x.target.error('次の日のエラー');
  const today = fs.readFileSync(path.join(x.dir, 'main-20261107.log'), 'utf8');
  assert.match(today, /^\[2026-11-0\dT[\d:.]+Z\] \[WARN\] \[Config\] 注意$/m);
  assert.match(today, /\[ERROR\] \[stats\] 失敗 \{ code: 'EBUSY' \}/);
  assert.doesNotMatch(today, /ふつうのログ/);
  assert.doesNotMatch(today, /abc123/, 'API キーは伏せる');
  assert.equal(today.match(/\[WARN\]/g).length, 1, '2回 install しても1回だけ書く');
  assert.match(fs.readFileSync(path.join(x.dir, 'main-20261108.log'), 'utf8'), /\[ERROR\] 次の日のエラー/);
  assert.deepEqual(x.printed.map(([level]) => level), ['log', 'warn', 'error', 'error', 'error'], '画面への出力はそのまま');
});

test('main のログ: 起動のときに7日より古い main-*.log を消す。ほかのログ（stop-requests.log など）は消さない', t => {
  const x = setup(t);
  fs.mkdirSync(x.dir, { recursive: true });
  const day = 24 * 60 * 60 * 1000;
  for (const [name, ago] of [['main-20261029.log', 9 * day], ['main-20261105.log', 2 * day], ['stop-requests.log', 30 * day]]) {
    const file = path.join(x.dir, name);
    fs.writeFileSync(file, 'old');
    const at = new Date(x.clock.now.getTime() - ago);
    fs.utimesSync(file, at, at);
  }
  x.mainLog.install();
  assert.deepEqual(fs.readdirSync(x.dir).sort(), ['main-20261105.log', 'stop-requests.log']);
});

test('main のログ: 書けなくてもアプリは止めない', t => {
  const x = setup(t);
  fs.writeFileSync(x.dir, 'ログのフォルダーの場所にファイルがある');
  x.mainLog.install();
  x.target.error('書けないエラー');
  assert.deepEqual(x.printed.map(([level]) => level), ['error']);
});

test('main のログ: logs:openFolder はログのフォルダーを作って開く。開けなければ理由を返す', async t => {
  const x = setup(t);
  assert.deepEqual(await x.invoke('logs:openFolder'), { ok: true, path: x.dir });
  assert.ok(fs.statSync(x.dir).isDirectory());
  assert.deepEqual(x.opened, [x.dir]);
  const y = setup(t, { openPath: async () => 'Failed to open path' });
  await assert.rejects(y.invoke('logs:openFolder'), /^Error: ログのフォルダーを開けませんでした: Failed to open path$/);
});

test('main のログの配線: main は起動のとき（app.whenReady の中）に書き始めて logs:openFolder を登録し、運用センターに「ログのフォルダーを開く」がある', () => {
  const main = read('electron/main.cjs');
  assert.match(main, /const mainLog = require\("\.\/main_log\.cjs"\)\.createMainLog\(\{ app, shell \}\);\r?\nmainLog\.register\(ipcMain\);/);
  assert.match(main, /app\.whenReady\(\)\.then\(\(\) => \{\r?\n  mainLog\.install\(\);/);
  assert.match(read('electron/preload.cjs'), /logsOpenFolder: \(\) => ipcRenderer\.invoke\("logs:openFolder"\),/);
  assert.match(read('src/types/electron.d.ts'), /logsOpenFolder: \(\) => Promise<\{ ok: true; path: string \}>;/);
  assert.match(read('src/lib/devApiMock.ts'), /logsOpenFolder: async \(\) =>/);
  const page = read('src/components/OperationsPage.tsx');
  const maintenance = page.slice(page.indexOf('hidden={opsTab !== "maintenance"}'), page.indexOf('{notice && <div className="ops-notice">'));
  assert.match(maintenance, /onClick=\{\(\) => api\.logsOpenFolder\(\)\.then\([^\n]*>ログのフォルダーを開く<\/button>/);
});
