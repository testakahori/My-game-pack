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
  // 空きがなければ足元へ。クリエイティブでは空きがないと add が黙って消すので、先に空きを確かめる（PR #83 レビュー）。
  const keep = equip.indexOf('if (!old.isEmpty() && (p.getInventory().getFreeSlot() < 0 || !p.getInventory().add(old))) dropAtFeet(p, old);');
  assert.ok(take > 0 && wear > take && keep > wear, '外す → 着せる → 持ち物へ（入らなければ足元へ）の順');
  // p.drop は Q キーと同じで、向いている方へ数ブロック投げる（溶岩や穴に落ちて失う）。足元に勢いなしで置く。
  assert.doesNotMatch(equip, /p\.drop\(/);
  assert.match(source, /private void dropAtFeet\(ServerPlayer p, ItemStack stack\) \{\s*ItemEntity item = new ItemEntity\(p\.level\(\), p\.getX\(\), p\.getY\(\), p\.getZ\(\), stack, 0, 0, 0\);/);
  assert.match(equip, /for \(int n = 0; n < Math\.max\(1, count\); n\+\+\)/, 'N 個なら N 回着せる（前のセットは持ち物へ）');
  const [major, minor, patch] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)\r?$/m).slice(1).map(Number);
  assert.ok(major > 1 || (major === 1 && (minor > 7 || (minor === 7 && patch >= 3))), `mod_version ${major}.${minor}.${patch} must be >= 1.7.3`);
});
