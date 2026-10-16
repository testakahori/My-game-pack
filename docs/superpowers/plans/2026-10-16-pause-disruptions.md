# 妨害の一時停止 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配信中の休憩・準備の間だけ、サーバーを動かしたまま妨害を止め、再開したら預かった分を送られた数どおり起こせるようにする（BridgeMOD 1.8.0 とアプリ）。

**Architecture:** BridgeMOD の `/bridge/control` に `pause`・`resume` を足し、止めている間は tick で待ちから取り出す処理（`processQueues`）だけを飛ばす。受付は続ける。アプリは IPC `mod:pause`・`mod:resume` でそれを呼び、画面上部の5秒ごとの `mod:status` で `paused` を読んで、全ページの帯と配信ホームのボタンを出す。BRIDGE は変えない。

**Tech Stack:** Java 17 / Forge 1.20.1（BridgeMOD）、Electron の main（CommonJS）、React + TypeScript（画面）、node:test、使い捨ての Forge サーバーでの実機テスト（`BridgeMod/test/*.cjs`）。

**Spec:** `docs/superpowers/specs/2026-10-16-pause-disruptions-design.md`

## Global Constraints

- BridgeMOD の版は 1.8.0（`BridgeMod/gradle.properties` の `mod_version=1.8.0`）。
- `/bridge/control` の本文：`{"action":"pause"}` → `{"ok":true,"paused":true}`、`{"action":"resume"}` → `{"ok":true,"paused":false}`。どちらも、すでにその状態でも 200。
- 今の `{"action":"discard","type":"like"}` はそのまま。それ以外は今までどおり 400（`{"ok":false,"error":"unsupported"}`）。
- 止めている状態はメモリだけ。`onServerStopping` で false に戻す。
- 状態の JSON に `"paused":true/false` を足す（`statusHead` に入れるので、サーバーで作った状態にも古い状態にも入る）。
- ゲーム内の `/bridge` を止めている間に打つと「[Bridge] 妨害は一時停止中です。再開すると実行されます」と出す。
- 古い BridgeMOD（400）のときのアプリの文言：「BridgeMOD を新しくすると使えます（1.8.0 以上）。」
- 帯の文言：「妨害を一時停止中です。届いた分は預かっています（ギフト N・いいね N・そのほか N）。再開すると順に起きます」
- テスト発火の文言：「一時停止中です。再開すると実行されます。」
- 記録（`logs/stop-requests.log`）の対象の名前：「妨害の一時停止」「妨害の再開」。出どころ：`home:pause`＝「配信ホームの一時停止」、`home:resume`＝「配信ホームの再開」、`banner:resume`＝「一時停止の帯の再開」。
- BRIDGE（`bridge/`）は変えない。
- D 側の git は PowerShell で行う。`git add` が「Permission denied」で止まったら、ファイルごとに `git hash-object -w <ファイル>` を実行してから `git add` し直す。
- MOD のビルドは `BridgeMod` で `.\gradlew.bat build --no-daemon --console=plain "-Dnet.minecraftforge.gradle.check.certs=false"`。

## Review Focus

1. BridgeMOD が止まっている・つながっていないときに一時停止を押す → アプリは理由を出し、帯は出さない（止めたことにしない）。Task 3 の `setDisruptionPause` のテストで押さえる。
2. 古い BridgeMOD（`paused` を返さない）や、サーバーの再起動で一時停止が解けた → 帯は消える。Task 3 の `pauseView` のテストで押さえる。
3. 止めている間に配信が終わる（いいねの待ちを捨てる）→ 預かったいいねも捨てる（10-14 の決定のまま）。Task 1 の実機テストで押さえる。
4. 長い休憩で待ちがいっぱい → 429 を返す（BRIDGE が預かる）。再開したら全部起きる。Task 1 の実機テストで押さえる。
5. 止めている間にテスト発火を押す → 実行は再開まで待つと分かる文言が出る。Task 2 のテストで押さえる。

---

### Task 1: BridgeMOD 1.8.0 の一時停止・再開

**Files:**
- Modify: `BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java`（フィールド、`onServerStopping`、`onServerTick`、`runKey`、`handleBridgeControl`、`statusHead`）
- Modify: `BridgeMod/gradle.properties`（`mod_version=1.8.0`）
- Create: `electron/test/bridgemod-pause.test.cjs`（ソースを読むテスト）
- Create: `BridgeMod/test/pause.cjs`（実機テスト）
- Modify: `BridgeMod/test/README.md`、`docs/BridgeMODとゲーム切替.md`、`docs/ゲームMOD連携API_v1.4.md`

**Interfaces:**
- Produces：`POST /bridge/control` に `{"action":"pause"}`・`{"action":"resume"}`。`GET /bridge/status` と WebSocket の状態に `"paused":true/false`。

- [ ] **Step 1: ソースを読むテストを書く**

`electron/test/bridgemod-pause.test.cjs`：

