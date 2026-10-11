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
  assert.match(source, /j\.target = JumpPhysics\.stackTarget\(Math\.max\(j\.target, p\.getY\(\)\), count\);/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../BridgeMod/src/main/java/jp/douma/bridgemod/EffectLimits.java')), false);
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.7\.0\r?$/m);
});

test('頂点を過ぎて水・溶岩・はしご・乗り物・飛行に入ったジャンプは外し、次のジャンプを古い頂点に足さない（PR #74 レビュー）', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  const tick = source.slice(source.indexOf('private void tickJumps('));
  assert.match(tick, /if \(j\.coasting && \(p\.isInWater\(\) \|\| p\.isInLava\(\) \|\| p\.onClimbable\(\) \|\| p\.isPassenger\(\) \|\| p\.getAbilities\(\)\.flying \|\| p\.isFallFlying\(\)\)\) \{ it\.remove\(\); continue; \}/);
  // 今の位置が古い目標より上（浮遊など）なら、今の位置から数える。
  assert.match(source, /j\.target = JumpPhysics\.stackTarget\(Math\.max\(j\.target, p\.getY\(\)\), count\);/);
});

test('開発メモに、なくした上限が残っていない', () => {
  const doc = read('docs/BridgeMODとゲーム切替.md');
  assert.doesNotMatch(doc, /EffectLimits/);
  assert.doesNotMatch(doc, /320ブロック）まで/);
  assert.match(doc, /強さの上限はない（BridgeMOD 1\.7\.0/);
});
