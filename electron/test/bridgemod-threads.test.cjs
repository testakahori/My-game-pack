// アプリレビュー（2026-10-08）P5：BridgeMOD でサーバーが固まる・落ちる経路をなくす（BridgeMOD 1.7.6）。
// WebSocket の送信・ゲームMODの登録と状態取得・状態の JSON 化は JUnit（BridgeMod/src/test）で確かめる。ここでは Minecraft に頼る配線を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const mod = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java').replace(/\r\n/g, '\n');
// メソッドの本体（4文字字下げの閉じかっこまで）。
const body = signature => {
  const start = mod.indexOf(signature);
  assert.ok(start >= 0, 'missing ' + signature);
  return mod.slice(start, mod.indexOf('\n    }\n', start));
};
// コメントを除いたコード。
const code = text => text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('状態はサーバーのスレッドだけで作る（起動時・tick・HTTP から頼む分）。作れなくても起動と tick は止めない', () => {
  // プレイヤー・TPS・外部ゲームMODの状態を読む buildStatusJson は、buildStatusSafely からだけ呼ぶ。
  const calls = code(mod).match(/buildStatusJson\(/g) || [];
  assert.equal(calls.length, 2, 'definition and one call from buildStatusSafely');
  const safely = body('private String buildStatusSafely()');
  assert.match(safely, /String status = buildStatusJson\(\);\s*lastStatusFailure = "";\s*return status;/, '直ったら、同じ失敗をまたログに出す（PR #98 再レビュー m3）');
  assert.match(safely, /catch \(RuntimeException \| StackOverflowError \| LinkageError error\)/);
  // サーバーで作った状態は "stale":false。WebSocket の最初の古い状態の印が、Bridge の記録に残り続けない（PR #98 再レビュー m1）。
  assert.match(body('private String buildStatusJson()'), /return statusHead\(gift, like, other\) \+ ",\\"stale\\":false" \+ rest;/);
  // 一度も状態を作れていないときは、起動中と分かるようにする（PR #98 再レビュー m2）。
  assert.match(mod, /private volatile String lastStatusRest = ",\\"starting\\":true\}";/);
  const started = body('public void onServerStarted(');
  assert.ok(started.indexOf('buildStatusSafely();') >= 0 && started.indexOf('buildStatusSafely();') < started.indexOf('startBridgeHttpServer('), '受付を開く前に作る');
  assert.match(body('public void onServerTick('), /String status = buildStatusSafely\(\);\s*if \(status != null\) broadcastWebSocket\(status\);/);
  // 外部ゲームMODの状態は、MOD ごとに JSON にする（JSON にできない MOD の分だけエラー。PR #98 レビュー I3）。
  assert.match(body('private String buildStatusJson()'), /StatusJson\.games\(GameEvents\.status\(\)\)/);
});

test('HTTP の状態の要求は、サーバーを少しだけ待ち、応えなければその場の待ちの件数と古い状態（stale）を返す（PR #98 レビュー C1・I2）', () => {
  // BRIDGE（1.5秒）・アプリ（1.5秒）の時間切れより十分短く待つ。
  const wait = Number(mod.match(/private static final long STATUS_WAIT_MS = (\d+);/)?.[1]);
  assert.ok(wait > 0 && wait <= 500, 'STATUS_WAIT_MS ' + wait);
  const current = body('private String currentStatus()');
  assert.match(current, /server\.submit\(this::buildStatusSafely\)/);
  assert.match(current, /\.get\(STATUS_WAIT_MS, java\.util\.concurrent\.TimeUnit\.MILLISECONDS\)/);
  assert.match(current, /future\.cancel\(false\);/);
  assert.match(current, /return staleStatus\(\);/);
  const stale = body('private String staleStatus()');
  assert.match(stale, /synchronized \(this\)/, '待ちの件数はその場で数える');
  assert.match(stale, /\\"stale\\":true/);
  assert.match(body('private void handleBridgeStatus('), /sendHttp\(exchange, 200, currentStatus\(\)\);/);
  // 状態の要求がサーバーを待っていても、ギフトの受付が後ろに並ばないよう、HTTP は複数のスレッドで受ける。止めるときは閉じる。
  assert.match(body('private void startBridgeHttpServer('), /httpExecutor = Executors\.newFixedThreadPool\(/);
  assert.match(body('private void startBridgeHttpServer('), /bridgeServer\.setExecutor\(httpExecutor\);/);
  assert.match(body('private void stopBridgeHttpServer('), /httpExecutor\.shutdownNow\(\);/);
  // 止めるときは、HTTP を閉じる前にサーバーを外す（止めている間に状態を頼まない。PR #98 レビュー M3）。
  const stopping = body('public void onServerStopping(');
  assert.ok(stopping.indexOf('activeServer = null;') >= 0 && stopping.indexOf('activeServer = null;') < stopping.indexOf('stopBridgeHttpServer();'));
  assert.match(mod, /private volatile MinecraftServer activeServer;/);
});

test('WebSocket へは送信待ちに積むだけで、tick の中でソケットに書かない。切れたら送信スレッドも終える', () => {
  assert.doesNotMatch(mod, /sendWebSocket\(/);
  assert.match(body('private void broadcastWebSocket('), /webSocketClients\.removeIf\(client -> !client\.offer\(text\)\);/);
  assert.match(mod, /private final Set<WebSocketOutbox> webSocketClients = java\.util\.concurrent\.ConcurrentHashMap\.newKeySet\(\);/);
  const client = code(body('private void handleWebSocketClient('));
  // つないだ直後の状態を先に積んでから、1秒ごとの送信先に入れる（古い状態が新しい状態のあとに届かない。PR #98 レビュー M1）。
  assert.match(client, /outbox\.offer\(staleStatus\(\)\);\s*webSocketClients\.add\(outbox\);/);
  // 普通に切断したときも送信スレッドを終える（PR #98 レビュー I1）。
  assert.match(client, /finally \{\s*if \(outbox != null\) \{ webSocketClients\.remove\(outbox\); outbox\.close\(\); \}/);
});

test('BridgeMOD 1.7.6、Java のテストを CI の MOD のビルドで動かす', () => {
  const [major, minor, patch] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)\r?$/m).slice(1).map(Number);
  assert.ok(major > 1 || major === 1 && (minor > 7 || minor === 7 && patch >= 6), 'BridgeMOD 1.7.6 以上');
  assert.match(read('BridgeMod/build.gradle'), /useJUnitPlatform\(\)/);
  assert.match(read('.github/workflows/verify.yml'), /working-directory: BridgeMod/);
});
