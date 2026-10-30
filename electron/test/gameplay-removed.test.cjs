// 演出・ゲーム性設定（options.gameplay と FeatureEngine）は仕掛けごとなくした（2026-10-30 ユーザーの決定「仕掛けごとなくす」）。
// なくしたのは、コンボ・いいねの節目・フォローの節目・コメントコマンド・時限モード・コメント投票と、コンボの視聴者名に使っていた上位者。
// 古い設定に残っている options.gameplay は読まずに放っておく（版は上げず、直しでも消さず、「設定を直しました」も警告も出さない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { commandFileRefs, invalidCommandFileRefs } = require('../../bridge/command_files.cjs');
const { CONFIG_VERSION, repeatTargets, thresholdTargets, migrateBridgeConfig } = require('../../bridge/config_migration.cjs');
const { validateBridgeConfig } = require('../../bridge/config_schema.js');

// 前の設定に書けた仕掛けを全部、使えない名前・無いコマンド・範囲の外の回数と閾値で書いたもの。
const OLD_GAMEPLAY = {
  combo: { windowMs: 60000, levels: [{ count: 2, commandFile: 'combo.txt', repeat: 500 }] },
  likeMilestones: [{ threshold: 10, commandFile: 'mile.txt' }, { threshold: -1, commandFile: 'ネコ.txt' }],
  followMilestones: [{ threshold: 1, commandFile: 'fan.txt', repeat: 2.5 }],
  commentCommands: { '!heal': 'heal.txt', '!x': { commandFile: 'missing.txt', repeat: 0 } },
  timedMode: { enabled: true, start: '00:00', end: '24:00', multiplier: 2 },
  poll: { enabled: true, durationMs: 5000, options: { 1: 'qa.txt', 2: { commandFile: 'missing.txt', repeat: 3 } } },
};

test('古い gameplay は読まない: コマンドの参照・回数・閾値に数えず、直しでも消さず直さず、確かめでもエラーや警告にしない', () => {
  const config = { tiktokUsername: 'fixture', mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt' }],
    options: { commandTransport: 'bridge_mod', gameplay: OLD_GAMEPLAY } };
  assert.deepEqual(commandFileRefs(config).map(ref => ref.where), ['ギフト割り当て（バラ）']);
  assert.deepEqual(invalidCommandFileRefs(config), [], 'ネコ.txt のような使えない名前も数えない');
  assert.deepEqual(repeatTargets(config).map(target => target.where), ['ギフト割り当て（バラ）']);
  assert.deepEqual(thresholdTargets(config), []);
  const migrated = migrateBridgeConfig(config);
  assert.deepEqual(migrated.changes, [], '「設定を直しました」を出さない');
  assert.deepEqual(migrated.config.options.gameplay, OLD_GAMEPLAY, '消さない・直さない');
  assert.equal(migrated.config.configVersion, 2, '版は上げない');
  assert.equal(CONFIG_VERSION, 2);
  const result = validateBridgeConfig(config, { previous: [null] });
  assert.deepEqual([result.ok, result.errors, result.warnings], [true, [], []]);
});