```js
// 妨害の一時停止（BridgeMOD 1.8.0、2026-10-16 ユーザーの決定。アプリレビュー 2026-10-08 P6 の残り）。
// 休憩・準備の間だけ止め、届いた分は預かって、再開したら送られた数どおり起こす。動きは実機テスト BridgeMod/test/pause.cjs で確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
const mod = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java');
const body = signature => {
  const start = mod.indexOf(signature);
  assert.ok(start >= 0, 'missing ' + signature);
  return mod.slice(start, mod.indexOf('\n    }\n', start));
};

test('止めている間は、待ちから取り出して実行する処理だけを飛ばす（始まっている演出・固定環境・状態の送信は続ける）', () => {
  assert.match(mod, /private volatile boolean paused;/);
  const tick = body('public void onServerTick(');
  assert.match(tick, /if \(!paused && hasQueuedEvents\(\)\) BlockProtection\.runProtected\(activeServer, "bridgemod", this::processQueues\);/);
  assert.match(tick, /giftEffects\.tick\(activeServer\);/);
  assert.match(tick, /environment\.apply\(activeServer, giftEffects\);/);
  // サーバーを止めたら解く（再起動すると止めていない状態で始まる）。
  assert.match(body('public void onServerStopping('), /paused = false;/);
});

test('/bridge/control で止める・再開する。2回押しても 200。いいねの待ちを捨てる指示は今までどおり', () => {
  const control = body('private void handleBridgeControl(');
  assert.match(control, /if \("pause"\.equals\(action\) \|\| "resume"\.equals\(action\)\) \{\s*paused = "pause"\.equals\(action\);/);
  assert.match(control, /"\{\\"ok\\":true,\\"paused\\":" \+ paused \+ "\}"/);
  assert.match(control, /if \(!"discard"\.equals\(action\) \|\| !"like"\.equals\(type\)\)/);
  // pause・resume は type を付けずに送る。
  assert.match(control, /type = data\.has\("type"\) \? data\.get\("type"\)\.getAsString\(\) : "";/);
});

test('状態に paused を出す（サーバーで作った状態にも、古い状態にも入る）', () => {
  assert.match(body('private String statusHead('), /\\"paused\\":" \+ paused/);
});

test('ゲーム内の /bridge は止めている間も待ちに積み、再開すると実行されると知らせる', () => {
  assert.match(body('private int runKey('), /if \(paused\) source\.sendSuccess\(\(\) -> Component\.literal\("\[Bridge\] 妨害は一時停止中です。再開すると実行されます"\), false\);/);
});

test('BridgeMOD 1.8.0 以上', () => {
  const [major, minor] = read('BridgeMod/gradle.properties').match(/^mod_version=(\d+)\.(\d+)\.(\d+)$/m).slice(1).map(Number);
  assert.ok(major > 1 || major === 1 && minor >= 8, 'BridgeMOD 1.8.0 以上');
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `node --test electron/test/bridgemod-pause.test.cjs`
Expected: 5件とも FAIL（`private volatile boolean paused;` がない など）。

- [ ] **Step 3: BridgeMOD に一時停止を足す**

`BridgeMod.java` のフィールド（`private volatile String lastStatusRest` の近く）に：

```java
    // 妨害の一時停止（休憩・準備の間だけ止める。2026-10-16 ユーザーの決定）。メモリだけに持ち、サーバーを止めたら解く。
    // 受付（HTTP）は続け、待ちから取り出して実行することだけを止める。
    private volatile boolean paused;
```

`onServerStopping` の先頭（`activeServer = null;` の次）に：

```java
        paused = false;
```

`onServerTick` の待ちの処理の行を置き換える：

```java
        // 妨害のコマンド（txt と /bridge/exec）は、実行のあとで変わったコマンドブロックを中身ごと戻す（BlockProtection）。
        // 一時停止の間は待ちから取り出さない（始まっている演出・固定環境・状態の送信は続ける）。
        if (!paused && hasQueuedEvents()) BlockProtection.runProtected(activeServer, "bridgemod", this::processQueues);
```

`runKey` の `if (!enqueueBridgeEvent(event)) { ... }` のあと、`return 1;` の前に：

```java
        if (paused) source.sendSuccess(() -> Component.literal("[Bridge] 妨害は一時停止中です。再開すると実行されます"), false);
```

`handleBridgeControl` を置き換える（コメントも更新）：

```java
    // 待ち列への指示（トークンが必要）。
    // - いいねの待ちを捨てる（配信が終わったとき。2026-10-14 ユーザーの決定）。ギフト・そのほかの待ちは捨てない。
    // - 妨害の一時停止・再開（休憩・準備の間だけ止める。2026-10-16 ユーザーの決定）。
    private void handleBridgeControl(HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            sendHttp(exchange, 405, "{\"ok\":false,\"error\":\"method_not_allowed\"}");
            return;
        }
        String action, type;
        try {
            com.google.gson.JsonObject data = com.google.gson.JsonParser.parseString(readHttpBody(exchange)).getAsJsonObject();
            action = data.get("action").getAsString();
            type = data.has("type") ? data.get("type").getAsString() : "";
        } catch (Exception e) {
            sendHttp(exchange, 400, "{\"ok\":false,\"error\":\"bad_request\"}");
            return;
        }
        if ("pause".equals(action) || "resume".equals(action)) {
            paused = "pause".equals(action);
            System.out.println("[Bridge] disruptions " + (paused ? "paused" : "resumed"));
            sendHttp(exchange, 200, "{\"ok\":true,\"paused\":" + paused + "}");
            return;
        }
        if (!"discard".equals(action) || !"like".equals(type)) {
            sendHttp(exchange, 400, "{\"ok\":false,\"error\":\"unsupported\"}");
            return;
        }
        int discarded = discardLikeQueue();
        System.out.println("[Bridge] discarded " + discarded + " queued like event(s)");
        sendHttp(exchange, 200, "{\"ok\":true,\"discarded\":" + discarded + "}");
    }
```

`statusHead` を、`paused` を読むインスタンスのメソッドにする（`static` を外す）：

```java
    private String statusHead(int gift, int like, int other) {
        return "{\"ok\":true,\"mod\":\"bridgemod\",\"environmentFixed\":true,\"paused\":" + paused
            + ",\"gift\":" + gift + ",\"like\":" + like + ",\"other\":" + other;
    }
