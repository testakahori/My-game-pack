const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMediaEffects, defaults, validateSettings } = require('../media_effects.cjs');
const { createGiftNormalizer, createMediaReporter } = require('../../bridge/media_events.cjs');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygamepack-media-'));
  let time = 1000000;
  const effects = createMediaEffects({ directory: path.join(root, 'store'), port: 0, now: () => time });
  t.after(() => { effects.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const png = path.join(root, 'ありがとう.png'); fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  await effects.importFiles([png]);
  const asset = effects.state().settings.assets[0];
  const rule = { id: 'likes', name: 'ありがとう', enabled: true, trigger: 'likes', threshold: 100, giftId: '5655', coinMode: 'unit', visualId: asset.id, audioId: '', x: 50, y: 50, width: 30, volume: 80, duration: 5, cooldown: 0 };
  const saveRules = rules => { const s = effects.state(); s.settings.profiles[0].rules = rules; effects.save(s.settings, s.revision); };
  saveRules([rule]);
  let sequence = 0;
  const event = (data, id) => effects.receive({ ...data, id: id || String(++sequence) });
  return { root, effects, png, asset, rule, saveRules, event, advance: ms => { time += ms; effects.tick(); } };
}

test('素材をコピーして保存・再起動。原本と他のプロフィールは保持する', async t => {
  const f = await fixture(t);
  assert.ok(fs.existsSync(f.png));
  f.effects.close();
  const reopened = createMediaEffects({ directory: path.join(f.root, 'store'), port: 0 }); t.after(() => reopened.close());
  assert.equal(reopened.state().settings.assets[0].name, 'ありがとう.png');
  assert.equal(reopened.state().settings.profiles[0].rules.length, 1);
  assert.equal(reopened.state().settings.profiles[1].rules.length, 0);
  assert.equal(reopened.state().canUndo, false);
});
test('いいね: 接続初回・重複・巻き戻りは発火せず、到達時に1回だけ再生', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.event({ type: 'like', total: 10900 }).matched, []);
  assert.equal(f.event({ type: 'like', total: 11000 }, 'same').matched.length, 1);
  assert.equal(f.event({ type: 'like', total: 11000 }, 'same').duplicate, true);
  assert.equal(f.event({ type: 'like', total: 20000 }).matched.length, 1); // 急増分を大量再生しない
  assert.equal(f.effects.state().queued, 1);
  assert.equal(f.event({ type: 'like', total: 1 }).matched.length, 0);
  f.event({ type: 'reset' });
  assert.equal(f.event({ type: 'like', total: 30000 }).matched.length, 0);
});
test('指定ギフト・1個のコイン数・連続合計の到達を独立判定', async t => {
  const f = await fixture(t);
  f.saveRules([{ ...f.rule, id: 'gift', trigger: 'gift' }, { ...f.rule, id: 'coins', trigger: 'coins', threshold: 1000 }, { ...f.rule, id: 'streak', trigger: 'coins', coinMode: 'streak', threshold: 1000 }]);
  assert.equal(f.event({ type: 'gift', giftId: '5655', delta: 1, unitCoins: 500, previousCoins: 0, totalCoins: 500 }).matched.length, 1);
  assert.equal(f.event({ type: 'gift', giftId: '5655', delta: 1, unitCoins: 500, previousCoins: 500, totalCoins: 1000 }).matched.length, 2);
  assert.equal(f.event({ type: 'gift', giftId: '5655', delta: 1, unitCoins: 500, previousCoins: 1000, totalCoins: 1500 }).matched.length, 1);
  assert.equal(f.event({ type: 'gift', giftId: '999', delta: 1, unitCoins: 1000, previousCoins: 0, totalCoins: 1000 }).matched.length, 2);
});
test('連続ギフト: 終了通知・同じ累積数の重複を除去し、次の連打と別視聴者を認識', () => {
  const n = createGiftNormalizer(), gift = { giftId: 5655, giftType: 1, diamondCount: 500, repeatCount: 1, repeatEnd: false };
  assert.equal(n.gift(gift, 'a').delta, 1);
  assert.equal(n.gift(gift, 'a'), null);
  assert.equal(n.gift({ ...gift, repeatCount: 2 }, 'a').totalCoins, 1000);
  assert.equal(n.gift({ ...gift, repeatCount: 2, repeatEnd: true }, 'a'), null);
  assert.equal(n.gift(gift, 'a').previousCoins, 0);
  assert.equal(n.gift(gift, 'b').delta, 1);
  n.reset(); assert.equal(n.gift({ ...gift, repeatCount: 2 }, 'a').delta, 2);
  const single = { ...gift, giftType: 0, repeatEnd: true };
  assert.equal(n.gift(single, 'a').delta, 1); assert.equal(n.gift(single, 'a').delta, 1);
  // The upstream message deduper can consume the final notification. A new
  // message at count 1 must still start a new streak.
  n.reset(); assert.equal(n.gift({ ...gift, msgId: 'one' }, 'a').delta, 1);
  assert.equal(n.gift({ ...gift, msgId: 'two' }, 'a').delta, 1);
  assert.equal(n.gift({ ...gift, msgId: 'two', repeatEnd: true }, 'a'), null);
});
test('手動の条件テストは本番のいいね基準・クールダウン・出力に影響しない', async t => {
  const f = await fixture(t);
  f.event({ type: 'like', total: 0 });
  assert.equal(f.effects.testEvent({ type: 'like', previousLikes: 0, total: 100 }).matched.length, 1);
  assert.ok(f.effects.state().previewPlaying); assert.equal(f.effects.state().playing, '');
  assert.equal(f.event({ type: 'like', total: 100 }).matched.length, 1);
  f.effects.closePreview(); assert.equal(f.effects.state().previewPlaying, ''); assert.ok(f.effects.state().playing);
});
test('一時停止は時間を保持し、停止中のイベントをためない。音声停止は解除まで持続', async t => {
  const f = await fixture(t);
  f.event({ type: 'like', total: 0 }); f.event({ type: 'like', total: 100 }); f.advance(2000);
  f.effects.control('pause'); f.advance(60000);
  assert.equal(f.event({ type: 'like', total: 200 }).paused, true); assert.equal(f.effects.state().queued, 0);
  assert.throws(() => f.effects.testRule('likes'), /一時停止/);
  f.effects.control('mute'); f.effects.control('resume'); f.advance(2999); assert.ok(f.effects.state().playing);
  f.advance(2); assert.equal(f.effects.state().playing, '');
  f.event({ type: 'like', total: 300 }); assert.equal(f.effects.snapshot('live').muted, true);
  f.effects.control('stop'); assert.equal(f.effects.state().playing, ''); assert.equal(f.effects.state().previewPlaying, '');
  f.effects.control('unmute'); assert.equal(f.effects.state().muted, false);
});
test('プロフィール切替・元に戻す・競合保存・不正ファイル参照を検証', async t => {
  const f = await fixture(t); const s = f.effects.state();
  f.event({ type: 'like', total: 0 }); f.event({ type: 'like', total: 100 });
  f.effects.save({ ...s.settings, activeProfile: 'sing' }, s.revision);
  assert.equal(f.effects.state().playing, ''); assert.equal(f.effects.state().settings.activeProfile, 'sing');
  f.effects.control('undo'); assert.equal(f.effects.state().settings.activeProfile, 'chat');
  assert.throws(() => f.effects.save(s.settings, s.revision), /更新されました/);
  const bad = f.effects.state(); bad.settings.assets[0].id = '../'.repeat(12);
  assert.throws(() => f.effects.save(bad.settings, bad.revision), /不正/);
  const invented = f.effects.state(); invented.settings.assets[0].name = 'invented';
  assert.throws(() => f.effects.save(invented.settings, invented.revision), /登録済み/);
});
test('未対応素材の一括登録は途中コピーも巻き戻し、既存素材は保持', async t => {
  const f = await fixture(t); const other = path.join(f.root, 'bad.html'); fs.writeFileSync(other, '<html>');
  await assert.rejects(f.effects.importFiles([f.png, other]), /対応する/);
  assert.equal(f.effects.state().settings.assets.length, 1);
  assert.equal(fs.readdirSync(path.join(f.root, 'store', 'assets')).length, 1);
});
test('破損した設定は上書きせず明示エラー。未知の形式・非有限値は拒否', async t => {
  const f = await fixture(t); f.effects.close(); const file = path.join(f.root, 'store', 'settings.json'); fs.writeFileSync(file, 'broken');
  const broken = createMediaEffects({ directory: path.dirname(file), port: 0 }); t.after(() => broken.close());
  assert.match(broken.state().error, /保護/); assert.throws(() => broken.save(defaults(), 0), /保護/); assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
  const bad = f.effects.state().settings; bad.profiles[0].rules[0].volume = NaN; assert.throws(() => validateSettings(bad), /不正/);
});
test('クールダウン・待ち行列上限・期限切れで大量イベントの後追いを防ぐ', async t => {
  const f = await fixture(t); f.saveRules([{ ...f.rule, cooldown: 3 }]); f.event({ type: 'like', total: 0 });
  assert.equal(f.event({ type: 'like', total: 100 }).matched.length, 1); assert.equal(f.event({ type: 'like', total: 200 }).matched.length, 0);
  f.advance(3000); assert.equal(f.event({ type: 'like', total: 300 }).matched.length, 1);
  f.saveRules([{ ...f.rule, duration: 60 }]); f.event({ type: 'like', total: 0 });
  for (let n = 1; n <= 100; n++) f.event({ type: 'like', total: n * 100 });
  assert.equal(f.effects.state().queued, 20); f.advance(60001); assert.equal(f.effects.state().queued, 0); assert.equal(f.effects.state().playing, '');
});
test('HTTP: ローカル認証・Origin・メディア範囲取得・SSE・終了通知', async t => {
  const f = await fixture(t); await f.effects.start();
  const output = new URL(f.effects.url()), token = output.searchParams.get('token'), base = output.origin;
  assert.equal((await fetch(base + '/overlay')).status, 403);
  assert.equal((await fetch(output, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  const page = await fetch(output); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  const media = base + '/media/' + f.asset.id + '?token=' + token;
  const range = await fetch(media, { headers: { Range: 'bytes=0-3' } }); assert.equal(range.status, 206); assert.equal(Buffer.from(await range.arrayBuffer()).toString('hex'), '89504e47');
  assert.equal((await fetch(media, { headers: { Range: 'bytes=999-' } })).status, 416);
  const tail = await fetch(media, { headers: { Range: 'bytes=-2' } }); assert.equal(Buffer.from(await tail.arrayBuffer()).toString('hex'), '1a0a');
  const cancel = new AbortController(); const stream = await fetch(base + '/events?channel=preview&token=' + token, { signal: cancel.signal });
  const reader = stream.body.getReader(); assert.match(Buffer.from((await reader.read()).value).toString(), /data:/);
  assert.equal(f.effects.state().previewClients, 1);
  f.effects.testRule('likes'); const current = f.effects.snapshot('preview').current;
  await fetch(base + '/feedback?token=' + token, { method: 'POST', body: JSON.stringify({ finished: true, channel: 'preview', jobId: current.id }) });
  assert.equal(f.effects.state().previewPlaying, ''); cancel.abort();
});
test('BridgeのHTTP通知が本番ルールへ届き、外部URLには送らない', async t => {
  const f = await fixture(t); await f.effects.start(); const reporter = createMediaReporter(f.effects.bridgeEnv());
  reporter.reset(); reporter.like({ totalLikeCount: 0 }); reporter.like({ totalLikeCount: 100 });
  const until = Date.now() + 3000; while (!f.effects.state().playing && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.effects.state().playing, 'ありがとう');
  const disabled = createMediaReporter({ MYGAMEPACK_MEDIA_URL: 'https://example.com/event', MYGAMEPACK_MEDIA_TOKEN: 'a'.repeat(64) }); disabled.like({ totalLikeCount: 200 });
  assert.equal(f.effects.state().queued, 0);
});

test('演出専用接続: Minecraft設定不要、過去イベントと重複を除去し、切断後は再接続', async t => {
  const { EventEmitter } = require('node:events');
  const { createMediaLive } = require('../../bridge/media_live.cjs');
  let connection, connects = 0, time = 1234000;
  class FakeConnection extends EventEmitter { constructor(username) { super(); assert.equal(username, 'test_user'); connection = this; } async connect() { connects++; } disconnect() {} }
  const received = [], states = [];
  const live = createMediaLive({ Connection: FakeConnection, username: 'test_user', mutedUsers: ['blocked'], now: () => time, retryMs: 10,
    reporter: { reset: () => received.push('reset'), gift: d => received.push(d.giftId), like: d => received.push(d.totalLikeCount) }, status: state => states.push(state) });
  t.after(() => live.stop()); await live.start();
  connection.emit('gift', { createTime: 1233, giftId: 1, msgId: 'old' });
  connection.emit('gift', { createTime: 1234, giftId: 2, msgId: 'new' });
  connection.emit('gift', { createTime: 1234, giftId: 2, msgId: 'new' });
  connection.emit('like', { createTime: 1234, totalLikeCount: 100 });
  connection.emit('like', { createTime: 1234, totalLikeCount: 999, uniqueId: 'Blocked' });
  assert.deepEqual(received, ['reset', 2, 100]);
  time += 10000; connection.emit('disconnected');
  connection.emit('like', { createTime: 1244, totalLikeCount: 200 });
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(connects, 2); assert.equal(received.at(-1), 'reset');
  live.stop(); connection.emit('like', { createTime: 1244, totalLikeCount: 300 }); assert.equal(states.at(-1), 'stopped'); assert.equal(received.at(-1), 'reset');
});
