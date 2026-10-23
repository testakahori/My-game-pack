const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isBridgeCommandFile, commandFileProblem, commandFileRefs } = require('../../bridge/command_files.cjs');
const { validateBridgeConfig: validateForSave } = require('../config_schema.cjs');
const { validateBridgeConfig: validateForBridge } = require('../../bridge/config_schema.js');

test('BridgeMODと同じ規則でコマンドファイル名を判定する', () => {
  for (const name of ['cod.txt', 'tnt-kuusyuu.txt', 'game_umetate_tower.txt', 'roulette', 'A.TXT']) assert.ok(isBridgeCommandFile(name), name);
  for (const name of ['ネコ.txt', 'tnt - コピー.txt', 'a b.txt', '.txt', '']) assert.ok(!isBridgeCommandFile(name), name);
  assert.match(commandFileProblem('ネコ.txt'), /ネコ\.txt.*半角英数字/);
  assert.equal(commandFileProblem('cod.txt'), '');
});

const config = (extra = {}) => ({
  tiktokUsername: 'fixture', options: { commandTransport: 'bridge_mod', gameplay: {
    combo: { levels: [{ count: 10, commandFile: 'combo ネコ.txt' }] },
    likeMilestones: [{ threshold: 1000, commandFile: 'ok.txt' }],
    commentCommands: { '!猫': 'ねこ.txt' }, poll: { enabled: true, options: { 1: { commandFile: 'ok.txt' } } },
  } },
  mappings: [{ giftId: '5655', name: 'バラ', commandFile: 'ネコ.txt' }],
  likeEvents: [{ threshold: 10, commandFile: 'cod.txt' }],
  followEvent: { commandFile: 'tnt - コピー.txt' },
  roulette: { enabled: true, items: [{ label: '当たり', commandFile: 'あたり.txt' }] },
  commentGifts: { enabled: true, rules: [{ match: 'こんにちは', commandFile: 'heal.txt' }] },
  ...extra,
});

test('アプリの保存では、新しく割り当てた使えない名前を場所付きのエラーにする', () => {
  // アプリの保存は保存済みの設定（無ければ null）を previous に渡す。保存済みに無い名前はエラー。
  const result = validateForSave(config(), { previous: [null] });
  assert.equal(result.ok, false);
  const text = result.errors.join('\n');
  for (const where of ['ギフト割り当て（バラ）', 'フォロー', 'ルーレット項目（当たり）', 'コンボ（10連）', 'コメントコマンド（「!猫」）']) assert.ok(text.includes(where), where);
  assert.ok(!text.includes('いいね（10いいねごと）'));
  assert.equal(commandFileRefs(config()).length, 9);
  // RCON はファイルを直接読むので名前の制限は掛けない。
  assert.equal(validateForSave(config({ options: { commandTransport: 'rcon' } }), { previous: [null] }).ok, true);
});