```

`BridgeMod/gradle.properties`：`mod_version=1.7.6` を `mod_version=1.8.0` にする。

- [ ] **Step 4: ソースを読むテストが通ることを確かめる**

Run: `node --test electron/test/bridgemod-pause.test.cjs electron/test/bridgemod-threads.test.cjs electron/test/like-backlog-stream-end.test.cjs`
Expected: PASS。

- [ ] **Step 5: 実機テストを書く**

`BridgeMod/test/pause.cjs`：

```js
// 妨害の一時停止（BridgeMOD 1.8.0、2026-10-16 ユーザーの決定）。使い捨てのサーバーで確かめる。使い方は README.md の「妨害の一時停止」。
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { bridgeFetch } = require('./bridge-http.cjs');
const { Rcon } = require('rcon-client');
const mineflayer = require('mineflayer');
const root = process.env.GIFT_QA_SERVER;
if (!root || JSON.parse(fs.readFileSync(path.join(root, 'gift-qa-marker.json'))).purpose !== 'disposable-gift-effects-test') throw Error('Dedicated disposable QA server marker required');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'server.properties'), 'utf8').split(/\r?\n/).filter(s => s.includes('=')).map(s => [s.slice(0, s.indexOf('=')), s.slice(s.indexOf('=') + 1)]));
if (props['server-ip'] !== '127.0.0.1' || props['server-port'] !== '25587' || props['rcon.port'] !== '25588') throw Error('Isolated loopback QA ports required');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const base = 'http://127.0.0.1:25578';
const status = async () => (await bridgeFetch(base + '/bridge/status')).json();
const post = (url, body) => bridgeFetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function wait(fn, ms = 60000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(200); } throw Error('Timed out'); }
const only = process.argv.find(a => a.startsWith('--only='))?.slice('--only='.length);
let rcon, bot;
const results = [];
async function test(name, fn) {
  if (only && !name.includes(only)) return;
  console.log('TEST', name);
  const info = await fn();
  results.push({ name, passed: true, info });
  console.log('PASS', name, JSON.stringify(info));
}
const score = async who => Number((await rcon.send(`scoreboard players get #${who} qapause`)).match(/has (\d+)/)?.[1] || 0);
const control = async action => { const r = await post('/bridge/control', { action }); const body = await r.json(); return { status: r.status, body }; };
const event = async (type, count) => { const r = await post('/bridge/event', { type, key: 'qa_pause', count, listenerName: 'QA', announce: false }); await r.text(); return r.status; };

(async () => {
  await wait(async () => { try { return (await status()).ok; } catch { return false; } }, 120000);
  rcon = await Rcon.connect({ host: '127.0.0.1', port: 25588, password: props['rcon.password'], timeout: 60000 });
  await rcon.send('scoreboard objectives add qapause dummy');
  const dir = path.join(root, 'bridge', 'commands', 'minecraft');
  fs.writeFileSync(path.join(dir, 'qa_pause.txt'), '# TITLE: qa pause\nscoreboard players add #pause qapause 1\n');

  await test('一時停止と再開は /bridge/control で切り替わり、2回押しても 200。状態に paused が出る', async () => {
    assert.deepEqual(await control('pause'), { status: 200, body: { ok: true, paused: true } });
    assert.deepEqual(await control('pause'), { status: 200, body: { ok: true, paused: true } });
    assert.equal((await status()).paused, true);
    assert.deepEqual(await control('resume'), { status: 200, body: { ok: true, paused: false } });
    assert.deepEqual(await control('resume'), { status: 200, body: { ok: true, paused: false } });
    assert.equal((await status()).paused, false);
    return { toggled: true };
  });

  await test('止めている間は、ギフト・いいね・そのほか・/bridge/exec・ゲーム内の /bridge を実行せずに預かり、再開したら送った数どおり実行する', async () => {
    await rcon.send('scoreboard players set #pause qapause 0');
    await rcon.send('scoreboard players set #exec qapause 0');
    await control('pause');
    assert.equal(await event('gift', 3), 202);
    assert.equal(await event('like', 4), 202);
    assert.equal(await event('other', 5), 202);
    const exec = await post('/bridge/exec', { listenerName: 'QA', commands: ['scoreboard players add #exec qapause 1'] });
    assert.equal(exec.status, 202); await exec.text();
    const said = await rcon.send('bridge qa_pause 2');
    assert.match(said, /一時停止中/);
    await sleep(2000);
    assert.equal(await score('pause'), 0, '止めている間は実行しない');
    assert.equal(await score('exec'), 0);
    const held = await status();
    assert.ok(held.gift >= 1 && held.like >= 1 && held.other >= 3, JSON.stringify({ gift: held.gift, like: held.like, other: held.other }));
    await control('resume');
    await wait(async () => await score('pause') === 3 + 4 + 5 + 2 && await score('exec') === 1, 20000);
    await sleep(1000);
    assert.equal(await score('pause'), 14, '余分に実行しない');
    return { held: { gift: held.gift, like: held.like, other: held.other } };
  });

  await test('止めている間に配信が終わったら、預かったいいねは捨てる（10-14 の決定のまま）', async () => {
    await rcon.send('scoreboard players set #pause qapause 0');
    await control('pause');
    assert.equal(await event('like', 10), 202);
    const discard = await post('/bridge/control', { action: 'discard', type: 'like' });
    assert.equal(discard.status, 200); await discard.text();
    assert.equal((await status()).like, 0);
    await control('resume');
    await sleep(2000);
    assert.equal(await score('pause'), 0);
    return { discarded: true };
  });

  await test('止めている間に待ちがいっぱいになったら 429 を返し、再開したら預かった分は全部実行する', async () => {
    await rcon.send('scoreboard players set #pause qapause 0');
    await control('pause');
    let accepted = 0, refused = 0;
    for (let i = 0; i < 300 && refused === 0; i++) { const s = await event('other', 1); if (s === 202) accepted++; else if (s === 429) refused++; }
    assert.equal(refused, 1, '待ちがいっぱいなら 429');
    await control('resume');
    await wait(async () => await score('pause') === accepted, 60000);
    return { accepted };
  });

  await test('始まっている演出は、止めても最後まで続く', async () => {
    bot = mineflayer.createBot({ host: '127.0.0.1', port: 25587, username: 'QAPause', auth: 'offline', version: '1.20.1', viewDistance: 'tiny' });
    await new Promise((resolve, reject) => { bot.once('spawn', resolve); bot.once('error', reject); bot.once('kicked', reason => reject(Error('kicked: ' + reason))); });
    await rcon.send('effect give QAPause minecraft:resistance 1000000 255 true');
    const r = await post('/bridge/event', { type: 'gift', key: 'anvildrop', count: 1, listenerName: 'QA', announce: false });
    assert.equal(r.status, 202); await r.text();
    await wait(async () => (await status()).effectsPending > 0, 10000);
    await control('pause');
    await wait(async () => (await status()).effectsPending === 0, 60000);
    await control('resume');
    return { finishedWhilePaused: true };
  });

  fs.writeFileSync(path.join(root, 'pause-results.json'), JSON.stringify({ results }, null, 2));
  console.log(`pause: ${results.length} tests passed`);
  bot?.quit();
  await rcon.end();
})().catch(error => { console.error(error); process.exitCode = 1; bot?.quit(); process.exit(1); });
```

- [ ] **Step 6: 直す前の BridgeMOD（1.7.6）で失敗することを確かめる**

直す前の BridgeMOD として `BridgeMod/build/libs/bridgemod-1.7.6.jar`（main と同じ、PR #98 の最後のビルド。1.8.0 をビルドしても別の名前なので残る）を使い捨てサーバーに入れ、`node pause.cjs` を流す。`GIFT_QA_SERVER` を設定し、検証用の `BridgeMod/build/qa/environment-probe.jar` と `DisplayMod/build/libs/displaymod-1.1.0.jar` も入れる（手順は README の「状態と WebSocket の送信」と同じ）。サーバーが起動して `/bridge/status` と RCON が応えるまで待ってから流す。
Expected: 最初のテストで FAIL（`pause` が 400）。

- [ ] **Step 7: 1.8.0 をビルドして、実機テストが通ることを確かめる**

Run: `BridgeMod` で `.\gradlew.bat build ...`（Global Constraints のとおり）→ `bridgemod-1.8.0.jar` を使い捨てサーバーに入れて `node pause.cjs`。あわせて `node like-backlog.cjs`、`node status-threads.cjs`、`node game-integration.cjs` も流す（サーバーは起動を待ってから流す）。
Expected: `pause: 5 tests passed`、ほかもすべて PASS。

- [ ] **Step 8: 説明を書く**

`BridgeMod/test/README.md` の末尾に：

```markdown
## 妨害の一時停止（2026-10-16）

