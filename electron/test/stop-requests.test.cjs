// サーバー・BRIDGE の停止を出どころ付きで記録する（2026-10-10、BRIDGE停止だけのはずがサーバーも止まった件の調査用）。
// main から実際に呼ぶ動きは app-regressions.test.cjs の「停止の記録」で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { STOP_ORIGINS, stopOriginLabel, isConsoleStop, createStopRequestLog } = require('../stop_requests.cjs');

const tempDir = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-requests-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const at = new Date(2026, 9, 10, 3, 44, 1, 662); // 端末の時刻（Minecraft のログと同じ書き方で比べられるようにする）

test('停止の出どころは決まった名前だけを日本語にし、それ以外は中身を書かない', () => {
  assert.equal(stopOriginLabel('stop-panel:bridge'), '停止パネルのBRIDGE停止');
  assert.equal(stopOriginLabel('stop-panel:all'), '停止パネルの一括停止');
  assert.equal(stopOriginLabel('home:server'), '配信ホームのサーバー停止');
  assert.equal(stopOriginLabel('euler:bridge-restart'), 'Euler APIキー設定のBRIDGE再起動');
  assert.equal(stopOriginLabel('map:load'), 'MAPの読込');
  assert.equal(stopOriginLabel('console'), 'コンソールコマンドのstop');
  assert.equal(stopOriginLabel(undefined), '出どころの指定なし');
  assert.equal(stopOriginLabel('x'.repeat(5000)), '不明な出どころ');
  assert.equal(stopOriginLabel('toString'), '不明な出どころ', 'Object の持ち物を出どころと見なさない');
  assert.equal(stopOriginLabel('__proto__'), '不明な出どころ');
  // 画面から文字列以外が来ても、キーに変えようとして例外を投げない（投げると停止まで止まる）。
  assert.equal(stopOriginLabel({ toString: 'x' }), '不明な出どころ');
  assert.equal(stopOriginLabel(['console']), '不明な出どころ');
  const labels = Object.values(STOP_ORIGINS);
  assert.equal(new Set(labels).size, labels.length, '文言が重ならない');
});

