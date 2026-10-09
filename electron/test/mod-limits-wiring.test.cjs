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

test('スーパージャンプは連続ジャンプの記録（JumpChain）で高さを重ねる', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/GiftEffects.java');
  assert.match(source, /new EffectLimits\.JumpChain\(p\.getY\(\)\)/);
  assert.match(source, /j\.chain\.stack\(count\)/);
  assert.match(source, /j\.chain\.slowFallingTicks\(p\.getY\(\)\)/);
  assert.doesNotMatch(source, /jumpTarget\(/, '基準の高さを呼び出し側で渡さない');
});
