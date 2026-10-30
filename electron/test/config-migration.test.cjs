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
test('TikTok ID: 配信前チェック・LIVE の確かめ・BRIDGE の接続・再起動の比べ方・ギフト一覧の自動更新は、自分の整え方や正規表現を持たず tiktok_id.cjs を使う', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['electron/preflight.cjs', 'electron/tiktok_live_status.cjs', 'bridge/index.js', 'bridge/live_config.cjs', 'electron/gifts_viewer.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /\{1,24\}/, file + ' に ID の正規表現の写しが残っている');
    // 設定の ID と、ギフト一覧を取った ID（gifts.meta.json の username）の両方を見る。
    assert.doesNotMatch(source, /(tiktokUsername|meta\.username)[^\n]*replace\(\/\^@\//, file + ' に @ を除く写しが残っている');
    // 小文字にするだけで比べる写し（前の配信前チェックの「LIVE へ接続しているか」）も見る。
    assert.doesNotMatch(source, /username[^\n]*\.toLowerCase\(\)/i, file + ' に小文字にして比べる写しが残っている');
    assert.match(source, /normalizeTikTokId\(/, file + ' が normalizeTikTokId を使っていない');
  }
  const index = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  assert.match(index, /const tiktokUsername = normalizeTikTokId\(config\.tiktokUsername\);/, 'BRIDGE は整えた形で接続する');
});

// ギフト一覧の画面で入力した ID・preload・別のアプリ GiftsViewer も同じ決まり（処理のコピー PR9）。
// preload と GiftsViewer のアプリの main は値をそのまま渡し、整えと確かめは受け取る側（gifts_viewer.cjs・GiftsViewer の道具）が行う。
test('TikTok ID: preload・ギフト一覧・GiftsViewer は自分の整え方や正規表現を持たない', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  for (const file of ['electron/preload.cjs', 'electron/gifts_viewer.cjs', 'GiftsViewer/tools/fetch_gifts.cjs', 'GiftsViewer/electron/main.cjs']) {
    const source = read(file);
    assert.doesNotMatch(source, /\.replace\(\/\^@\//, file + ' に @ を除く写しが残っている');
    assert.doesNotMatch(source, /\[\\w\.\]\{1,64\}/, file + ' に ID の正規表現の写しが残っている');
    assert.doesNotMatch(source, /username is empty/, file + ' に英語の空の文が残っている');
  }
  for (const file of ['electron/gifts_viewer.cjs', 'GiftsViewer/tools/fetch_gifts.cjs']) {
    assert.match(read(file), /normalizeTikTokId\(/, file + ' が normalizeTikTokId を使っていない');
  }
  const { tiktokIdProblem } = require('../../bridge/tiktok_id.cjs');
  assert.equal(tiktokIdProblem(' @Foo_Bar '), '');
  assert.equal(tiktokIdProblem(''), '', '空の扱いは呼ぶ側');
  assert.equal(tiktokIdProblem(' foo-bar '), 'TikTok ID「foo-bar」の形が正しくありません。半角英数字・_・. の24文字以内で入力してください');
  assert.match(read('bridge/config_schema.js'), /tiktokIdProblem\(/, '設定の確かめも同じ文を使う');
});

test('保存済みの設定を直す: 回数は四捨五入して1〜100、閾値は四捨五入して1以上。無効な項目も直し、元は変えない', () => {
  const original = { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt', repeat: '3' }, { giftId: '2', name: 'b', commandFile: 'a.txt', repeat: 500 }],
    likeEvents: [{ threshold: 0, commandFile: 'a.txt', repeat: 2.5, enabled: false }],
    shareEvent: { commandFile: 'a.txt', repeat: 'x' },
    commentGifts: { rules: [{ match: 'c', commandFile: 'a.txt', repeat: 7.4 }] } };
  const before = JSON.stringify(original);
  const { config, changes } = migrateBridgeConfig(original);
  assert.equal(JSON.stringify(original), before, '元の設定は変えない');
  assert.deepEqual([config.mappings[0].repeat, config.mappings[1].repeat, config.likeEvents[0].repeat, config.likeEvents[0].threshold, config.shareEvent.repeat,
    config.commentGifts.rules[0].repeat], [3, 100, 3, 1, 1, 7]);
  assert.ok(changes.includes('ギフト割り当て（バラ）の回数 "3" → 3'));
  assert.ok(changes.includes('いいね（0いいねごと）の閾値 0 → 1'));
  assert.ok(changes.includes('いいね（0いいねごと）の回数 2.5 → 3'));
  assert.equal(changes.length, 6, changes.join('\n'));
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

// オブジェクトでないもの（壊れたプリセットなど）を {configVersion:2} にすると、確かめが「TikTok IDが未承認です」という
// 関係のない文を出す（PR3 の最終レビュー）。そのまま返し、確かめに「設定全体がJSONオブジェクトではありません」を出させる。
test('保存済みの設定を直す: オブジェクトでないものは直さずそのまま返す', () => {
  for (const value of [null, undefined, [], [{ repeat: 2.5 }], 'x', 3, true]) {
    assert.deepEqual(migrateBridgeConfig(value), { config: value, changes: [] }, JSON.stringify(value));
  }
});

test('回数と閾値の対象: 無効の項目も含めてすべて並べ、場所の名前は commandFileRefs と同じ。古い gameplay は並べない', () => {
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
  ]);
  assert.deepEqual(thresholdTargets(config).map(t => t.where), ['いいね（100いいねごと）']);
  assert.equal(repeatTargets(config)[0].item, config.mappings[0], '項目そのものを返す（直す・確かめる側が値を読む）');
  assert.deepEqual(repeatTargets(null), []);
  assert.deepEqual(repeatTargets({ mappings: 'x', likeEvents: {}, roulette: { items: 3 } }), [], '形が違うものは飛ばす');
});

// 入力された TikTok ID の文（空なら「入力してください」、形が正しくなければ設定の確かめと同じ文）は tiktok_id.cjs の1か所（PR9 の最後のレビュー）。
// ギフト一覧の更新と GiftsViewer の道具が使う。前の道具は「@」だけのとき英語の Usage の文で止まった。
test('TikTok ID: 入力の文は tiktokIdInputProblem の1つで、ギフト一覧の更新と GiftsViewer の道具が使う', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { tiktokIdInputProblem } = require('../../bridge/tiktok_id.cjs');
  for (const empty of ['', '@', '  ', null, 3]) assert.equal(tiktokIdInputProblem(empty), 'TikTok ID を入力してください', String(empty));
  assert.equal(tiktokIdInputProblem(' @Foo_Bar '), '');
  assert.match(tiktokIdInputProblem('foo-bar'), /^TikTok ID「foo-bar」の形が正しくありません/);
  for (const file of ['electron/gifts_viewer.cjs', 'GiftsViewer/tools/fetch_gifts.cjs']) {
    assert.match(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), /tiktokIdInputProblem\(/, file);
  }
});
