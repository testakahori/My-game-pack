// ゲームの一覧と、ゲーム専用のコマンド・チャットの名前・ゲーム MOD の ID・パックの key の決まりは1か所
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 6。処理のコピー PR6）。
// 一覧は bridge/games.json（画面も読む）、決まりは bridge/game_commands.cjs。BridgeMOD とは同じ例の一覧を契約テストで比べる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GAMES, GAME_IDS, PACK_GAME_IDS, gameOfCommand, isGameCommandFile, publicCommandKey, isGameModId, isGamePackKey } = require('../../bridge/game_commands.cjs');

const fixture = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../bridge/test/fixtures', name), 'utf8'));

test('ゲームの一覧は games.json の1か所（common と、ゲームパックの3つ）', () => {
  assert.deepEqual(GAME_IDS, ['common', 'umetate', 'run', 'saikutu']);
  assert.deepEqual(PACK_GAME_IDS, ['umetate', 'run', 'saikutu']);
  assert.ok(Object.isFrozen(GAMES) && Object.isFrozen(GAMES[0]));
});

test('ゲーム専用の判定とチャットの名前: 例の一覧（Java の契約テストも同じものを読む）', () => {
  for (const c of fixture('game-commands.json')) {
    assert.equal(gameOfCommand(c.name), c.game, c.name);
    assert.equal(publicCommandKey(c.name), c.publicKey, c.name);
  }
  assert.deepEqual([isGameCommandFile('game_run_x.txt'), isGameCommandFile('game_run_x'), isGameCommandFile('../game_run_x.txt'), isGameCommandFile('game_mode_on.txt')], [true, false, false, false]);
  assert.equal(gameOfCommand(null), null);
});

// 設計書 13：1つにまとめた決まりは、今それを使っている所すべてが使う（自分の一覧や正規表現を持たない）。
test('ゲームの一覧と判定の写し: アプリ・BRIDGE・画面は自分の一覧や正規表現を持たない', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const files = [...fs.readdirSync(path.resolve(__dirname, '..')).filter(n => n.endsWith('.cjs')).map(n => 'electron/' + n),
    ...['bridge/index.js', 'bridge/mod_event_delivery.cjs', 'vite.config.ts'],
    ...fs.readdirSync(path.resolve(__dirname, '../../src/components')).filter(n => n.endsWith('.tsx')).map(n => 'src/components/' + n),
    ...fs.readdirSync(path.resolve(__dirname, '../../src/lib')).filter(n => n.endsWith('.ts')).map(n => 'src/lib/' + n)];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /(umetate|saikutu)\|(umetate|run|saikutu)|startsWith\(['"]game_['"]\)|\^game_\[a-z0-9\]/, file + ' にゲームの一覧・判定の写しがある');
    assert.doesNotMatch(source, /\{1,63\}|\{0,49\}|['"]doumacmd['"]/, file + ' に MOD の ID・パックの key の写しがある');
  }
});

// 画面は決まりを持たず、データは bridge/ の JSON か、アプリが付けて渡す値を使う（設計書 3。処理のコピー PR6）。
test('画面: コマンド一覧のチャットの名前はアプリが付ける chatKey を使い、開発用のモックの一覧は games.json から', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  assert.match(read('src/components/CommandsListPage.tsx'), /meta\.chatKey \?\? meta\.name/);
  assert.match(read('src/lib/devApiMock.ts'), /from "\.\.\/\.\.\/bridge\/games\.json"/);
  assert.match(read('vite.config.ts'), /publicCommandKey\(name\)/);
});

test('ゲーム MOD の ID とパックの key', () => {
  for (const c of fixture('game-mod-ids.json')) assert.equal(isGameModId(c.id), c.ok, c.id);
  assert.equal(isGameModId(undefined), false);
  assert.deepEqual(['dig', 'a', 'a'.repeat(50), 'Dig', '1x', 'a'.repeat(51), 'a-b'].map(isGamePackKey), [true, true, true, false, false, false, false]);
});
