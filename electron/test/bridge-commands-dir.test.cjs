// コマンドの場所（commandsDir）は、設定に無ければ commands/minecraft（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7。処理のコピー PR4）。
// 前の BRIDGE だけ commands を見ていて、新しく入れた直後など設定に書かれていないとき、txt の見出し（# RANDOM: など）を読み落としていた。
const test = require('node:test');
const assert = require('node:assert/strict');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

test('コマンドの場所: 設定に commandsDir が無ければ commands/minecraft を読む（見出しの RANDOM も効く）', async t => {
  const bridge = await startBridgeFixture(t, { commandsFolder: 'commands/minecraft',
    commands: { pick: '# RANDOM: qa\nsay pick\n', qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'pick.txt', repeat: 1 }], options: { commandsDir: undefined } } });
  assert.ok(bridge.logs.some(line => line.includes('[Bridge] CommandsDir: commands/minecraft/')), bridge.logs.join('\n'));
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.length > 0, 'gift');
  assert.deepEqual(bridge.requests.map(x => x.key), ['qa']);
});