test('無効にしてある設定は、Bridgeと同じく発火しないので検査しない', () => {
  const disabled = config({
    mappings: [], followEvent: { enabled: false, commandFile: 'tnt - コピー.txt' },
    likeEvents: [{ enabled: false, threshold: 10, commandFile: 'ねこ.txt' }],
    roulette: { enabled: false, items: [{ commandFile: 'あたり.txt' }] },
    deathRoulette: { items: [{ commandFile: 'あたり.txt' }] },
    commentGifts: { enabled: true, rules: [{ enabled: false, match: 'x', commandFile: 'ねこ.txt' }] },
    options: { commandTransport: 'bridge_mod', gameplay: { poll: { enabled: false, options: { 1: 'ねこ.txt' } } } },
  });
  assert.deepEqual(commandFileRefs(disabled), []);
  assert.equal(validateForSave(disabled, { previous: [null] }).ok, true);
  // コンボ・ルーレット項目は Bridge が enabled を見ずに発火するので、enabled:false でも数える。
  // ギフト割り当ては、無効なら BRIDGE も動かさない（設計書 10。処理のコピー PR5）ので数えない。
  const ignoredFlag = config({ mappings: [{ enabled: false, giftId: '1', name: 'ハート', commandFile: 'ねこ.txt' }],
    roulette: { enabled: true, items: [{ enabled: false, label: '外れ', commandFile: 'あたり.txt' }] },
    options: { commandTransport: 'bridge_mod', gameplay: { combo: { levels: [{ enabled: false, count: 5, commandFile: 'ねこ.txt' }] } } } });
  const where = commandFileRefs(ignoredFlag).map(ref => ref.where);
  for (const expected of ['ルーレット項目（外れ）', 'コンボ（5連）']) assert.ok(where.includes(expected), expected);
  assert.ok(!where.includes('ギフト割り当て（ハート）'), '無効のギフト割り当ては数えない');
  // ルーレットは BRIDGE が真の値なら回す（index.js の rouletteCfg?.enabled）ので、手で書いた 1 でも数える（PR5 の最終レビュー）。
  assert.ok(commandFileRefs({ roulette: { enabled: 1, items: [{ label: '当たり', commandFile: 'a.txt' }] } }).some(ref => ref.where === 'ルーレット項目（当たり）'));
});

// 設計書 13：参照を数える所は、自分の数え方（設定全体の commandFile をたどる写し）を持たない（PR5 の最終レビュー）。
test('参照の数え方の写し: 配信前チェック・ゲームの候補の確かめ・ゲームの切り替えは commandFileRefs を使う', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['electron/preflight.cjs', 'electron/game_command_scope.cjs', 'electron/game_profiles.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /key === ['"]commandFile['"]|function collect\(/, file + ' に参照の数え方の写しが残っている');
    assert.match(source, /commandFileRefs\(/, file + ' が commandFileRefs を使っていない');
  }
});

test('前から保存されていた割り当ては警告に留め、一括起動やほかの保存を止めない', () => {
  const saved = config({ followEvent: null, roulette: null, options: { commandTransport: 'bridge_mod' } });
  // 旧版で保存した「バラ→ネコ.txt」をそのままに、ID承認やほかの設定だけを保存する。
  const result = validateForSave({ ...saved, tiktokUsername: 'changed' }, { previous: [saved] });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.includes('ギフト割り当て（バラ）') && w.includes('実行されません')));
  // 「新しいか」はコマンドの名前で決める（2026-10-18 設計書の 7）。保存済みの名前を別の場所へ割り当てても警告、保存済みに無い名前はエラー。
  const added = { ...saved, mappings: [...saved.mappings, { giftId: '1', name: 'ハート', commandFile: 'ネコ.txt' }, { giftId: '2', name: 'スター', commandFile: 'イヌ.txt' }] };
  const next = validateForSave(added, { previous: [saved] });
  assert.equal(next.ok, false);
  assert.ok(next.errors.some(e => e.includes('ギフト割り当て（スター）')));
  assert.ok(!next.errors.some(e => e.includes('ギフト割り当て（ハート）') || e.includes('ギフト割り当て（バラ）')));
  assert.ok(next.warnings.some(w => w.includes('ギフト割り当て（ハート）')));
});

test('Bridgeの起動・再読込では警告に留め、Bridge自体は起動できる', () => {
  const result = validateForBridge(config());
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(w => w.includes('ギフト割り当て（バラ）') && w.includes('実行されません')));
});

