// テスト発火は BRIDGE の本番と同じ処理・同じ送る列を通す（2026-10-16 ユーザーの決定。アプリレビュー 2026-10-08「テスト発火と本番の食い違い」）。
// 同じ内容を、仮想の TikTok から送ったときとテスト発火で送ったときで、偽 BridgeMOD に届く要求が同じになることを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const proto = createRequire(path.resolve(__dirname, '../../bridge/index.js'))('tiktok-live-connector');

// 今の接続ライブラリは、common.displayText.key でフォロー・シェアを見分ける。
const social = key => {
  const bytes = Buffer.from(key);
  return { displayText: proto.CommonMessageData.decode(Uint8Array.from([66, bytes.length + 2, 10, bytes.length, ...bytes])).displayText };
};
const view = request => ({ type: request.type, key: request.key, count: request.count, announce: request.announce, listenerName: request.listenerName });
const sorted = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
// ルーレットの演出（/bridge/exec）は key がないので除く。
const events = bridge => bridge.requests.filter(request => request.key).map(view);
const history = bridge => {
  try { return fs.readFileSync(path.join(bridge.dir, 'operations-history.json'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
};
async function eventually(bridge, check, label, ms = 10000) {
  for (let waited = 0; waited < ms && !check(); waited += 20) await bridge.wait(20);
  assert.ok(check(), 'Timed out: ' + label);
}
// テスト発火を先に送り（本番の状態に触らない）、そのあと同じ内容を本番として送る。
async function bothWays(bridge, input, sendLive, liveCount) {
  const result = await bridge.testEvent({ listenerName: '視聴者', ...input });
  const fromTest = events(bridge);
  bridge.requests.length = 0;
  await sendLive();
  await eventually(bridge, () => events(bridge).length >= liveCount, 'live requests');
  await bridge.wait(300);
  return { result, fromTest, fromLive: events(bridge) };
}

test('いいね: 追いつき上限で省かず、100未満の閾値はアナウンスなし。マイルストーンが先（本番と同じ）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { cod: 'say cod\n', boss: 'say boss\n', mile: 'say mile\n' },
    config: {
      likeEvents: [{ enabled: true, threshold: 10, commandFile: 'cod.txt', repeat: 1 }, { enabled: true, threshold: 100, commandFile: 'boss.txt', repeat: 1 }],
      options: { gameplay: { likeMilestones: [{ threshold: 50, commandFile: 'mile.txt' }] } },
    },
  });
  const { result, fromTest, fromLive } = await bothWays(bridge, { type: 'like', previousLikes: 0, likeCount: 100 },
    () => bridge.emit('WebcastLikeMessage', { count: 100, total: '100' }), 3);
  assert.deepEqual(sorted(fromTest), sorted([
    { type: 'like', key: 'cod', count: 10, announce: false, listenerName: '視聴者' },
    { type: 'like', key: 'boss', count: 1, announce: true, listenerName: '視聴者' },
    { type: 'other', key: 'mile', count: 1, announce: true, listenerName: '視聴者' },
  ]), '10いいねごとは10回（以前のテスト発火は追いつき上限で5回）');
  assert.deepEqual(sorted(fromLive), sorted(fromTest));
  assert.deepEqual(result.steps.map(step => step.commandFile), ['mile.txt', 'cod.txt', 'boss.txt'], 'マイルストーンが先、いいねの設定があと');
  assert.deepEqual(result.fired.map(row => row.state), ['delivered', 'delivered', 'delivered']);
  assert.ok(history(bridge).filter(row => row.source === 'test').every(row => ['like', 'milestone'].includes(row.type)), 'テストの行は本番と同じ種類名');
});

