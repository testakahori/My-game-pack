// 見送った軽い点（PR #74・#79 のレビュー）を直したこと。2026-10-12。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const commandFiles = require('../../bridge/command_files.cjs');
const eventRules = require('../../bridge/event_rules.cjs');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('BridgeMOD 経路の判定は1か所（送り方の名前の一覧を2か所に持たない）', () => {
  assert.equal(eventRules.isBridgeModTransport, commandFiles.isBridgeModTransport, 'event_rules は command_files の判定を使う');
  for (const file of ['bridge/event_rules.cjs', 'electron/preflight.cjs']) assert.doesNotMatch(read(file), /douma_mod/, file + '：名前の一覧の写しを持たない');
  assert.match(read('electron/preflight.cjs'), /const usesRcon = !isBridgeModTransport\(cfg\.options\?\.commandTransport\);/, '配信前チェックも同じ判定（大文字・空白も同じに扱う）');
  assert.equal(commandFiles.usesBridgeModTransport({ options: { commandTransport: ' HTTP ' } }), true);
  assert.equal(commandFiles.usesBridgeModTransport({ target: { type: 'other' }, options: { commandTransport: 'bridge_mod' } }), false);
});

test('時限倍率で回数が小数になったら、四捨五入して整数で送る（BridgeMOD は小数を拒否する）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n' },
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 3 }],
      // 一日中（0:00〜24:00）1.5倍。時限倍率は options.gameplay.timedMode から読む。
      options: { gameplay: { timedMode: { enabled: true, start: '00:00', end: '24:00', multiplier: 1.5 } } },
    },
  });
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g1' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.some(x => x.key === 'zombie'), 'gift');
  assert.deepEqual(bridge.requests.filter(x => x.key === 'zombie').map(x => x.count), [5], '3回×1.5倍＝4.5回 → 5回');
});

test('時限倍率のあとの回数は、本番もテスト発火も同じ関数（giftTimes）で四捨五入する（PR #85 レビュー）', () => {
  assert.equal(eventRules.giftTimes(4.5), 5);
  assert.equal(eventRules.giftTimes(1.2), 1);
  assert.equal(eventRules.giftTimes(NaN), 1);
  assert.match(read('bridge/index.js'), /times = giftTimes\(ctx\.featureEngine\.recordGift\(/, '本番も同じ関数で丸める');
});

test('運用の統計は、回数0の行（音・粒子だけ失敗）を1回と数えない（PR #85 レビュー）', () => {
  // 運用の統計は electron/operations_stats.cjs へ移した（2026-10-17 main.cjs の分割 PR5）。
  const source = read('electron/operations_stats.cjs');
  const stats = source.slice(source.indexOf('const byCommand = {};'), source.indexOf('const top = (obj)'));
  assert.match(stats, /const count = Number\(row\.count\);\s*const amount = Number\.isFinite\(count\) && count >= 0 \? count : 1;/);
});

test('起動ログの「個別最大コマンド数」には、BridgeMOD 経由では使わないことを書く', async t => {
  const bridge = await startBridgeFixture(t, { commands: { zombie: '# TITLE: zombie\nsay test\n' } });
  assert.ok(bridge.logs.some(line => /maxCommandsPerGift: \d+（BridgeMOD 経由では使わない）/.test(line)), bridge.logs.filter(l => /maxCommands/.test(l)).join('\n'));
});

test('bridge-live-events のテストに、もう効かない「個別最大コマンド数」の設定を残さない', () => {
  assert.doesNotMatch(read('electron/test/bridge-live-events.test.cjs'), /maxCommandsPerGift/);
});

// 同じ動きの小さい関数は1つ（設計書 3。処理のコピー PR5）。
test('範囲の丸めは event_rules.cjs の boundedInt の1つ（BRIDGE とルーレットに写しを持たない）', () => {
  for (const file of ['bridge/index.js', 'bridge/roulette.cjs']) assert.doesNotMatch(read(file), /clampInt|Math\.max\(1, Math\.min\(100, Math\.floor/, file);
});
