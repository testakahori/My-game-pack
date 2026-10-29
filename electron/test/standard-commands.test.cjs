// BridgeMOD の標準コマンドの見直し（2026-10-12 ユーザーの決定）を、txt の中身で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.resolve(__dirname, '../../bridge/commands/minecraft');
const read = name => fs.readFileSync(path.join(dir, name + '.txt'), 'utf8');
// 見出し・説明文の読み方は BRIDGE・アプリと同じ bridge/command_text.cjs（2026-10-18）。
const { parseCommandText } = require('../../bridge/command_text.cjs');
const meta = (text, key) => parseCommandText(text).meta[key];
const description = text => parseCommandText(text).description || undefined;

test('地形を壊す標準コマンドは全部「地形破壊系」の印を付ける', () => {
  // creeper・taiden・ghast・wither は mobGriefing で地形を壊し、husk_watertower は水源を置くのに、印もキー名の判定も素通りしていた。
  // エリア保護は今は無効（Bridge は protectionEnabled: false で送る。docs/MAP保存と配信統計.md）。
  // 印はエリア保護を戻したときに効き、コマンドの説明（地形破壊系）としても使う。
  for (const name of ['lavafloor', 'husk_watertower', 'fall_sand', 'anvildrop', 'meteor', 'meteorshower', 'volcano',
    'tnt', 'tnt-kuusyuu', 'creeper', 'taiden', 'ghast', 'wither', 'bossrush']) {
    assert.equal(meta(read(name), 'DESTRUCTIVE'), 'true', name);
  }
});

test('ウォーデンは召喚した1体だけに視聴者名を付け、自然に湧いたウォーデンには触らない', () => {
  const text = read('warden');
  assert.equal(meta(text, 'CATEGORY'), '敵対MOB', 'CATEGORY は1つ');
  assert.doesNotMatch(text, /@e\[type=(minecraft:)?warden/, 'ワールドのウォーデン全部を選ばない');
  const summons = text.split(/\r?\n/).filter(line => /summon minecraft:warden/.test(line));
  assert.equal(summons.length, 2);
  for (const line of summons) assert.match(line, /CustomName:"\\"\{ListenerName\}\\""/);
});

test('おじさんパーティと魔女パニックの説明は、それぞれの中身に合わせる', () => {
  const ozisan = description(read('ozisan_party')), witch = description(read('witch_sabbat'));
  assert.notEqual(ozisan, witch);
  for (const mob of ['ヴィンディケーター', 'ピリジャー', 'イリュージョナー', 'エヴォーカー']) assert.ok(ozisan.includes(mob), mob);
});

// /bridge magma_cube 1（マグマスライム！）を足す（2026-10-29 ユーザーの決定）。スライム！と同じ作り：頭上が空いていれば頭上から落とし、
// 塞がっていれば足元に出す。視聴者の名前を付け、ゆっくり落とす。一時タグは外す。どのゲームでも使える共通のコマンド。
// 大きさは小（Size を書かない。スライム！と同じ。2026-10-29 ユーザーの決定）。マグマキューブは小さくても当たるとダメージがあるので、
// 頭上が塞がっているときは、横が空いていれば1ブロック横に出す（足元に出すと出たとたんに当たる。最後のレビューの軽い5。ユーザーの決定「全部直す」）。
test('マグマスライム！は、頭上が空いていれば頭上から、塞がっていれば1ブロック横（それも塞がっていれば足元）にマグマキューブを1体出す', () => {
  const text = read('magma_cube');
  assert.equal(meta(text, 'TITLE'), 'マグマスライム！');
  assert.equal(meta(text, 'CATEGORY'), '敵対MOB');
  assert.equal(meta(text, 'DESTRUCTIVE'), undefined, '地形は壊さない');
  const nbt = '{Tags:["gift_spawn_new"],NoAI:0b,NoGravity:0b,CustomNameVisible:1b,CustomName:"\\"{ListenerName}\\""}';
  assert.deepEqual(parseCommandText(text).commands, [
    `execute at @p if block ~ ~3 ~ air run summon minecraft:magma_cube ~ ~3 ~ ${nbt}`,
    `execute at @p unless block ~ ~3 ~ air if block ~1 ~ ~ air run summon minecraft:magma_cube ~1 ~ ~ ${nbt}`,
    `execute at @p unless block ~ ~3 ~ air unless block ~1 ~ ~ air run summon minecraft:magma_cube ~ ~ ~ ${nbt}`,
    'effect give @e[tag=gift_spawn_new,limit=1] minecraft:slow_falling 3 1 true',
    'tag @e[tag=gift_spawn_new] remove gift_spawn_new',
  ]);
  // どのゲームでも使える共通のコマンド。ゲームパックに同じ名前があると、BridgeMOD はゲームのほうを先に動かす。
  assert.equal(require('../../bridge/game_commands.cjs').gameOfCommand('magma_cube.txt'), null);
  const packs = path.resolve(__dirname, '../../game-packs');
  for (const id of fs.readdirSync(packs)) {
    const keys = JSON.parse(fs.readFileSync(path.join(packs, id, 'game.json'), 'utf8')).commands.map(c => c.key);
    assert.ok(!keys.includes('magma_cube'), `${id} のゲームパックに magma_cube が無い`);
  }
});

// 敵の自然発生を止める仕組み（BridgeMOD の NaturalHostileSpawns）は MONSTER 全部に効く。実機の検証の一覧にもマグマキューブを入れる（最後のレビューの軽い6）。
test('BridgeMOD の検証の道具：敵の自然発生を止める確かめに、マグマキューブも入れる（11種類 × 出現の理由 8 = 88 通り）', () => {
  const root = path.resolve(__dirname, '../..');
  const probe = fs.readFileSync(path.join(root, 'BridgeMod/src/integrationProbe/java/example/environmentprobe/EnvironmentProbe.java'), 'utf8');
  assert.match(probe, /EntityType\.SLIME, EntityType\.MAGMA_CUBE, /);
  const check = fs.readFileSync(path.join(root, 'BridgeMod/test/fixed-environment.cjs'), 'utf8');
  assert.match(check, /new Set\(\['zombie', 'skeleton', 'creeper', 'slime', 'magma_cube', 'phantom', 'pillager', 'ghast'\]\)/);
  assert.match(check, /Object\.keys\(matrix\[dimension\]\)\.length, 88\)/);
});
