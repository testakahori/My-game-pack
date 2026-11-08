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

// ルーレットのまだ回していない分も、送信待ちに数え、止めたら未送信として残す（2026-11-08 PR #196 レビュー）。
// 前は残りの回数が履歴にも件数にも出ず、止めたあとも演出が終わった1回の当たりを送ろうとしていた。
test('ルーレットの途中で BRIDGE を止めると、まだ回していない回数を roulette.txt の未送信として残し、当たりは送らない', async t => {
  const exits = [];
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'roulette.txt', repeat: 3 }],
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] } },
    onExit: code => exits.push(code),
  });
  const status = () => JSON.parse(fs.readFileSync(path.join(bridge.dir, 'runtime-status.json'), 'utf8'));
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ', diamondCount: 1 }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => Array.isArray(x.commands)), 'first roulette frame');
  await bridge.until(() => status().sendQueue?.pending === 3, 'three spins are waiting');
  assert.equal(status().sendQueue.gifts, 3, 'ギフトから回すルーレットは、未送信のギフトに数える');

  bridge.shutdown();
  await bridge.until(() => exits.length === 1, 'bridge exits');
  const rows = fs.readFileSync(path.join(bridge.dir, 'operations-history.json'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => [row.type, row.commandFile, row.count, row.ok, row.message]),
    [['roulette', 'roulette.txt', 3, false, 'BRIDGE停止で未送信']]);
  // 演出が終わっても（約2秒）、当たりは送らない。次の回も回さない。
  await bridge.wait(3000);
  assert.ok(!bridge.requests.some(x => x.commandFile === 'qa.txt'), '止めたあとに当たりを送らない');
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

// 履歴に1行足すたびに全体を読まない（ファイルの頭だけで旧フォーマットか見分ける。2026-11-08 PR #196 レビュー）。
// 旧フォーマット（JSON配列・新しい順。頭に BOM や空白があっても）は、今までどおり古い順の JSONL に直してから足す。
test('旧フォーマット（JSON配列）の履歴は、JSONL に直してから足す（頭に BOM・空白があっても）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay zombie\n' },
    config: { mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }] },
  });
  const history = path.join(bridge.dir, 'operations-history.json');
  fs.writeFileSync(history, '﻿\n  ' + JSON.stringify([{ commandFile: 'new.txt', ok: true }, { commandFile: 'old.txt', ok: true }]), 'utf8');
  await bridge.emit('WebcastGiftMessage', { giftId: '5655', gift: { name: 'バラ', diamondCount: 1 }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => fs.readFileSync(history, 'utf8').includes('zombie.txt'), 'gift delivered');
  const rows = fs.readFileSync(history, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(rows.map(row => row.commandFile), ['old.txt', 'new.txt', 'zombie.txt']);
});