test('設定済みギフト3個: 本番の連打と同じく1個ずつ送り、時限倍率のあとの回数を四捨五入する。コンボも同じ', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { zombie: 'say zombie\n', combo: 'say combo\n' },
    config: {
      mappings: [{ giftId: '1', name: 'バラ', commandFile: 'zombie.txt', repeat: 3 }],
      options: { gameplay: { timedMode: { enabled: true, start: '00:00', end: '24:00', multiplier: 1.5 },
        combo: { windowMs: 10000, levels: [{ count: 10, commandFile: 'combo.txt' }] } } },
    },
  });
  const gift = (repeatCount, repeatEnd) => bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'バラ' }, repeatCount, repeatEnd });
  const { result, fromTest, fromLive } = await bothWays(bridge, { type: 'mapped_gift', giftId: '1', count: 3 },
    async () => { await gift(1, 0); await gift(2, 0); await gift(3, 1); }, 4);
  assert.deepEqual(fromTest.filter(x => x.key === 'zombie').map(x => [x.type, x.count, x.announce]),
    [['gift', 5, true], ['gift', 5, true], ['gift', 5, true]], '3回×1.5倍＝4.5回 → 5回を、ギフト1個ごとに');
  assert.deepEqual(fromTest.filter(x => x.key === 'combo').map(x => [x.type, x.count, x.announce]), [['other', 1, true]]);
  assert.deepEqual(sorted(fromLive), sorted(fromTest));
  assert.equal(result.steps.filter(step => step.label === 'バラ').length, 3);
});

test('フォロー: フォローマイルストーンが先、フォローの設定があと（本番と同じ）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { fan: 'say fan\n', thanks: 'say thanks\n' },
    config: { followEvent: { enabled: true, commandFile: 'thanks.txt', repeat: 1 },
      options: { gameplay: { followMilestones: [{ threshold: 3, commandFile: 'fan.txt' }] } } },
  });
  const follow = () => bridge.emit('WebcastSocialMessage', { common: social('pm_main_follow_message'), action: '1' });
  const { fromTest, fromLive } = await bothWays(bridge, { type: 'follow_milestone', followCount: 3 },
    async () => { await follow(); await follow(); await follow(); }, 4);
  assert.deepEqual(fromTest, [
    { type: 'other', key: 'fan', count: 1, announce: true, listenerName: '視聴者' },
    { type: 'other', key: 'thanks', count: 1, announce: true, listenerName: '視聴者' },
  ]);
  assert.deepEqual(fromLive.slice(-2), fromTest, '本番の3人目と同じ要求・同じ順番');
});

test('コメント: コメントコマンドが先、コメントギフトがあと（本番と同じ）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { heal: 'say heal\n', gifted: 'say gifted\n' },
    config: { commentGifts: { enabled: true, rules: [{ enabled: true, match: '!heal', commandFile: 'gifted.txt', repeat: 2 }] },
      options: { gameplay: { commentCommands: { '!heal': 'heal.txt' } } } },
  });
  const { fromTest, fromLive } = await bothWays(bridge, { type: 'comment', comment: '!heal' },
    () => bridge.emit('WebcastChatMessage', { content: '!heal' }), 2);
  assert.deepEqual(fromTest, [
    { type: 'other', key: 'heal', count: 1, announce: true, listenerName: '視聴者' },
    { type: 'other', key: 'gifted', count: 2, announce: true, listenerName: '視聴者' },
  ]);
  assert.deepEqual(fromLive, fromTest);
});

test('訪問はアナウンスなし、シェアはあり（本番と同じ）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { hello: 'say hello\n' },
    config: { memberEvent: { enabled: true, commandFile: 'hello.txt', repeat: 1 }, shareEvent: { enabled: true, commandFile: 'hello.txt', repeat: 2 } },
  });
  const member = await bothWays(bridge, { type: 'member' }, () => bridge.emit('WebcastMemberMessage', { action: 1 }), 1);
  assert.deepEqual(member.fromTest, [{ type: 'other', key: 'hello', count: 1, announce: false, listenerName: '視聴者' }]);
  assert.deepEqual(member.fromLive, member.fromTest);
  bridge.requests.length = 0;
  const share = await bothWays(bridge, { type: 'share' }, () => bridge.emit('WebcastSocialMessage', { common: social('pm_main_share_message'), action: '3' }), 1);
  assert.deepEqual(share.fromTest, [{ type: 'other', key: 'hello', count: 2, announce: true, listenerName: '視聴者' }]);
  assert.deepEqual(share.fromLive, share.fromTest);
});

