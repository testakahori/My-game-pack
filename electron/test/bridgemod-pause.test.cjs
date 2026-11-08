// 妨害の一時停止（BridgeMOD 1.8.0、2026-10-16 ユーザーの決定。アプリレビュー 2026-10-08 P6 の残り）。
// 休憩・準備の間だけ止め、届いた分は預かって、再開したら送られた数どおり起こす。動きは実機テスト BridgeMod/test/pause.cjs で確かめる。
// BridgeMOD 1.8.4 から、一時停止は待ち列（EventQueues）が持ち、止めている間の動きは JUnit の EventQueuesTest でも確かめる（2026-11-07 品質レビュー）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
const mod = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java');
const queues = read('BridgeMod/src/main/java/jp/douma/bridgemod/EventQueues.java');
const body = (signature, source = mod) => {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, 'missing ' + signature);
  return source.slice(start, source.indexOf('\n    }\n', start));
};

test('止めている間は、待ちから取り出して実行する処理だけを飛ばす（始まっている演出・固定環境・状態の送信は続ける）', () => {
  assert.match(queues, /private volatile boolean paused;/);
  assert.match(mod, /private final EventQueues<BridgeEvent> queues = new EventQueues<>\(\);/);
  const tick = body('public void onServerTick(');
  assert.match(tick, /if \(queues\.hasWork\(\)\) BlockProtection\.runProtected\(activeServer, "bridgemod", this::processQueues\);/);
  assert.match(body('synchronized boolean hasWork()', queues), /return !paused && /);
  assert.match(body('void process(Slice<E> slice)', queues), /^void process\(Slice<E> slice\) \{\s*if \(paused\) return;/);
  assert.match(tick, /giftEffects\.tick\(activeServer\);/);
  assert.match(tick, /environment\.apply\(activeServer, giftEffects\);/);
  // サーバーを止めたら解く（再起動すると止めていない状態で始まる）。
  assert.match(body('public void onServerStopping('), /queues\.clear\(\);/);
  assert.match(body('synchronized void clear()', queues), /paused = false;/);
});

test('/bridge/control で止める・再開する。2回押しても 200。いいねの待ちを捨てる指示は今までどおり', () => {
  const control = body('private void handleBridgeControl(');
  assert.match(control, /if \("pause"\.equals\(action\) \|\| "resume"\.equals\(action\)\) \{\s*boolean paused = "pause"\.equals\(action\);\s*queues\.setPaused\(paused\);/);
  assert.match(control, /"\{\\"ok\\":true,\\"paused\\":" \+ paused \+ "\}"/);
  assert.match(control, /if \(!"discard"\.equals\(action\) \|\| !"like"\.equals\(type\)\)/);
  // pause・resume は type を付けずに送る。
  assert.match(control, /type = data\.has\("type"\) \? data\.get\("type"\)\.getAsString\(\) : "";/);
});

test('状態に paused を出す（サーバーで作った状態にも、古い状態にも入る）', () => {
  assert.match(body('private String statusHead('), /\\"paused\\":" \+ queues\.paused\(\)/);
});

test('ゲーム内の /bridge は止めている間も待ちに積み、再開すると実行されると知らせる', () => {
  assert.match(body('private int runKey('), /if \(queues\.paused\(\)\) source\.sendSuccess\(\(\) -> Component\.literal\("\[Bridge\] 妨害は一時停止中です。再開すると実行されます"\), false\);/);
});

test('BridgeMOD 1.8.0 以上', () => {
  const [major, minor] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)$/m).slice(1).map(Number);
  assert.ok(major > 1 || major === 1 && minor >= 8, 'BridgeMOD 1.8.0 以上');
});
