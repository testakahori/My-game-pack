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
test('マグマスライム！は、スライム！と同じ作りでマグマキューブを1体ずつ出す', () => {
  const text = read('magma_cube');
  assert.equal(meta(text, 'TITLE'), 'マグマスライム！');
  assert.equal(meta(text, 'CATEGORY'), '敵対MOB');
  assert.equal(meta(text, 'DESTRUCTIVE'), undefined, '地形は壊さない');
  const commands = parseCommandText(text).commands;
  assert.deepEqual(commands, parseCommandText(read('slime')).commands.map(line => line.replaceAll('minecraft:slime', 'minecraft:magma_cube')));
  assert.equal(commands.filter(line => /summon minecraft:magma_cube .*CustomName:"\\"\{ListenerName\}\\""/.test(line)).length, 2);
  assert.equal(require('../../bridge/game_commands.cjs').gameOfCommand('magma_cube.txt'), null, 'どのゲームでも使える');
});
