// テスト発火の入力を、本番の BRIDGE と同じ処理に通す形へ変える。結果は送る列の知らせから集める（2026-10-16 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { testEventActions, createTestRun, noMatchNote } = require('../../bridge/test_fire.cjs');

const mapped = { mappedGiftIds: new Set(['1']) };

test('設定済みギフト N 個は、同じ視聴者の連打として1個ずつ通し、最後の1個で連打を終える。コンボも同じ', () => {
  const { actions } = testEventActions({ type: 'mapped_gift', giftId: '1', count: 3, listenerName: '検証' }, mapped);
  assert.deepEqual(actions.map(a => [a.kind, a.data.giftId, a.data.repeatCount, a.data.repeatEnd, a.data.nickname]),
    [['gift', '1', 1, 0, '検証'], ['gift', '1', 2, 0, '検証'], ['gift', '1', 3, 1, '検証']]);
  assert.equal(testEventActions({ type: 'combo', giftId: '1', count: 1 }, mapped).actions.length, 1);
});

test('割当のない ID（設定済みギフト）・割当のある ID（未設定ギフト）は理由を書いて何も通さない', () => {
  const missing = testEventActions({ type: 'mapped_gift', giftId: '2', count: 1 }, mapped);
  assert.deepEqual(missing.actions, []);
  assert.match(missing.notes.join(''), /割当がありません/);
  const taken = testEventActions({ type: 'unmapped_gift', giftId: '1' }, mapped);
  assert.deepEqual(taken.actions, []);
  assert.match(taken.notes.join(''), /設定済み/);
  const unmapped = testEventActions({ type: 'unmapped_gift', giftId: '999', count: 50 }, mapped);
  assert.deepEqual(unmapped.actions.map(a => [a.kind, a.data.giftId, a.data.repeatCount, a.data.repeatEnd]), [['gift', '999', 1, 1]], '未設定ギフトは1個');
});

test('いいねは入力の前回・今回の累計をそのまま渡し、今回が前回より少なければ止める', () => {
  const { actions, notes } = testEventActions({ type: 'like_milestone', previousLikes: 300, likeCount: 900 }, mapped);
  assert.deepEqual(actions.map(a => [a.kind, a.progress]), [['like', { previousTotal: 300, total: 900, local: false }]]);
  assert.match(notes.join(''), /累計300→900/);
  assert.throws(() => testEventActions({ type: 'like', previousLikes: 100, likeCount: 1 }, mapped), /前回以上/);
});

test('フォロー・コメント・死亡・ルーレット・投票・シェア・訪問・コマンド直接の入れ方', () => {
  const one = input => testEventActions({ listenerName: '検証', ...input }, mapped).actions[0];
  assert.deepEqual([one({ type: 'follow_milestone', followCount: 5 }).kind, one({ type: 'follow', followCount: 5 }).followCount], ['follow', 5]);
  assert.deepEqual(one({ type: 'comment_command', comment: ' !heal ' }).data, { nickname: '検証', comment: '!heal' });
  assert.deepEqual(one({ type: 'death', deaths: 3 }).status, { type: 'death', deaths: 3, player: '検証' });
  assert.equal(one({ type: 'roulette' }).kind, 'roulette');
  assert.deepEqual([one({ type: 'poll', pollOption: ' 2 ' }).kind, one({ type: 'poll', pollOption: ' 2 ' }).option], ['poll', '2']);
  assert.equal(one({ type: 'share' }).kind, 'share');
  assert.equal(one({ type: 'member' }).kind, 'member');
  assert.deepEqual([one({ type: 'gift', commandFile: 'qa', count: 7 }).commandFile, one({ type: 'gift', commandFile: 'qa.txt', count: 7 }).count], ['qa.txt', 7]);
});

test('名前が空なら「テスト視聴者」、改行は空白にする（整えるのは本番と同じく BRIDGE の処理の中）', () => {
  assert.equal(testEventActions({ type: 'share' }, mapped).sender, 'テスト視聴者');
  assert.equal(testEventActions({ type: 'share', listenerName: 'a"b\nc' }, mapped).sender, 'a"b c');
});

test('不正入力・パス脱出・不明な種類を、通す前に止める', () => {
  for (const commandFile of ['../secret', 'C:\\secret', 'x/y', 'a:b', '']) assert.throws(() => testEventActions({ type: 'gift', commandFile }, mapped), /ファイル名/);
  for (const likeCount of [NaN, Infinity, -1, 1.5, 1000001]) assert.throws(() => testEventActions({ type: 'like', likeCount }, mapped), /整数/);
  for (const count of [0, 101, 1.5]) assert.throws(() => testEventActions({ type: 'gift', commandFile: 'qa', count }, mapped), /整数/);
  assert.throws(() => testEventActions({ type: 'comment', comment: '  ' }, mapped), /コメントを入力/);
  assert.throws(() => testEventActions({ type: 'made_up' }, mapped), /対応していない/);
  assert.throws(() => testEventActions(null, mapped), /対応していない/);
});