`node pause.cjs` は、BridgeMOD 1.8.0 の妨害の一時停止を確かめます。上と同じマーカー・ポート・GIFT_QA_SERVER を使います。テストが `bridge/commands/minecraft/qa_pause.txt` を書き、ボット（QAPause）を接続します。

- `/bridge/control` の `pause`・`resume` で切り替わり、2回押しても 200。状態に `paused` が出る。
- 止めている間は、ギフト・いいね・そのほか・`/bridge/exec`・ゲーム内の `/bridge` を実行せずに預かる。再開したら送った数どおり実行する。
- 止めている間に配信が終わったら、預かったいいねは捨てる。
- 止めている間に待ちがいっぱいになったら 429 を返す。再開したら預かった分は全部実行する。
- 始まっている演出は、止めても最後まで続く。

結果はサーバールートの `pause-results.json` に保存します。`--only=<名前の一部>` で1件だけ実行できます。
```

`docs/BridgeMODとゲーム切替.md` の BridgeMOD 1.7.6 の箇条書きの下に：

```markdown
- BridgeMOD 1.8.0 から（2026-10-16 ユーザーの決定。アプリレビュー 2026-10-08 の P6 の残り）、妨害を一時停止できる。
  - `/bridge/control` に `{"action":"pause"}`・`{"action":"resume"}` を送る（トークンが必要）。止めている間は、待ちから取り出して実行することだけを止める。受付は続け、待ちに積む。待ちがいっぱいなら 429（Bridge が預かって送り直す）。
  - 始まっている演出・固定環境・状態の送信は続ける。状態に `"paused"` が出る。止めている状態はメモリだけで、サーバーを止めると解ける。
  - アプリは配信ホームのボタンで止め、止めている間はどのページにも帯を出す。
