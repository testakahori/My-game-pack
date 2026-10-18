// 配信中に保存した設定を BRIDGE の再起動なしで効かせる（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 8）。
// 前は options（ミュート・ゲームの設定など）を起動のときに1回だけ読み、配信中に保存しても BRIDGE を再起動するまで効かなかった。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');

// 設定を書き換えて保存し（アプリと同じく一時ファイルから置き換える）、BRIDGE の再読込（成功か取りやめ）を待つ。
async function save(bridge, change) {
  const file = path.join(bridge.dir, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  change(config);
  const count = () => bridge.logs.filter(line => line.includes('Config reloaded') || line.includes('Config reload skipped')).length;
  const before = count();
  fs.writeFileSync(file + '.tmp', JSON.stringify(config));
  fs.renameSync(file + '.tmp', file);
  await bridge.until(() => count() > before, 'config reload');
}
const runtime = bridge => JSON.parse(fs.readFileSync(path.join(bridge.dir, 'runtime-status.json'), 'utf8'));

test('配信中の保存: ミュートは再起動なしで効き、エラーのある設定を書いても前のまま止め続ける', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 1 }], options: { mutedUsers: [] } },
  });
  let n = 0;
  const gift = nickname => bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount: 1, repeatEnd: 1, user: { id: String(300 + ++n), displayId: 'u' + n, nickname } });
  await gift('troll');
  await bridge.until(() => bridge.requests.length === 1, 'before mute');
  await save(bridge, config => { config.options.mutedUsers = ['troll']; });
  await gift('troll');
  await gift('friend');
  await bridge.until(() => bridge.requests.some(x => x.listenerName === 'friend'), 'friend after mute');
  await bridge.wait(200);
  assert.deepEqual(bridge.requests.map(x => x.listenerName), ['troll', 'friend']);
  // ギフトの割り当てが壊れた設定（mappings がオブジェクト）は取りやめる。ミュートを外した値も効かせない。
  await save(bridge, config => { config.mappings = {}; config.options.mutedUsers = []; });
  assert.ok(bridge.logs.some(line => line.includes('Config reload skipped')));
  await gift('troll');
  await bridge.wait(300);
  assert.equal(bridge.requests.length, 2, 'エラーのある設定では、前のミュートのまま');
});

test('配信中の保存: ゲームの設定（時限倍率）は再起動なしで効く', async t => {
  const timed = multiplier => ({ timedMode: { enabled: true, start: '00:00', end: '24:00', multiplier } });
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: '# TITLE: zombie\nsay test\n' },
    config: { mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 3 }], options: { gameplay: timed(1.5) } },
  });
  let n = 0;
  const gift = () => bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g1' }, repeatCount: 1, repeatEnd: 1, user: { id: String(400 + ++n), displayId: 'v' + n, nickname: 'v' + n } });
  await gift();
  await bridge.until(() => bridge.requests.length === 1, 'x1.5');
  await save(bridge, config => { config.options.gameplay = timed(2); });
  await gift();
  await bridge.until(() => bridge.requests.length === 2, 'x2');
  assert.deepEqual(bridge.requests.map(x => x.count), [5, 6], '3回×1.5倍＝5回、保存のあとは 3回×2倍＝6回');
});

// 設計書 13：クールダウンがすぐ効き、つなぎ方の変更は効かないことも確かめる（PR2 の最終レビュー）。
test('配信中の保存: ギフトのクールダウンは再起動なしで効く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say z\n' },
    config: { mappings: [{ giftId: '1', name: 'g', commandFile: 'zombie.txt', repeat: 1 }], options: { giftCooldownMs: 60000 } },
  });
  const gift = () => bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g' }, repeatCount: 0, repeatEnd: 0, user: { id: '9', displayId: 'same', nickname: 'same' } });
  await gift();
  await bridge.until(() => bridge.requests.length === 1, 'first gift');
  await gift();
  await bridge.wait(300);
  assert.equal(bridge.requests.length, 1, '60秒のクールダウン中は送らない');
  await save(bridge, config => { config.options.giftCooldownMs = 0; });
  await gift();
  await bridge.until(() => bridge.requests.length === 2, 'cooldown 0 after save');
});

test('配信中の保存: つなぎ方（BridgeMOD のポート）を変えても起動したときの宛先に送り続け、再起動で反映と出す', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say z\n' },
    config: { mappings: [{ giftId: '1', name: 'g', commandFile: 'zombie.txt', repeat: 1 }] },
  });
  await save(bridge, config => { config.options.bridgeModPort = 1; });
  assert.deepEqual(runtime(bridge).pendingRestart, ['BridgeMOD のポート']);
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'g' }, repeatCount: 1, repeatEnd: 1, user: { id: '10', displayId: 'a', nickname: 'a' } });
  await bridge.until(() => bridge.requests.length === 1, 'still sent to the port the BRIDGE started with');
});

test('配信中の保存: いいねをまとめる時間と連打の区切りの時間は、使うたびに今の値を読む（本番とテスト発火）', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  assert.equal((source.match(/windowMs: \(\) => likeBatchWindowMs/g) || []).length, 2, '本番とテスト発火のいいねのまとめ');
  assert.equal((source.match(/, streakTtlMs\)/g) || []).length, 2, '割り当てのあるギフトと未設定ギフトの連打（computeStreakDelta の最後の引数）');
  assert.doesNotMatch(source, /STREAK_TTL_MS|LIKE_BATCH_MS|options\.(giftCooldownMs|likeBatchWindowMs|streakTtlMs|mutedUsers|gameplay)/, '起動のときの値の読み方が残っていない');
});

test('配信中の保存: つなぎ方を変えたらログと runtime-status.json に再起動で反映と出し、元に戻したら消す。起動のときは空', async t => {
  const bridge = await startBridgeFixture(t, { commands: { zombie: '# TITLE: zombie\nsay test\n' } });
  assert.deepEqual(runtime(bridge).pendingRestart, []);
  await save(bridge, config => { config.tiktokUsername = 'other'; });
  assert.ok(bridge.logs.some(line => line.includes('[Config] BRIDGE を再起動すると反映されます: TikTok ID')));
  assert.deepEqual(runtime(bridge).pendingRestart, ['TikTok ID']);
  await save(bridge, config => { config.tiktokUsername = 'fixture'; config.options.mutedUsers = ['x']; });
  assert.deepEqual(runtime(bridge).pendingRestart, [], '元に戻したら消える（つなぎ方以外の変更では出さない）');
});

test('配信中の保存: 再読込は FeatureEngine を作り直さず config を入れ替える（いいねの累計・連打・上位者を保つ）', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  const start = source.indexOf('function reloadDynamicConfig(');
  const end = source.indexOf('let _reloadTimer', start);
  assert.ok(start > 0 && end > start);
  const reload = source.slice(start, end);
  assert.doesNotMatch(reload, /new FeatureEngine/);
  assert.match(source, /liveFeatureEngine\.config = gameplayConfig/);
  assert.match(reload, /applyLiveOptions\(liveOptions\(newCfg\.options\)\)/);
});
