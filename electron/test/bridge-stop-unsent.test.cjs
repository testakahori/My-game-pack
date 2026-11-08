// BRIDGE を止めたとき（停止・再起動・MAP の保存）に、BridgeMOD にまだ受け付けられていないギフトは黙って消えていた（2026-11-07 品質レビュー）。
// 送信待ちの件数を runtime-status.json に書いて画面に出し、止めるときは操作履歴に「BRIDGE停止で未送信」の失敗として残す（送り直さない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

test('BRIDGE を止めると、BridgeMOD にまだ受け付けられていないギフトを、操作履歴に「BRIDGE停止で未送信」の失敗として残して終わる（送り直さない）', async t => {
  const exits = [];
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay zombie\n' },
    config: { mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }] },
    // BridgeMOD が受け付けない（サーバーの再起動中など）。BRIDGE は再送を待っている。
    respond: () => 503,
    onExit: code => exits.push(code),
  });
  const status = () => JSON.parse(fs.readFileSync(path.join(bridge.dir, 'runtime-status.json'), 'utf8'));
  assert.deepEqual(status().sendQueue, { pending: 0, gifts: 0, oldestAt: null }, '起動したときは0件');
  await bridge.emit('WebcastGiftMessage', { giftId: '5655', gift: { name: 'バラ', diamondCount: 1 }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.type === 'gift'), 'gift is being retried');
  await bridge.until(() => status().sendQueue?.pending === 1, 'send queue is written');
  assert.equal(status().sendQueue.gifts, 1);
  assert.ok(Date.parse(status().sendQueue.oldestAt) <= Date.now());

  bridge.shutdown();
  await bridge.until(() => exits.length === 1, 'bridge exits');
  assert.deepEqual(exits, [0]);
  const rows = fs.readFileSync(path.join(bridge.dir, 'operations-history.json'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => [row.type, row.sender, row.commandFile, row.count, row.ok, row.message]),
    [['gift', '視聴者', 'zombie.txt', 1, false, 'BRIDGE停止で未送信']]);
  assert.ok(bridge.logs.some(line => line.includes('BRIDGE停止で未送信のイベント 1件')), 'ログに件数を出す');
  assert.ok(!bridge.logs.some(line => line.includes('送れなかったイベント（再送しません）')), 'ホーム画面の「送れなかったイベント」には数えない');

  // 再送の待ち（最長3秒）が明けても送り直さない。
  const tries = bridge.requests.filter(x => x.type === 'gift').length;
  await bridge.wait(3300);
  assert.equal(bridge.requests.filter(x => x.type === 'gift').length, tries);
  // アプリからの shutdown と ipc の切断が重なっても、止める処理は1回だけ。
  bridge.shutdown();
  await bridge.wait(50);
  assert.deepEqual(exits, [0]);
});

test('BRIDGE を止めても、送れたギフトは履歴の成功のまま（未送信には入れない）', async t => {
  const exits = [];
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay zombie\n' },
    config: { mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }] },
    onExit: code => exits.push(code),
  });
  const history = path.join(bridge.dir, 'operations-history.json');
  await bridge.emit('WebcastGiftMessage', { giftId: '5655', gift: { name: 'バラ', diamondCount: 1 }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => fs.existsSync(history) && fs.readFileSync(history, 'utf8').includes('"ok":true'), 'gift delivered');
  bridge.shutdown();
  await bridge.until(() => exits.length === 1, 'bridge exits');
  const rows = fs.readFileSync(history, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => [row.commandFile, row.ok]), [['zombie.txt', true]]);
  assert.ok(!bridge.logs.some(line => line.includes('BRIDGE停止で未送信')));
});