```

`docs/ゲームMOD連携API_v1.4.md` の「状態の取得と登録（BridgeMOD 1.7.6 から…）」の節の箇条書きの最後に：

```markdown
- BridgeMOD 1.8.0 から、配信者が妨害を一時停止している間は、BridgeMOD はゲームMODへ要求を渡しません。要求は BridgeMOD の待ちに残り、再開したあとに順に渡します。requestId と gameSessionId は変わりません。ゲームMOD自身の待ちにすでに入った分は、ゲームMOD側で動きます。
```

- [ ] **Step 9: コミット**

```powershell
git add BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java BridgeMod/gradle.properties electron/test/bridgemod-pause.test.cjs BridgeMod/test/pause.cjs BridgeMod/test/README.md "docs/BridgeMODとゲーム切替.md" "docs/ゲームMOD連携API_v1.4.md"
git commit -m "feat: BridgeMOD 1.8.0 で妨害を一時停止・再開できるようにする（アプリレビュー P6 の残り）"
```

---

### Task 2: アプリの main（IPC・記録・テスト発火の文言）

**Files:**
- Modify: `electron/stop_requests.cjs`（`STOP_ORIGINS`・`TARGETS`）
- Modify: `electron/main.cjs`（`requestBridgeMod` の失敗に `status` を付ける、`setDisruptionPause`、IPC `mod:pause`・`mod:resume`、`mod:testEvent` の文言）
- Modify: `electron/preload.cjs`（`modPause`・`modResume`）
- Modify: `src/types/electron.d.ts`（`PauseOrigin`）
- Test: `electron/test/stop-requests.test.cjs`、`electron/test/app-regressions.test.cjs`

**Interfaces:**
- Consumes：Task 1 の `/bridge/control`（`pause`・`resume`）と `/bridge/status` の `paused`。
- Produces：IPC `mod:pause(origin: PauseOrigin)`・`mod:resume(origin: PauseOrigin)` → `{ ok: true, paused: boolean } | { ok: false, message: string }`。preload の `modPause(origin)`・`modResume(origin)`。型 `export type PauseOrigin = "home:pause" | "home:resume" | "banner:resume";`

- [ ] **Step 1: 記録のテストを足す**

`electron/test/stop-requests.test.cjs` の末尾に：

```js
test('妨害の一時停止・再開も、出どころ付きで同じ記録に残す（2026-10-16）', t => {
  assert.equal(stopOriginLabel('home:pause'), '配信ホームの一時停止');
  assert.equal(stopOriginLabel('home:resume'), '配信ホームの再開');
  assert.equal(stopOriginLabel('banner:resume'), '一時停止の帯の再開');
  const file = path.join(tempDir(t), 'stop-requests.log');
  const log = createStopRequestLog({ file: () => file, now: () => at });
  log.record('pause', 'home:pause');
  log.record('resume', 'banner:resume');
  assert.equal(fs.readFileSync(file, 'utf8'),
    '2026-10-10 03:44:01.662 妨害の一時停止 ← 配信ホームの一時停止\n' +
    '2026-10-10 03:44:01.662 妨害の再開 ← 一時停止の帯の再開\n');
  const declared = fs.readFileSync(path.resolve(__dirname, '../../src/types/electron.d.ts'), 'utf8').match(/export type PauseOrigin = ([^;]+);/);
  assert.ok(declared, 'PauseOrigin の型がある');
  const names = [...declared[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(names.sort(), ['banner:resume', 'home:pause', 'home:resume']);
});
```

- [ ] **Step 2: IPC とテスト発火のテストを足す**

`electron/test/app-regressions.test.cjs` の「Mod状態IPC」のテストのあとに：

```js
test('妨害の一時停止IPC: /bridge/control へ送り、出どころを記録する。古い BridgeMOD（400）では新しくするよう伝える。止めている間のテスト発火には文言を足す', async t => {
  const http = require("node:http");
  const received = [];
  let supported = true, paused = false;
  const server = http.createServer((req, res) => {
    const chunks = []; req.on("data", c => chunks.push(c)); req.on("end", () => {
      const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      received.push({ method: req.method, url: req.url, payload });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/bridge/control" && !supported) { res.statusCode = 400; res.end('{"ok":false,"error":"unsupported"}'); return; }
      if (req.url === "/bridge/control") { paused = payload.action === "pause"; res.end(JSON.stringify({ ok: true, paused })); return; }
      if (req.url === "/bridge/status") { res.end(JSON.stringify({ ok: true, paused, gameSessions: {} })); return; }
      res.end('{"ok":true}');
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const app = loadApp(t);
  const cfg = JSON.parse(fs.readFileSync(app.configPath));
  cfg.options.bridgeModPort = server.address().port;
  cfg.shareEvent = { commandFile: "qa.txt", enabled: true, repeat: 1 };
  fs.writeFileSync(app.configPath, JSON.stringify(cfg));
  fs.writeFileSync(path.join(app.root, "bridge", "commands", "minecraft", "qa.txt"), "say test");
  const logFile = path.join(app.root, "logs", "stop-requests.log");

  assert.deepEqual(await app.invoke("mod:pause", "home:pause"), { ok: true, paused: true });
  assert.deepEqual(received.at(-1), { method: "POST", url: "/bridge/control", payload: { action: "pause" } });
  const fired = await app.invoke("mod:testEvent", { type: "share" });
  assert.match(fired.message, /一時停止中です。再開すると実行されます。/);
  assert.deepEqual(await app.invoke("mod:resume", "banner:resume"), { ok: true, paused: false });
  assert.doesNotMatch((await app.invoke("mod:testEvent", { type: "share" })).message, /一時停止中/);
  const lines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
  assert.match(lines[0], /妨害の一時停止 ← 配信ホームの一時停止$/);
  assert.match(lines[1], /妨害の再開 ← 一時停止の帯の再開$/);

  supported = false;
  assert.deepEqual(await app.invoke("mod:pause", "home:pause"), { ok: false, message: "BridgeMOD を新しくすると使えます（1.8.0 以上）。" });
  server.close();
  await new Promise(resolve => server.once("close", resolve));
  const offline = await app.invoke("mod:resume", "home:resume");
  assert.equal(offline.ok, false);
  assert.ok(offline.message.length > 0, "つながらないときは理由を返す");
});
```

- [ ] **Step 3: 失敗することを確かめる**

Run: `node --test electron/test/stop-requests.test.cjs electron/test/app-regressions.test.cjs`
Expected: 新しい2件が FAIL（`配信ホームの一時停止` がない、`mod:pause` の handler がない）。

- [ ] **Step 4: 記録の名前を足す**

`electron/stop_requests.cjs` の `STOP_ORIGINS` に足す：

```js
  'home:pause': '配信ホームの一時停止',
  'home:resume': '配信ホームの再開',
  'banner:resume': '一時停止の帯の再開',
```

`TARGETS` を置き換える：

```js
const TARGETS = Object.freeze({ server: 'サーバー停止', bridge: 'BRIDGE停止', pause: '妨害の一時停止', resume: '妨害の再開' });
```

ファイル先頭のコメントの1行目を「サーバー・BRIDGE の停止と、妨害の一時停止・再開を、出どころ（どのボタン・操作から来たか）付きで記録する。」にする。

- [ ] **Step 5: main に IPC を足す**

`requestBridgeMod` の 400 以上の行を、状態コードを付けて返す形に置き換える：

```js
        else if (res.statusCode >= 400 || parsed.ok === false) reject(Object.assign(new Error(parsed.message || `HTTP ${res.statusCode}`), { status: res.statusCode }));
```

`ipcMain.handle("mod:status", ...)` のあとに：

```js
// 妨害の一時停止・再開（BridgeMOD 1.8.0 の /bridge/control。2026-10-16 ユーザーの決定）。停止と同じく出どころを記録する。
async function setDisruptionPause(pause, origin) {
  stopRequests.record(pause ? "pause" : "resume", origin);
  try {
    const result = await requestBridgeMod("POST", "/bridge/control", { action: pause ? "pause" : "resume" });
    return { ok: true, paused: result.paused === true };
  } catch (error) {
    if (error?.status === 400) return { ok: false, message: "BridgeMOD を新しくすると使えます（1.8.0 以上）。" };
    return { ok: false, message: error?.message || String(error) };
  }
}
ipcMain.handle("mod:pause", (_event, origin) => setDisruptionPause(true, origin));
ipcMain.handle("mod:resume", (_event, origin) => setDisruptionPause(false, origin));
```

`mod:testEvent` の `testEventRunning = true;` の直前に：

```js
  // 一時停止中でも待ちに積む。実行は再開まで待つことを結果に書く（2026-10-16）。
  let paused = false;
  try { paused = (await requestBridgeMod("GET", "/bridge/status", null, bridgeCfg)).paused === true; } catch { /* 送る段階で失敗を報告する */ }
```

同じハンドラーの最後の `return` の `message` を置き換える：

```js
      message: fired.length + "件中" + succeeded + "件をModへ送信しました。ゲーム内の結果も確認してください。" + (paused ? " 一時停止中です。再開すると実行されます。" : "") };
```

- [ ] **Step 6: preload と型を足す**

`electron/preload.cjs` の `modStatus` の次の行に：

```js
  // 妨害の一時停止・再開（origin はどのボタンから押したか。logs/stop-requests.log に残す）
  modPause: (origin) => ipcRenderer.invoke("mod:pause", origin),
  modResume: (origin) => ipcRenderer.invoke("mod:resume", origin),
```

`src/types/electron.d.ts` の `StopOrigin` の次の行に：

```ts
export type PauseOrigin = "home:pause" | "home:resume" | "banner:resume";
```

- [ ] **Step 7: テストが通ることを確かめる**

Run: `node --test electron/test/stop-requests.test.cjs electron/test/app-regressions.test.cjs`
Expected: PASS。

- [ ] **Step 8: コミット**

```powershell
git add electron/stop_requests.cjs electron/main.cjs electron/preload.cjs src/types/electron.d.ts electron/test/stop-requests.test.cjs electron/test/app-regressions.test.cjs
git commit -m "feat: アプリから妨害を一時停止・再開する IPC と記録、テスト発火の文言"
```

---

### Task 3: 画面（配信ホームのボタンと、全ページの帯）

**Files:**
- Create: `src/lib/disruptionPause.ts`
- Modify: `src/App.tsx`（状態の読み取り・帯・DashboardPage へ渡す）
- Modify: `src/components/DashboardPage.tsx`（一時停止のボタン）
- Modify: `src/index.css`（帯）、`src/studio.css`（ボタンの並び）
- Create: `electron/test/disruption-pause-ui.test.cjs`

**Interfaces:**
- Consumes：Task 2 の `api.modPause(origin)`・`api.modResume(origin)`、`api.modStatus()` の `paused`・`gift`・`like`・`other`。
- Produces：
  - `pauseView(mod): PauseView`（`PauseView = { online: boolean; paused: boolean; queued: { gift: number; like: number; other: number } }`）
  - `pauseBannerText(view: PauseView): string`
  - `setDisruptionPause(api, pause: boolean, origin: PauseOrigin): Promise<{ ok: boolean; paused?: boolean; message?: string }>`
  - `DashboardPage` の props に `disruption?: PauseView` と `onDisruptionPause?: (pause: boolean) => Promise<string | null>`（失敗したら文言を返す）

- [ ] **Step 1: 画面の判断のテストを書く**

`electron/test/disruption-pause-ui.test.cjs`：

```js
// 妨害の一時停止（2026-10-16 ユーザーの決定）：画面の判断と配線。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
function loadTs(relative) {
  const file = path.resolve(__dirname, '../../src/lib', relative);
  const compiled = new Module(file, module);
  compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node20' }).code, file);
  return compiled.exports;
}
const source = relative => fs.readFileSync(path.resolve(__dirname, '../../src', relative), 'utf8');
const { pauseView, pauseBannerText, setDisruptionPause } = loadTs('disruptionPause.ts');

test('止めているかは、BridgeMOD とつながっていて paused が true のときだけ。古い BridgeMOD・再起動で解けたときは止めていない', () => {
  assert.deepEqual(pauseView({ online: true, paused: true, gift: 2, like: 30, other: 1 }), { online: true, paused: true, queued: { gift: 2, like: 30, other: 1 } });
  assert.equal(pauseView({ online: true, gift: 0 }).paused, false, '古い BridgeMOD は paused を返さない');
  assert.equal(pauseView({ online: true, paused: false }).paused, false, '再起動で解けた');
  assert.equal(pauseView({ online: false, paused: true }).paused, false, 'つながっていなければ帯を出さない');
  assert.equal(pauseView(null).paused, false);
  assert.deepEqual(pauseView({ online: true, paused: true, gift: 'x', like: -1 }).queued, { gift: 0, like: 0, other: 0 }, '数でない値は0');
});

test('帯の文言は、預かっている件数と、再開すると順に起きることを書く', () => {
  assert.equal(pauseBannerText({ online: true, paused: true, queued: { gift: 2, like: 30, other: 1 } }),
    '妨害を一時停止中です。届いた分は預かっています（ギフト 2・いいね 30・そのほか 1）。再開すると順に起きます');
});

test('一時停止・再開は出どころを付けて IPC を呼ぶ。失敗したら理由を返し、止めたことにしない', async () => {
  const calls = [];
  const api = { modPause: async origin => { calls.push(['pause', origin]); return { ok: true, paused: true }; },
    modResume: async origin => { calls.push(['resume', origin]); return { ok: false, message: 'BridgeMOD を新しくすると使えます（1.8.0 以上）。' }; } };
  assert.deepEqual(await setDisruptionPause(api, true, 'home:pause'), { ok: true, paused: true });
  assert.deepEqual(await setDisruptionPause(api, false, 'banner:resume'), { ok: false, message: 'BridgeMOD を新しくすると使えます（1.8.0 以上）。' });
  assert.deepEqual(calls, [['pause', 'home:pause'], ['resume', 'banner:resume']]);
  const throwing = { modPause: async () => { throw new Error('つながりません'); } };
  assert.deepEqual(await setDisruptionPause(throwing, true, 'home:pause'), { ok: false, message: 'つながりません' });
  assert.deepEqual(await setDisruptionPause({}, true, 'home:pause'), { ok: false, message: 'このアプリでは一時停止を使えません。' });
});

test('帯はどのページにも出し、再開ボタンは帯から出どころ付きで呼ぶ。配信ホームのボタンも出どころを付ける', () => {
  const app = source('App.tsx');
  assert.match(app, /pauseView\(mod\)/, '画面上部の5秒ごとの mod:status から読む');
  assert.match(app, /className="pause-banner" role="status"/);
  assert.match(app, /setDisruptionPause\(api, false, "banner:resume"\)/);
  assert.match(app, /<DashboardPage onNavigate=\{navigateTo\} disruption=\{disruption\} onDisruptionPause=\{changeDisruptionPause\} \/>/);
  const home = source('components/DashboardPage.tsx');
  assert.match(home, /onDisruptionPause\(!disruption\.paused\)/);
  assert.match(home, /妨害を再開/);
  assert.match(home, /妨害を一時停止/);
  assert.match(app, /setDisruptionPause\(api, pause, pause \? "home:pause" : "home:resume"\)/);
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `node --test electron/test/disruption-pause-ui.test.cjs`
Expected: FAIL（`disruptionPause.ts` がない）。

- [ ] **Step 3: 画面の判断を書く**

`src/lib/disruptionPause.ts`：

```ts
// 妨害の一時停止（BridgeMOD 1.8.0、2026-10-16 ユーザーの決定）。画面の判断だけを置き、React からも node:test からも使う。
import type { PauseOrigin } from "../types/electron";

export type PauseView = { online: boolean; paused: boolean; queued: { gift: number; like: number; other: number } };

const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** mod:status の結果から、帯とボタンに要るものだけを取り出す。古い BridgeMOD（paused なし）やつながっていないときは止めていない。 */
export function pauseView(mod: { online?: unknown; paused?: unknown; gift?: unknown; like?: unknown; other?: unknown } | null | undefined): PauseView {
  const online = mod?.online === true;
  return { online, paused: online && mod?.paused === true, queued: { gift: count(mod?.gift), like: count(mod?.like), other: count(mod?.other) } };
}

export function pauseBannerText(view: PauseView): string {
  const { gift, like, other } = view.queued;
  return `妨害を一時停止中です。届いた分は預かっています（ギフト ${gift}・いいね ${like}・そのほか ${other}）。再開すると順に起きます`;
}

type PauseApi = { modPause?: (origin: PauseOrigin) => Promise<{ ok: boolean; paused?: boolean; message?: string }>; modResume?: (origin: PauseOrigin) => Promise<{ ok: boolean; paused?: boolean; message?: string }> };

/** 失敗したら理由を返す（止めたことにしない）。 */
export async function setDisruptionPause(api: PauseApi, pause: boolean, origin: PauseOrigin): Promise<{ ok: boolean; paused?: boolean; message?: string }> {
  const call = pause ? api.modPause : api.modResume;
  if (!call) return { ok: false, message: "このアプリでは一時停止を使えません。" };
  try {
    return await call(origin);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
```

- [ ] **Step 4: App に帯を足し、DashboardPage へ渡す**

`src/App.tsx`：

- import に `import { pauseView, pauseBannerText, setDisruptionPause, type PauseView } from "./lib/disruptionPause";` を足す。
- `headerStatus` の `useState` の次に：

```tsx
  const [disruption, setDisruption] = useState<PauseView>(() => pauseView(null));
  const [pauseError, setPauseError] = useState("");
  const pollRef = useRef<() => Promise<void>>(async () => {});
```

  （`useRef` が import されていなければ `react` の import に足す。）
- 5秒ごとの `poll` の中、`setHeaderStatus(...)` の行の次に `if (!cancelled) setDisruption(pauseView(mod));` を足し、`poll();` の前に `pollRef.current = poll;` を足す。
- コンポーネントの中（`handleSetupComplete` の前）に、配信ホーム用と帯用の2つの関数を足す。どちらも、切り替えたあとは5秒待たずに読み直す。失敗したら理由を出す（止めたことにしない）。

```tsx
  // 一時停止・再開（2026-10-16）。出どころは配信ホームと帯で分けて記録する。
  const changeDisruptionPause = async (pause: boolean): Promise<string | null> => {
    const api = (window as any).mygamepack;
    const result = await setDisruptionPause(api, pause, pause ? "home:pause" : "home:resume");
    await pollRef.current();
    return result.ok ? null : result.message || "一時停止を切り替えられませんでした。";
  };
  const resumeFromBanner = async () => {
    const api = (window as any).mygamepack;
    const result = await setDisruptionPause(api, false, "banner:resume");
    setPauseError(result.ok ? "" : result.message || "再開できませんでした。");
    await pollRef.current();
  };
```

- 未保存の帯（`{hasChanges && <div className="unsaved-banner" ...>}`）の次の行に：

```tsx
          {disruption.paused && <div className="pause-banner" role="status">
            <span>{pauseBannerText(disruption)}</span>
            <button type="button" onClick={resumeFromBanner}>▶ 再開</button>
            {pauseError && <em role="alert">{pauseError}</em>}
          </div>}
```

- 配信ホームの描画を `<DashboardPage onNavigate={navigateTo} disruption={disruption} onDisruptionPause={changeDisruptionPause} />` にする。

- [ ] **Step 5: 配信ホームにボタンを足す**

`src/components/DashboardPage.tsx`：

- import に `import type { PauseView } from "../lib/disruptionPause";` を足す。
- 宣言を置き換える：

```tsx
const DashboardPage: React.FC<{ onNavigate: (page: AppPage) => void; disruption?: PauseView; onDisruptionPause?: (pause: boolean) => Promise<string | null> }> = ({ onNavigate, disruption, onDisruptionPause }) => {
```

- コンポーネントの state の近くに `const [pauseBusy, setPauseBusy] = useState(false); const [pauseNotice, setPauseNotice] = useState("");` を足す。
- 「BRIDGEだけを操作」の `</section>` の直後に：

```tsx
          {disruption && onDisruptionPause ? (
            <section className="cockpit-bridge-controls cockpit-pause-controls" aria-label="妨害の一時停止">
              <strong>妨害の一時停止</strong>
              <div className="cockpit-bridge-actions">
                <button type="button" disabled={pauseBusy || !disruption.online}
                  className={`cockpit-bridge-action ${disruption.paused ? "cockpit-bridge-action--start" : "cockpit-bridge-action--restart"}`}
                  onClick={async () => { setPauseBusy(true); setPauseNotice((await onDisruptionPause(!disruption.paused)) || ""); setPauseBusy(false); }}>
                  {disruption.paused ? "▶ 妨害を再開" : "⏸ 妨害を一時停止"}
                </button>
              </div>
              {pauseNotice && <p role="alert">{pauseNotice}</p>}
              <p>休憩や準備の間だけ妨害を止めます。止めている間に届いたギフト・いいねは預かり、再開すると送られた数どおり順に起きます。始まっている演出は最後まで続きます。サーバーを再起動すると解けます。</p>
            </section>
          ) : null}
```

- [ ] **Step 6: 帯の見た目を足す**

`src/index.css` の `.unsaved-banner` の次の行に：

```css
.pause-banner { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 24px; background: #1c3a49; border-bottom: 1px solid #2e7d8c; color: #c9f3ff; font-size: 12px; }
.pause-banner button { padding: 4px 12px; border: 1px solid #5fd3e8; border-radius: 6px; background: #0f2a36; color: #e6fbff; font-size: 12px; cursor: pointer; }
.pause-banner em { color: #ffb4a8; font-style: normal; }
```

- [ ] **Step 7: テストと型の確認が通ることを確かめる**

Run: `node --test electron/test/disruption-pause-ui.test.cjs`、続けて `npm run verify`（型チェック・ビルド・全テスト）
Expected: PASS。

- [ ] **Step 8: コミット**

```powershell
git add src/lib/disruptionPause.ts src/App.tsx src/components/DashboardPage.tsx src/index.css electron/test/disruption-pause-ui.test.cjs
git commit -m "feat: 配信ホームの一時停止ボタンと、止めている間の全ページの帯"
```

---

### Task 4: 全体の確かめと PR

- [ ] **Step 1:** `npm run verify`、`node scripts/test-bridge-contracts.cjs` がすべて通ることを確かめる。
- [ ] **Step 2:** `BridgeMod` で `.\gradlew.bat build ...` が通り（JUnit を含む）、`bridgemod-1.8.0.jar` ができることを確かめる。
- [ ] **Step 3:** Task 1 の Step 7 の実機テストを、最後の jar でもう一度流す。
- [ ] **Step 4:** 開発版（`npm run electron:dev`、`ELECTRON_RUN_AS_NODE` を外す）で、配信ホームのボタンと帯が出て、押すと切り替わることを目で確かめる（サーバーは使い捨てでよい）。
- [ ] **Step 5:** push して PR を出す（本文に、設計書・決めたこと・テストの結果・直す前の失敗の確認を書く）。レビューを別のエージェントに頼み、指摘を直す。マージはユーザーの許可を得てから。
