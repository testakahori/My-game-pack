# テスト発火を本番と同じ処理にする Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** テスト発火をアプリ（main）から BRIDGE に渡し、本番と同じ処理・同じ送る列で BridgeMOD へ送る。

**Architecture:** bridge/index.js のイベント処理（ギフト・いいね・シェア・フォロー・訪問・コメント・死亡）を「状態と送り先を ctx で受け取る関数」に分ける。本番は今の状態（liveContext）で、テスト発火は毎回新しい状態の ctx で同じ関数を通す。main は ipc で BRIDGE に問い合わせ、返事から画面の文を作るだけにし、electron/event_tests.cjs と main の送信処理を消す。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（ipc の child_process）、React + TypeScript（画面）。

**Spec:** docs/superpowers/specs/2026-10-16-test-fire-parity-design.md

## Global Constraints

- 返事・コメント・画面の文は日本語。コード中のコメントは周りと同じく日本語で、決めた日付・理由を添える。
- テスト発火は BridgeMOD 経路（Minecraft）のときだけ使える。RCON・7DTD の処理は変えない。
- 本番の結果（BridgeMOD へ送る要求の type・key・count・announce・順番、履歴、ホーム画面の件数）は Task 3 で1つも変えない。
- テストで使う時間: BRIDGE が結果を待つのは最大10秒（`BRIDGE_TEST_FIRE_WAIT_MS` で上書き可、100〜60000）。main が返事を待つのは最大15秒。
- 画面・main の文言は設計書のとおり: 「BRIDGE を起動すると試せます。」「送り直し中（届いたら実行されます）」「ルーレットを回しています（当たりは回したあとに送ります）」「配信の終了で取りやめました」「BridgeMOD が受け付けました」「Minecraft サーバー（BridgeMOD）につながりません。サーバーを起動してから試してください。」「BRIDGE から返事がありません。BRIDGE のログを確認してください。」「BRIDGE が止まったため、結果を受け取れませんでした。」「テスト発火は、Minecraft を BridgeMOD で動かしているときだけ使えます。」
- テストの履歴の行には `source: "test"` を付ける（配信統計に入れない）。テストで送れなかった分はホーム画面の「Modへ送れなかったイベント」に数えない。
- D 側の git は PowerShell で行う。`git add` が Permission denied のときは、先に `git hash-object -w <file>` してから `git add` する。commit メッセージはファイルに書いて `git commit -F <file>` で渡し、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` を付ける。`git stash` は使わない。
- 1つのテストファイルは `node --test electron/test/<name>.test.cjs` で動かす。全体は `npm run verify`（typecheck・test:bridge・test:app・build）。

## Review Focus

1. 配信中（本番のギフト・いいねが送る列に並んでいる）にテスト発火したとき、テストの状態（いいねの累計・マイルストーン・連打）が本番に混ざらないこと → Task 4 の「テスト発火は本番の状態に触らない」で確かめる。
2. 配信終了（streamEnd）でいいねの送る列が捨てられたとき、テストのいいねが「取りやめ」になり、結果を待ち続けないこと → Task 2 の「集計: 送れた・送れなかった・取りやめ」で確かめる。
3. BRIDGE の自動再起動の直後など、子プロセスはあるが ipc の通り道が切れているとき、main が「BRIDGE を起動すると試せます。」を返すこと → Task 5 の最初のテストで確かめる。
4. 名前に記号や改行がある視聴者（`a"b` と改行）でテスト発火したとき、本番と同じく整えた表示名で送ること → Task 4 の「ミュート・コマンド直接・名前」で確かめる。
5. BRIDGE が問い合わせを知らない・返事をしないとき、main が15秒で理由を返し、次のテストを押せること（実行中の印が残らない） → Task 5 の「返事がない」のテストのあとにもう1回押せることで確かめる。

---

### Task 1: コメント投票の締め切りを1つの関数にする（FeatureEngine.finishPoll）

**Files:**
- Modify: `bridge/feature_engine.js`（`startPoll()`、128〜140行目あたり）
- Test: `electron/test/feature-engine-poll.test.cjs`（新規）

**Interfaces:**
- Produces: `FeatureEngine#finishPoll(): void` … 投票を締め切って当選を `emit` し、時間切れのタイマーを止める。投票していなければ何もしない。`startPoll()` の時間切れもこれを呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/feature-engine-poll.test.cjs`:

```js
// コメント投票の締め切りを1つの関数（finishPoll）にする。時間切れでも、テスト発火（すぐ締め切る）でも同じ当選を出す（2026-10-16）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { FeatureEngine } = require('../../bridge/feature_engine.js');

const poll = { enabled: true, durationMs: 5000, options: { '1': 'a.txt', '2': { commandFile: 'b.txt', repeat: 3 } } };

test('すぐ締め切ると、票の多い選択肢を1回だけ出し、あとから時間切れでもう一度出さない', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted = [];
  const engine = new FeatureEngine({ poll }, feature => emitted.push(feature));
  engine.startPoll();
  engine.recordComment('!2', 'A');
  engine.finishPoll();
  assert.deepEqual(emitted, [{ type: 'poll', commandFile: 'b.txt', count: 3, sender: 'コメント投票', label: '!2' }]);
  t.mock.timers.tick(5000);
  assert.equal(emitted.length, 1, '時間切れでもう一度出さない');
  engine.finishPoll();
  assert.equal(emitted.length, 1, '締め切ったあとは何もしない');
});

