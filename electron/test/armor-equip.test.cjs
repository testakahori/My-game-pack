// ダイヤ装備・ネザライト装備は、今着ている防具を消さずに持ち物へ移す（2026-10-12 ユーザーの決定）。
// 以前は item replace で上書きしていたので、ネザライトを着ていてもダイヤに置き換わって消えた。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('ダイヤ装備・ネザライト装備の txt は、BridgeMOD の大技で着せ、送られた数をまとめて渡す', () => {
  for (const [name, key] of [['daiyasoubi', 'diamondarmor'], ['nezaraitosoubi', 'netheritearmor']]) {
    const text = read(`bridge/commands/minecraft/${name}.txt`);
    assert.doesNotMatch(text, /item replace/, name + '：上書きしない');
    assert.match(text, /^# COUNT_MODE: aggregate\r?$/m, name);
    assert.match(text, new RegExp(`^execute as @p at @s run bridgeeffect ${key} \\{Count\\}\\r?$`, 'm'), name);
  }
});

test('BridgeMOD は今の防具を持ち物へ移してから着せ、持ち物がいっぱいなら足元に落とす', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  assert.match(source, /static final Set<String> KEYS = Set\.of\([^)]*"diamondarmor"[^)]*"netheritearmor"/);
  assert.match(source, /case "diamondarmor" -> equip\(source\.getPlayerOrException\(\), DIAMOND_ARMOR, count\);/);
  assert.match(source, /case "netheritearmor" -> equip\(source\.getPlayerOrException\(\), NETHERITE_ARMOR, count\);/);
  const equip = source.slice(source.indexOf('private void equip('));
  const take = equip.indexOf('ItemStack old = p.getItemBySlot(slot);'), wear = equip.indexOf('p.setItemSlot(slot, new ItemStack(armor[i]));');
  const keep = equip.indexOf('if (!old.isEmpty() && !p.getInventory().add(old)) p.drop(old, false);');
  assert.ok(take > 0 && wear > take && keep > wear, '外す → 着せる → 持ち物へ（入らなければ落とす）の順');
  assert.match(equip, /for \(int n = 0; n < Math\.max\(1, count\); n\+\+\)/, 'N 個なら N 回着せる（前のセットは持ち物へ）');
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.7\.3\r?$/m);
});
