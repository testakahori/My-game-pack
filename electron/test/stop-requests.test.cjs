// サーバー・BRIDGE の停止を「どのボタン・操作から来たか」付きで記録する（2026-10-10、BRIDGE停止だけのはずがサーバーも止まった件の調査用）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { STOP_ORIGINS, stopOriginLabel, createStopRequestLog } = require('../stop_requests.cjs');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stop-requests-'));
const at = new Date(2026, 9, 10, 3, 44, 1, 662); // 端末の時刻（Minecraft のログと同じ書き方で比べられるようにする）

test('停止の出どころは決まった名前だけを日本語にし、それ以外は中身を書かない', () => {
  assert.equal(stopOriginLabel('stop-panel:bridge'), '停止パネルのBRIDGE停止');
  assert.equal(stopOriginLabel('stop-panel:all'), '停止パネルの一括停止');
  assert.equal(stopOriginLabel('home:server'), '配信ホームのサーバー停止');
  assert.equal(stopOriginLabel('map:load'), 'MAPの読込');
  assert.equal(stopOriginLabel('console'), 'コンソールコマンドのstop');
  assert.equal(stopOriginLabel(undefined), '呼び出し元の指定なし');
  assert.equal(stopOriginLabel('x'.repeat(5000)), '不明な呼び出し元');
  assert.equal(stopOriginLabel('toString'), '不明な呼び出し元', 'Object の持ち物を出どころと見なさない');
  for (const [key, label] of Object.entries(STOP_ORIGINS)) assert.ok(label && !label.includes(key), key);
});

test('停止の記録は、端末の時刻・止めたもの・出どころを1行でファイルに足し、フォルダーがなければ作る', () => {
  const dir = tempDir();
  const file = path.join(dir, 'logs', 'stop-requests.log');
  const log = createStopRequestLog({ file: () => file, now: () => at });
  assert.equal(log.record('bridge', 'stop-panel:bridge'), '停止パネルのBRIDGE停止');
  assert.equal(log.record('server', 'stop-panel:all'), '停止パネルの一括停止');
  assert.equal(fs.readFileSync(file, 'utf8'),
    '2026-10-10 03:44:01.662 BRIDGE停止 ← 停止パネルのBRIDGE停止\n' +
    '2026-10-10 03:44:01.662 サーバー停止 ← 停止パネルの一括停止\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('停止の記録に失敗しても、停止そのものは止めない', () => {
  const dir = tempDir();
  const blocker = path.join(dir, 'not-a-folder');
  fs.writeFileSync(blocker, '');
  const log = createStopRequestLog({ file: () => path.join(blocker, 'stop-requests.log'), now: () => at });
  assert.equal(log.record('server', 'home:all'), '配信ホームの一括停止');
  const broken = createStopRequestLog({ file: () => { throw new Error('userData がまだない'); }, now: () => at });
  assert.equal(broken.record('bridge', 'home:bridge'), '配信ホームのBRIDGE停止');
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = relative => fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8').replace(/\r\n/g, '\n');

test('画面の停止・再起動は、どれも出どころを付けて呼び、その名前は記録が知っているものだけ', () => {
  const declared = read('src/types/electron.d.ts').match(/export type StopOrigin = ([^;]+);/);
  assert.ok(declared, 'StopOrigin の型がある');
  const names = [...declared[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.ok(names.length >= 8, names.join(','));
  for (const name of names) assert.ok(Object.prototype.hasOwnProperty.call(STOP_ORIGINS, name), `${name} が STOP_ORIGINS にない`);

  const callers = ['src/components/StopPanel.tsx', 'src/components/DashboardPage.tsx', 'src/components/EulerApiKeySettings.tsx'];
  for (const file of callers) {
    const source = read(file);
    assert.doesNotMatch(source, /\.(bridgeStop|serverStop|bridgeRestart)\(\)/, `${file} に出どころなしの呼び出しがある`);
  }
  const dashboard = read('src/components/DashboardPage.tsx');
  for (const origin of ['home:server', 'home:bridge', 'home:all', 'home:bridge-restart']) assert.match(dashboard, new RegExp(`"${origin}"`), origin);
  assert.match(read('src/components/EulerApiKeySettings.tsx'), /bridgeRestart\("euler:bridge-restart"\)/);
});

test('main: サーバーへの stop と BRIDGE の停止は、出どころをログ欄と記録に残してから行う', () => {
  const main = read('electron/main.cjs');
  const preload = read('electron/preload.cjs');
  for (const [name, channel] of [['serverStop', 'server:stop'], ['bridgeStop', 'bridge:stop'], ['bridgeRestart', 'bridge:restart']]) {
    assert.match(preload, new RegExp(`${name}: \\(origin\\) => ipcRenderer\\.invoke\\("${channel}", origin\\)`), name);
  }
  assert.match(main, /ipcMain\.handle\("server:stop", async \(_event, origin\) => \{[\s\S]*?await stopMapServer\(origin\);/);
  assert.match(main, /ipcMain\.handle\("bridge:stop", async \(_event, origin\) => \{ assertMapIdle\(\); return stopBridge\(origin\); \}\);/);
  assert.match(main, /ipcMain\.handle\("bridge:restart", async \(_event, origin\) => \{\s*assertMapIdle\(\);\s*await stopBridge\(origin\);/);
  for (const origin of ['map:save', 'map:load', 'map:backup']) assert.match(main, new RegExp(`runMapOperation\\('${origin}', `), origin);

  // stop を書く場所は stopMapServer だけで、書く前に出どころを残す（コンソールから打った stop も残す）。
  assert.equal(main.split("stdin.write('stop\\n')").length - 1, 1);
  const stopServer = main.slice(main.indexOf('async function stopMapServer(origin) {'), main.indexOf('async function runMapOperation('));
  assert.ok(stopServer.indexOf("stopRequests.record('server', origin)") >= 0 && stopServer.indexOf("stopRequests.record('server', origin)") < stopServer.indexOf("stdin.write('stop"));
  assert.match(main, /if \(\/\^stop\(\\s\|\$\)\/i\.test\(cmd\)\) stopRequests\.record\("server", "console"\);/);
  const stopBridge = main.slice(main.indexOf('async function stopBridge(origin) {'), main.indexOf('ipcMain.handle("bridge:launch"'));
  assert.ok(stopBridge.indexOf('stopRequests.record("bridge", origin)') >= 0 && stopBridge.indexOf('stopRequests.record("bridge", origin)') < stopBridge.indexOf("type: 'shutdown'"));
});

test('停止の記録が大きくなったら、新しい半分だけを残す', () => {
  const dir = tempDir();
  const file = path.join(dir, 'stop-requests.log');
  const log = createStopRequestLog({ file: () => file, now: () => at, maxBytes: 400 });
  for (let i = 0; i < 20; i++) log.record('server', i % 2 ? 'home:server' : 'map:save');
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  assert.ok(fs.statSync(file).size <= 400 + 100, `大きすぎる: ${fs.statSync(file).size}`);
  assert.ok(lines.length < 20 && lines.length > 1, String(lines.length));
  assert.match(lines.at(-1), /サーバー停止 ← 配信ホームのサーバー停止$/, '最後に足した行が残る');
  assert.ok(lines.every(line => /^2026-10-10 03:44:01\.662 /.test(line)), '途中で切れた行を残さない');
  fs.rmSync(dir, { recursive: true, force: true });
});
