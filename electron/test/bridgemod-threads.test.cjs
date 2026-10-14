// アプリレビュー（2026-10-08）P5：BridgeMOD でサーバーが固まる・落ちる経路をなくす（BridgeMOD 1.7.6）。
// WebSocket の送信・ゲームMODの登録と状態取得は JUnit（BridgeMod/src/test）で確かめる。ここでは Minecraft に頼る配線を確かめる。
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

test('状態はサーバーのスレッドだけで作り、HTTP はサーバーに作らせて待つ（応えなければ最後の状態）', () => {
  // プレイヤー・TPS・外部ゲームMODの状態を読む buildStatusJson を呼ぶのは、サーバーのスレッドだけ：
  // 起動時・tick（WebSocket へ1秒ごと）・HTTP から server.submit で頼む分。
  assert.equal(mod.split('buildStatusJson(').length - 1, 3, 'definition, server start and server tick');
  assert.equal(mod.split('this::buildStatusJson').length - 1, 1, 'server.submit from HTTP');
  const started = body('public void onServerStarted(');
  assert.ok(started.indexOf('buildStatusJson();') >= 0 && started.indexOf('buildStatusJson();') < started.indexOf('startBridgeHttpServer('), '受付を開く前に作る');
  assert.match(body('public void onServerTick('), /try \{\s*broadcastWebSocket\(buildStatusJson\(\)\);\s*\} catch \(RuntimeException error\)/);
  assert.match(body('private String buildStatusJson()'), /lastStatus = json;\s*return json;/);
  // HTTP のスレッドは、tick と tick の間でサーバーに作らせる（待ちの件数と演出の残りが同じ時点になる）。2秒応えなければ最後の状態。
  const current = body('private String currentStatus()');
  assert.match(current, /return server\.submit\(this::buildStatusJson\)\.get\(2, java\.util\.concurrent\.TimeUnit\.SECONDS\);/);
  assert.match(current, /TimeoutException e\) \{\s*return lastStatus;/);
  assert.match(body('private void handleBridgeStatus('), /sendHttp\(exchange, 200, currentStatus\(\)\);/);
  assert.match(body('private void handleWebSocketClient('), /outbox\.offer\(lastStatus\);/);
  assert.match(mod, /private volatile String lastStatus = /);
  assert.match(mod, /private volatile MinecraftServer activeServer;/);
});

test('WebSocket へは送信待ちに積むだけで、tick の中でソケットに書かない', () => {
  assert.doesNotMatch(mod, /sendWebSocket\(/);
  assert.match(body('private void broadcastWebSocket('), /webSocketClients\.removeIf\(client -> !client\.offer\(text\)\);/);
  assert.match(mod, /private final Set<WebSocketOutbox> webSocketClients = java\.util\.concurrent\.ConcurrentHashMap\.newKeySet\(\);/);
});

test('BridgeMOD 1.7.6、Java のテストを CI の MOD のビルドで動かす', () => {
  const [major, minor, patch] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)\r?$/m).slice(1).map(Number);
  assert.ok(major > 1 || major === 1 && (minor > 7 || minor === 7 && patch >= 6), 'BridgeMOD 1.7.6 以上');
  assert.match(read('BridgeMod/build.gradle'), /useJUnitPlatform\(\)/);
  assert.match(read('.github/workflows/verify.yml'), /working-directory: BridgeMod/);
});