// .txt の付け外しは command_files.cjs の1組の関数だけで行い、TNT.TXT のような大文字の拡張子も同じに扱う（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 4）。
test('.txt の付け外し: ensureTxt・isTxtName・bridgeCommandKey は大文字小文字を問わない', () => {
  const { ensureTxt, isTxtName, bridgeCommandKey } = require('../../bridge/command_files.cjs');
  assert.equal(ensureTxt('a'), 'a.txt');
  assert.equal(ensureTxt(' A.TXT '), 'A.TXT');
  assert.equal(ensureTxt('tnt.v2'), 'tnt.v2.txt');
  assert.equal(ensureTxt(''), '');
  // 前の BRIDGE の ensureTxt と同じく、空・0・false・null は「名前なし」（PR1 の最終レビュー）。
  for (const value of [0, false, null, undefined]) assert.equal(ensureTxt(value), '', String(value));
  assert.equal(isTxtName('A.TXT'), true);
  assert.equal(isTxtName('a.txt.bak'), false);
  assert.equal(bridgeCommandKey('TNT.TXT'), 'TNT');
});

test('.txt の付け外し: BRIDGE・アプリは自前の付け外しを持たず command_files.cjs を使う', () => {
  const root = path.resolve(__dirname, '../..');
  const files = ['bridge/index.js', 'bridge/test_fire.cjs', 'bridge/roulette.cjs', 'vite.config.ts',
    ...fs.readdirSync(path.join(root, 'electron')).filter(name => name.endsWith('.cjs') && name !== 'preload.cjs').map(name => 'electron/' + name)];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    // endsWith(".txt")・basename(x, ".txt")・/\.txt$/i.test(・.replace(/\.txt$/ の形（PR1 の最終レビューで .replace と vite.config.ts を足した）。
    const copy = /endsWith\((["'])\.txt\1\)|basename\([^)]*,\s*(["'])\.txt\2\)|\/\\\.txt\$\/i\.test\(|replace\(\/\\\.txt\$\//;
    assert.equal(copy.test(source), false, file + ' に .txt の付け外しの写しが残っている');
  }
});

test('.txt の付け外し: 大文字の拡張子（TNT.TXT）の割り当ても、BridgeMOD へ送る名前は TNT', async t => {
  const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
  const bridge = await startBridgeFixture(t, { config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'TNT.TXT', repeat: 1 }] } });
  fs.writeFileSync(path.join(bridge.dir, 'commands', 'TNT.TXT'), '# TITLE: TNT\nsay tnt\n');
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g1' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.length > 0, 'gift');
  assert.deepEqual(bridge.requests.map(request => request.key), ['TNT']);
});

// 前は bridgeCommandKey がフォルダーを除いた最後の部分だけを見て ../x.txt を通し、foo.txt.txt では BRIDGE が foo.txt を送って
// BridgeMOD が別のファイル foo.txt を動かしていた（処理のコピー PR7。HANDOFF04 の PR1 のレビューの残り）。
test('BridgeMOD 向けの名前: フォルダーの区切りと、終わりの .txt が2つの名前は断る', () => {
  for (const name of ['../x.txt', '..\\x.txt', 'sub/x.txt', 'foo.txt.txt', 'FOO.TXT.txt', 'foo.txt.TXT']) assert.equal(isBridgeCommandFile(name), false, name);
  for (const name of ['foo.txt', 'tnt.v2.txt', 'TNT.TXT', 'foo', 'a.txtb.txt']) assert.equal(isBridgeCommandFile(name), true, name);
  assert.match(commandFileProblem('../x.txt'), /フォルダーの区切り（\/ や \\）は使えません/);
  assert.match(commandFileProblem('foo.txt.txt'), /終わりに \.txt が2つあります。ファイル名を foo\.txt に直してください/);
  // 拡張子を表示していないエクスプローラーでは foo.txt.txt が「foo.txt」と見えるので、名前を foo にすればよいことも書く（PR7 の最後のレビュー）。
  assert.match(commandFileProblem('foo.txt.txt'), /拡張子を表示していない.*名前を foo にしてください/);
  // .txt が3つでも、直し先はまた断られる名前（x.txt.txt）ではなく x.txt。
  assert.match(commandFileProblem('x.txt.txt.txt'), /終わりに \.txt が3つあります。ファイル名を x\.txt に直してください.*名前を x にしてください/);
});
