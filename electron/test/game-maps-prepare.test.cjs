// ゲームの初期マップを配る物に入れる（埋め立て PR3。2026-10-29）。元は map/<マップ名>（git の外）。
// 作った人のプレイヤーの記録（一番上の playerdata・stats・advancements）は配らない。研究室の見分け（umetate_lab_map.json）は配る。
// level.dat の Data.Player（作った人の UUID・持ち物）と level.dat_old も配らない（2026-11-06 品質レビュー）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { levelDat, levelNbt } = require('./fake-level-dat.cjs');

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
  for (const name of ['umetate_lab_map.json', 'region/r.0.0.mca', 'playerdata/x.dat', 'stats/x.json', 'advancements/x.json', 'session.lock', 'data/playerdata/keep.dat']) put(name);
  // 1人用で遊んだワールドの level.dat には、遊んだ人の記録（Data.Player）が入る。level.dat_old はその1つ前の写し。
  put('level.dat', levelDat());
  put('level.dat_old', levelDat());
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
  assert.deepEqual(files(dest), ['data/playerdata/keep.dat', 'level.dat', 'region/r.0.0.mca', 'umetate_lab_map.json'], '外すのは一番上の playerdata・stats・advancements と session.lock・level.dat_old だけ');
  assert.equal(fs.readFileSync(path.join(dest, 'umetate_lab_map.json'), 'utf8'), 'umetate_lab_map.json');
});

test('初期マップ: level.dat から作った人のプレイヤーの記録（Data.Player）だけを外す。ほかの中身は1バイトも変えず、元の map/ も変えない', t => {
  const { prepareGameMaps, MAP_SKIP_FILES } = require('../../scripts/prepare-game-maps.cjs');
  const { hasPlayer, stripPlayer } = require('../../scripts/level_dat.cjs');
  assert.deepEqual(MAP_SKIP_FILES, ['level.dat_old', 'session.lock']);
  const { dir, source } = fakeRepo(t);
  const before = fs.readFileSync(path.join(source, 'level.dat'));
  assert.equal(hasPlayer(before), true);
  prepareGameMaps(dir);
  const shipped = fs.readFileSync(path.join(dir, 'build/game-packs/umetate/maps/umetate_lab_map/level.dat'));
  assert.equal(hasPlayer(shipped), false);
  assert.deepEqual(zlib.gunzipSync(shipped), levelNbt({ player: false }), 'Player の項目のほかは、並びも中身も同じ');
  assert.deepEqual(fs.readFileSync(path.join(source, 'level.dat')), before, '元の level.dat は変えない');
  assert.equal(fs.existsSync(path.join(source, 'level.dat_old')), true, '元の level.dat_old も消さない');
  // もともと Player の無い level.dat は、そのまま写す。
  const clean = levelDat({ player: false });
  assert.deepEqual(stripPlayer(clean), { changed: false, bytes: clean });
});

test('初期マップ: level.dat が読めない・途中で切れているときは、はっきり止まる', t => {
  const { prepareGameMaps } = require('../../scripts/prepare-game-maps.cjs');
  const { hasPlayer } = require('../../scripts/level_dat.cjs');
  const { dir, put } = fakeRepo(t);
  put('level.dat', 'not gzip');
  assert.throws(() => prepareGameMaps(dir), /level\.dat を読めません/);
  assert.throws(() => hasPlayer(zlib.gzipSync(levelNbt().subarray(0, 60))), /level\.dat の中身が途中で切れています/);
  assert.throws(() => hasPlayer(zlib.gzipSync(Buffer.concat([levelNbt(), Buffer.from([0])]))), /level\.dat の形が違います/);
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