test('時間切れでも同じ締め切りを通す（票がなければ最初の選択肢）', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const emitted = [];
  const engine = new FeatureEngine({ poll }, feature => emitted.push(feature));
  engine.startPoll();
  t.mock.timers.tick(5000);
  assert.deepEqual(emitted, [{ type: 'poll', commandFile: 'a.txt', count: 1, sender: 'コメント投票', label: '!1' }]);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/feature-engine-poll.test.cjs`
Expected: 1つ目が FAIL（`engine.finishPoll is not a function`）。2つ目は今のコードでも PASS。

- [ ] **Step 3: 実装する**

`bridge/feature_engine.js` の `startPoll()` を次に置き換える:

```js
  startPoll() {
    const poll = this.config.poll;
    if (!poll?.enabled || !poll.options) return;
    this.poll = { options: poll.options, votes: new Map(), voters: new Set() };
    this.pollTimer = setTimeout(() => this.finishPoll(), Math.max(5000, Number(poll.durationMs || 30000)));
    // 投票の締め切りを待つだけで、プロセス（BRIDGE・テストの実行）を終わらせずに残さない。
    this.pollTimer?.unref?.();
  }

  // 投票を締め切って当選を出す。時間切れでも、テスト発火（すぐ締め切る）でも同じ処理を通す（2026-10-16）。
  finishPoll() {
    if (!this.poll) return;
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
    const { options, votes } = this.poll;
    this.poll = null;
    const winner = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || Object.keys(options)[0];
    const chosen = options[winner];
    if (chosen) this.emit({ type: "poll", commandFile: chosen.commandFile || chosen,
      count: Number(chosen.repeat || 1), sender: "コメント投票", label: `!${winner}` });
  }
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test electron/test/feature-engine-poll.test.cjs`
Expected: 2件とも PASS。続けて `npm run test:bridge` も PASS（simulate_events.js が FeatureEngine を使う）。

- [ ] **Step 5: commit**

```powershell
git add bridge/feature_engine.js electron/test/feature-engine-poll.test.cjs
git commit -F <メッセージのファイル>   # 「feat: コメント投票の締め切りを finishPoll にまとめる」
```

---

### Task 2: テスト発火の入力の変換と結果の集計（bridge/test_fire.cjs）

**Files:**
- Create: `bridge/test_fire.cjs`
- Test: `electron/test/test-fire-actions.test.cjs`（新規）

**Interfaces:**
- Produces:
  - `testEventActions(input, { mappedGiftIds: Set<string> }) → { sender: string, actions: Action[], notes: string[] }`。入力が誤っていれば日本語の Error を投げる。
    - `Action` は次のどれか: `{ kind: 'direct', commandFile, count, data }` / `{ kind: 'gift', data: { nickname, giftId, repeatCount, repeatEnd } }` / `{ kind: 'like', data, progress: { previousTotal, total, local: false } }` / `{ kind: 'share' | 'member' | 'roulette', data }` / `{ kind: 'follow', data, followCount }` / `{ kind: 'chat', data: { nickname, comment } }` / `{ kind: 'death', status: { type: 'death', deaths, player } }` / `{ kind: 'poll', data, option }`。`data` は `{ nickname: sender, ... }`。
  - `createTestRun({ preview }) → run`。`run.step(event, extra?) → stepIndex`、`run.mark(event, stepIndex?) → 印つきの event`（`source: 'test'`・`testRun`・`testStep`・`testSend`）、`run.delivered(event)`、`run.failed(event, reason)`、`run.finished(event)`、`run.hold(stepIndex)`、`run.release(stepIndex)`、`run.notice(text)`、`await run.wait(ms)`、`run.result(sender) → { preview, sender, steps, notes, fired }`、`run.preview`、`run.steps`、`run.notes`。
  - `fired` の行: `{ stepIndex, commandFile, count, state: 'delivered' | 'pending' | 'failed' | 'discarded', message }`。
  - `noMatchNote(type) → string`。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/test-fire-actions.test.cjs`:

```js
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

test('何も通らなかったときの注意は種類ごと', () => {
  assert.match(noMatchNote('death'), /デスルーレット/);
  assert.match(noMatchNote('share'), /シェア/);
  assert.match(noMatchNote('unknown'), /条件に一致する有効な設定がありません/);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/test-fire-actions.test.cjs`
Expected: FAIL（`Cannot find module '../../bridge/test_fire.cjs'`）。

- [ ] **Step 3: 実装する**

`bridge/test_fire.cjs`:

```js
// テスト発火（アプリの「イベントテスト」）の入力を、本番の BRIDGE が受け取るイベントと同じ形にする。
// 本番と同じ処理・同じ送る列を通すため、ここでは「何をどの処理に通すか」と、結果の集め方だけを決める（2026-10-16 ユーザーの決定）。
// ファイルも設定ファイルも読まない。

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

// sender は入力の名前（改行だけ空白にする）。表示名に整えるのは本番と同じく BRIDGE の処理の中（getStableSender）。
function testEventActions(input, { mappedGiftIds = new Set() } = {}) {
  if (!input || !TYPES.has(input.type)) throw new Error('対応していないテストイベントです。');
  const type = input.type;
  const sender = String(input.listenerName || '').replace(/[\r\n]+/g, ' ').trim() || 'テスト視聴者';
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

// テスト1回分の手順と結果。送る列の「送れた」「送れなかった」「列から外れた」の知らせを受け、全部終わるか時間切れまで待つ。
function createTestRun({ preview = false } = {}) {
  const steps = [], fired = [], notes = [];
  const open = new Map();    // 手順の番号 → まだ終わっていない数
  const settled = new Set(); // 結果を書いた送信の番号
  let waiting = 0, sendSeq = 0, wake = null;
  const close = stepIndex => {
    open.set(stepIndex, (open.get(stepIndex) || 0) - 1);
    waiting--;
    if (waiting === 0 && wake) wake();
  };
  const row = (event, state, message) => {
    if (settled.has(event.testSend)) return;
    settled.add(event.testSend);
    fired.push({ stepIndex: event.testStep, commandFile: txt(event.commandFile), count: Number(event.count) || 1, state, message });
    close(event.testStep);
  };
  const run = {
    preview, steps, notes,
    // 送る（条件だけ確認では送るはずの）1件を手順に足し、手順の番号を返す。
    step(event, extra = {}) {
      steps.push({ label: event.label || LABELS[event.historyType || event.type] || 'イベント', commandFile: txt(event.commandFile),
        count: Number(event.count) || 1, type: event.historyType || event.type || 'other', ...extra });
      return steps.length - 1;
    },
    // 送る列へ入れるイベントにテストの印を付ける。stepIndex を渡すと、その手順の続き（ルーレットの当たり）として数える。
    mark(event, stepIndex = run.step(event)) {
      open.set(stepIndex, (open.get(stepIndex) || 0) + 1);
      waiting++;
      return { ...event, source: 'test', testRun: run, testStep: stepIndex, testSend: ++sendSeq };
    },
    delivered: event => row(event, 'delivered', 'BridgeMOD が受け付けました'),
    failed: (event, reason) => row(event, 'failed', reason),
    // 送る列から外れた。送れた・送れなかったの知らせがなければ、配信の終了で捨てた分。
    finished: event => row(event, 'discarded', '配信の終了で取りやめました'),
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
```

- [ ] **Step 4: 通ることを確かめる**

Run: `node --test electron/test/test-fire-actions.test.cjs`
Expected: 10件とも PASS。

- [ ] **Step 5: commit**

```powershell
git add bridge/test_fire.cjs electron/test/test-fire-actions.test.cjs
git commit -F <メッセージのファイル>   # 「feat: テスト発火の入力の変換と結果の集計を BRIDGE 側に作る」
```

---

### Task 3: BRIDGE のイベント処理を ctx つきの関数に分ける（本番の動きは変えない）

**Files:**
- Modify: `bridge/index.js`（ルーレットの差し替え `dispatchBridgeEvent`・FeatureEngine・デスルーレット・gift / chat / like / share / follow / member の各 `onTikTok`・いいねのまとめ送り）
- Modify: `electron/test/bridge-minor-fixes.test.cjs`（45行目の正規表現）
- Test: `electron/test/bridge-event-context.test.cjs`（新規）

**Interfaces:**
- Produces（Task 4 が使う。すべて `main()` の中の関数）:
  - `dispatchBridgeEvent(ctx, label, event, opts = {})`
  - `emitFeature(ctx, feature)`
  - `handleGift(ctx, data)`（async）、`handleLikeProgress(ctx, data, progress)`、`handleShare(ctx, data)`、`handleFollow(ctx, data)`、`handleMember(ctx, data)`、`handleChat(ctx, data)`（async）、`handleDeath(ctx, status)`
  - ctx の形: `{ run, log(...args), featureEngine, lastExecAt: Map, streakLastCount: Map, commentGiftLastAt: Map, isDuplicate(key), queueLike(commandFile, count, sender, announce, triggers), sendExtras(extras, sender), rejected(event, error) }`。本番は `liveContext`（`run: null`）。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/bridge-event-context.test.cjs`:

```js
// 本番の処理（ギフト・いいね・シェア・フォロー・訪問・コメント・死亡）は、状態と送り先を ctx で受け取る。
// 本番は liveContext で、テスト発火は毎回新しい状態の ctx で同じ処理を通す（2026-10-16 ユーザーの決定）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8').replace(/\r\n/g, '\n');
const body = name => {
  const start = source.indexOf(`function ${name}(ctx`);
  assert.ok(start >= 0, 'missing ' + name);
  return source.slice(start, source.indexOf('\n  }\n', start));
};
const HANDLERS = ['handleGift', 'handleLikeProgress', 'handleShare', 'handleFollow', 'handleMember', 'handleChat', 'handleDeath', 'emitFeature'];

test('本番の TikTok のイベントは、liveContext を渡して同じ処理を呼ぶ', () => {
  for (const [event, handler] of [['gift', 'handleGift'], ['share', 'handleShare'], ['follow', 'handleFollow'], ['member', 'handleMember'], ['chat', 'handleChat']]) {
    assert.match(source, new RegExp(`onTikTok\\("${event}", async \\(data\\) => ${handler}\\(liveContext, data\\)\\);`), event);
  }
  assert.match(source, /handleLikeProgress\(liveContext, data, progress\);/);
  assert.match(source, /onBridgeModWsMessage = \(status\) => handleDeath\(liveContext, status\);/);
  assert.match(source, /const featureEngine = new FeatureEngine\(options\.gameplay \|\| \{\}, feature => emitFeature\(liveContext, feature\)\);/);
  assert.match(source, /dispatch: event => dispatchBridgeEvent\(liveContext, "like:" \+ event\.commandFile, event\),/);
});

test('処理の中では、状態と送り先を ctx から使う（本番の状態を直接さわらない）', () => {
  for (const name of HANDLERS) {
    const text = body(name);
    assert.doesNotMatch(text, /(?<!ctx\.)featureEngine\./, name + ': featureEngine は ctx から');
    assert.doesNotMatch(text, /(?<!ctx\.)\b(lastExecAt|streakLastCount|commentGiftLastAt)\b/, name + ': 記録は ctx から');
    assert.doesNotMatch(text, /isDuplicateEvent\(|queueLikeEventBatched\(|sendBridgeExec\(|recordDeliveryRejection\(/, name + ': 送り先は ctx から');
  }
  assert.doesNotMatch(source, /dispatchBridgeEvent\((?!ctx, |liveContext, )/, 'dispatchBridgeEvent には必ず ctx を渡す');
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/bridge-event-context.test.cjs`
Expected: FAIL（`missing handleGift` など）。

- [ ] **Step 3: dispatchBridgeEvent に ctx を足す**

`bridge/index.js` の `function dispatchBridgeEvent(label, event, opts = {}) {` の行を次に変える（中身はそのまま）:

```js
  // Mod への発火を一元化：commandFile が roulette（仮想コマンド）ならルーレットに差し替える
  // ctx は本番（liveContext）か、テスト発火の文脈（2026-10-16）。
  function dispatchBridgeEvent(ctx, label, event, opts = {}) {
```

- [ ] **Step 4: FeatureEngine とデスルーレットを ctx つきにする**

「// デスルーレット：Mod からの death 通知（WS）で発動」から `const featureEngine = new FeatureEngine(...)` の閉じ `});` まで（今の 1464〜1490 行目）を、次に置き換える。liveContext を先に作り、デスルーレットをそのあとに置く:

```js
  // 本番の処理（ギフト・いいね・シェア・フォロー・訪問・コメント・死亡）は、状態と送り先を ctx で受け取る。
  // 本番はこの liveContext で、テスト発火は毎回新しい状態で同じ処理を通す（2026-10-16 ユーザーの決定）。
  const liveContext = {
    run: null,
    log: (...args) => console.log(...args),
    lastExecAt, streakLastCount,
    commentGiftLastAt: new Map(), // rule毎の連投クールダウン
    isDuplicate: key => isDuplicateEvent(key),
    // まとめ送りは下（いいねの処理の前）で作る。呼ばれるのは TikTok のイベントが届いてから。
    queueLike: (...args) => queueLikeEventBatched(...args),
    sendExtras: (extras, sender) => { sendBridgeExec(bridgeMod, extras, sender).catch(() => {}); },
    rejected: (event, error) => recordDeliveryRejection(event, error),
  };
  const featureEngine = new FeatureEngine(options.gameplay || {}, feature => emitFeature(liveContext, feature));
  liveContext.featureEngine = featureEngine;

  function emitFeature(ctx, feature) {
    if (!feature?.commandFile) return;
    if (!bridgeMod) {
      console.warn(`[Feature] ${feature.type} skipped: BridgeMod transport is required`);
      return;
    }
    const listenerName = feature.type === "combo"
      ? (ctx.featureEngine.topGifter() || feature.sender) : feature.sender;
    dispatchBridgeEvent(ctx, `feature:${feature.type}`, {
      type: "other", historyType: feature.type || "other", commandFile: feature.commandFile,
      count: clampInt(feature.count, 1, 100, 1),
      listenerName: listenerName || "viewer", announce: true,
    }, { priority: 8 });
  }

  // デスルーレット：Mod からの death 通知（WS）で発動
  onBridgeModWsMessage = (status) => handleDeath(liveContext, status);
  function handleDeath(ctx, status) {
    if (status?.type !== "death") return;
    const rl = deathRouletteCfg;
    if (!rl || rl.enabled !== true) return;
    const deaths = Number(status.deaths || 0);
    const every = clampInt(rl.everyDeaths ?? 1, 1, 1000, 1);
    if (deathRouletteMatches(rl, deaths)) {
      ctx.log(`[DeathRoulette] deaths=${deaths}（${every}回ごと）→ ルーレット始動`);
      runRoulette(() => rl, String(status.player || "player"), "death_roulette");
    }
  }
```

- [ ] **Step 5: ギフトの処理を handleGift にする**

`onTikTok("gift", async (data) => {` を次の2行に変え、対応する閉じ `  });`（TTS の `enqueueSpeech(ttsText, ttsCfg, ttsNgWords);` の2行下）を `  }` に変える:

```js
  onTikTok("gift", async (data) => handleGift(liveContext, data));
  async function handleGift(ctx, data) {
```

本体は動かさず、BridgeMOD へ送る部分だけ次のとおり置き換える（RCON・Telnet の部分のログはそのまま）:

| 今 | 変更後 |
|---|---|
| `console.log(\`[Gift:RAW]` | `ctx.log(\`[Gift:RAW]` |
| `console.log(\`[Gift:SKIP:pre-connection]` | `ctx.log(\`[Gift:SKIP:pre-connection]` |
| `if (isDuplicateEvent(dkey)) {` | `if (ctx.isDuplicate(dkey)) {` |
| `console.log(\`[Gift:SKIP:dedupe]` | `ctx.log(\`[Gift:SKIP:dedupe]` |
| `` `[Gift] (unmapped) id=${giftId}`` を出す `console.log(` | `ctx.log(` |
| `computeStreakDelta(streakLastCount, 'unmapped:'` | `computeStreakDelta(ctx.streakLastCount, 'unmapped:'` |
| `` console.log(`[Gift] (unmapped) -> BridgeMod`` | `` ctx.log(`[Gift] (unmapped) -> BridgeMod`` |
| `` dispatchBridgeEvent(`unmapped:${giftId}`, {`` | `` dispatchBridgeEvent(ctx, `unmapped:${giftId}`, {`` |
| `const last = lastExecAt.get(cooldownKey) \|\| 0;` | `const last = ctx.lastExecAt.get(cooldownKey) \|\| 0;` |
| `lastExecAt.set(cooldownKey, now);` | `ctx.lastExecAt.set(cooldownKey, now);` |
| `` computeStreakDelta(streakLastCount, `${giftId}:`` | `` computeStreakDelta(ctx.streakLastCount, `${giftId}:`` |
| `times = giftTimes(featureEngine.recordGift(` | `times = giftTimes(ctx.featureEngine.recordGift(` |
| BridgeMod へ送るときの `console.log(` （`-> BridgeMod file=${mapping.commandFile}`） | `ctx.log(` |
| `` dispatchBridgeEvent(`gift:${giftId}`, {`` | `` dispatchBridgeEvent(ctx, `gift:${giftId}`, {`` |

- [ ] **Step 6: コメントの処理を handleChat にする**

`const commentGiftLastAt = new Map(); // rule毎の連投クールダウン` の行を消す（liveContext に移した）。`onTikTok("chat", async (data) => {` を次に変え、閉じ `  });`（`enqueueSpeech(readText, ttsCfg, ttsNgWords);` の次の行）を `  }` に変える:

```js
  onTikTok("chat", async (data) => handleChat(liveContext, data));
  async function handleChat(ctx, data) {
```

本体の置き換え:

| 今 | 変更後 |
|---|---|
| `featureEngine.recordComment(text, sender);` | `ctx.featureEngine.recordComment(text, sender);` |
| `const lastAt = commentGiftLastAt.get(ruleKey) \|\| 0;` | `const lastAt = ctx.commentGiftLastAt.get(ruleKey) \|\| 0;` |
| `commentGiftLastAt.set(ruleKey, Date.now());` | `ctx.commentGiftLastAt.set(ruleKey, Date.now());` |
| `` console.log(`[CommentGift]`` | `` ctx.log(`[CommentGift]`` |
| `` dispatchBridgeEvent(`comment:${rule.commandFile}`, {`` | `` dispatchBridgeEvent(ctx, `comment:${rule.commandFile}`, {`` |
| `sendBridgeExec(bridgeMod, extras, sender).catch(() => {});` | `ctx.sendExtras(extras, sender);` |

- [ ] **Step 7: いいねのまとめ送りといいねの処理を分ける**

まとめ送りの `dispatch: event => dispatchBridgeEvent("like:" + event.commandFile, event),` を次に変える:

```js
    dispatch: event => dispatchBridgeEvent(liveContext, "like:" + event.commandFile, event),
```

`onTikTok("like", async (data) => {` から、その閉じ `  });`（Share イベントの見出しの直前）までを次に置き換える。`for (const ev of likeEvents) {` の中は、BridgeMOD の部分の3か所（ログ・まとめ送り・失敗の記録）だけを変え、RCON の部分は今の行をそのまま残す。下のコードの「（ここから…今の行のまま）」の2行は目印で、そこには今の行をそのまま置く（目印の行は残さない）:

```js
  onTikTok("like", async (data) => {
    data = normalizeTikTokEvent(data, 'like');
    if (likesClosed) return;
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (isMuted(data)) return;
    const progress = likeCounter.next(data);
    if (!progress) return;
    handleLikeProgress(liveContext, data, progress);
  });
  // いいねの累計が分かったあとの処理（マイルストーン → いいねの設定）。テスト発火は入力の累計で同じ処理を通す（2026-10-16）。
  function handleLikeProgress(ctx, data, progress) {
    const { total, previousTotal } = progress;
    if (previousTotal === 0 || likeEvents.some(ev => enabledCommand(ev) && Math.floor(total / Number(ev.threshold)) > Math.floor(previousTotal / Number(ev.threshold)))) {
      ctx.log(`[Like:RAW] total=${total} previous=${previousTotal} count=${data.likeCount ?? '(none)'} from=${getStableSender(data)}`);
    }
    ctx.featureEngine.recordLikes(total, getStableSender(data), previousTotal, progress.local);
    for (const ev of likeEvents) {
      // （ここから BridgeMOD の if の前までは今の行のまま）
      if (bridgeMod) {
        const count = triggersToRun * evRepeat;
        ctx.log(
          `[Like] total=${total} threshold=${thresh} newTriggers=${newTriggers} run=${triggersToRun} skipped=${skippedTriggers} repeat=${evRepeat} -> BridgeMod file=${ev.commandFile} count=${count}`
        );
        if (count > 0) {
          // 1つのルールの不備（GAME_MOD の書き間違いなど）で、残りのいいねルールまで止めない。
          try { ctx.queueLike(ev.commandFile, count, sender, announceEnabled && thresh >= 100, triggersToRun); }
          catch (error) { ctx.rejected({ type: "like", commandFile: ev.commandFile, count, listenerName: sender }, error); }
        }
        continue;
      }
      // （ここから RCON の部分は今の行のまま）
    }
  }
```

- [ ] **Step 8: シェア・フォロー・訪問を関数にする**

それぞれ `onTikTok("share", async (data) => {` / `onTikTok("follow", async (data) => {` / `onTikTok("member", async (data) => {` を次に変え、閉じ `  });` を `  }` に変える:

```js
  onTikTok("share", async (data) => handleShare(liveContext, data));
  function handleShare(ctx, data) {
```
```js
  onTikTok("follow", async (data) => handleFollow(liveContext, data));
  function handleFollow(ctx, data) {
```
```js
  onTikTok("member", async (data) => handleMember(liveContext, data));
  function handleMember(ctx, data) {
```

本体の置き換え（BridgeMOD の部分だけ。RCON の部分のログはそのまま）:

| 今 | 変更後 |
|---|---|
| `` console.log(`[Share] from=${sender} -> BridgeMod`` | `` ctx.log(`[Share] from=${sender} -> BridgeMod`` |
| `dispatchBridgeEvent("share", {` | `dispatchBridgeEvent(ctx, "share", {` |
| `featureEngine.recordFollow(sender);` | `ctx.featureEngine.recordFollow(sender);` |
| `` console.log(`[Follow] from=${sender} -> BridgeMod`` | `` ctx.log(`[Follow] from=${sender} -> BridgeMod`` |
| `dispatchBridgeEvent("follow", {` | `dispatchBridgeEvent(ctx, "follow", {` |
| `` console.log(`[Member] join=${sender} -> BridgeMod`` | `` ctx.log(`[Member] join=${sender} -> BridgeMod`` |
| `dispatchBridgeEvent("member", {` | `dispatchBridgeEvent(ctx, "member", {` |

- [ ] **Step 9: 正規表現で本番のコードを見ているテストを合わせる**

`electron/test/bridge-minor-fixes.test.cjs` の45行目:

```js
  assert.match(read('bridge/index.js'), /times = giftTimes\(ctx\.featureEngine\.recordGift\(/, '本番も同じ関数で丸める');
```

- [ ] **Step 10: 通ることを確かめる**

Run: `node --test electron/test/bridge-event-context.test.cjs`
Expected: 2件とも PASS。

Run: `npm run test:bridge; npm run test:app`
Expected: すべて PASS（本番の動きを変えていないので、bridge-live-events・milestones-per-stream・like-backlog-stream-end・storm-roulette-count・bridge-muted-users・bridge-delivery-rejects などがそのまま通る）。落ちたら、置き換え漏れ（`ctx` を渡していない、`liveContext` より前に `featureEngine` を使っている）を探す。

- [ ] **Step 11: commit**

```powershell
git add bridge/index.js electron/test/bridge-event-context.test.cjs electron/test/bridge-minor-fixes.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: BRIDGE のイベント処理を ctx つきの関数に分ける（本番の動きは同じ）」
```

---

### Task 4: BRIDGE がテスト発火を受け、本番と同じ処理で通す

**Files:**
- Modify: `bridge/index.js`（require・`recordDeliveryRejection`・送る列の `delivered`・ルーレット・`dispatchBridgeEvent`・`enqueueMod`・handleGift / handleChat / handleDeath・テスト発火の文脈と問い合わせ）
- Modify: `electron/test/helpers/bridge-fixture.cjs`（`testEvent` を足す）
- Modify: `electron/test/storm-roulette-count.test.cjs`（46〜47行目の正規表現）
- Test: `electron/test/test-fire-parity.test.cjs`（新規）

**Interfaces:**
- Consumes: Task 1 の `finishPoll()`。Task 2 の `testEventActions`・`createTestRun`・`noMatchNote`。Task 3 の `dispatchBridgeEvent(ctx, …)`・`emitFeature`・`handle*`。
- Produces（Task 5 が使う）:
  - BRIDGE は ipc で `{ type: "testEvent", id, input }` を受け、`{ type: "testEventResult", id, result }` を返す。
  - `result` は `{ ok: true, preview, sender, steps: [{ label, commandFile, count, type, roulette? }], notes: string[], fired: [{ stepIndex, commandFile, count, state, message }] }` か `{ ok: false, error: string }`。
  - 履歴の行（`operations-history.json`）は、テストの分に `source: "test"` が付く。
- Fixture: `startBridgeFixture(...)` の戻り値に `testEvent(input) → Promise<result>` を足す（最大20秒待つ。結果は JSON で写した普通のオブジェクト）。

- [ ] **Step 1: fixture に問い合わせの口を足す**

`electron/test/helpers/bridge-fixture.cjs` の `const fakeProcess = Object.assign(new EventEmitter(), { ... });` を次に変える:

```js
  const replies = [];
  const fakeProcess = Object.assign(new EventEmitter(), { argv: ['node', source], env, platform: process.platform, cwd: () => dir,
    exit: code => { throw Error('unexpected exit ' + code); },
    // アプリ（main）との ipc の代わり。BRIDGE からの返事を、ipc と同じく JSON で写してためる。
    send: message => { replies.push(JSON.parse(JSON.stringify(message))); return true; } });
```

`return { dir, requests, ... };` の直前に足し、戻り値に `testEvent` を加える:

```js
  // アプリのテスト発火と同じ問い合わせを送り、返事を待つ（ルーレットの演出は1回2秒ほどかかる）。
  let testId = 0;
  const testEvent = async input => {
    const id = 'fixture-test-' + (++testId);
    fakeProcess.emit('message', { type: 'testEvent', id, input });
    for (let i = 0; i < 1000 && !replies.some(reply => reply.id === id); i++) await wait(20);
    const reply = replies.find(reply => reply.id === id);
    assert.ok(reply, 'Timed out: test event ' + id);
    return reply.result;
  };
  return { dir, requests, logs, emit, until, wait, testEvent, connection: () => connection, setRoomId: id => { roomId = id; } };
```

- [ ] **Step 2: 失敗するテストを書く**

`electron/test/test-fire-parity.test.cjs`:

```js
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
});

test('設定: 保存した直後でも新しいイベント設定で試す。起動時と違う options は注意を出し、起動時の値で試す', async t => {
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
  assert.ok(!fresh.notes.some(note => note.includes('起動し直す')), 'options を変えていなければ注意しない');
  cfg.options.announceEnabled = false;
  fs.writeFileSync(file, JSON.stringify(cfg));
  const changed = await bridge.testEvent({ type: 'share' });
  assert.ok(changed.notes.some(note => note.includes('BRIDGE を起動し直すまで')), changed.notes.join(' / '));
  assert.equal(events(bridge).at(-1).announce, true, 'いまの BRIDGE の設定（起動時のアナウンスあり）で試す');
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
```

- [ ] **Step 3: 失敗を確かめる**

Run: `node --test electron/test/test-fire-parity.test.cjs`
Expected: 最後の1件以外が FAIL（`Timed out: test event fixture-test-1`。BRIDGE が問い合わせに答えない）。最後の1件も FAIL（文がない）。

- [ ] **Step 4: require と履歴の印を足す**

`bridge/index.js` の require の並び（`require("./tiktok_events.cjs")` の次）に足す:

```js
const { testEventActions, createTestRun, noMatchNote } = require("./test_fire.cjs");
```

`function recordDeliveryRejection(event, error) {` の関数全体を次に置き換える:

```js
function recordDeliveryRejection(event, error) {
  // 例外の受け皿から呼ばれるので、記録そのものの失敗で後続の処理を止めない。
  try {
    const reason = deliveryFailureReason(error);
    const commandFile = ensureTxt(event?.commandFile);
    const at = new Date().toISOString(), type = event?.historyType || event?.type || "other";
    // テスト発火の分は、テストの結果と履歴（テストの印つき）にだけ出す。ホーム画面の「送れなかったイベント」には数えない（2026-10-16）。
    const test = event?.source === "test";
    console.error(`[BridgeMod] ${test ? "[Test] " : ""}送れなかったイベント（再送しません）: type=${event?.type || "other"} file=${commandFile} count=${event?.count ?? 1} 理由: ${reason}`);
    appendOperationsHistoryLine(path.join(__dirname, "operations-history.json"), {
      at, type, sender: event?.listenerName || "viewer", commandFile, count: event?.count || 1, ok: false, message: reason,
      ...(test ? { source: "test" } : {}),
    });
    if (test) { event.testRun?.failed(event, reason); return; }
    deliveryRejections.rejected++;
    deliveryRejections.last = { at, type, commandFile, reason };
    updateRuntimeStatus({ delivery: { ...deliveryRejections } });
  } catch (recordError) {
    console.error("[BridgeMod] 送れなかったイベントを記録できませんでした:", recordError?.message || recordError);
  }
}
```

`bridgeEventDelivery` の `delivered: event => {` を次に置き換える:

```js
    delivered: event => {
      markBridgeModAuth(false);
      appendOperationsHistoryLine(path.join(__dirname, "operations-history.json"), {
        at: new Date().toISOString(), type: event.historyType || event.type || "other",
        sender: event.listenerName || "viewer", commandFile: ensureTxt(event.commandFile),
        count: event.count || 1, ok: true,
        // ダイヤ集計用（giftのみ）。diamond は1個あたりの単価、合計は diamond×count。
        ...(event.giftId ? { giftId: String(event.giftId) } : {}),
        ...(Number(event.diamond) > 0 ? { diamond: Number(event.diamond) } : {}),
        // テスト発火の分は配信統計に入れない（アプリは source: "test" の行を数えない）。
        ...(event.source === "test" ? { source: "test" } : {}),
      });
      event.testRun?.delivered(event);
    },
```

- [ ] **Step 5: 送る列とルーレットにテストの印を通す**

`const enqueueMod = event => modDelivery.enqueue(event).catch(() => {});` を次に置き換える:

```js
  // テスト発火の分は、送る列から外れたことを集計へ知らせる（送れた・送れなかったの知らせがなければ、配信の終了で捨てた分）。
  const enqueueMod = event => {
    const pending = modDelivery.enqueue(event).catch(() => {});
    if (event.testRun) pending.then(() => event.testRun.finished(event));
    return pending;
  };
```

`createRouletteRunner({` の `onFrameError: error => {` の中、`console.warn(...)` の次の行に足す:

```js
      // テスト発火のルーレットなら、結果にも書く（演出が出なかった理由を残す。PR #79 の確かめ）。
      rouletteRequests[0]?.run?.notice(`ルーレットの演出を送れなかったため、演出を省いて当たりを送りました: ${error?.message || error}`);
```

`function runRoulette(getConfig, triggerName, historyType, count = 1) {` の関数全体を次に置き換える:

```js
  function runRoulette(getConfig, triggerName, historyType, count = 1, run = null) {
    if (!bridgeMod) return false;
    const spins = rouletteSpins(count);
    // テスト発火のルーレットは1つの手順として数え、回し終えるまで結果を待つ（2026-10-16）。
    const step = run ? run.step({ commandFile: "roulette.txt", count: spins, historyType: historyType || "roulette" }, { roulette: true }) : null;
    if (run) run.hold(step);
    rouletteRequests.push({ getConfig, triggerName, historyType, spins, done: 0, run, step });
    if (!rouletteBusy) nextRouletteSpin();
    // 無効な項目を旧 roulette.txt へ流して成功扱いにしない。
    return true;
  }
```

`nextRouletteSpin()` の中を2か所変える。`const finish = () => { rouletteRequests.shift(); Promise.resolve().then(nextRouletteSpin); };` を:

```js
    const finish = () => {
      rouletteRequests.shift();
      if (request.run) request.run.release(request.step);
      Promise.resolve().then(nextRouletteSpin);
    };
```

当たりを送る `animateRoulette(round, request.triggerName, winner => { enqueueMod({ ... }); })` を:

```js
    animateRoulette(round, request.triggerName, winner => {
      const event = {
        type: "other", historyType: request.historyType || "roulette",
        commandFile: winner.commandFile, count: winner.repeat,
        listenerName: request.triggerName || "roulette", announce: false,
      };
      // テスト発火の当たりは、ルーレットの手順の続きとして数える。
      enqueueMod(request.run ? request.run.mark({ ...event, label: `${winner.label}（${request.done + 1}回目/${request.spins}）` }, request.step) : event);
    })
```

- [ ] **Step 6: dispatchBridgeEvent に「条件だけ確認」とテストの印を足す**

`function dispatchBridgeEvent(ctx, label, event, opts = {}) {` の関数全体を次に置き換える:

```js
  function dispatchBridgeEvent(ctx, label, event, opts = {}) {
    const run = ctx.run;
    if (rouletteCfg?.enabled && commandFileToBridgeKey(event.commandFile) === "roulette") {
      // 条件だけ確認では回さない。回す回数だけ書く。
      if (run?.preview) { run.step({ ...event, label: "ルーレット", count: rouletteSpins(event.count) }, { roulette: true }); return; }
      if (runRoulette(() => rouletteCfg, event.listenerName, event.historyType || "roulette", event.count, run)) return;
    }
    if (run?.preview) { previewEvent(run, event); return; }
    enqueueMod(run ? run.mark(event) : event);
  }
  // 条件だけ確認：送る前の確かめ（名前・コマンドファイル・GAME_MOD）を送るときと同じく通し、通らなければ理由を書く。
  function previewEvent(run, event) {
    const step = run.step(event);
    const commandFile = ensureTxt(event.commandFile);
    let problem = commandFileProblem(commandFile)
      || (fs.existsSync(path.join(commandsDirAbs, commandFile)) ? "" : `コマンドが見つかりません: ${commandFile}`);
    if (!problem) { try { prepareGameEvent(event); } catch (error) { problem = error?.message || String(error); } }
    if (problem) run.notice(`${run.steps[step].label}（${commandFile}）: ${problem}`);
  }
```

- [ ] **Step 7: 見出しを足し、テスト発火では読み上げない・ルーレットを回さない**

handleGift の2か所の `dispatchBridgeEvent(ctx, …, {` の中身に1行ずつ足す（テスト発火の結果の見出しに使う。BridgeMOD へは送らない）:
- `unmapped:${giftId}` の方: `type: "gift",` の次に `label: "未設定ギフト",`
- `gift:${giftId}` の方: `type: "gift",` の次に `label: mapping.name,`

emitFeature の送るイベントに `label: feature.label,` を足す（`announce: true,` の次）。

handleGift の `const randomized = resolveRandomizedMapping(mapping);` の次の行に足す（設計書 6。抽選は送るときと同じく行い、選ばれたものを書く）:

```js
    if (ctx.run && randomized.mapping !== mapping) ctx.run.notice(`ランダム選択: ${randomized.mapping.commandFile}（実行ごとに抽選）`);
```

handleGift の `// TTS 読み上げ（ギフト）` の直前と、handleChat の `const ttsCfg = loadTtsConfig();` の直前に、同じ1行を足す:

```js
    if (ctx.run) return; // テスト発火は読み上げない（読み上げは読み上げ設定のテストで確かめる）
```

handleDeath の `runRoulette(() => rl, String(status.player || "player"), "death_roulette");` を次に置き換える:

```js
      if (ctx.run?.preview) ctx.run.step({ commandFile: "roulette.txt", count: 1, historyType: "death_roulette" }, { roulette: true });
      else runRoulette(() => rl, String(status.player || "player"), "death_roulette", 1, ctx.run);
```

- [ ] **Step 8: テスト発火の文脈と問い合わせを作る**

`function shutdownBridge() {` の直前に足す:

```js
  // --------------------
  // テスト発火（アプリの「イベントテスト」）
  // --------------------
  // 本番と同じ処理・同じ送る列を、本番とは別の新しい状態で通す（2026-10-16 ユーザーの決定）。
  // 本番の状態（クールダウン・連打・コンボ・いいねとフォローの累計）には触らない。
  const TEST_FIRE_WAIT_MS = clampInt(process.env.BRIDGE_TEST_FIRE_WAIT_MS ?? 10000, 100, 60000, 10000);
  const startupOptions = JSON.stringify(options);
  const OPTIONS_CHANGED_NOTE = "設定のうち、ミュート・アナウンス・コンボ・マイルストーン・投票などは、BRIDGE を起動し直すまで本番にもテストにも反映されません。いまの BRIDGE の設定で試しました。";

  function createTestContext(run) {
    let flushLikes = null;
    const ctx = {
      run,
      log: (...args) => console.log("[Test]", ...args),
      lastExecAt: new Map(), streakLastCount: new Map(), commentGiftLastAt: new Map(),
      isDuplicate: () => false,
      sendExtras: (extras, sender) => {
        if (run.preview) return;
        sendBridgeExec(bridgeMod, extras, sender).catch(error => run.notice(`音・粒子を送れませんでした: ${error?.message || error}`));
      },
      rejected: (event, error) => {
        if (run.preview) run.notice(`${ensureTxt(event.commandFile)}: ${error?.message || error}`);
        else recordDeliveryRejection(run.mark(event), error);
      },
      // まとめ送りは待たずに、処理を通し終えたらすぐ送る（まとめ方は本番と同じ）。
      flushLikes: () => { const flush = flushLikes; flushLikes = null; if (flush) flush(); },
    };
    ctx.featureEngine = new FeatureEngine(options.gameplay || {}, feature => emitFeature(ctx, feature));
    ctx.queueLike = createLikeBatcher({
      windowMs: LIKE_BATCH_MS, schedule: flush => { flushLikes = flush; return flush; },
      prepare: run.preview ? (event => event) : prepareGameEvent,
      dispatch: event => dispatchBridgeEvent(ctx, "like:" + event.commandFile, event),
      failed: ctx.rejected,
    });
    return ctx;
  }

  async function runTestAction(ctx, action) {
    const sender = getStableSender(action.data || {});
    switch (action.kind) {
      case "direct": {
        const key = commandFileToBridgeKey(action.commandFile);
        if (key === "roulette" && !rouletteCfg?.enabled) throw new Error("ルーレットが無効です。イベント設定②で有効にして保存してください。");
        if (key !== "roulette" && !fs.existsSync(path.join(commandsDirAbs, action.commandFile))) throw new Error(`コマンドが見つかりません: ${action.commandFile}`);
        return dispatchBridgeEvent(ctx, "test:direct", { type: "gift", commandFile: action.commandFile, count: action.count,
          listenerName: sender, announce: announceEnabled, label: "選んだコマンド" }, { priority: 10 });
      }
      case "gift": return handleGift(ctx, action.data);
      case "like": return handleLikeProgress(ctx, action.data, action.progress);
      case "share": return handleShare(ctx, action.data);
      case "member": return handleMember(ctx, action.data);
      case "follow":
        // 新しいフォローを「入力の人数」人目として数える。
        ctx.featureEngine.followCount = action.followCount - 1;
        return handleFollow(ctx, action.data);
      case "chat": return handleChat(ctx, action.data);
      case "death": return handleDeath(ctx, action.status);
      case "roulette":
        if (!rouletteCfg?.enabled) return;
        return dispatchBridgeEvent(ctx, "test:roulette", { type: "other", historyType: "roulette", commandFile: "roulette.txt",
          count: 1, listenerName: sender, announce: false });
      case "poll": {
        const poll = ctx.featureEngine.config.poll;
        if (!poll?.enabled || !poll.options?.[action.option]) return;
        ctx.featureEngine.startPoll();
        ctx.featureEngine.recordComment(`!${action.option}`, sender);
        return ctx.featureEngine.finishPoll();
      }
    }
  }

  async function runTestEvent(input) {
    if (!bridgeMod) throw new Error("テスト発火は、Minecraft を BridgeMOD で動かしているときだけ使えます。");
    // 保存した直後でも、新しいイベント設定・割り当てで試す（自動の読み直しと同じ確かめを通す）。
    reloadDynamicConfig();
    const { sender, actions, notes } = testEventActions(input, { mappedGiftIds: new Set(mappingById.keys()) });
    const run = createTestRun({ preview: input.preview === true });
    const name = getStableSender({ nickname: sender });
    if (input.type !== "death" && isMuted({ nickname: sender })) {
      run.notice("この視聴者はミュート対象のため発火しません。");
      return run.result(name);
    }
    for (const note of notes) run.notice(note);
    try {
      if (JSON.stringify(JSON.parse(fs.readFileSync(configPath, "utf8")).options || {}) !== startupOptions) run.notice(OPTIONS_CHANGED_NOTE);
    } catch { /* 読めなければ注意を出さない（読み直しのエラーはログに出ている） */ }
    const ctx = createTestContext(run);
    for (const action of actions) await runTestAction(ctx, action);
    ctx.flushLikes();
    if (actions.length && !run.steps.length) run.notice(noMatchNote(input.type));
    if (!run.preview) await run.wait(TEST_FIRE_WAIT_MS);
    return run.result(name);
  }
```

`process.on('message', message => { if (message?.type === 'shutdown') shutdownBridge(); });` の次の行に足す:

```js
  // アプリ（main）からのテスト発火の問い合わせ。結果は同じ id で返す。
  process.on('message', message => {
    if (message?.type !== 'testEvent') return;
    runTestEvent(message.input || {})
      .then(result => ({ ok: true, ...result }), error => ({ ok: false, error: error?.message || String(error) }))
      .then(result => {
        try { process.send?.({ type: 'testEventResult', id: message.id, result }); }
        catch (error) { console.error('[Test] 結果をアプリへ返せませんでした:', error?.message || error); }
      });
  });
```

- [ ] **Step 9: ルーレットの呼び方を見ているテストを合わせる**

`electron/test/storm-roulette-count.test.cjs` の46〜47行目:

```js
  assert.match(source, /runRoulette\(\(\) => rouletteCfg, event\.listenerName, event\.historyType \|\| "roulette", event\.count, run\)/);
  assert.match(source, /runRoulette\(\(\) => rl, String\(status\.player \|\| "player"\), "death_roulette", 1, ctx\.run\)/, 'デスルーレットは1回');
```

- [ ] **Step 10: 通ることを確かめる**

Run: `node --test electron/test/test-fire-parity.test.cjs`
Expected: 15件とも PASS（ルーレットの演出があるので30秒ほどかかる）。

Run: `npm run test:bridge; npm run test:app`
Expected: すべて PASS（main のテスト発火はまだ古い処理のまま動く）。

- [ ] **Step 11: commit**

```powershell
git add bridge/index.js electron/test/helpers/bridge-fixture.cjs electron/test/storm-roulette-count.test.cjs electron/test/test-fire-parity.test.cjs
git commit -F <メッセージのファイル>   # 「feat: BRIDGE がテスト発火を受け、本番と同じ処理・同じ送る列で送る」
```

---

### Task 5: main はテスト発火を BRIDGE へ渡す。古い処理とテストを消す

**Files:**
- Modify: `electron/main.cjs`（17行目と21行目の require、`compactOperationsHistoryIfLarge`・`appendOperationsHistory`、`fireBridgeEventMaybeRoulette` と `mod:testEvent`）
- Delete: `electron/event_tests.cjs`
- Modify: `electron/test/app-regressions.test.cjs`（loadApp の戻り値、185〜224行目の「イベントIPC」、241〜305行目の一時停止のテスト、782〜873行目のルーレット3件）
- Modify: `electron/test/event-tests.test.cjs`、`electron/test/bridge-count-limit.test.cjs`、`electron/test/bridge-minor-fixes.test.cjs`、`electron/test/command-files.test.cjs`、`electron/test/test-result-status.test.cjs`（planTestEvent と main の古いコードを見ている部分）

**Interfaces:**
- Consumes: Task 4 の ipc（`{ type: "testEvent", id, input }` → `{ type: "testEventResult", id, result }`）。
- Produces（Task 6 が使う）: `mod:testEvent` の戻り値 `{ ok, message, matched?, preview?, bridgeStopped?, steps?, notes?, fired? }`。`fired` の行は Task 2 の形。入力の誤り（`result.ok === false`）は例外。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/app-regressions.test.cjs` の `loadApp` の戻り値（`shortenServerWait: ...` の次）に足す:

```js
    // テスト発火を受ける BRIDGE の代わり（ipc の通り道つきの子プロセス）。
    setBridge: child => { context.fixtureBridge = child; vm.runInContext('bridgeProcRef = fixtureBridge; bridgePid = fixtureBridge?.pid || null;', context); },
    shortenTestEventReply: () => vm.runInContext('testEventReplyMs = 50;', context),
```

`loadApp` の関数の次（77行目の Euler のテストの前）に足す:

```js
// テスト発火を受ける偽の BRIDGE。届いた問い合わせを記録し、answer の戻り値を返事として返す（undefined なら返さない）。
function fakeBridge(answer, { connected = true } = {}) {
  const { EventEmitter } = require('node:events');
  const child = new EventEmitter();
  const asked = [];
  Object.assign(child, { pid: 4321, connected, exitCode: null, signalCode: null,
    send(message, callback) {
      asked.push(JSON.parse(JSON.stringify(message)));
      callback?.(null);
      const result = answer(message);
      if (result !== undefined) setImmediate(() => child.emit('message', { type: 'testEventResult', id: message.id, result }));
      return true;
    } });
  return { child, asked };
}
// テスト発火が送る前に読む BridgeMOD の状態（/bridge/status）。
async function bridgeModStatus(t, app, reply = () => ({ ok: true, paused: false })) {
  const http = require('node:http');
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply(req))); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const cfg = JSON.parse(fs.readFileSync(app.configPath)); cfg.options.bridgeModPort = server.address().port;
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  return server;
}
const plainJson = value => JSON.parse(JSON.stringify(value));
```

185〜224行目の「イベントIPC: 条件確認は未送信、全種別の実送信はテスト履歴、部分失敗も報告」のテストを、次の2つに置き換える:

```js
test('テスト発火IPC: BRIDGE が止まっていると試せない。動いていれば入力を BRIDGE へ渡し、返事から文を作る（2026-10-16）', async t => {
  const app = loadApp(t);
  await bridgeModStatus(t, app);
  const stopped = await app.invoke('mod:testEvent', { type: 'share', preview: true });
  assert.deepEqual(plainJson(stopped), { ok: false, bridgeStopped: true, message: 'BRIDGE を起動すると試せます。' });
  // 子プロセスはあっても ipc の通り道が切れている（自動再起動の直後など）ときも同じ。
  app.setBridge(fakeBridge(() => undefined, { connected: false }).child);
  assert.equal((await app.invoke('mod:testEvent', { type: 'share', preview: true })).bridgeStopped, true);
  const steps = [{ label: 'シェア', commandFile: 'qa.txt', count: 1, type: 'share' }, { label: 'ルーレット', commandFile: 'roulette.txt', count: 2, type: 'roulette', roulette: true }];
  const bridge = fakeBridge(message => message.input.preview
    ? { ok: true, preview: true, sender: '検証', steps: steps.slice(0, 1), notes: ['メモ'], fired: [] }
    : { ok: true, preview: false, sender: '検証', steps, notes: [], fired: [
      { stepIndex: 0, commandFile: 'qa.txt', count: 1, state: 'delivered', message: 'BridgeMOD が受け付けました' },
      { stepIndex: 1, commandFile: 'roulette.txt', count: 2, state: 'pending', message: 'ルーレットを回しています（当たりは回したあとに送ります）' },
    ] });
  app.setBridge(bridge.child);
  const preview = await app.invoke('mod:testEvent', { type: 'share', preview: true, listenerName: '検証' });
  assert.equal(preview.ok, true); assert.equal(preview.matched, true); assert.deepEqual(plainJson(preview.notes), ['メモ']);
  assert.equal(preview.message, '1件の設定が条件に一致しました（未送信）。');
  assert.equal(bridge.asked[0].type, 'testEvent');
  assert.deepEqual(bridge.asked[0].input, { type: 'share', preview: true, listenerName: '検証' });
  const fired = await app.invoke('mod:testEvent', { type: 'share', listenerName: '検証' });
  assert.equal(fired.ok, true);
  assert.equal(fired.message, 'BridgeMOD が受け付けた 1件・送り直し中 1件。ゲーム内の結果も確認してください。');
  assert.equal(fired.fired.length, 2);
  assert.deepEqual(plainJson(await app.invoke('operations:history')), [], '履歴は BRIDGE が書く（main は書かない）');
});

test('テスト発火IPC: 入力の誤りは例外。返事がない・途中で BRIDGE が止まった・BridgeMOD につながらないときは理由を返す', async t => {
  const app = loadApp(t);
  const server = await bridgeModStatus(t, app);
  app.shortenTestEventReply();
  app.setBridge(fakeBridge(() => undefined).child);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'share', preview: true }), /BRIDGE から返事がありません/);
  // 返事がなくても実行中の印は残らない（次のテストを押せる）。
  app.setBridge(fakeBridge(() => ({ ok: false, error: 'テストするコメントを入力してください。' })).child);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'comment', preview: true }), /テストするコメントを入力してください/);
  const dying = fakeBridge(() => undefined);
  dying.child.send = (_message, callback) => { callback?.(null); setImmediate(() => dying.child.emit('exit', 1)); return true; };
  app.setBridge(dying.child);
  await assert.rejects(app.invoke('mod:testEvent', { type: 'share', preview: true }), /BRIDGE が止まったため、結果を受け取れませんでした/);
  // BridgeMOD につながらないときは、送る列に入れない（あとでサーバーを起動したときに思いがけず動くため。設計書 7）。
  const asked = fakeBridge(() => ({ ok: true, steps: [], notes: [], fired: [] }));
  app.setBridge(asked.child);
  await new Promise(resolve => server.close(resolve));
  const refused = await app.invoke('mod:testEvent', { type: 'share' });
  assert.equal(refused.ok, false);
  assert.equal(refused.message, 'Minecraft サーバー（BridgeMOD）につながりません。サーバーを起動してから試してください。');
  assert.equal(asked.asked.length, 0);
  // 条件だけ確認は BridgeMOD がなくても使える。
  assert.equal((await app.invoke('mod:testEvent', { type: 'share', preview: true })).ok, true);
  assert.equal(asked.asked.length, 1);
});
```

一時停止のテスト（`test('妨害の一時停止IPC: ...`）の `const app = loadApp(t);` の次に足す。`rejectEvents` を見て、受け付けた／送れなかったを返す偽の BRIDGE:

```js
  // テスト発火は BRIDGE へ渡す（2026-10-16）。rejectEvents のあいだは「送れなかった」と返す。
  app.setBridge(fakeBridge(() => ({ ok: true, steps: [{ label: 'シェア', commandFile: 'qa.txt', count: 1, type: 'share' }], notes: [],
    fired: [rejectEvents
      ? { stepIndex: 0, commandFile: 'qa.txt', count: 1, state: 'failed', message: 'BridgeMODが受け付けませんでした（HTTP 400）' }
      : { stepIndex: 0, commandFile: 'qa.txt', count: 1, state: 'delivered', message: 'BridgeMOD が受け付けました' }] })).child);
```

782〜873行目のルーレットの3つのテスト（「テスト発火のルーレット: 数を3にすると…」「テスト発火: 音・粒子は本番と同じく先に送り…」「テスト発火のルーレット: 演出だけ送れなくても…」）を消す（BRIDGE 側の test-fire-parity と storm-roulette-count で確かめる）。

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/app-regressions.test.cjs`
Expected: 新しい2つが FAIL（古い main は BRIDGE に問い合わせず、`bridgeStopped` を返さない）。

- [ ] **Step 3: main を BRIDGE へ渡す形にする**

`electron/main.cjs`:
- 17行目 `const { prepareRoulette, createRouletteRunner, rouletteSpins } = require("../bridge/roulette.cjs");` を消す。
- 21行目 `const { planTestEvent } = require("./event_tests.cjs");` を消す。
- `function compactOperationsHistoryIfLarge(historyPath) {...}` と `function appendOperationsHistory(row, historyPath = getOperationsHistoryPath()) {...}` を消す（テスト発火の履歴だけが使っていた）。
- 「// 送った分を outcomes に1件ずつ足す。」の行から `mod:testEvent` の閉じ `});` まで（`fireBridgeEventMaybeRoulette` と古い `mod:testEvent`）を、次に置き換える:

```js
// テスト発火は BRIDGE に渡し、本番と同じ処理・同じ送る列を通す（2026-10-16 ユーザーの決定。
// 設計書 docs/superpowers/specs/2026-10-16-test-fire-parity-design.md）。BRIDGE は結果を最大10秒待つので、返事は15秒まで待つ。
let testEventReplyMs = 15000;
function askBridgeTestEvent(input) {
  const child = bridgeProcRef;
  if (!child?.connected) return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let timer = null;
    const onMessage = message => { if (message?.type === "testEventResult" && message.id === id) finish(resolve, message.result); };
    const onExit = () => finish(reject, new Error("BRIDGE が止まったため、結果を受け取れませんでした。"));
    function finish(settle, value) {
      clearTimeout(timer);
      child.off("message", onMessage);
      child.off("exit", onExit);
      settle(value);
    }
    child.on("message", onMessage);
    child.on("exit", onExit);
    timer = setTimeout(() => finish(reject, new Error("BRIDGE から返事がありません。BRIDGE のログを確認してください。")), testEventReplyMs);
    try { child.send({ type: "testEvent", id, input }, error => { if (error) finish(reject, new Error("BRIDGE へ送れませんでした: " + error.message)); }); }
    catch (error) { finish(reject, new Error("BRIDGE へ送れませんでした: " + error.message)); }
  });
}

const BRIDGE_STOPPED_FOR_TEST = { ok: false, bridgeStopped: true, message: "BRIDGE を起動すると試せます。" };
let testEventRunning = false;
ipcMain.handle("mod:testEvent", async (_event, value) => {
  if (testEventRunning) return { ok: false, message: "別のテストを実行中です。完了後にお試しください。" };
  const bridgeCfg = JSON.parse(fs.readFileSync(getConfigPath(), "utf8"));
  assertGameCommands(bridgeCfg, selectableCommandNames(), gameProfiles.list());
  if (value?.type === "gift") assertGameCommands({ gameProfile: bridgeCfg.gameProfile, commandFile: value.commandFile }, selectableCommandNames(), gameProfiles.list());
  if (!bridgeProcRef?.connected) return { ...BRIDGE_STOPPED_FOR_TEST };
  const preview = value?.preview === true;
  testEventRunning = true;
  try {
    // 一時停止中でも待ちに積む。実行は再開まで待つことを結果に書く（2026-10-16）。
    // 読み取りは実行中の印を立てたあとに行う（待っている間に押された2つ目を、同時に動かさない）。
    let paused = false;
    if (!preview) {
      try { paused = (await requestBridgeMod("GET", "/bridge/status", null, bridgeCfg)).paused === true; }
      catch (error) {
        // つながらないときは送らない。止まっている間に送る列へ入れると、あとでサーバーを起動したときに思いがけず動く（設計書 7）。
        // HTTP の応答が返ったとき（403 など）はつながっているので送り、BRIDGE の送り直しに任せる。
        if (!Number.isInteger(error?.status)) return { ok: false, message: "Minecraft サーバー（BridgeMOD）につながりません。サーバーを起動してから試してください。" };
      }
    }
    const result = await askBridgeTestEvent({ ...value, preview });
    if (!result) return { ...BRIDGE_STOPPED_FOR_TEST };
    if (!result.ok) throw new Error(result.error || "テスト発火に失敗しました。");
    const steps = result.steps || [], notes = result.notes || [], fired = result.fired || [];
    if (preview || !steps.length) return {
      ok: true, matched: steps.length > 0, preview: true, steps, notes,
      message: steps.length ? steps.length + "件の設定が条件に一致しました（未送信）。" : "発火する設定はありません。条件・有効設定を確認してください。",
    };
    const count = state => fired.filter(row => row.state === state).length;
    const delivered = count("delivered"), pending = count("pending"), failed = count("failed"), discarded = count("discarded");
    const parts = ["BridgeMOD が受け付けた " + delivered + "件"];
    if (pending) parts.push("送り直し中 " + pending + "件");
    if (failed) parts.push("送れなかった " + failed + "件");
    if (discarded) parts.push("取りやめ " + discarded + "件");
    return { ok: failed === 0 && discarded === 0, matched: true, fired, steps, notes,
      // 送れなかった分は再開しても実行されないので、受け付けた分・送り直し中の分があるときだけ書く。
      message: parts.join("・") + "。ゲーム内の結果も確認してください。" + (paused && delivered + pending > 0 ? " 一時停止中です。再開すると実行されます。" : "") };
  } finally { testEventRunning = false; }
});
```

- [ ] **Step 4: 古いテスト発火の処理とテストを消す**

- `electron/event_tests.cjs` を消す（`git rm electron/event_tests.cjs`）。
- `electron/test/event-tests.test.cjs`: 6行目の `planTestEvent` の require、`fixture` 関数、planTestEvent を使う5つのテスト（「全イベント」「無効・条件未達・ミュート」「ミュート: 設定は生の名前」「いいね: 前後の累計」「不正入力・パス脱出」）を消し、`共有判定` のテストだけ残す。いいねの計算の確かめ（元の68行目）は `共有判定` のテストの最後に移す:

```js
  assert.equal(likeRuleProgress({threshold:100},1000,undefined).triggersToRun,0);
```

  ファイルの先頭は次のとおり（使わなくなった fs・path・os の require も消す）:

```js
// いいね・コメント・死亡の判定（bridge/event_rules.cjs）。テスト発火の入力の変換は test-fire-actions.test.cjs、本番と同じかは test-fire-parity.test.cjs で確かめる（2026-10-16）。
const test = require('node:test');
const assert = require('node:assert/strict');
const { likeRuleProgress, matchingCommentRules, deathRouletteMatches } = require('../../bridge/event_rules.cjs');
```

- `electron/test/bridge-count-limit.test.cjs`: 5行目の planTestEvent の require、`os` の require、「テスト発火も、BridgeMOD 経由なら回数を抑えず…」と「テスト発火は、ギフト数×割当の回数が100を超えても…」の2つのテストを消す（fs・path は残りのテストが使う）。
- `electron/test/bridge-minor-fixes.test.cjs`: 「テスト発火も本番と同じく、時限倍率のあとの回数を四捨五入する」のテストを次に置き換え、「音・粒子とイベントの両方が失敗したら、両方の理由を記録する」のテストを消す:

```js
test('時限倍率のあとの回数は、本番もテスト発火も同じ関数（giftTimes）で四捨五入する（PR #85 レビュー）', () => {
  assert.equal(eventRules.giftTimes(4.5), 5);
  assert.equal(eventRules.giftTimes(1.2), 1);
  assert.equal(eventRules.giftTimes(NaN), 1);
  assert.match(read('bridge/index.js'), /times = giftTimes\(ctx\.featureEngine\.recordGift\(/, '本番も同じ関数で丸める');
});
```

- `electron/test/command-files.test.cjs`: 9行目の planTestEvent の require と、「テスト発火でも本番と同じく使えない名前は送らず…」のテストを消す（test-fire-parity の「条件だけ確認」で確かめる）。
- `electron/test/test-result-status.test.cjs`: 39〜41行目（main の古いコードを見る3行）を消す。

- [ ] **Step 5: 通ることを確かめる**

Run: `node --test electron/test/app-regressions.test.cjs`
Expected: すべて PASS。

Grep ツール（なければ `rg -n`）で `planTestEvent|event_tests|fireBridgeEventMaybeRoulette|appendOperationsHistory\(` を `electron`・`bridge`・`src` から探す。
Expected: 何も出ない。

Run: `npm run test:app`
Expected: すべて PASS。

- [ ] **Step 6: commit**

```powershell
git add electron/main.cjs electron/test/app-regressions.test.cjs electron/test/event-tests.test.cjs electron/test/bridge-count-limit.test.cjs electron/test/bridge-minor-fixes.test.cjs electron/test/command-files.test.cjs electron/test/test-result-status.test.cjs
git rm electron/event_tests.cjs
git commit -F <メッセージのファイル>   # 「feat: テスト発火を BRIDGE へ渡し、main の別の実装を消す」
```

---

### Task 6: 画面（BRIDGE が止まっているとき・結果の出し方）

**Files:**
- Modify: `src/lib/testResult.ts`
- Modify: `src/components/EventTestPanel.tsx`
- Modify: `src/components/OperationsPage.tsx`（383行目）
- Test: `electron/test/test-result-status.test.cjs`

**Interfaces:**
- Consumes: Task 5 の `mod:testEvent` の戻り値。`fired` の行の `message` は BRIDGE が state ごとに決めた文。
- Produces: `stepStatus(fired, index): string`、`stepLines(steps, fired): string[]`、`EventTestPanel({ onTested, bridgeRunning })`。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/test-result-status.test.cjs` の3つのテストと12行目の require を、次に置き換える（先頭の require と compile の行はそのまま）:

```js
const { stepStatus, stepLines } = compiled.exports;
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const accepted = 'BridgeMOD が受け付けました';

test('手順ごとに、その手順の結果だけを見て出し、同じ結果はまとめて回数を添える', () => {
  // 手順0はルーレット3回、手順1は失敗、手順2は回している途中。
  const fired = [
    { stepIndex: 0, state: 'delivered', message: accepted }, { stepIndex: 0, state: 'delivered', message: accepted }, { stepIndex: 0, state: 'delivered', message: accepted },
    { stepIndex: 1, state: 'failed', message: 'HTTP 400' },
    { stepIndex: 2, state: 'pending', message: 'ルーレットを回しています（当たりは回したあとに送ります）' },
  ];
  assert.equal(stepStatus(fired, 0), 'BridgeMOD が受け付けました（3回）');
  assert.equal(stepStatus(fired, 1), 'HTTP 400');
  assert.equal(stepStatus(fired, 2), 'ルーレットを回しています（当たりは回したあとに送ります）');
  assert.equal(stepStatus(fired, 3), '未送信');
  assert.equal(stepStatus(undefined, 0), '未送信');
  assert.equal(stepStatus([{ stepIndex: 0, state: 'delivered', message: accepted }, { stepIndex: 0, state: 'failed', message: 'HTTP 400' }], 0), 'BridgeMOD が受け付けました・HTTP 400');
});

test('同じ内容（見出し・コマンド・回数・結果）の手順が続くときは1行にまとめる（ギフト100個で100行にしない）', () => {
  const steps = [1, 2, 3].map(() => ({ label: 'バラ', commandFile: 'zombie.txt', count: 5 })).concat([{ label: 'コンボ', commandFile: 'combo.txt', count: 1 }]);
  const fired = steps.map((_, stepIndex) => ({ stepIndex, state: 'delivered', message: accepted }));
  assert.deepEqual(stepLines(steps, fired), ['バラ → zombie.txt ×5 / BridgeMOD が受け付けました（×3回）', 'コンボ → combo.txt ×1 / BridgeMOD が受け付けました']);
  assert.deepEqual(stepLines(steps.slice(0, 2), fired.slice(0, 1)), ['バラ → zombie.txt ×5 / BridgeMOD が受け付けました', 'バラ → zombie.txt ×5 / 未送信'], '結果が違えばまとめない');
  assert.deepEqual(stepLines(undefined, undefined), []);
});

test('テスト発火の画面: BRIDGE が止まっていると押せず理由を出す。結果は stepLines で出し、手順 i と結果の i 行目を組にしない', () => {
  const panel = read('src/components/EventTestPanel.tsx');
  assert.match(panel, /export default function EventTestPanel\(\{ onTested, bridgeRunning \}: \{ onTested: \(\) => Promise<void>; bridgeRunning: boolean \}\)/);
  assert.equal((panel.match(/disabled=\{hasChanges \|\| !bridgeRunning\}/g) || []).length, 2, '2つのボタン');
  assert.match(panel, /if \(busy \|\| hasChanges \|\| !bridgeRunning\) return;/);
  assert.match(panel, /\{!bridgeRunning \? <p className="ops-test-note" role="status">BRIDGE を起動すると試せます。<\/p> : null\}/);
  assert.match(panel, /stepLines\(result\.steps, result\.fired\)\.map\(\(line, i\) => <p key=\{i\}>\{line\}<\/p>\)/);
  assert.doesNotMatch(panel, /result\.fired\?\.\[i\]/);
  assert.match(panel, /本番と同じく、元のギフト・いいね・フォロー・コメントの設定も一緒に動きます。/);
  assert.match(panel, /条件確認・発火には BRIDGE の起動が必要です（本番と同じ処理で試します）。/);
  assert.match(read('src/components/OperationsPage.tsx'), /<EventTestPanel onTested=\{refresh\} bridgeRunning=\{bridgeProcess\.running === true\} \/>/);
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/test-result-status.test.cjs`
Expected: FAIL（`stepLines is not a function`、画面の文がない）。

- [ ] **Step 3: testResult.ts を書き換える**

`src/lib/testResult.ts` の全体:

```ts
// テスト発火の結果を手順ごとにまとめる（PR #79 レビュー）。
// 1つの手順から結果が何行も出ることがある（ルーレットは当たりごとに1行）。手順 i と結果の i 行目を組にせず、結果の stepIndex で見る。
// 結果の文（受け付けた・送り直し中・送れなかった理由・取りやめ）は BRIDGE が決める（2026-10-16：テスト発火も本番と同じ送る列を通す）。
export type FiredRow = { stepIndex?: number; state?: 'delivered' | 'pending' | 'failed' | 'discarded'; message: string };
export type TestStep = { label: string; commandFile: string; count: number };

export function stepStatus(fired: FiredRow[] | undefined, index: number): string {
  const rows = (fired || []).filter(row => row.stepIndex === index);
  if (!rows.length) return '未送信';
  // 同じ結果はまとめ、回数を添える（ルーレットの当たりが3回受け付けられたら「…（3回）」）。
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.message, (counts.get(row.message) || 0) + 1);
  return Array.from(counts).map(([message, times]) => (times > 1 ? `${message}（${times}回）` : message)).join('・');
}

// 同じ内容（見出し・コマンド・回数・結果）の手順が続くときは1行にまとめる（ギフト100個で100行にしない）。
export function stepLines(steps: TestStep[] | undefined, fired: FiredRow[] | undefined): string[] {
  const lines: Array<{ text: string; times: number }> = [];
  (steps || []).forEach((step, index) => {
    const text = `${step.label} → ${step.commandFile} ×${step.count} / ${stepStatus(fired, index)}`;
    const last = lines[lines.length - 1];
    if (last && last.text === text) last.times++;
    else lines.push({ text, times: 1 });
  });
  return lines.map(line => (line.times > 1 ? `${line.text}（×${line.times}回）` : line.text));
}
```

- [ ] **Step 4: EventTestPanel と OperationsPage を変える**

`src/components/EventTestPanel.tsx`:
- 4行目: `import { stepLines, type FiredRow, type TestStep } from '../lib/testResult';`
- 13行目: `type Result = { ok: boolean; message: string; notes?: string[]; preview?: boolean; steps?: TestStep[]; fired?: FiredRow[] };`
- 15行目: `export default function EventTestPanel({ onTested, bridgeRunning }: { onTested: () => Promise<void>; bridgeRunning: boolean }) {`
- `fire` の1行目: `if (busy || hasChanges || !bridgeRunning) return;`
- 投票番号の入力（`{type === 'poll' ? ...}`）の次の行に足す:

```tsx
      {['combo', 'like_milestone', 'follow_milestone', 'comment_command'].includes(type) ? <p className="ops-test-note">本番と同じく、元のギフト・いいね・フォロー・コメントの設定も一緒に動きます。</p> : null}
```

- ボタンの行を次に置き換え、その次の行に BRIDGE が止まっているときの文を足す:

```tsx
      <div className="ops-action-row"><button type="button" disabled={hasChanges || !bridgeRunning} className="ops-small-button" onClick={() => fire(true)}>条件だけ確認</button><button type="button" disabled={hasChanges || !bridgeRunning} className="ops-primary-button ops-primary-button--cyan" onClick={() => fire(false)}>{busy ? '確認中…' : type === 'gift' ? '🎁 ギフト発火' : type === 'like' ? '♥ いいね発火' : 'テスト発火'}</button></div>
      {!bridgeRunning ? <p className="ops-test-note" role="status">BRIDGE を起動すると試せます。</p> : null}
```

- 未保存でないときの注意の文（`'条件確認はサーバー停止中でも利用できます。…'`）を次に置き換える:

```tsx
'条件確認・発火には BRIDGE の起動が必要です（本番と同じ処理で試します）。発火には Minecraft サーバーも必要です。実際にコマンドが動きますが、テスト履歴は配信統計に加算しません。'
```

- 結果の表示の `{result.steps?.map((step, i) => <p key={i}>{step.label} → {step.commandFile} ×{step.count} / {stepStatus(result.fired, i)}</p>)}` を次に置き換える:

```tsx
{stepLines(result.steps, result.fired).map((line, i) => <p key={i}>{line}</p>)}
```

`src/components/OperationsPage.tsx` の383行目:

```tsx
      <div hidden={opsTab !== "test"}><EventTestPanel onTested={refresh} bridgeRunning={bridgeProcess.running === true} /></div>
```

- [ ] **Step 5: 通ることを確かめる**

Run: `node --test electron/test/test-result-status.test.cjs`
Expected: 3件とも PASS。

Run: `npm run typecheck`
Expected: エラーなし。

- [ ] **Step 6: commit**

```powershell
git add src/lib/testResult.ts src/components/EventTestPanel.tsx src/components/OperationsPage.tsx electron/test/test-result-status.test.cjs
git commit -F <メッセージのファイル>   # 「feat: テスト発火の画面に BRIDGE の状態と送り直し中の結果を出す」
```

---

### Task 7: 文書を合わせて、全体を確かめる

**Files:**
- Modify: `AGENTS.md`（34行目）
- Modify: `HANDOFF/HANDOFF04.md`（9番の残っている大きい問題）

- [ ] **Step 1: AGENTS.md の古い注意を書き換える**

34行目（「テスト発火と本番の両方を直します。…（`electron/event_tests.cjs`、`electron/main.cjs`）にも同じ処理があります。」）を次に置き換える:

```markdown
- テスト発火は BRIDGE に渡し、本番と同じ処理（`bridge/index.js` の `handleGift` などに ctx を渡す形）を通します（2026-10-16）。本番の処理を直せば、テスト発火にも同じ直しが効きます。テストのときだけの分かれ道（`ctx.run` があるとき）を足すときは、本番の要求が変わらないことを `electron/test/test-fire-parity.test.cjs` で確かめます。
```

- [ ] **Step 2: HANDOFF04 に記録する**

`HANDOFF/HANDOFF04.md` の9番（残っている大きい問題）の「テスト発火と本番の食い違い」の行に、済んだことと PR 番号の欄（PR を作ったあとで番号を入れる）を書く。次にやることの並びから外す。

- [ ] **Step 3: 全体を確かめる**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて PASS。

Grep ツール（なければ `rg -n`）で `TODO|test\.skip|\.only\(` を、このブランチで変えたファイル（`git diff --name-only main...HEAD`）から探す。
Expected: 何も出ない（このブランチで足したものがない）。

- [ ] **Step 4: commit**

```powershell
git add AGENTS.md HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: テスト発火が BRIDGE を通るようになったことを記録する」
```