test('ルーレット: 当たりは type other・アナウンスなし。回し終えるまで待ち、当たりを同じ手順の結果に書く（本番と同じ）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n', roulette: '# virtual\n' },
    config: { roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 2 }] },
      mappings: [{ giftId: '7', name: '回す', commandFile: 'roulette.txt', repeat: 1 }] },
  });
  const { result, fromTest, fromLive } = await bothWays(bridge, { type: 'roulette' },
    () => bridge.emit('WebcastGiftMessage', { giftId: '7', gift: { name: '回す' }, repeatCount: 1, repeatEnd: 1 }), 1);
  assert.deepEqual(fromTest, [{ type: 'other', key: 'qa', count: 2, announce: false, listenerName: '視聴者' }]);
  assert.deepEqual(fromLive, fromTest);
  assert.deepEqual(result.steps.map(step => [step.label, step.commandFile, step.count]), [['ルーレット', 'roulette.txt', 1]]);
  assert.deepEqual(result.fired.map(row => [row.stepIndex, row.state, row.commandFile, row.count]), [[0, 'delivered', 'qa.txt', 2]]);
});

test('ルーレットの演出だけ送れなくても当たりは送り、演出を送れなかった理由を結果に書く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] } },
    respond: (_payload, url) => url === '/bridge/exec' ? 429 : 202,
  });
  const result = await bridge.testEvent({ type: 'roulette' });
  assert.deepEqual(result.fired.map(row => row.state), ['delivered']);
  assert.ok(result.notes.some(note => note.includes('ルーレットの演出を送れなかった')), result.notes.join(' / '));
});

// 以前のテスト発火は送る前にルーレットを確かめ、誤りを失敗として出していた（最後のレビュー Important #1。2026-10-16）。
test('ルーレットの設定の誤り（存在しないコマンドだけ）は、テスト発火では「送れなかった」に、条件だけ確認では注意に出す', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { roulette: { enabled: true, items: [{ commandFile: 'gone.txt', label: 'なし', weight: 1, repeat: 1 }] },
      deathRoulette: { enabled: true, everyDeaths: 1, items: [{ commandFile: 'gone.txt', weight: 1, repeat: 1 }] } },
  });
  const fired = await bridge.testEvent({ type: 'roulette' });
  assert.deepEqual(fired.fired.map(row => [row.stepIndex, row.state, row.commandFile, row.count]), [[0, 'failed', 'roulette.txt', 1]]);
  assert.match(fired.fired[0].message, /ルーレットの有効な項目がありません/);
  const preview = await bridge.testEvent({ type: 'roulette', preview: true });
  assert.ok(preview.notes.some(note => note.includes('ルーレットの有効な項目がありません')), preview.notes.join(' / '));
  const death = await bridge.testEvent({ type: 'death', deaths: 1, preview: true });
  assert.ok(death.notes.some(note => note.includes('ルーレットの有効な項目がありません')), death.notes.join(' / '));
  assert.deepEqual(events(bridge), []);
});

test('送り直し: 混んでいても届いたら「受け付けた」、時間内に届かなければ「送り直し中」。400 は「送れなかった」で、ホームの件数に数えない', async t => {
  let busy = 1, slow = true;
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n', slow: 'say slow\n', bad: 'say bad\n' },
    env: { BRIDGE_TEST_FIRE_WAIT_MS: '1500' },
    respond: (payload, url) => {
      if (url !== '/bridge/event') return 202;
      if (payload.key === 'qa' && busy-- > 0) return 503;
      if (payload.key === 'slow' && slow) return 503;
      return payload.key === 'bad' ? 400 : 202;
    },
  });
  const retried = await bridge.testEvent({ type: 'gift', commandFile: 'qa', count: 1 });
  assert.deepEqual(retried.fired.map(row => row.state), ['delivered'], JSON.stringify(retried));
  const waiting = await bridge.testEvent({ type: 'gift', commandFile: 'slow', count: 1 });
  assert.deepEqual(waiting.fired.map(row => [row.state, row.message]), [['pending', '送り直し中（届いたら実行されます）']]);
  slow = false;
  await eventually(bridge, () => history(bridge).some(row => row.commandFile === 'slow.txt' && row.ok), '届いたら実行される');
  const rejected = await bridge.testEvent({ type: 'gift', commandFile: 'bad', count: 1 });
  assert.deepEqual(rejected.fired.map(row => row.state), ['failed']);
  assert.match(rejected.fired[0].message, /HTTP 400/);
  let status = {};
  try { status = JSON.parse(fs.readFileSync(path.join(bridge.dir, 'runtime-status.json'), 'utf8')); } catch { /* なければ数えていない */ }
  assert.ok(!(status.delivery?.rejected > 0), 'テストの失敗はホームの「送れなかったイベント」に数えない');
  const rows = history(bridge);
  assert.deepEqual(rows.map(row => [row.commandFile, row.ok, row.source]), [['qa.txt', true, 'test'], ['slow.txt', true, 'test'], ['bad.txt', false, 'test']]);
});

