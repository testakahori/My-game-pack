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
    ['TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。配信ホームでIDを入力して承認してください']);
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
  // electron/ の下のフォルダーも見る（test/ は配布のアプリで読まないので外す。埋め立て PR2 の最後のレビュー）。
  const electronFiles = fs.readdirSync(path.join(root, 'electron'), { recursive: true }).map(n => String(n).split(path.sep).join('/'))
    .filter(n => n.endsWith('.cjs') && !n.startsWith('test/'));
  for (const name of electronFiles) {
    const from = `electron/${name}`, source = fs.readFileSync(path.join(root, from), 'utf8');
    // 名前を組み立てて読む require は、配布のアプリに入るかをここでたどれないので使わない。
    assert.doesNotMatch(source, /\brequire\(\s*(?!(["'])[^"'\n]+\1\s*\))/, `${from} が名前を組み立てて require している`);
    for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const target = path.posix.join(path.posix.dirname(from), match[1]);
      if (target.startsWith('bridge/')) { visit(match[1], from); continue; }
      // bridge/ のほかの外（scripts/ など）は配布のアプリに入らないので、electron からは読まない（埋め立て PR2 で見つけた穴）。
      assert.ok(target.startsWith('electron/') || files.has(target) || files.has(target + '.cjs') || files.has(target + '.js'), `${from} が配布のアプリに入らない ${match[1]} を読んでいる`);
    }
  }
  assert.ok(required.has('bridge/config_schema.js'), [...required].join(', '));
  assert.ok(required.has('bridge/tiktok_events.cjs'), 'audience_stats.cjs が中で読む tiktok_events.cjs までたどる: ' + [...required].join(', '));
  for (const file of required) assert.ok(files.has(file), `${file} が build.files にない`);
});

// 開発版では BRIDGE のフォルダーがリポジトリの bridge/ なので、そこに設定ファイルの写し（.last-good）や壊れたファイル（.broken-…）ができる。
// 配布物に入ると、配信者の PC に開発者の写しが届き、壊れたときに開発者の設定に戻る（設定ファイルの PR2）。
test('配布と git: 設定ファイルの写しと壊れたファイルは、git にも配布物の bridge にも入れない', () => {
  const root = path.resolve(__dirname, '../..');
  const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map(line => line.trim());
  // PC が落ちて残った書きかけの一時ファイル（<名前>.<uuid>.tmp）も入れない（最後のレビューの軽い 6）。
  const temp = '*.????????-????-????-????-????????????.tmp';
  for (const pattern of ['*.last-good', '*.broken-*', temp]) assert.ok(ignore.includes(pattern), `.gitignore に ${pattern} が無い`);
  const resources = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.extraResources;
  const bridge = resources.find(entry => entry.from === 'bridge');
  for (const pattern of ['!**/*.last-good', '!**/*.broken-*', '!**/' + temp]) assert.ok(bridge.filter.includes(pattern), `bridge の filter に ${pattern} が無い`);
});

// git の bridge/tts-settings.json は開発者の読み上げの設定。配布物に入ると、新しく作った BRIDGE のフォルダーにコピーされ、
// 配信者が読み上げを切っていても開発者の声の設定で読み上げる（最初からの問題。PR2 の最後のレビューの重要 3。2026-10-24 ユーザーの決定：配布物からだけ外す）。
test('配布: 開発者の読み上げの設定（bridge/tts-settings.json）は配布物に入れない', () => {
  const root = path.resolve(__dirname, '../..');
  const resources = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.extraResources;
  assert.ok(resources.find(entry => entry.from === 'bridge').filter.includes('!tts-settings.json'));
});

// 開発機の bridge/commands/minecraft には、git の管理外のファイルが残る。配布物の bridge は中身をまるごと（**/*）入れるので、それも配っていた。
// _op.txt（開発者のマイクラIDを OP にする中身）、ゲームのコマンドの写し（game_<ゲーム>_*.txt。ゲームを選んだときにアプリがパックから書き出す）、
// .omc・.claude（開発の道具の記録）。OP の自動付与は、付けるたびに保存したマイクラIDで _op.txt を書き直すので、配らなくてよい
// （2026-10-29 ユーザーの決定：外す。OP の自動付与は外さない。ゲームのコマンドは3つのゲームの分だけ外す）。
// electron-builder（app-builder-lib）の、配る物に入れるかを決める部品そのものを使う（版は package.json で固定。中の作りなので、版を上げて変わったらここが落ちる）。
function shipsFrom(from, patterns) {
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js');
  const filter = new FileMatcher(from, 'out', text => text, patterns).createFilter();
  // フォルダーが外れると、その中は見に行かない（builder-util の fs.js）。上のフォルダーから順に確かめる。
  return rel => {
    const parts = rel.split('/');
    for (let i = 1; i <= parts.length; i++) if (!filter(path.join(from, ...parts.slice(0, i)), { isDirectory: () => i < parts.length })) return false;
    return true;
  };
}

test('配布: 開発機に残った _op.txt・ゲームのコマンドの写し・.omc・.claude は配布物に入れず、_gamerules.txt と共通のコマンドは入れる', () => {
  const { PACK_GAME_IDS, gameOfCommand } = require('../../bridge/game_commands.cjs');
  const root = path.resolve(__dirname, '../..');
  const build = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build;
  const filter = build.extraResources.find(entry => entry.from === 'bridge').filter;
  const ships = shipsFrom(path.join(root, 'bridge'), filter);
  // 外すゲームは、ゲームの一覧（bridge/game_commands.cjs）と同じ。ゲームを足したのに外す決まりを直し忘れると、ここで止まる。
  const games = filter.map(pattern => /^!commands\/minecraft\/game_\{(.+)\}_\*\.txt$/.exec(pattern)).find(Boolean);
  assert.ok(games, 'ゲームのコマンドを外す決まりがある');
  assert.deepEqual(games[1].split(',').sort(), [...PACK_GAME_IDS].sort());
  for (const file of ['commands/minecraft/_op.txt', ...PACK_GAME_IDS.map(id => `commands/minecraft/game_${id}_flood.txt`),
    'commands/minecraft/.omc/state/sessions/x/pre-tool-advisory-throttle.json', '.omc/state/a.json',
    '.claude/settings.local.json', 'commands/minecraft/.claude/settings.local.json']) {
    assert.equal(ships(file), false, `${file} は配布物に入れない`);
  }
  // game_ で始まっても、ゲームの一覧に無い名前は共通のコマンド（gameOfCommand が null）。配る。
  for (const name of ['game_mode_on.txt', 'game_unknown_x.txt']) {
    assert.equal(gameOfCommand(name), null);
    assert.equal(ships('commands/minecraft/' + name), true, `${name} は配布物に入れる`);
  }
  // 手元の bridge/commands/minecraft の txt（開発機には _op.txt やゲームのコマンドの写しも残っている。CI では git から取り出したものだけ）。
  const commands = fs.readdirSync(path.join(root, 'bridge/commands/minecraft')).filter(name => name.endsWith('.txt') && name !== '_op.txt' && !gameOfCommand(name));
  assert.ok(commands.includes('_gamerules.txt') && commands.length > 10, 'bridge/commands/minecraft のコマンドを見ている');
  for (const name of commands) assert.equal(ships('commands/minecraft/' + name), true, `${name} は配布物に入れる`);
  assert.equal(ships('games.json'), true);
  // アプリ本体（files）の側にも、開発の道具の記録は入れない。
  const appFiles = shipsFrom(root, build.files);
  for (const file of ['electron/.omc/state/a.json', 'electron/.claude/settings.local.json']) assert.equal(appFiles(file), false, `${file} は配布物に入れない`);
  assert.equal(appFiles('electron/main.cjs'), true);
});
