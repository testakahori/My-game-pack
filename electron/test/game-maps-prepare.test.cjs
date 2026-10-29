// ゲームの初期マップを配る物に入れる（埋め立て PR3。2026-10-29）。元は map/<マップ名>（git の外）。
// 作った人のプレイヤーの記録（一番上の playerdata・stats・advancements）は配らない。研究室の見分け（umetate_lab_map.json）は配る。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const games = () => JSON.parse(fs.readFileSync(path.join(root, 'bridge/games.json'), 'utf8'));

test('初期マップ: games.json でマップを持つのは埋め立てだけ。切り替えたときに初期に戻すのも埋め立てだけ。サバイバルには無い', () => {
  const list = games();
  assert.deepEqual(list.filter(g => g.maps).map(g => [g.id, g.maps]), [['umetate', ['umetate_lab_map']]]);
  assert.deepEqual(list.filter(g => g.resetMapOnSwitch !== undefined).map(g => [g.id, g.resetMapOnSwitch]), [['umetate', true]]);
  assert.equal(list.find(g => g.id === 'common').maps, undefined, 'サバイバルには「マップを初期化」を出さない（2026-10-29 ユーザーの決定）');
  for (const g of list) for (const name of g.maps || []) assert.match(name, /^[a-z0-9_]+$/, `${g.id} のマップ名`);
});

// 偽のリポジトリ：map/umetate_lab_map に小さな見本のワールドを置く。
function fakeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'game-maps-prepare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (name, text = name) => { const file = path.join(dir, 'map/umetate_lab_map', name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  for (const name of ['level.dat', 'umetate_lab_map.json', 'region/r.0.0.mca', 'playerdata/x.dat', 'stats/x.json', 'advancements/x.json', 'session.lock', 'data/playerdata/keep.dat']) put(name);
  return { dir, put, source: path.join(dir, 'map/umetate_lab_map') };
}
const files = folder => fs.readdirSync(folder, { recursive: true }).map(n => String(n).split(path.sep).join('/')).filter(n => fs.statSync(path.join(folder, n)).isFile()).sort();

test('初期マップ: 配る物の置き場（ゲームパックの maps/<マップ名>）に、プレイヤーの記録を外して写す', t => {
  const { prepareGameMaps, MAP_EXCLUDES } = require('../../scripts/prepare-game-maps.cjs');
  assert.deepEqual(MAP_EXCLUDES, ['playerdata', 'stats', 'advancements']);
  const { dir } = fakeRepo(t);
  const made = prepareGameMaps(dir);
  const dest = path.join(dir, 'build/game-packs/umetate/maps/umetate_lab_map');
  assert.deepEqual(made, [dest]);
  assert.deepEqual(files(dest), ['data/playerdata/keep.dat', 'level.dat', 'region/r.0.0.mca', 'umetate_lab_map.json'], '外すのは一番上の playerdata・stats・advancements と session.lock だけ');
  assert.equal(fs.readFileSync(path.join(dest, 'umetate_lab_map.json'), 'utf8'), 'umetate_lab_map.json');
});

test('初期マップ: 毎回作り直す（元から消したファイルは、配る物からも消える）', t => {
  const { prepareGameMaps } = require('../../scripts/prepare-game-maps.cjs');
  const { dir, source } = fakeRepo(t);
  prepareGameMaps(dir);
  fs.rmSync(path.join(source, 'region/r.0.0.mca'));
  prepareGameMaps(dir);
  assert.equal(fs.existsSync(path.join(dir, 'build/game-packs/umetate/maps/umetate_lab_map/region/r.0.0.mca')), false);
});

test('初期マップ: 元のマップが無い・level.dat が無いときは、はっきり止まる', t => {
  const { prepareGameMaps } = require('../../scripts/prepare-game-maps.cjs');
  const { dir, source } = fakeRepo(t);
  fs.rmSync(path.join(source, 'level.dat'));
  assert.throws(() => prepareGameMaps(dir), /map\/umetate_lab_map/);
  fs.rmSync(source, { recursive: true, force: true });
  assert.throws(() => prepareGameMaps(dir), /map\/umetate_lab_map/);
});