test('条件だけ確認: 送らずに手順を返し、使えない名前・ないコマンドは理由を書く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { cod: 'say cod\n', 'ネコ': 'say neko\n' },
    config: { likeEvents: [
      { enabled: true, threshold: 10, commandFile: 'ネコ.txt' },
      { enabled: true, threshold: 10, commandFile: 'cod.txt' },
      { enabled: true, threshold: 10, commandFile: 'gone.txt' },
    ] },
  });
  const preview = await bridge.testEvent({ type: 'like', previousLikes: 0, likeCount: 10, preview: true });
  await bridge.wait(300);
  assert.deepEqual(events(bridge), [], '送らない');
  assert.deepEqual(preview.steps.map(step => step.commandFile), ['ネコ.txt', 'cod.txt', 'gone.txt']);
  assert.ok(preview.notes.some(note => note.includes('半角英数字')), preview.notes.join(' / '));
  assert.ok(preview.notes.some(note => note.includes('コマンドが見つかりません: gone.txt')), preview.notes.join(' / '));
  assert.deepEqual(preview.fired, []);
  assert.deepEqual(history(bridge), [], '条件だけ確認は履歴に書かない');
});

test('ミュート・コマンド直接・名前: ミュートの視聴者は送らず、コマンド直接は1件で送る。名前は本番と同じく整える', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { shareEvent: { enabled: true, commandFile: 'qa.txt' }, options: { mutedUsers: ["it's me"] } },
  });
  const muted = await bridge.testEvent({ type: 'share', listenerName: 'It’s Me' });
  assert.deepEqual(muted.notes, ['この視聴者はミュート対象のため発火しません。']);
  assert.deepEqual(events(bridge), []);
  const direct = await bridge.testEvent({ type: 'gift', commandFile: 'qa', count: 7, listenerName: 'a"b\nc' });
  assert.deepEqual(events(bridge), [{ type: 'gift', key: 'qa', count: 7, announce: true, listenerName: 'a”b c' }]);
  assert.equal(direct.sender, 'a”b c');
  const missing = await bridge.testEvent({ type: 'gift', commandFile: 'missing' });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /コマンドが見つかりません: missing\.txt/);
  // 改行は本番と同じく1文字ごとに空白1つ（最後のレビュー Minor #2）。
  bridge.requests.length = 0;
  const crlf = await bridge.testEvent({ type: 'gift', commandFile: 'qa', count: 1, listenerName: 'a\r\nb' });
  assert.equal(crlf.sender, 'a  b');
  assert.equal(events(bridge)[0].listenerName, 'a  b');
});

test('GAME_MOD のいいね: 手順の回数は要求の数ぶん。条件だけ確認と同じ回数を出す（最後のレビュー Minor #3）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { tower: '# TITLE: tower\n# GAME_MOD: gameprobe\nsay game\n' },
    config: { likeEvents: [{ enabled: true, threshold: 10, commandFile: 'tower.txt', repeat: 1 }] },
  });
  const preview = await bridge.testEvent({ type: 'like', previousLikes: 0, likeCount: 30, preview: true });
  const fired = await bridge.testEvent({ type: 'like', previousLikes: 0, likeCount: 30 });
  assert.deepEqual(preview.steps.map(step => step.count), [3]);
  assert.deepEqual(fired.steps.map(step => step.count), [3]);
  assert.deepEqual(fired.fired.map(row => [row.state, row.count]), [['delivered', 3]]);
  assert.equal(events(bridge).length, 3, 'GAME_MOD は1回ずつ別の要求');
});

