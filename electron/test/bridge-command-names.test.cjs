// BridgeMOD 向けのコマンド名の残りの食い違い（処理のコピー PR7。HANDOFF04 の PR1 のレビューの残り）を、本番の BRIDGE で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

test('保存済みの foo.txt.txt の割り当て: BRIDGE は起動し、そのギフトは送らず、ほかのギフトは届く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { 'foo.txt': 'say double\n', foo: 'say wrong file\n', cod: 'say cod\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'foo.txt.txt', repeat: 1 }, { giftId: '2', name: 'ハート', commandFile: 'cod.txt', repeat: 1 }] } });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.emit('WebcastGiftMessage', { giftId: '2', gift: { name: 'ハート' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.key === 'cod'), 'other gift');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.key), ['cod'], '前は foo.txt を送り、BridgeMOD が別のファイル foo.txt を動かしていた');
  assert.ok(bridge.logs.some(line => line.includes('.txt が2つあります')), bridge.logs.join('\n'));
});

test('テスト発火で foo.txt.txt を直接選ぶ: 「見つかりません」ではなく .txt が2つあることを伝え、送らない', async t => {
  const bridge = await startBridgeFixture(t, { commands: { foo: 'say foo\n' } });
  const result = await bridge.testEvent({ type: 'gift', commandFile: 'foo.txt.txt', count: 1 });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.match(result.error, /終わりに \.txt が2つあります。ファイル名を foo\.txt に直してください/, '前はファイルがあるかを先に見て「コマンドが見つかりません」だった');
  assert.deepEqual(bridge.requests, []);
});

test('大文字の Roulette.TXT を割り当てたギフトでも、ルーレットが回る（Roulette という名前のコマンドは送らない）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'Roulette.TXT', repeat: 1 }],
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] } } });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ' }, repeatCount: 1, repeatEnd: 1 });
  // 当たり（qa）が届くまで待つ。演出の途中で終えると、残りの送り直しが片付けたあとの偽 BridgeMOD へ続き、テストが終わらない。
  await bridge.until(() => bridge.requests.some(x => x.key === 'qa'), 'roulette winner');
  assert.ok(bridge.requests.some(x => Array.isArray(x.commands)), 'ルーレットの演出を送る');
  assert.ok(!bridge.requests.some(x => x.key === 'Roulette'), '前は Roulette という名前の要求を送っていた');
});