test('画面が渡す出どころの型は、記録が知っている名前だけ', () => {
  const declared = fs.readFileSync(path.resolve(__dirname, '../../src/types/electron.d.ts'), 'utf8').match(/export type StopOrigin = ([^;]+);/);
  assert.ok(declared, 'StopOrigin の型がある');
  const names = [...declared[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.ok(names.length >= 8, names.join(','));
  for (const name of names) assert.ok(Object.prototype.hasOwnProperty.call(STOP_ORIGINS, name), `${name} が STOP_ORIGINS にない`);
});

test('画面のどこからも、出どころを付けずに停止・再起動を呼ばない', () => {
  // 配信ホームは api を any で持つので、型チェックだけでは漏れを防げない。src のすべての画面を見る。
  const src = path.resolve(__dirname, '../../src');
  const files = fs.readdirSync(src, { recursive: true }).map(String).filter(name => /\.tsx?$/.test(name) && !/devApiMock|\.d\.ts$/.test(name));
  assert.ok(files.length > 10);
  let calls = 0;
  for (const name of files) {
    const text = fs.readFileSync(path.join(src, name), 'utf8');
    assert.doesNotMatch(text, /\.(bridgeStop|serverStop|bridgeRestart)\s*(\?\.)?\(\s*\)/, `${name} に出どころなしの呼び出しがある`);
    calls += (text.match(/\.(bridgeStop|serverStop|bridgeRestart)\s*(\?\.)?\(/g) || []).length;
  }
  assert.ok(calls >= 9, `呼び出しが見つからない: ${calls}`);
});

test('コンソールの stop は、サーバーが実際に止まる形だけを stop と見なす', () => {
  for (const command of ['stop', '/stop', ' stop ', 'execute as @a run stop', 'execute if entity @p run stop']) assert.equal(isConsoleStop(command), true, command);
  for (const command of ['STOP', 'stop now', 'say please stop', 'stopsound @a', 'op stop']) assert.equal(isConsoleStop(command), false, command);
});

test('停止の記録は、端末の時刻・止めたもの・出どころを1行でファイルに足し、フォルダーがなければ作る', t => {
  const file = path.join(tempDir(t), 'logs', 'stop-requests.log');
  const log = createStopRequestLog({ file: () => file, now: () => at });
  assert.equal(log.record('bridge', 'stop-panel:bridge'), '停止パネルのBRIDGE停止');
  assert.equal(log.record('server', 'stop-panel:all'), '停止パネルの一括停止');
  assert.equal(fs.readFileSync(file, 'utf8'),
    '2026-10-10 03:44:01.662 BRIDGE停止 ← 停止パネルのBRIDGE停止\n' +
    '2026-10-10 03:44:01.662 サーバー停止 ← 停止パネルの一括停止\n');
});

test('停止の記録に失敗しても、停止そのものは止めない', t => {
  const blocker = path.join(tempDir(t), 'not-a-folder');
  fs.writeFileSync(blocker, '');
  const log = createStopRequestLog({ file: () => path.join(blocker, 'stop-requests.log'), now: () => at });
  assert.equal(log.record('server', 'home:all'), '配信ホームの一括停止');
  const broken = createStopRequestLog({ file: () => { throw new Error('userData がまだない'); }, now: () => at });
  assert.equal(broken.record('bridge', 'home:bridge'), '配信ホームのBRIDGE停止');
  const badClock = createStopRequestLog({ file: () => path.join(blocker, 'x.log'), now: () => { throw new Error('時計'); } });
  assert.equal(badClock.record('bridge', { toString: 'x' }), '不明な出どころ');
});

test('停止の記録が大きくなったら、バイト数で新しい半分ほど（行の途中で切らない）だけを残す', t => {
  const file = path.join(tempDir(t), 'stop-requests.log');
  const maxBytes = 1000;
  const log = createStopRequestLog({ file: () => file, now: () => at, maxBytes });
  // 日本語の文言は1文字3バイト。文字数で切ると上限を超えたままになっていた。
  for (let i = 0; i < 40; i++) log.record('server', i % 2 ? 'home:server' : 'map:save');
  const size = fs.statSync(file).size;
  const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
  // 切り詰めは足す前に見るので、上限を超えるのは最後の1行分まで。
  assert.ok(size <= maxBytes + 100, `大きすぎる: ${size}`);
  assert.ok(lines.length < 40 && lines.length > 1, String(lines.length));
  assert.match(lines.at(-1), /サーバー停止 ← 配信ホームのサーバー停止$/, '最後に足した行が残る');
  assert.ok(lines.every(line => /^2026-10-10 03:44:01\.662 サーバー停止 ← (MAPの保存|配信ホームのサーバー停止)$/.test(line)), '途中で切れた行や化けた文字を残さない');
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['stop-requests.log'], '書き直しの一時ファイルを残さない');
});

test('残す範囲に改行がない長い1行は、途中から残さずに捨てる', t => {
  const file = path.join(tempDir(t), 'stop-requests.log');
  fs.writeFileSync(file, 'あ'.repeat(600)); // 1800 バイト、改行なし
  createStopRequestLog({ file: () => file, now: () => at, maxBytes: 1000 }).record('bridge', 'home:bridge');
  assert.equal(fs.readFileSync(file, 'utf8'), '2026-10-10 03:44:01.662 BRIDGE停止 ← 配信ホームのBRIDGE停止\n');
});

test('妨害の一時停止・再開も、出どころ付きで同じ記録に残す（2026-10-16）', t => {
  assert.equal(stopOriginLabel('home:pause'), '配信ホームの一時停止');
  assert.equal(stopOriginLabel('home:resume'), '配信ホームの再開');
  assert.equal(stopOriginLabel('banner:resume'), '一時停止の帯の再開');
  const file = path.join(tempDir(t), 'stop-requests.log');
  const log = createStopRequestLog({ file: () => file, now: () => at });
  log.record('pause', 'home:pause');
  log.record('resume', 'banner:resume');
  assert.equal(fs.readFileSync(file, 'utf8'),
    '2026-10-10 03:44:01.662 妨害の一時停止 ← 配信ホームの一時停止\n' +
    '2026-10-10 03:44:01.662 妨害の再開 ← 一時停止の帯の再開\n');
  const declared = fs.readFileSync(path.resolve(__dirname, '../../src/types/electron.d.ts'), 'utf8').match(/export type PauseOrigin = ([^;]+);/);
  assert.ok(declared, 'PauseOrigin の型がある');
  const names = [...declared[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(names.sort(), ['banner:resume', 'home:pause', 'home:resume']);
});
