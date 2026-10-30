// 手で enabled: false にしたギフト割り当ては、そのコマンドを動かさず、未設定ギフトにも回さない
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10、2026-10-22 ユーザーの決定。処理のコピー PR5）。
// 前はコンボの回数にも入れていた。演出・ゲーム性設定は仕掛けごとなくした（2026-10-30）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

test('無効のギフト割り当て: そのコマンドも未設定ギフトも撃たない', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say z\n', cod: 'say cod\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1, enabled: false }, { giftId: '2', name: 'ハート', commandFile: 'cod.txt', repeat: 1 }],
      unmappedGiftEvent: { enabled: true, commandFile: 'cod.txt', repeat: 1 } } });
  for (let i = 1; i <= 3; i++) await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: i, repeatEnd: i === 3 ? 1 : 0 });
  await bridge.emit('WebcastGiftMessage', { giftId: '2', gift: { name: 'ハート' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'enabled gift');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.key), ['cod']);
  assert.ok(bridge.logs.some(line => line.includes('[Gift] (disabled)') && line.includes('割り当ては無効です（コマンドは動かしません）')), bridge.logs.filter(line => line.includes('[Gift]')).join('\n'));
  // 起動のログの件数は、無効の割り当てを分けて出す（PR5 の最終レビュー）。
  assert.ok(bridge.logs.some(line => line.includes('[Bridge] Mappings: 2 items（無効 1）')), bridge.logs.filter(line => line.includes('Mappings')).join('\n'));
});

// 無効の割り当てでも、連打の記録は今までどおり通す（2026-10-22 ユーザーの決定）。連打の途中で有効にして保存したら、
// 有効にしたあとの分だけを送る（無効の間の2個分は送らない）。PR #177 レビュー 軽い3。
// 有効にしたあとの最初の通知は、連打の数が 2 → 4 と飛ぶ形にする（3個目だけだと、連打を記録していなくても「新しい連打の1回」で同じ [1] になる）。
test('無効のギフト割り当て: 連打の記録は通すので、連打の途中で有効にして保存したら、そのあとの分だけを送る', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say z\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1, enabled: false }] },
  });
  const gift = (repeatCount, repeatEnd) => bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount, repeatEnd });
  await gift(1, 0);
  await gift(2, 0);
  await bridge.wait(200);
  assert.deepEqual(bridge.requests, [], '無効の間は送らない');
  // 配信中の保存（アプリと同じく一時ファイルから置き換える）。
  const file = path.join(bridge.dir, 'config.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.mappings[0].enabled = true;
  fs.writeFileSync(file + '.tmp', JSON.stringify(saved));
  fs.renameSync(file + '.tmp', file);
  await bridge.until(() => bridge.logs.some(line => line.includes('Config reloaded')), 'config reload');
  await gift(4, 1);
  await bridge.until(() => bridge.requests.some(x => x.key === 'zombie'), 'gift after enabling');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.filter(x => x.key === 'zombie').map(x => x.count), [2], '3個目・4個目の2個分だけ（記録が無ければ1、無効の間も数えれば4）');
});
