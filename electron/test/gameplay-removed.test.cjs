// 演出・ゲーム性設定（options.gameplay と FeatureEngine）は仕掛けごとなくした（2026-10-30 ユーザーの決定「仕掛けごとなくす」）。
// なくしたのは、コンボ・いいねの節目・フォローの節目・コメントコマンド・時限モード・コメント投票と、コンボの視聴者名に使っていた上位者。
// 古い設定に残っている options.gameplay は読まずに放っておく（版は上げず、直しでも消さず、「設定を直しました」も警告も出さない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const { commandFileRefs, invalidCommandFileRefs } = require('../../bridge/command_files.cjs');
const { CONFIG_VERSION, repeatTargets, thresholdTargets, migrateBridgeConfig } = require('../../bridge/config_migration.cjs');
const { validateBridgeConfig } = require('../../bridge/config_schema.js');
const { liveOptions } = require('../../bridge/live_config.cjs');
const { testEventActions, createTestRun, noMatchNote } = require('../../bridge/test_fire.cjs');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const proto = createRequire(path.join(root, 'bridge/index.js'))('tiktok-live-connector');
// 今の接続ライブラリは、common.displayText.key でフォローを見分ける。
const social = key => {
  const bytes = Buffer.from(key);
  return { displayText: proto.CommonMessageData.decode(Uint8Array.from([66, bytes.length + 2, 10, bytes.length, ...bytes])).displayText };
};
const REMOVED_TEST_TYPES = ['combo', 'like_milestone', 'follow_milestone', 'comment_command', 'poll'];

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
  assert.equal('gameplay' in liveOptions(config.options), false, '配信中に保存したらすぐ効かせる値にも入れない');
});

test('FeatureEngine と bridge/feature_engine.js は無い。RANDOM の重みは weighted_choice.cjs、配信者の保存先の古いファイルは次の同期で消す', () => {
  assert.equal(fs.existsSync(path.join(root, 'bridge/feature_engine.js')), false);
  // 移した先（weighted_choice.cjs）と消す一覧（bridge_sync.cjs）は、前のファイルの名前を書いてよい。
  const sources = [
    ...fs.readdirSync(path.join(root, 'bridge')).filter(name => /\.c?js$/.test(name) && name !== 'weighted_choice.cjs').map(name => 'bridge/' + name),
    ...fs.readdirSync(path.join(root, 'bridge/test')).filter(name => /\.js$/.test(name)).map(name => 'bridge/test/' + name),
    ...fs.readdirSync(path.join(root, 'electron')).filter(name => name.endsWith('.cjs') && name !== 'bridge_sync.cjs').map(name => 'electron/' + name),
    ...fs.readdirSync(path.join(root, 'scripts')).filter(name => name.endsWith('.cjs')).map(name => 'scripts/' + name),
    'package.json', 'vite.config.ts',
  ];
  for (const file of sources) assert.doesNotMatch(read(file), /FeatureEngine|featureEngine|feature_engine/, file);
  const files = JSON.parse(read('package.json')).build.files;
  assert.ok(files.includes('bridge/weighted_choice.cjs'), '配布に入れる');
  assert.match(read('scripts/prepare-bridge-runtime.cjs'), /assertExists\(path\.join\(bridgeDir, "weighted_choice\.cjs"\), "Bridge weighted_choice\.cjs"\);/);
  const sync = read('electron/bridge_sync.cjs');
  const removed = sync.slice(sync.indexOf('const BRIDGE_REMOVED_BUNDLE_FILES = ['), sync.indexOf('];', sync.indexOf('const BRIDGE_REMOVED_BUNDLE_FILES = [')));
  assert.match(removed, /"feature_engine\.js",/);
});

test('BRIDGE: ギフト・いいね・フォロー・コメント・つなぎ直し・配信終了・テスト発火は、ゲームの数え方を通さない', () => {
  const source = read('bridge/index.js');
  assert.doesNotMatch(source, /gameplay|emitFeature|startPoll|finishPoll|recordGift|recordLikes|recordFollow|recordComment|startStream|topGifter|lastRoomId|followCount|feature:/);
  assert.doesNotMatch(source, /コンボ|マイルストーン|時限倍率|上位者|ゲームの数え方|投票/, '注釈とログの文にも残さない');
  assert.doesNotMatch(source, /case "poll"/);
});

