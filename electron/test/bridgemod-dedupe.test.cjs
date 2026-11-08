// BRIDGE の送り直しで、ギフトが2回動かないこと（BridgeMOD 1.8.4、2026-11-07 品質レビュー）。
// BRIDGE は BridgeMOD が 1.5 秒応えないと、同じ requestId で送り直す（bridge/mod_event_delivery.cjs）。重い配信 PC では GC の止まりで超えうる。
// 待ち列と HTTP の受付の動きは JUnit（BridgeMod/src/test の EventQueuesTest・BridgeHttpTest。CI の mod-build で動く）で確かめる。
// ここでは JUnit で動かせない BridgeMod.java の配線（BRIDGE の requestId を待ち列へ渡しているか）を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
const mod = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java');

test('/bridge/event は BridgeHttp.events で受け、BRIDGE の requestId を待ち列の重複の確かめに渡す', () => {
  assert.match(mod, /bridgeServer\.createContext\("\/bridge\/event", BridgeHttp\.events\(\(\) -> auth, port, BridgeEvent::fromJson, queues\)\);/);
  assert.match(mod, /private static class BridgeEvent extends EventQueues\.Event \{/);
  const fromJson = mod.slice(mod.indexOf('static BridgeEvent fromJson('), mod.indexOf('private static String memberString('));
  assert.match(fromJson, /if \(!requestId\.isEmpty\(\)\) \{\s*event\.eventId = requestId;\s*event\.requestId = requestId;\s*\}/);
  // ゲーム内の /bridge と /bridge/exec（演出のフレーム）は番号を持たない。同じ中身でも届いた分だけ動かす。
  assert.doesNotMatch(mod.slice(mod.indexOf('private int runKey('), mod.indexOf('private void startBridgeHttpServer(')), /requestId/);
  assert.doesNotMatch(mod.slice(mod.indexOf('private void handleBridgeExec('), mod.indexOf('private String readHttpBody(')), /requestId/);
  // 受け付けた番号は、サーバーを止めたら待ちと一緒に忘れる（消した待ちの送り直しを、次の起動で受けられるように）。
  assert.match(read('BridgeMod/src/main/java/jp/douma/bridgemod/EventQueues.java'), /synchronized void clear\(\) \{[^}]*acceptedIds\.clear\(\);/);
});

test('送り直しには積まずに 202 で答える（BRIDGE は 2xx を届いたとみなして次へ進む。429 にすると送り直し続ける）', () => {
  const http = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeHttp.java');
  assert.match(http, /case DUPLICATE -> send\(exchange, 202, "\{\\"ok\\":true,\\"duplicate\\":true\}"\);/);
  // 受け付け済みかを、待ちがいっぱいかより先に見る。
  const offer = read('BridgeMod/src/main/java/jp/douma/bridgemod/EventQueues.java');
  const body = offer.slice(offer.indexOf('synchronized Offer offer('), offer.indexOf('synchronized boolean hasWork('));
  assert.ok(body.indexOf('return Offer.DUPLICATE;') > 0 && body.indexOf('return Offer.DUPLICATE;') < body.indexOf('return Offer.FULL;'));
});

test('BridgeMOD 1.8.4 以上', () => {
  const [major, minor, patch] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)$/m).slice(1).map(Number);
  assert.ok(major > 1 || major === 1 && (minor > 8 || minor === 8 && patch >= 4), 'BridgeMOD 1.8.4 以上');
});
