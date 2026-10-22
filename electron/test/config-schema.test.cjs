// 設定（config.minecraft.json）の確かめは1つ（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7・9）。
// 正本は bridge/config_schema.js。アプリ（保存・config:validate・プリセット・配信前チェック・バックアップの一覧）も BRIDGE も同じ関数を使う。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateBridgeConfig } = require('../../bridge/config_schema.js');
const { isKnownTransport } = require('../../bridge/command_files.cjs');

const base = (extra = {}) => ({ tiktokUsername: 'fixture', mappings: [{ giftId: '1', name: 'バラ', commandFile: 'a.txt' }], ...extra });

test('確かめは1つ: アプリと BRIDGE は同じ関数を使う', () => {
  assert.equal(require('../config_schema.cjs').validateBridgeConfig, validateBridgeConfig);
  assert.equal(validateBridgeConfig(base()).ok, true, '回数を書いていない割り当てはエラーにしない');
});

test('回数・閾値: 1〜100 の整数・1 以上の整数でなければエラー（無効な項目も、ゲームの設定も）。書いていなければよい', () => {
  const result = validateBridgeConfig(base({
    mappings: [{ giftId: '1', name: 'A', commandFile: 'a.txt', repeat: '3' }, { giftId: '2', name: 'B', commandFile: 'a.txt', repeat: 2.5 },
      { giftId: '3', name: 'C', commandFile: 'a.txt', repeat: 0 }, { giftId: '4', name: 'D', commandFile: 'a.txt', repeat: 101 }, { giftId: '5', name: 'E', commandFile: 'a.txt', repeat: 100 }],
    likeEvents: [{ threshold: 0, commandFile: 'a.txt', enabled: false }, { threshold: 1.5, commandFile: 'a.txt' }, { threshold: 1000000, commandFile: 'a.txt', repeat: 1 }],
    options: { gameplay: { combo: { levels: [{ count: 5, commandFile: 'a.txt', repeat: 500 }] }, followMilestones: [{ threshold: -1, commandFile: 'a.txt' }] } },
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    'ギフト割り当て（A）の回数は 1〜100 の整数で指定してください（今は "3"）',
    'ギフト割り当て（B）の回数は 1〜100 の整数で指定してください（今は 2.5）',
    'ギフト割り当て（C）の回数は 1〜100 の整数で指定してください（今は 0）',
    'ギフト割り当て（D）の回数は 1〜100 の整数で指定してください（今は 101）',
    'コンボ（5連）の回数は 1〜100 の整数で指定してください（今は 500）',
    'いいね（0いいねごと）の閾値は 1 以上の整数で指定してください（今は 0）',
    'いいね（1.5いいねごと）の閾値は 1 以上の整数で指定してください（今は 1.5）',
    'フォローマイルストーン（-1）の閾値は 1 以上の整数で指定してください（今は -1）',
  ]);
});

test('送り方: 知らない名前は警告して RCON 扱い（エラーにはしない）', () => {
  assert.deepEqual(['', ' RCON ', 'bridge_mod', 'http', undefined, null].map(isKnownTransport), [true, true, true, true, true, true]);
  assert.deepEqual(['bridge-mod', 'tcp', 3].map(isKnownTransport), [false, false, false]);
  const result = validateBridgeConfig(base({ options: { commandTransport: 'bridge-mod' } }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes('options.commandTransport「bridge-mod」は知らない送り方です。RCON として扱います（BridgeMOD で送るなら bridge_mod）'), result.warnings.join('\n'));
  assert.deepEqual(validateBridgeConfig(base({ options: { commandTransport: 'bridge_mod' } })).warnings, []);
});

test('TikTok ID: 空・形が正しくないものはエラー、@ や大文字は整えれば正しい', () => {
  assert.deepEqual(validateBridgeConfig(base({ tiktokUsername: '  ' })).errors,
    ['TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。ダッシュボードでIDを入力して承認してください']);
  assert.deepEqual(validateBridgeConfig(base({ tiktokUsername: 'foo-bar' })).errors,
    ['TikTok ID「foo-bar」の形が正しくありません。半角英数字・_・. の24文字以内で入力してください']);
  for (const id of [' @Foo_Bar ', 'a.b_c9']) assert.equal(validateBridgeConfig(base({ tiktokUsername: id })).ok, true, id);
});

test('BridgeMOD が受け付けない名前: previous を渡さなければ警告。渡せば、同じコマンドの名前が保存済みなら警告、新しければエラー（ギフト名やいいねの閾値を変えても警告のまま）', () => {
  const saved = base({ options: { commandTransport: 'bridge_mod' }, mappings: [{ giftId: '1', name: 'バラ', commandFile: 'ネコ.txt' }], likeEvents: [{ threshold: 100, commandFile: 'ネコ.txt' }] });
  const noPrevious = validateBridgeConfig(saved);
  assert.equal(noPrevious.ok, true, 'BRIDGE・配信前チェック・バックアップの一覧は止めない');
  assert.equal(noPrevious.warnings.length, 2);
  const renamed = { ...saved, mappings: [{ giftId: '1', name: 'ローズ', commandFile: ' ネコ.txt ' }], likeEvents: [{ threshold: 200, commandFile: 'ネコ.txt' }] };
  const kept = validateBridgeConfig(renamed, { previous: [saved] });
  assert.equal(kept.ok, true, kept.errors.join('\n'));
  assert.ok(kept.warnings.some(w => w.includes('ギフト割り当て（ローズ）') && w.includes('実行されません')));
  const added = validateBridgeConfig({ ...renamed, followEvent: { commandFile: 'イヌ.txt' } }, { previous: [null, saved] });
  assert.equal(added.ok, false);
  assert.equal(added.errors.length, 1);
  assert.match(added.errors[0], /^フォロー: .*イヌ\.txt/);
  assert.equal(validateBridgeConfig(saved, { previous: [] }).ok, false, 'previous が空なら（保存済みの設定がなければ）新しい名前としてエラー');
});

// electron が読む ../bridge/*.cjs・*.js は、配布のアプリ（asar）に入っていないと起動で落ちる（PR1 の最終レビューで見つけた穴）。
// bridge のモジュールが中で読む ./*.cjs も同じなので、たどって確かめる（PR3 の最終レビュー）。
test('配布: electron が読む bridge のモジュールは、その中で読むものも含めて、すべて package.json の build.files にある', () => {
  const root = path.resolve(__dirname, '../..');
  const files = new Set(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files);
  const required = new Set();
  // require と同じく、書いたままの名前・.js・.cjs・.json の順にファイルを探す。bridge/ の外（electron/** など）は glob で入るので見ない。
  const visit = (spec, from) => {
    const base = path.posix.join(path.posix.dirname(from), spec);
    if (!base.startsWith('bridge/')) return;
    const file = ['', '.js', '.cjs', '.json'].map(ext => base + ext).find(name => fs.existsSync(path.join(root, name)) && fs.statSync(path.join(root, name)).isFile());
    assert.ok(file, `${from} が読む ${spec} が見つからない`);
    if (required.has(file)) return;
    required.add(file);
    if (file.endsWith('.json')) return;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) visit(match[1], file);
  };
  for (const name of fs.readdirSync(path.join(root, 'electron')).filter(n => n.endsWith('.cjs'))) {
    const source = fs.readFileSync(path.join(root, 'electron', name), 'utf8');
    for (const match of source.matchAll(/require\(\s*["'](\.\.\/bridge\/[^"']+)["']\s*\)/g)) visit(match[1], `electron/${name}`);
  }
  assert.ok(required.has('bridge/config_schema.js'), [...required].join(', '));
  assert.ok(required.has('bridge/tiktok_events.cjs'), 'audience_stats.cjs が中で読む tiktok_events.cjs までたどる: ' + [...required].join(', '));
  for (const file of required) assert.ok(files.has(file), `${file} が build.files にない`);
});