test('テスト発火: コンボ・いいねとフォローのマイルストーン・コメントコマンド・コメント投票の種類は無く、ほかの種類は残す', () => {
  const mapped = { mappedGiftIds: new Set(['1']) };
  for (const type of REMOVED_TEST_TYPES) {
    assert.throws(() => testEventActions({ type, giftId: '1', count: 1, comment: '!heal', pollOption: '1', followCount: 3 }, mapped), /対応していないテストイベントです/, type);
    assert.equal(noMatchNote(type), '条件に一致する有効な設定がありません。', type);
  }
  for (const type of ['gift', 'mapped_gift', 'unmapped_gift', 'like', 'share', 'follow', 'member', 'comment', 'death', 'roulette']) {
    assert.doesNotThrow(() => testEventActions({ type, commandFile: 'qa', giftId: type === 'unmapped_gift' ? '999' : '1', comment: 'hi' }, mapped), type);
  }
  // フォローは「何人目か」を受け取らない（数えていたのはフォローの節目だけ）。
  assert.deepEqual(testEventActions({ type: 'follow', followCount: 5, listenerName: '検証' }, mapped).actions, [{ kind: 'follow', data: { nickname: '検証' } }]);
  // 結果の見出し: コンボ・マイルストーン・コメント投票の名前は無く、コメントギフトの「コメント」は残す。
  const run = createTestRun();
  for (const type of ['combo', 'milestone', 'poll']) run.step({ historyType: type, commandFile: 'x.txt', count: 1 });
  run.step({ historyType: 'comment', commandFile: 'x.txt', count: 1 });
  assert.deepEqual(run.steps.map(step => step.label), ['イベント', 'イベント', 'イベント', 'コメント']);
  const fire = read('bridge/test_fire.cjs');
  assert.doesNotMatch(fire, /マイルストーン|コメントコマンド|ゲームの数え方|投票/, '案内の文にも残さない');
});

test('古い gameplay が残っている設定でも、BRIDGE は起動して今の設定のとおりだけ送り、配信中の保存も読み直す', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: Object.fromEntries(['zombie', 'cod', 'thanks', 'gifted', 'combo', 'mile', 'fan', 'heal', 'qa'].map(name => [name, `say ${name}\n`])),
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 3 }],
      likeEvents: [{ enabled: true, threshold: 100, commandFile: 'cod.txt', repeat: 1 }],
      followEvent: { enabled: true, commandFile: 'thanks.txt', repeat: 1 },
      commentGifts: { enabled: true, rules: [{ enabled: true, match: '!heal', commandFile: 'gifted.txt', repeat: 1 }] },
      options: { gameplay: OLD_GAMEPLAY },
    },
  });
  const kept = ['zombie', 'cod', 'thanks', 'gifted'];
  for (let i = 1; i <= 3; i++) await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: i, repeatEnd: i === 3 ? 1 : 0 });
  await bridge.emit('WebcastLikeMessage', { count: 150, total: '150' });
  await bridge.emit('WebcastSocialMessage', { common: social('pm_main_follow_message'), action: '1' });
  await bridge.emit('WebcastChatMessage', { content: '!heal' });
  await bridge.emit('WebcastChatMessage', { content: '!1' });
  await bridge.until(() => kept.every(key => bridge.requests.some(x => x.key === key)), 'ギフト・いいね・フォロー・コメントギフト');
  await bridge.wait(300);
  assert.deepEqual(bridge.requests.filter(x => x.key === 'zombie').map(x => x.count), [3, 3, 3], '時限モードの倍率を掛けない');
  assert.deepEqual(bridge.requests.map(x => x.key).filter(key => !kept.includes(key)), [], 'コンボ・節目・コメントコマンド・投票は送らない');
  assert.ok(!bridge.logs.some(line => line.includes('[Feature]')), bridge.logs.filter(line => line.includes('[Feature]')).join('\n'));

  // 配信中の保存（アプリと同じく一時ファイルから置き換える）。gameplay が残っていても取りやめずに読み直す。
  const file = path.join(bridge.dir, 'config.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.mappings[0].repeat = 1;
  fs.writeFileSync(file + '.tmp', JSON.stringify(saved));
  fs.renameSync(file + '.tmp', file);
  await bridge.until(() => bridge.logs.some(line => line.includes('Config reloaded') || line.includes('Config reload skipped')), 'config reload');
  assert.ok(!bridge.logs.some(line => line.includes('Config reload skipped')), bridge.logs.filter(line => line.includes('Config')).join('\n'));
  bridge.requests.length = 0;
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: 1, repeatEnd: 1, user: { id: '700', displayId: 'next', nickname: 'next' } });
  await bridge.until(() => bridge.requests.some(x => x.key === 'zombie'), 'gift after reload');
  assert.deepEqual(bridge.requests.map(x => [x.key, x.count]), [['zombie', 1]]);
});
