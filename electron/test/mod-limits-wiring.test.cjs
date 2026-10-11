// 強さの上限をなくしたこと（2026-10-11）と、TNT大爆発の衝撃波が実際の処理につながっていることを、ソースで確かめる（Minecraft なしでは動かせない部分）。
// 衝撃波の形そのものは scripts/test-bridge-contracts.cjs の ShockwaveContractTest で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const effects = () => read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuEffects.java');

test('採掘MODは大技の倍率もくり返し回数も抑えない', () => {
  const mod = read('SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuMod.java');
  assert.doesNotMatch(mod, /SaikutuLimits/);
  assert.doesNotMatch(effects(), /SaikutuLimits/);
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../SaikutuMod/src/main/java/jp/douma/saikutumod/SaikutuLimits.java')), false);
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
  assert.doesNotMatch(doc, /採掘MOD 側の変更でなくす/, '採掘MOD も 1.1.0 でなくした');
  assert.match(read('docs/採掘MODと統一コマンド.md'), /TNT大爆発は、N 個で横 48×N・上下 11×N/);
});

test('TNT大爆発は大技で、頭上の TNT は N に関係なく1回、衝撃波は N 倍', () => {
  const source = effects();
  assert.match(source, /static final Set<String> KEYS = Set\.of\([^)]*"tntdaibakuhatu"/);
  assert.match(source, /case "tntdaibakuhatu" -> tntBlast\(source, o, count\);/);
  const blast = source.slice(source.indexOf('private void tntBlast('), source.indexOf('private void tickWaves('));
  assert.match(blast, /for \(String line : TNT_CANOPY\) o\.level\.getServer\(\)\.getCommands\(\)\.performPrefixedCommand\(source, line\);/);
  assert.match(blast, /new Shockwave\(count, limit\)/);
  assert.match(blast, /\(o\.level\.getServer\(\)\.getPlayerList\(\)\.getViewDistance\(\) \+ 2\) \* 16/);
  assert.match(blast, /ticks \+ WAVE_DELAY_TICKS/);
  const tick = source.slice(source.indexOf('void tick(MinecraftServer server'), source.indexOf('private void rain('));
  assert.match(tick, /tickWaves\(server\);/);
  // txt はメタ情報だけ（コマンドの行は Java の TNT_CANOPY に移した）。
  const txt = read('SaikutuMod/src/main/resources/commands/tntdaibakuhatu.txt');
  assert.deepEqual(txt.split(/\r?\n/).filter(line => line.trim() && !/^\s*(#|\/\/)/.test(line)), []);
  assert.match(txt, /^# TITLE: TNT大爆発\r?$/m);
});

test('衝撃波は set() と同じ判定でえぐり、チャンクを読み込ませない（Review Focus 1）', () => {
  const source = effects();
  const carve = source.slice(source.indexOf('private boolean carve('), source.indexOf('private void front('));
  const allowed = carve.indexOf('o.allowed(p)'), state = carve.indexOf('getBlockState(p)');
  assert.ok(allowed > 0 && allowed < state, '読み込み済みかを先に確かめる');
  assert.match(carve, /BlockPos at = p\.immutable\(\);\s*set\(o, at, Blocks\.AIR\.defaultBlockState\(\)\);/);
  const front = source.slice(source.indexOf('private void front('));
  assert.match(front, /!loaded\(w\.origin, x, z\)\) continue;/, '先端の爆発も読み込み済みの所だけ');
  assert.match(front, /Level\.ExplosionInteraction\.NONE/, '爆発で地形を壊さない（えぐるのは carve だけ）');
});

test('衝撃波の予算は全部の衝撃波で 1 tick に1回だけ戻り、止めたら捨てる（Review Focus 2・3）', () => {
  const source = effects();
  assert.match(source, /static final int WAVE_BLOCK_BUDGET = 50_000;/);
  assert.match(source, /private static long waveBudgetTick = -1;/);
  assert.match(source, /if \(waveBudgetTick != now\) \{ waveBudgetTick = now; waveBudgetLeft = WAVE_BLOCK_BUDGET; \}/);
  assert.match(source, /long now = server\.getTickCount\(\);/);
  const stop = source.slice(source.indexOf('void stop()'), source.indexOf('int start('));
  assert.match(stop, /waves\.clear\(\)/);
  assert.match(source, /int pendingJobs\(\) \{ return jobs\.size\(\) \+ waves\.size\(\); \}/);
});

test('SaikutuMOD 1.1.0 とゲームパックの jar 名', () => {
  assert.match(read('SaikutuMod/gradle.properties'), /^mod_version=1\.1\.0\r?$/m);
  const pack = JSON.parse(read('game-packs/saikutu/game.json'));
  assert.equal(pack.serverJar, 'saikutumod-1.1.0.jar');
  assert.equal(pack.clientJar, 'saikutumod-1.1.0.jar');
});