test('配信の終了でいいねの送る列を捨てたら、テストのいいねは「取りやめ」になり、結果を待ち続けない（最後のレビューの足りないテスト）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { cod: 'say cod\n' },
    config: { likeEvents: [{ enabled: true, threshold: 10, commandFile: 'cod.txt', repeat: 1 }] },
    respond: (payload, url) => (url === '/bridge/event' && payload.type === 'like' ? 429 : 202),
  });
  const pending = bridge.testEvent({ type: 'like', previousLikes: 0, likeCount: 10 });
  await bridge.wait(300);
  bridge.connection().emit('streamEnd', {});
  const started = Date.now();
  const result = await pending;
  assert.ok(Date.now() - started < 5000, '10秒の時間切れを待たない');
  assert.deepEqual(result.fired.map(row => [row.state, row.message]), [['discarded', '配信の終了で取りやめました']]);
});

test('テスト発火のログには、本番と見分けられるよう行頭に [Test] を付ける（最後のレビュー Minor #7）', async t => {
  let busy = 1;
  const bridge = await startBridgeFixture(t, {
    commands: { pick: '# RANDOM: qa\nsay pick\n', qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'pick.txt', repeat: 1 }],
      roulette: { enabled: true, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 1 }] },
      options: { mutedUsers: ['muted'] } },
    respond: (payload, url) => (url === '/bridge/exec' ? 429 : url === '/bridge/event' && payload.key === 'qa' && busy-- > 0 ? 503 : 202),
  });
  const start = bridge.logs.length;
  await bridge.testEvent({ type: 'share', listenerName: 'muted' });
  await bridge.testEvent({ type: 'mapped_gift', giftId: '1', count: 1 });
  await bridge.testEvent({ type: 'roulette' });
  const lines = bridge.logs.slice(start).filter(line => /\[(Random|Roulette|Safety)\]|Config reloaded|Waiting to retry/.test(line));
  assert.ok(lines.length >= 4, lines.join('\n'));
  assert.deepEqual(lines.filter(line => !line.startsWith('[Test]')), []);
});

test('設定: options のキーの並びが変わっただけなら、起動し直しの注意を出さない（最後のレビュー Minor #10）', async t => {
  const bridge = await startBridgeFixture(t, { commands: { qa: 'say qa\n' }, config: { shareEvent: { enabled: true, commandFile: 'qa.txt' } } });
  const file = path.join(bridge.dir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.options = Object.fromEntries(Object.entries(cfg.options).reverse());
  fs.writeFileSync(file, JSON.stringify(cfg));
  const result = await bridge.testEvent({ type: 'share', preview: true });
  assert.ok(!result.notes.some(note => note.includes('起動し直す')), result.notes.join(' / '));
});

test('結果を返す ipc の失敗はログに出し、音・粒子の送信も結果を返す前に待つ（最後のレビュー Minor #8・#9）', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  assert.match(source, /process\.send\?\.\(\{ type: 'testEventResult', id: message\.id, result \}, error => \{ if \(error\) console\.error\('\[Test\] 結果をアプリへ返せませんでした:', error\.message\); \}\);/);
  assert.match(source, /run\.track\(sendBridgeExec\(bridgeMod, extras, sender\)\.catch\(error => run\.notice\(`音・粒子を送れませんでした: \$\{error\?\.message \|\| error\}`\)\)\);/);
});

// options は配信中に保存したらすぐ効く（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 8）。
// 前は「起動し直すまで反映されません」と注意して起動時の値で試していた。つなぎ方（TikTok ID など）だけは今も起動し直すまで反映されない。
test('設定: 保存した直後でも新しいイベント設定と options で試す。つなぎ方を変えたときだけ起動し直すよう注意する', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n', fresh: 'say fresh\n' },
    config: { shareEvent: { enabled: true, commandFile: 'qa.txt' } },
  });
  const file = path.join(bridge.dir, 'config.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.shareEvent = { enabled: true, commandFile: 'fresh.txt' };
  fs.writeFileSync(file, JSON.stringify(cfg));
  const fresh = await bridge.testEvent({ type: 'share' });
  assert.deepEqual(events(bridge).map(x => x.key), ['fresh']);
  assert.ok(!fresh.notes.some(note => note.includes('起動し直す')), 'つなぎ方を変えていなければ注意しない');
  cfg.options.announceEnabled = false;
  fs.writeFileSync(file, JSON.stringify(cfg));
  const changed = await bridge.testEvent({ type: 'share' });
  assert.ok(!changed.notes.some(note => note.includes('起動し直す')), 'すぐ効く options では注意しない: ' + changed.notes.join(' / '));
  assert.equal(events(bridge).at(-1).announce, false, '保存したアナウンスなしで試す（本番も同じくすぐ効く）');
  cfg.tiktokUsername = 'other';
  fs.writeFileSync(file, JSON.stringify(cfg));
  const reconnect = await bridge.testEvent({ type: 'share' });
  assert.ok(reconnect.notes.some(note => note.includes('TikTok IDは、BRIDGE を起動し直すまで')), reconnect.notes.join(' / '));
});