test('集計: 送れた・送れなかった・取りやめを1回ずつ書き、全部終わったら待たずに返す', async () => {
  const run = createTestRun();
  const a = run.mark({ type: 'gift', commandFile: 'qa', count: 2 });
  const b = run.mark({ type: 'other', historyType: 'share', commandFile: 'x.txt', count: 1 });
  const c = run.mark({ type: 'like', commandFile: 'y', count: 3 });
  assert.equal(a.source, 'test');
  run.delivered({ ...a });
  run.finished(a);               // 送れたあとに列から外れても、もう1行書かない
  run.failed(b, 'HTTP 400');
  run.finished(c);               // 送れた・送れなかったの知らせがない → 配信の終了で捨てた
  const started = Date.now();
  await run.wait(5000);
  assert.ok(Date.now() - started < 1000, '全部終わっていれば待たない');
  const result = run.result('検証');
  assert.deepEqual(result.fired.map(r => [r.stepIndex, r.state, r.commandFile, r.count]),
    [[0, 'delivered', 'qa.txt', 2], [1, 'failed', 'x.txt', 1], [2, 'discarded', 'y.txt', 3]]);
  assert.deepEqual(result.fired.map(r => r.message), ['BridgeMOD が受け付けました', 'HTTP 400', '配信の終了で取りやめました']);
  assert.deepEqual(result.steps.map(s => [s.label, s.type]), [['ギフト', 'gift'], ['シェア', 'share'], ['いいね', 'like']]);
  assert.equal(result.sender, '検証');
  assert.equal(result.fired[0].testRun, undefined, '結果に集計先を入れない');
});

test('集計: 時間内に終わらない送信とルーレットは pending にする', async () => {
  const run = createTestRun();
  run.mark({ type: 'gift', commandFile: 'qa.txt', count: 1 });
  const spin = run.step({ commandFile: 'roulette.txt', count: 3, historyType: 'roulette' }, { roulette: true });
  run.hold(spin);
  await run.wait(50);
  assert.deepEqual(run.result('x').fired.map(r => [r.stepIndex, r.state, r.message]), [
    [0, 'pending', '送り直し中（届いたら実行されます）'],
    [1, 'pending', 'ルーレットを回しています（当たりは回したあとに送ります）'],
  ]);
});

test('集計: ルーレットの当たりは同じ手順の続きとして数え、回し終えたら待ちを解く。注意は1回だけ書く', async () => {
  const run = createTestRun();
  const spin = run.step({ commandFile: 'roulette.txt', count: 1, historyType: 'death_roulette' }, { roulette: true });
  run.hold(spin);
  const win = run.mark({ type: 'other', historyType: 'death_roulette', commandFile: 'qa.txt', count: 2 }, spin);
  run.delivered(win);
  run.release(spin);
  run.notice('演出なし'); run.notice('演出なし');
  await run.wait(5000);
  const result = run.result('x');
  assert.deepEqual(result.steps.map(s => [s.label, s.commandFile, s.count, s.roulette]), [['デスルーレット', 'roulette.txt', 1, true]]);
  assert.deepEqual(result.fired.map(r => [r.stepIndex, r.state, r.commandFile, r.count]), [[0, 'delivered', 'qa.txt', 2]]);
  assert.deepEqual(result.notes, ['演出なし']);
});

test('集計: 送る前に止まった手順（ルーレットの設定の誤りなど）は、送らなかった回数を「送れなかった」として書く', async () => {
  const run = createTestRun();
  const spin = run.step({ commandFile: 'roulette.txt', count: 3, historyType: 'roulette' }, { roulette: true });
  run.hold(spin);
  run.failStep(spin, 'ルーレットの有効な項目がありません。', 2);
  run.release(spin);
  await run.wait(5000);
  assert.deepEqual(run.result('x').fired.map(r => [r.stepIndex, r.state, r.commandFile, r.count, r.message]),
    [[0, 'failed', 'roulette.txt', 2, 'ルーレットの有効な項目がありません。']]);
});

test('何も通らなかったときの注意は種類ごと', () => {
  assert.match(noMatchNote('death'), /デスルーレット/);
  assert.match(noMatchNote('share'), /シェア/);
  assert.match(noMatchNote('unknown'), /条件に一致する有効な設定がありません/);
});
