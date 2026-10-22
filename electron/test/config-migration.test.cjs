// TikTok ID の整え方と、保存済みの設定を更新のときに1回だけ直す式（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7・9）。
// 式は bridge/tiktok_id.cjs・bridge/config_migration.cjs の1か所に置き、アプリ・配信前チェック・LIVE の確かめ・BRIDGE が使う。
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTikTokId, isValidTikTokId } = require('../../bridge/tiktok_id.cjs');
const { CONFIG_VERSION, migrateBridgeConfig, repeatTargets, thresholdTargets } = require('../../bridge/config_migration.cjs');

test('TikTok ID: 前後の空白・先頭の @ を除いて小文字にし、半角英数字・_・. の24文字以内だけを正しいとする', () => {
  assert.equal(normalizeTikTokId('  @Foo_Bar.1 '), 'foo_bar.1');
  assert.deepEqual([null, undefined, 3, {}].map(normalizeTikTokId), ['', '', '', ''], '文字列でなければ空');
  assert.deepEqual(['foo_bar', '@Foo', 'a'.repeat(24)].map(isValidTikTokId), [true, true, true]);
  assert.deepEqual(['', 'foo-bar', 'a'.repeat(25), 'ねこ', null, '@'].map(isValidTikTokId), [false, false, false, false, false, false]);
});

// 設計書 13：1つにまとめた関数は、今それを使っている所すべてが同じ関数を呼ぶ（自分の写しを持ち続けない）。
test('TikTok ID: 配信前チェック・LIVE の確かめ・BRIDGE の接続・再起動の比べ方は、自分の整え方や正規表現を持たず tiktok_id.cjs を使う', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['electron/preflight.cjs', 'electron/tiktok_live_status.cjs', 'bridge/index.js', 'bridge/live_config.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /\{1,24\}/, file + ' に ID の正規表現の写しが残っている');
    assert.doesNotMatch(source, /tiktokUsername[^\n]*replace\(\/\^@\//, file + ' に @ を除く写しが残っている');
    assert.match(source, /normalizeTikTokId\(/, file + ' が normalizeTikTokId を使っていない');
  }
  const index = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  assert.match(index, /const tiktokUsername = normalizeTikTokId\(config\.tiktokUsername\);/, 'BRIDGE は整えた形で接続する');
});

test('保存済みの設定を直す: 回数は四捨五入して1〜100、閾値は四捨五入して1以上。無効な項目も直し、元は変えない', () => {
  const original = { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: '3' }, { giftId: '2', name: 'b', commandFile: 'a.txt', repeat: 500 }],
    likeEvents: [{ threshold: 0, commandFile: 'a.txt', repeat: 2.5, enabled: false }],
    shareEvent: { commandFile: 'a.txt', repeat: 'x' },
    options: { gameplay: { combo: { levels: [{ count: 5, commandFile: 'a.txt', repeat: 0 }] }, commentCommands: { '!c': { commandFile: 'a.txt', repeat: 7.4 }, '!s': 'a.txt' } } } };
  const before = JSON.stringify(original);
  const { config, changes } = migrateBridgeConfig(original);
  assert.equal(JSON.stringify(original), before, '元の設定は変えない');
  assert.deepEqual([config.mappings[0].repeat, config.mappings[1].repeat, config.likeEvents[0].repeat, config.likeEvents[0].threshold, config.shareEvent.repeat,
    config.options.gameplay.combo.levels[0].repeat, config.options.gameplay.commentCommands['!c'].repeat, config.options.gameplay.commentCommands['!s']], [3, 100, 3, 1, 1, 1, 7, 'a.txt']);
  assert.ok(changes.includes('ギフト割り当て（バラ）の回数 "3" → 3'));
  assert.ok(changes.includes('いいね（0いいねごと）の閾値 0 → 1'));
  assert.ok(changes.includes('いいね（0いいねごと）の回数 2.5 → 3'));
  assert.equal(changes.length, 7, changes.join('\n'));
  assert.deepEqual(migrateBridgeConfig(config).changes, [], '直したものはもう直さない');
  assert.equal(config.configVersion, CONFIG_VERSION);
  assert.equal(CONFIG_VERSION, 2);
});

test('保存済みの設定を直す: 書いていない回数・閾値は足さない。閾値は上を切らない', () => {
  const { config, changes } = migrateBridgeConfig({ mappings: [{ giftId: '1', commandFile: 'a.txt' }], likeEvents: [{ threshold: 99.6, commandFile: 'a.txt' }, { threshold: 2000000, commandFile: 'a.txt' }] });
  assert.equal(Object.hasOwn(config.mappings[0], 'repeat'), false);
  assert.deepEqual(config.likeEvents.map(ev => ev.threshold), [100, 2000000]);
  assert.deepEqual(changes, ['いいね（99.6いいねごと）の閾値 99.6 → 100']);
  assert.deepEqual(migrateBridgeConfig({}).config, { configVersion: 2 }, '空の設定にも版だけ付ける');
});

test('回数と閾値の対象: 無効の項目・ゲームの設定も含めてすべて並べ、場所の名前は commandFileRefs と同じ', () => {
  const config = {
    mappings: [{ name: 'バラ', commandFile: 'a.txt' }],
    likeEvents: [{ threshold: 100, commandFile: 'a.txt', enabled: false }],
    shareEvent: { commandFile: 'a.txt' }, followEvent: { commandFile: 'a.txt' }, memberEvent: { commandFile: 'a.txt' }, unmappedGiftEvent: { commandFile: 'a.txt', enabled: false },
    roulette: { enabled: false, items: [{ label: '雷', commandFile: 'a.txt' }, { commandFile: 'b.txt' }] },
    deathRoulette: { items: [{ label: '罠', commandFile: 'a.txt' }] },
    commentGifts: { rules: [{ match: 'gg', commandFile: 'a.txt', enabled: false }] },
    options: { gameplay: {
      combo: { levels: [{ count: 5, commandFile: 'a.txt' }] },
      likeMilestones: [{ threshold: 100, commandFile: 'a.txt' }], followMilestones: [{ threshold: 10, commandFile: 'a.txt' }],
      commentCommands: { '!creeper': { commandFile: 'a.txt' }, '!s': 'a.txt' },
      poll: { enabled: false, options: { 1: { commandFile: 'a.txt' }, 2: 'b.txt' } },
    } },
  };
  assert.deepEqual(repeatTargets(config).map(t => t.where), [
    'ギフト割り当て（バラ）', 'いいね（100いいねごと）', 'シェア', 'フォロー', '訪問', '未設定ギフト',
    'ルーレット項目（雷）', 'ルーレット項目（b.txt）', 'デスルーレット項目（罠）', 'コメントギフト（「gg」）',
    'コンボ（5連）', 'いいねマイルストーン（100）', 'フォローマイルストーン（10）', 'コメントコマンド（「!creeper」）', 'コメント投票（!1）',
  ]);
  assert.deepEqual(thresholdTargets(config).map(t => t.where), ['いいね（100いいねごと）', 'いいねマイルストーン（100）', 'フォローマイルストーン（10）']);
  assert.equal(repeatTargets(config)[0].item, config.mappings[0], '項目そのものを返す（直す・確かめる側が値を読む）');
  assert.deepEqual(repeatTargets(null), []);
  assert.deepEqual(repeatTargets({ mappings: 'x', options: { gameplay: { combo: { levels: {} } } } }), [], '形が違うものは飛ばす');
});
