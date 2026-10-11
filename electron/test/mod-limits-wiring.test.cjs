// MOD の上限が実際の処理につながっていることを、ソースで確かめる（Minecraft なしでは動かせない部分）。
// 上限そのものの値は scripts/ の契約テストで確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('採掘MODのくり返しの上限は、待ち列が満杯でないと決まってから掛ける', () => {
  const source = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  const offer = source.slice(source.indexOf('private int offer('), source.indexOf('public void register('));
  const full = offer.indexOf('if (queue.size() >= limit) return GameEvents.WAIT;');
  const cap = offer.indexOf('SaikutuLimits.scriptRepeat(');
  const add = offer.indexOf('queue.addLast(request)');
  assert.ok(full > 0 && cap > full && add > cap, '満杯の判定 → 上限 → 積む の順にする');
  assert.match(offer, /request\.remaining = limited;/);
});

test('BridgeMOD は大技の count を抑えず、スーパージャンプに上限も低速落下もない', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  assert.doesNotMatch(source, /EffectLimits/, '上限のクラスを使わない');
  assert.doesNotMatch(source, /SLOW_FALLING/, '低速落下を付けない（落下死してよい）');
  assert.match(source, /j\.target = JumpPhysics\.stackTarget\(j\.target, count\);/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java')), false);
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.7\.0\r?$/m);
});
