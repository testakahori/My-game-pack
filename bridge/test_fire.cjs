// テスト発火（アプリの「イベントテスト」）の入力を、本番の BRIDGE が受け取るイベントと同じ形にする。
// 本番と同じ処理・同じ送る列を通すため、ここでは「何をどの処理に通すか」と、結果の集め方だけを決める（2026-10-16 ユーザーの決定）。
// ファイルも設定ファイルも読まない。
const { safeDisplayName } = require('./tiktok_events.cjs');

const TYPES = new Set(['gift', 'mapped_gift', 'unmapped_gift', 'like', 'share', 'follow', 'member', 'comment', 'death',
  'roulette', 'combo', 'like_milestone', 'follow_milestone', 'comment_command', 'poll']);

function commandName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 160 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('コマンドファイル名が不正です。');
  return /\.txt$/i.test(name) ? name : `${name}.txt`;
}

function integer(input, key, fallback, min, max) {
  const n = Number(input[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key}: ${min}〜${max}の整数を指定してください。`);
  return n;
}

// sender は入力の名前のまま。表示名に整えるのは本番と同じく BRIDGE の処理の中（getStableSender）。
// 先に改行をまとめると、本番（改行1文字ごとに空白1つ）とずれる（最後のレビュー Minor #2）。整えて空になる名前は「テスト視聴者」。
function testEventActions(input, { mappedGiftIds = new Set() } = {}) {
  if (!input || !TYPES.has(input.type)) throw new Error('対応していないテストイベントです。');
  const type = input.type;
  const raw = String(input.listenerName ?? '');
  const sender = safeDisplayName(raw) ? raw : 'テスト視聴者';
  const data = extra => ({ nickname: sender, ...extra });
  const actions = [], notes = [];
  if (type === 'gift') {
    actions.push({ kind: 'direct', commandFile: commandName(input.commandFile), count: integer(input, 'count', 1, 1, 100), data: data() });
  }
  if (type === 'mapped_gift' || type === 'combo') {
    const giftId = String(input.giftId ?? '').trim();
    const count = integer(input, 'count', 1, 1, 100);
    if (!mappedGiftIds.has(giftId)) notes.push('このギフトIDには割当がありません。未設定ギフトのテストを使用してください。');
    // 同じ視聴者の連打として1個ずつ処理する（本番の連打と同じ）。最後の1個で連打の終わり。
    else for (let i = 1; i <= count; i++) actions.push({ kind: 'gift', data: data({ giftId, repeatCount: i, repeatEnd: i === count ? 1 : 0 }) });
  }
  if (type === 'unmapped_gift') {
    const giftId = String(input.giftId ?? '').trim();
    if (!giftId) throw new Error('割当のないギフトIDを入力してください。');
    if (mappedGiftIds.has(giftId)) notes.push('このIDは設定済みです。割当のないギフトIDを指定してください。');
    else actions.push({ kind: 'gift', data: data({ giftId, repeatCount: 1, repeatEnd: 1 }) });
  }
  if (type === 'like' || type === 'like_milestone') {
    const total = integer(input, 'likeCount', 100, 0, 1000000);
    const previousTotal = integer(input, 'previousLikes', 0, 0, 1000000);
    if (total < previousTotal) throw new Error('今回の累計いいねは前回以上にしてください。');
    actions.push({ kind: 'like', data: data(), progress: { previousTotal, total, local: false } });
    notes.push(`累計${previousTotal}→${total}として判定。本番のいいね数は変更しません。`);
  }
  if (type === 'share' || type === 'member') actions.push({ kind: type, data: data() });
  if (type === 'follow' || type === 'follow_milestone') {
    actions.push({ kind: 'follow', data: data(), followCount: integer(input, 'followCount', 1, 1, 1000000) });
  }
  if (type === 'comment' || type === 'comment_command') {
    const comment = String(input.comment || '').trim().slice(0, 500);
    if (!comment) throw new Error('テストするコメントを入力してください。');
    actions.push({ kind: 'chat', data: data({ comment }) });
    notes.push('新しいコメントとして判定します。読み上げは読み上げ設定のテストで確認できます。');
  }
  if (type === 'death') actions.push({ kind: 'death', status: { type: 'death', deaths: integer(input, 'deaths', 1, 0, 1000000), player: sender } });
  if (type === 'roulette') actions.push({ kind: 'roulette', data: data() });
  if (type === 'poll') {
    actions.push({ kind: 'poll', data: data(), option: String(input.pollOption ?? '').trim() });
    notes.push('選択肢の当選後の発火を確認します。実際の投票待ち時間は省略します。');
  }
  return { sender, actions, notes };
}

const NO_MATCH = {
  gift: '送るものがありません。',
  mapped_gift: 'このギフトの割り当てから送るものがありません。',
  combo: 'このギフトの割り当てから送るものがありません。',
  unmapped_gift: '未設定ギフトの設定が無効または未設定です。',
  like: 'この累計で届くいいねの設定・いいねマイルストーンがありません。',
  like_milestone: 'この累計で届くいいねの設定・いいねマイルストーンがありません。',
  share: 'シェアの設定が無効または未設定です。',
  member: '訪問の設定が無効または未設定です。',
  follow: 'フォローの設定が無効または未設定で、この人数で届くフォローマイルストーンもありません。',
  follow_milestone: 'フォローの設定が無効または未設定で、この人数で届くフォローマイルストーンもありません。',
  comment: 'このコメントに一致するコメントギフト・コメントコマンドがありません。',
  comment_command: 'このコメントに一致するコメントギフト・コメントコマンドがありません。',
  death: 'デスルーレットが無効か、死亡回数が「〇回ごと」の条件に届いていません。',
  roulette: 'ルーレットが無効です。イベント設定②で有効にして保存してください。',
  poll: '投票が無効か、この番号の選択肢がありません。',
};
function noMatchNote(type) {
  return NO_MATCH[type] || '条件に一致する有効な設定がありません。';
}

const LABELS = { gift: 'ギフト', like: 'いいね', share: 'シェア', follow: 'フォロー', member: '訪問', comment: 'コメント',
  milestone: 'マイルストーン', combo: 'コンボ', poll: 'コメント投票', roulette: 'ルーレット', death_roulette: 'デスルーレット' };
const txt = name => (/\.txt$/i.test(String(name || '')) ? String(name) : `${name}.txt`);
const ACCEPTED = 'BridgeMOD が受け付けました';
const DISCARDED = '配信の終了で取りやめました';
// 1件の送信で実行される回数。GAME_MOD のいいねは1回ずつ別の要求（repeatRequests）になる（最後のレビュー Minor #3）。
const timesOf = event => (Number(event.count) || 1) * (Number(event.repeatRequests) || 1);

// テスト1回分の手順と結果。送る列の「送れた」「送れなかった」「列から外れた」の知らせを受け、全部終わるか時間切れまで待つ。
function createTestRun({ preview = false } = {}) {
  const steps = [], fired = [], notes = [];
  const open = new Map();    // 手順の番号 → まだ終わっていない数
  const settled = new Set(); // 結果を書いた送信の番号
  const expected = new Map(); // 送信の番号 → 送るはずの回数
  let waiting = 0, sendSeq = 0, wake = null;
  const done = () => { waiting--; if (waiting === 0 && wake) wake(); };
  const close = stepIndex => {
    open.set(stepIndex, (open.get(stepIndex) || 0) - 1);
    done();
  };
  // 1件の送信の結果を書く（1回だけ）。rows は [state, 回数, 文] の並び。
  const settle = (event, rows) => {
    if (settled.has(event.testSend)) return;
    settled.add(event.testSend);
    for (const [state, count, message] of rows) fired.push({ stepIndex: event.testStep, commandFile: txt(event.commandFile), count, state, message });
    close(event.testStep);
  };
  const planned = event => expected.get(event.testSend) ?? timesOf(event);
  const run = {
    preview, steps, notes,
    // 送る（条件だけ確認では送るはずの）1件を手順に足し、手順の番号を返す。
    step(event, extra = {}) {
      steps.push({ label: event.label || LABELS[event.historyType || event.type] || 'イベント', commandFile: txt(event.commandFile),
        count: timesOf(event), type: event.historyType || event.type || 'other', ...extra });
      return steps.length - 1;
    },
    // 送る列へ入れるイベントにテストの印を付ける。stepIndex を渡すと、その手順の続き（ルーレットの当たり）として数える。
    mark(event, stepIndex = run.step(event)) {
      open.set(stepIndex, (open.get(stepIndex) || 0) + 1);
      waiting++;
      expected.set(++sendSeq, timesOf(event));
      return { ...event, source: 'test', testRun: run, testStep: stepIndex, testSend: sendSeq };
    },
    // 配信の終了で途中まで送ったところで捨てたときは、送れた回数と取りやめた回数を分けて書く（最後のレビュー Minor #4）。
    delivered: event => {
      const sent = Number(event.count) || 1, left = planned(event) - sent;
      settle(event, [['delivered', sent, ACCEPTED], ...(left > 0 ? [['discarded', left, DISCARDED]] : [])]);
    },
    // 送れなかった知らせの回数は、まだ送っていない回数。それより前に送れた分があれば、それも書く。
    failed: (event, reason) => {
      const left = Number(event.count) || 1, sent = planned(event) - left;
      settle(event, [...(sent > 0 ? [['delivered', sent, ACCEPTED]] : []), ['failed', left, reason]]);
    },
    // 送る列から外れた。送れた・送れなかったの知らせがなければ、配信の終了で捨てた分。
    finished: event => settle(event, [['discarded', planned(event), DISCARDED]]),
    // 手順に数えない送信（音・粒子）。終わるまで結果を待つ（最後のレビュー Minor #8）。
    track(promise) {
      waiting++;
      Promise.resolve(promise).then(done, done);
    },
    // 送る前に止まった手順（ルーレットの設定の誤りなど）。送らなかった回数を「送れなかった」として書く。
    failStep(stepIndex, reason, count = steps[stepIndex].count) {
      fired.push({ stepIndex, commandFile: steps[stepIndex].commandFile, count, state: 'failed', message: reason });
    },
    // ルーレットを回し終えるまで待つ。
    hold(stepIndex) { open.set(stepIndex, (open.get(stepIndex) || 0) + 1); waiting++; },
    release: close,
    notice(text) { if (!notes.includes(text)) notes.push(text); },
    // 全部終わるか、ms たつまで待つ。終わっていない手順は pending として結果に足す。
    async wait(ms) {
      if (waiting > 0) await new Promise(resolve => {
        const timer = setTimeout(resolve, ms);
        wake = () => { clearTimeout(timer); resolve(); };
      });
      wake = null;
      for (const [stepIndex, left] of open) {
        if (left <= 0) continue;
        const step = steps[stepIndex];
        fired.push({ stepIndex, commandFile: step.commandFile, count: step.count, state: 'pending',
          message: step.roulette ? 'ルーレットを回しています（当たりは回したあとに送ります）' : '送り直し中（届いたら実行されます）' });
      }
    },
    // 返したあとに届いた分は、履歴には届いたときに書く（結果には入らない）。
    result(sender) {
      return { preview, sender, steps: steps.map(step => ({ ...step })), notes: [...notes], fired: fired.map(item => ({ ...item })) };
    },
  };
  return run;
}

module.exports = { testEventActions, createTestRun, noMatchNote };
