// 採掘へ移したコマンドの一覧が、アプリ（引き継ぎ）・SaikutuMOD・採掘パックでそろっていること。
// 2026-10-12：採掘速度上昇・低下（give_haste・give_fatigue）も採掘パックへ移した（ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const saikutu = require('../saikutu_commands.cjs');
const repo = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

test('採掘速度上昇・低下は採掘のコマンドになり、標準コマンドからは消える', () => {
  for (const key of ['give_haste', 'give_fatigue']) {
    assert.ok(saikutu.KEYS.includes(key), key + '：引き継ぎの対象');
    assert.equal(fs.existsSync(path.join(repo, 'bridge/commands/minecraft', key + '.txt')), false, key + '：標準コマンドに残さない');
    assert.ok(fs.existsSync(path.join(repo, 'SaikutuMod/src/main/resources/commands', key + '.txt')), key + '：SaikutuMOD の内蔵 txt');
  }
});

test('引き継ぎの一覧・SaikutuMOD の一覧・採掘パックのコマンドは同じ', () => {
  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java').match(/private static final List<String> KEYS = List\.of\(([^)]*)\);/)[1]
    .split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  const pack = JSON.parse(read('game-packs/saikutu/game.json')).commands.map(c => c.key);
  assert.deepEqual([...mod].sort(), [...saikutu.KEYS].sort());
  assert.deepEqual([...pack].sort(), [...saikutu.KEYS].sort());
  for (const key of saikutu.KEYS) assert.ok(fs.existsSync(path.join(repo, 'SaikutuMod/src/main/resources/commands', key + '.txt')), key);
});

test('サバイバルの割り当ては採掘へ引き継ぎ、古い txt は退避する（14件のときと同じ仕組み）', t => {
  const profile = { mappings: [{ giftId: '1', commandFile: 'give_haste.txt' }, { giftId: '2', commandFile: 'cod.txt' }], roulette: { items: [{ commandFile: 'give_fatigue.txt' }] } };
  assert.equal(saikutu.hasLegacy(profile), true);
  const mining = saikutu.mapLegacy(profile);
  assert.equal(mining.mappings[0].commandFile, 'game_saikutu_give_haste.txt');
  assert.equal(mining.roulette.items[0].commandFile, 'game_saikutu_give_fatigue.txt');
  const survival = saikutu.withoutLegacy(profile);
  assert.deepEqual(survival.mappings.map(m => m.commandFile), ['cod.txt']);
  assert.deepEqual(survival.roulette.items, []);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'commands', 'minecraft'); fs.mkdirSync(dir, { recursive: true });
  for (const name of ['give_haste.txt', 'give_fatigue.txt', 'cod.txt']) fs.writeFileSync(path.join(dir, name), 'say x\n');
  saikutu.retireCommands(root);
  assert.deepEqual(fs.readdirSync(dir), ['cod.txt']);
  const backups = fs.readdirSync(path.join(root, '.retired-saikutu-commands'));
  assert.deepEqual(fs.readdirSync(path.join(root, '.retired-saikutu-commands', backups[0])).sort(), ['give_fatigue.txt', 'give_haste.txt']);
});

test('ゲーム選択の案内は件数を書かず、「保存」で整理されることと、採掘の設定があるときは退避に残ることを書く（PR #84 レビュー）', () => {
  const line = read('src/components/GameSelector.tsx').split(/\r?\n/).find(l => l.includes('saikutuMigrationNeeded &&'));
  assert.doesNotMatch(line, /14種類/, 'あとから2件足したので件数は書かない');
  assert.match(line, /「保存」/);
  assert.match(line, /退避/);
});

test('SaikutuMOD 1.1.2 以上とゲームパックの jar 名', () => {
  const version = read('SaikutuMod/gradle.properties').match(/^mod_version=(1\.1\.(\d+))\r?$/m);
  assert.ok(version && Number(version[2]) >= 2, 'mod_version ' + (version && version[1]) + ' must be >= 1.1.2');
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, `saikutumod-${version[1]}.jar`);
  assert.equal(pack.clientJar, `saikutumod-${version[1]}.jar`);
});