test('死亡と投票: デスルーレットは「N回ごと」で回し、投票はその番号を当選させる。条件に届かなければ理由を書く', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { qa: 'say qa\n' },
    config: { deathRoulette: { enabled: true, everyDeaths: 3, items: [{ commandFile: 'qa.txt', label: 'QA', weight: 1, repeat: 5 }] },
      options: { gameplay: { poll: { enabled: true, options: { '1': 'qa.txt', '2': { commandFile: 'qa.txt', repeat: 3 } } } } } },
  });
  const miss = await bridge.testEvent({ type: 'death', deaths: 2 });
  assert.match(miss.notes.join(''), /デスルーレット/);
  const hit = await bridge.testEvent({ type: 'death', deaths: 3, listenerName: 'Steve' });
  assert.equal(hit.steps[0].label, 'デスルーレット');
  assert.deepEqual(events(bridge), [{ type: 'other', key: 'qa', count: 5, announce: false, listenerName: 'Steve' }]);
  bridge.requests.length = 0;
  await bridge.testEvent({ type: 'poll', pollOption: '2' });
  assert.deepEqual(events(bridge), [{ type: 'other', key: 'qa', count: 3, announce: true, listenerName: 'コメント投票' }]);
  const none = await bridge.testEvent({ type: 'poll', pollOption: '9' });
  assert.match(none.notes.join(''), /投票が無効か、この番号の選択肢がありません/);
});

test('テスト発火は本番の状態（いいねの累計・マイルストーン）に触らない', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { mile: 'say mile\n' },
    config: { options: { gameplay: { likeMilestones: [{ threshold: 50, commandFile: 'mile.txt' }] } } },
  });
  await bridge.emit('WebcastLikeMessage', { count: 10, total: '10' });
  await bridge.wait(200);
  const tested = await bridge.testEvent({ type: 'like_milestone', previousLikes: 0, likeCount: 100 });
  assert.deepEqual(tested.fired.map(row => row.state), ['delivered'], 'テストではマイルストーン50が出る');
  bridge.requests.length = 0;
  await bridge.emit('WebcastLikeMessage', { count: 30, total: '40' });
  await bridge.wait(300);
  assert.deepEqual(events(bridge), [], '本番の累計は10→40（テストの100で進めていない）');
  await bridge.emit('WebcastLikeMessage', { count: 20, total: '60' });
  await eventually(bridge, () => events(bridge).some(x => x.key === 'mile'), '本番のマイルストーン50は本番で1回出る');
});

test('RANDOM の割り当ては送るときと同じく抽選し、選ばれたものを書く（条件だけ確認でも）', async t => {
  const bridge = await startBridgeFixture(t, {
    commands: { pick: '# RANDOM: qa\nsay pick\n', qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'pick.txt', repeat: 1 }] },
  });
  const preview = await bridge.testEvent({ type: 'mapped_gift', giftId: '1', count: 1, preview: true });
  assert.deepEqual(preview.steps.map(step => step.commandFile), ['qa.txt']);
  assert.ok(preview.notes.includes('ランダム選択: qa.txt（実行ごとに抽選）'), preview.notes.join(' / '));
  await bridge.testEvent({ type: 'mapped_gift', giftId: '1', count: 1 });
  assert.deepEqual(events(bridge).map(x => x.key), ['qa']);
});

test('BridgeMOD 経路でないときは、テスト発火を使えないと返す', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8');
  assert.match(source, /if \(!bridgeMod\) throw new Error\("テスト発火は、Minecraft を BridgeMOD で動かしているときだけ使えます。"\);/);
});
