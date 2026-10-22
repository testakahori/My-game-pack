# 処理のコピー PR4（既定値の1か所・コマンドの場所・BridgeMOD の接続先・画面の古い名前）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** config.minecraft.json の既定値・新しい設定の雛形・コマンドの場所・BridgeMOD の接続先の読み方を1か所にし、BRIDGE・アプリ・画面が同じものを使う（設計書の 7 の後半）。

**Architecture:** 既定値の表は `bridge/config_defaults.json`（画面も読めるようにデータは JSON）、雛形・コマンドの場所・BridgeMOD の接続先を決める関数は `bridge/config_defaults.cjs` に置く。BRIDGE（`bridge/index.js`・`bridge/live_config.cjs`・`bridge/roulette.cjs`）、electron、`scripts/prepare-bridge-runtime.cjs`、`vite.config.ts` は `.cjs` を、画面（`OperationsPage.tsx`・`DashboardPage.tsx`）は JSON を読む。

**Tech Stack:** Node.js（CommonJS、node:test）、React と TypeScript（画面は JSON を import する。`tsconfig.json` の `resolveJsonModule` は有効）。

**Spec:** docs/superpowers/specs/2026-10-18-logic-copies-design.md（7 の「既定値」「画面の古い名前」「BridgeMOD のホスト・ポート」「`bridge/index.js` のコメント」）。PR の分け方は PR3 の計画のとおり（この PR4 のあと、設計書の元の PR4 を PR5 にする）。

## Global Constraints

- 既定値（`bridge/config_defaults.json`。値は今の BRIDGE と同じ。ただし `logUnknownGifts` は下の決めたこと 1）:
  - `options`: `giftCooldownMs` 300、`maxCommandsPerGift` 200、`maxLikeCatchUpPerEvent` 5、`rconQueueWarnSize` 20、`likeBatchWindowMs` 1200、`streakTtlMs` 60000、`logUnknownGifts` true、`announceFunction` "gift_stream:_announce"、`announceStorage` "gift_stream:bridge"、`announceEveryRepeat` true、`announceEnabled` true、`commandTransport` "rcon"、`commandsDir` "commands/minecraft"、`bridgeModHost` "127.0.0.1"、`bridgeModPort` 25576。
  - `rcon`: `host` "127.0.0.1"、`port` 25575。`telnet`: `host` "127.0.0.1"、`port` 8081。
- 送り方は、設定に無ければ RCON（今と同じ）。新しい設定の雛形には `bridge_mod` を書く（今と同じ）。
- コマンドの場所（`commandsDir`）は、設定に無い・空なら `commands/minecraft`。相対なら BRIDGE のフォルダーから、絶対ならそのまま。BRIDGE・再起動の比べ方・ルーレット・アプリは同じ関数で決める。ルーレットの「見つからなければ `minecraft` のフォルダーも探す」はやめる（決めたこと 2）。
- BridgeMOD の接続先: ホストは `bridgeModHost`・`doumaModHost` の順に、前後の空白を除いて空でない最初のもの（なければ 127.0.0.1）。ポートは `Number(bridgeModPort || doumaModPort || 25576)`（今と同じ書き方。範囲は今までどおり設定の確かめが見る）。
- 範囲の丸め（`liveOptions` の `boundedInt` の範囲）と設定の確かめの範囲は変えない。
- アプリが設定を書くときは、今までどおり `commandsDir` に絶対パス（`<BRIDGE のフォルダー>/commands/minecraft`）を書く（決めたこと 3）。
- ipc の名前・画面の見た目は変えない。作業は D 側の作業コピーのブランチ `fix/logic-copies-4`（main の 5bed08d から切った）。git は PowerShell、`git add` の前に `git hash-object -w <file>`、commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash`・`git clean` は使わない。追跡していない `docs/soutenmon/StreamToEarn_code/` には触らない（ユーザーのもの）。コメントは日本語、既存ファイルの改行（CRLF）は変えない。複数行のスクリプトは Write でファイルにしてから実行する。文書にバックスラッシュと英数字の並び（Windows の場所など）を書かない（Tailwind のビルドが止まる。`electron/test/docs-css-safe.test.cjs`）。
- electron が読む新しい bridge のファイル（`bridge/config_defaults.cjs`・`bridge/config_defaults.json`）は `package.json` の `build.files` に足す（`electron/test/config-schema.test.cjs` の配布のテストが、中で読む `./config_defaults.json` までたどって確かめる）。

## 決めたこと（設計書 14 で作る人に任された所。違っていれば直す）

1. `logUnknownGifts` の既定は true。今は BRIDGE だけ「書いていなければ false」で、アプリの雛形・配信ホームの ID の承認は true を書いていた。ログが増えるだけで、ギフトの動きは変わらない。
2. ルーレットの「`commands` を指す古い設定のために `minecraft` のフォルダーも探す」をやめる。既定が `commands/minecraft` になれば要らない。アプリは最初の版から保存のたびに `commands/minecraft` を書いてきたので、`commands` を指すのは手で書いた設定だけ。そのときは、ギフト（見出しを読まない）と同じくルーレットも項目が見つからなくなる（「ルーレットの有効な項目がありません」が出る）。アプリで一度保存すると直る。
3. アプリが書く `commandsDir` は絶対パスのまま（BRIDGE が読む値を変えない）。相対に変えると保存先を移したときに強くなるが、この PR では変えない。
4. 配信ホームの ID の承認は、`options` の既定値（`giftCooldownMs`・`maxCommandsPerGift`・`commandsDir`・`logUnknownGifts`）を書かない。書いていなければ BRIDGE も運用センターも同じ既定値を使うので動きは変わらず、既定値の写しが設定に残らない。RCON のホストとポートの既定値は JSON から読む。
5. 画面の古い名前（`likeBatchMs`・`likeCatchupLimit`）は表示に使わない。BRIDGE は前から読んでいないので、古い名前だけの設定では、表示が BRIDGE の使う値（既定値）と同じになる。設定に残った古い名前は消さない（害はない）。
6. 範囲の丸めと確かめの範囲は1つにしない（設計書は既定値だけ。今は同じ値で食い違っていない）。`electron/initial_setup.cjs`・`electron/world_setup.cjs` の空きポートの一覧と、配信前チェックの server.properties 側の RCON ポートの既定（Minecraft の既定値）は変えない。

## Review Focus

1. 新しく入れた直後など、設定に `commandsDir` が無いとき、BRIDGE が `commands/minecraft` の txt の見出し（`# RANDOM:`・`# COOLDOWN:` など）を読むこと（前は `commands` を見て見出しを読み落とし、送る名前だけ BridgeMOD に渡していた）→ Task 2 の BRIDGE を動かすテスト。
2. アプリで保存した設定（`commandsDir` が絶対パス）と、`commandsDir` の無い設定で、BRIDGE の起動のあとに保存しても「コマンドの場所」の再起動の案内が出ないこと → Task 2 の live-config のテスト。
3. `bridgeModHost` の前後に空白があるとき、アプリの BridgeMOD との通信（状態・テスト発火・一時停止）が BRIDGE と同じ接続先に届くこと。空白だけのホストは旧い名前か 127.0.0.1 を使うこと → Task 1・Task 3 のテスト。
4. 新しく作った設定に `configVersion: 2` があり、次の起動の直しで書き直されないこと → Task 3 のテスト。
5. 古い名前（`likeBatchMs`）だけの設定で、運用センターが BRIDGE の使う値（1200）を出すこと → Task 4 のテスト。

---

### Task 1: 既定値の表と、雛形・コマンドの場所・BridgeMOD の接続先を決める関数

**Files:**
- Create: `bridge/config_defaults.json`、`bridge/config_defaults.cjs`、`electron/test/config-defaults.test.cjs`
- Modify: `package.json`（`build.files` に `bridge/config_defaults.cjs`・`bridge/config_defaults.json`）

**Interfaces:**
- Consumes: `CONFIG_VERSION`（`bridge/config_migration.cjs`）。
- Produces（`bridge/config_defaults.cjs`）:
  - `CONFIG_DEFAULTS`: JSON をそのまま読んで、中まで `Object.freeze` したもの（`{ options, rcon, telnet }`）。
  - `newBridgeConfig() => object`: 呼ぶたびに新しいもの。今の2つの雛形（`electron/paths.cjs` の `ensureConfigExists`・`scripts/prepare-bridge-runtime.cjs` の `cleanConfig`）と同じ項目に `configVersion: CONFIG_VERSION` を足す: `tiktokUsername: ""`、`rcon: { host, port, password: "" }`（host・port は `CONFIG_DEFAULTS.rcon`）、`mappings: []`、`likeEvents: []`、`unmappedGiftEvent`・`shareEvent`・`followEvent`・`memberEvent` は `{ commandFile: "", repeat: 1, enabled: false }`、`options: { giftCooldownMs, maxCommandsPerGift, commandTransport: "bridge_mod", bridgeModHost, bridgeModPort, maxLikeCatchUpPerEvent, logUnknownGifts }`（値は `CONFIG_DEFAULTS.options`）。
  - `commandsDirSetting(options?: object) => string`: `options.commandsDir` が文字列なら前後の空白を除いたもの、空・文字列でなければ `"commands/minecraft"`。BRIDGE のログの表示にも使う。
  - `bridgeCommandsDir(bridgeDir: string, options?: object) => string`: `path.resolve(bridgeDir, commandsDirSetting(options))`。
  - `bridgeModEndpoint(options?: object) => { host: string, port: number }`: Global Constraints のとおり。

- [ ] **Step 1: テストを書く**（`electron/test/config-defaults.test.cjs`）

```js
test('新しい設定の雛形: 今の雛形と同じ項目に今の決まりの版を付け、確かめを通り、直すものがない。呼ぶたびに別のもの', () => {
  const a = newBridgeConfig(), b = newBridgeConfig();
  a.mappings.push({}); a.options.giftCooldownMs = 1;
  assert.deepEqual([b.mappings, b.options.giftCooldownMs], [[], 300]);
  assert.deepEqual(b.options, { giftCooldownMs: 300, maxCommandsPerGift: 200, commandTransport: 'bridge_mod', bridgeModHost: '127.0.0.1', bridgeModPort: 25576, maxLikeCatchUpPerEvent: 5, logUnknownGifts: true });
  assert.deepEqual(b.rcon, { host: '127.0.0.1', port: 25575, password: '' });
  assert.equal(b.configVersion, CONFIG_VERSION);
  assert.deepEqual(validateBridgeConfig({ ...b, tiktokUsername: 'fixture' }).errors, []);
  assert.deepEqual(migrateBridgeConfig(b).changes, []);
  assert.ok(Object.isFrozen(CONFIG_DEFAULTS.options) && Object.isFrozen(CONFIG_DEFAULTS.rcon));
});

test('コマンドの場所: 書いていない・空なら commands/minecraft。相対は BRIDGE のフォルダーから、絶対はそのまま', () => {
  const base = path.resolve('bridge-dir'), standard = path.join(base, 'commands', 'minecraft');
  assert.deepEqual([bridgeCommandsDir(base), bridgeCommandsDir(base, {}), bridgeCommandsDir(base, { commandsDir: '  ' }), bridgeCommandsDir(base, { commandsDir: 3 })], [standard, standard, standard, standard]);
  assert.equal(bridgeCommandsDir(base, { commandsDir: ' commands ' }), path.join(base, 'commands'));
  const elsewhere = path.resolve('elsewhere', 'cmds');
  assert.equal(bridgeCommandsDir(base, { commandsDir: elsewhere }), elsewhere);
  assert.equal(commandsDirSetting(undefined), 'commands/minecraft');
});

test('BridgeMOD の接続先: 前後の空白を除き、旧い doumaMod* も読む。空白だけなら次の名前、なければ 127.0.0.1:25576', () => {
  assert.deepEqual(bridgeModEndpoint(undefined), { host: '127.0.0.1', port: 25576 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: ' 10.0.0.2 ', bridgeModPort: '25600' }), { host: '10.0.0.2', port: 25600 });
  assert.deepEqual(bridgeModEndpoint({ doumaModHost: 'mod.local', doumaModPort: 25601 }), { host: 'mod.local', port: 25601 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: '  ', doumaModHost: ' old ' }), { host: 'old', port: 25576 });
  assert.deepEqual(bridgeModEndpoint({ bridgeModHost: 'new', doumaModHost: 'old', bridgeModPort: 1, doumaModPort: 2 }), { host: 'new', port: 1 }, '新しい名前が先');
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/config-defaults.test.cjs` / Expected: FAIL（モジュールがない）。
- [ ] **Step 3: JSON とモジュールを作り、`build.files` に足す**（Interfaces のとおり）。
- [ ] **Step 4: 動かす** — Run: `node --test electron/test/config-defaults.test.cjs electron/test/config-schema.test.cjs` / Expected: PASS。
- [ ] **Step 5: commit**（「refactor: 設定の既定値と、雛形・コマンドの場所・BridgeMOD の接続先を決める関数を1か所に置く」）

---

### Task 2: BRIDGE が既定値・コマンドの場所・接続先を1か所から読む

**Files:**
- Modify: `bridge/live_config.cjs`（`liveOptions` の既定値、`connection` のコマンドの場所・BridgeMOD・RCON・Telnet の既定値）
- Modify: `bridge/index.js`（1036〜1038 行目のコメント、1063〜1077 行目の送り方・BridgeMOD・コマンドの場所、1113〜1116 行目の RCON、1141〜1143 行目の Telnet）
- Modify: `bridge/roulette.cjs`（`commandPath`）
- Modify: `electron/test/helpers/bridge-fixture.cjs`（引数 `commandsFolder` を足す）
- Test: `electron/test/live-config.test.cjs`、`electron/test/roulette.test.cjs`、`electron/test/config-defaults.test.cjs`、Create `electron/test/bridge-commands-dir.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `CONFIG_DEFAULTS`・`commandsDirSetting`・`bridgeCommandsDir`・`bridgeModEndpoint`。
- Produces: `commandPath(commandsDir, commandFile)` は `path.join(commandsDir, <ensureTxt した名前>)` だけを返す（形は今と同じ）。試験台の `startBridgeFixture(t, { commandsFolder = 'commands', ... })`: txt を `<dir>/<commandsFolder>` に書く（`/` で区切った入れ子も作る）。設定の `options.commandsDir` は今までどおり既定 `'commands'` で、`config.options.commandsDir: undefined` を渡すと設定から消える（`JSON.stringify` が落とす）。

- [ ] **Step 1: テストを書く**

`electron/test/bridge-commands-dir.test.cjs`:

```js
test('コマンドの場所: 設定に commandsDir が無ければ commands/minecraft を読む（見出しの RANDOM も効く）', async t => {
  const bridge = await startBridgeFixture(t, { commandsFolder: 'commands/minecraft',
    commands: { pick: '# RANDOM: qa\nsay pick\n', qa: 'say qa\n' },
    config: { mappings: [{ giftId: '1', name: 'くじ', commandFile: 'pick.txt', repeat: 1 }], options: { commandsDir: undefined } } });
  assert.ok(bridge.logs.some(line => line.includes('[Bridge] CommandsDir: commands/minecraft/')), bridge.logs.join('\n'));
  await bridge.emit('WebcastGiftMessage', { giftId: '1', gift: { name: 'くじ' }, repeatCount: 1, repeatEnd: 1 });
  await bridge.until(() => bridge.requests.length > 0, 'gift');
  assert.deepEqual(bridge.requests.map(x => x.key), ['qa']);
});
```

`electron/test/live-config.test.cjs`: 1つ目のテストの期待を `logUnknownGifts: true` にし、`liveOptions({ logUnknownGifts: false }).logUnknownGifts === false` を足す。次のテストを足す:

```js
test('つなぎ方: commandsDir の無い設定とアプリが書く絶対パスは同じ場所（起動のあとに保存しても案内しない）', () => {
  const path = require('node:path');
  const base = path.resolve('bridge-dir');
  const started = { tiktokUsername: 'a', options: { commandTransport: 'bridge_mod' } };
  assert.deepEqual(restartRequired(started, { ...started, options: { ...started.options, commandsDir: path.join(base, 'commands', 'minecraft') } }, base), []);
  assert.deepEqual(restartRequired(started, { ...started, options: { ...started.options, bridgeModHost: ' 127.0.0.1 ' } }, base), [], '前後の空白だけの違い');
});
```

`electron/test/roulette.test.cjs`: 1つ目のテストの `assert.deepEqual(direct, prepareRoulette(config, path.dirname(dir), () => 0.5));` を、次に置き換える（名前も「ルーレット: 決めたコマンドの場所だけを読む（minecraft のフォルダーを探しに行かない）…」にする）:

```js
  assert.throws(() => prepareRoulette(config, path.dirname(dir), () => 0.5), /有効な項目がありません/, '旧い commands のルートでは探さない');
```

`electron/test/config-defaults.test.cjs` に、写しを探すテストを足す:

```js
test('既定値の写し: BRIDGE は既定値・コマンドの場所・接続先を自分で持たず config_defaults を使う', () => {
  for (const file of ['bridge/index.js', 'bridge/live_config.cjs', 'bridge/roulette.cjs']) {
    const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
    assert.doesNotMatch(source, /(\|\||\?\?)\s*(25576|25575|8081|"127\.0\.0\.1"|"commands")/, file);
    assert.doesNotMatch(source, /\?\?\s*(300|200|1200|5|20|60000)[,)]/, file);
    assert.doesNotMatch(source, /(bridgeModHost|doumaModHost|bridgeModPort|doumaModPort|commandsDir)\s*\|\|/, file);
    assert.doesNotMatch(source, /"minecraft", name/, file);
  }
  assert.match(fs.readFileSync(path.resolve(__dirname, '../../bridge/index.js'), 'utf8'), /既定値は bridge\/config_defaults\.json/);
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/bridge-commands-dir.test.cjs electron/test/live-config.test.cjs electron/test/roulette.test.cjs electron/test/config-defaults.test.cjs` / Expected: FAIL（BRIDGE は `commands` を見て `pick` を送る、`logUnknownGifts` が false、ルーレットが `minecraft` を探す、写しがある）。
- [ ] **Step 3: 直す**
  - `liveOptions`: 既定値を `CONFIG_DEFAULTS.options` から読む（範囲は今のまま）。`logUnknownGifts` は `!!(o.logUnknownGifts ?? 既定値)`。`protection`・`gameplay` の空の形は今のまま。
  - `connection`: `dir` は `bridgeCommandsDir(baseDir || ".", options)`、BridgeMOD は `bridgeModEndpoint(options)`、RCON・Telnet の既定は `CONFIG_DEFAULTS.rcon`・`CONFIG_DEFAULTS.telnet`。
  - `bridge/index.js`: 送り方の既定は `CONFIG_DEFAULTS.options.commandTransport`、BridgeMOD は `bridgeModEndpoint(options)`、`commandsDirName = commandsDirSetting(options)`・`commandsDirAbs = bridgeCommandsDir(__dirname, options)`、RCON・Telnet の既定は表から（環境変数を先に使う順は今のまま）。1036〜1038 行目のコメントの最後の文を「既定値は bridge/config_defaults.json の1か所（新しい設定の雛形・運用センターの表示も同じものを読む）。」にする。
  - `roulette.cjs`: `commandPath` から `minecraft` のフォルダーを探す分岐とそのコメントを消す。
  - 試験台に `commandsFolder` を足す。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:bridge` / Expected: PASS、`=== done: 15 passed, exitCode=0 ===`。
- [ ] **Step 5: commit**（「fix: BRIDGE のコマンドの場所の既定を commands/minecraft にし、既定値と BridgeMOD の接続先を1か所から読む」）

---

### Task 3: アプリの雛形・コマンドの場所・BridgeMOD の接続先を1か所から読む

**Files:**
- Modify: `electron/paths.cjs`（`ensureConfigExists` の雛形）、`scripts/prepare-bridge-runtime.cjs`（`cleanConfig` とそのコメント。`commandsDir` が無くても `commands/minecraft` を読むので exit(1) しない、に直す）
- Modify: `electron/bridge_mod_client.cjs:18-19`、`electron/server_process.cjs:117`（BridgeMOD の接続先）
- Modify: コマンドの場所を `bridgeCommandsDir(<BRIDGE のフォルダー>)` にする所: `electron/bridge_settings.cjs`（36・92・102・150・173・214・226 行目）、`electron/main.cjs:72`、`electron/server_files.cjs:39`、`electron/server_process.cjs:90`、`electron/command_migration.cjs:36`、`electron/saikutu_commands.cjs:26`（`bridgeRoot`）、`electron/game_profiles.cjs:151・184`（BRIDGE のフォルダーは `path.dirname(configPath())`）、`electron/bridge_sync.cjs:629-631`（`path.join(process.resourcesPath, "bridge")`・`path.resolve(appDir, "..", "bridge")`・`path.join(targetFolder, "bridge")`）、`vite.config.ts:129`（`load("./bridge/config_defaults.cjs")`。136 行目と同じ読み方）
- Test: `electron/test/paths-module.test.cjs`、`electron/test/bridge-mod-client-module.test.cjs`、`electron/test/config-defaults.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `newBridgeConfig`・`bridgeCommandsDir`・`bridgeModEndpoint`。

- [ ] **Step 1: テストを書く**
  - `paths-module.test.cjs` の「BRIDGE の設定がなければ…」に `assert.deepEqual(created, newBridgeConfig());` と `assert.equal(created.configVersion, 2, '次の起動の直しで書き直さない');` を足す。
  - `bridge-mod-client-module.test.cjs` に足す:

```js
test('BridgeMOD との通信: 接続先は BRIDGE と同じ読み方（ホストの前後の空白を除く、旧い doumaModPort も読む）', async t => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end(JSON.stringify({ ok: true })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const x = setup(t);
  fs.writeFileSync(x.configPath, JSON.stringify({ options: { commandTransport: 'bridge_mod', bridgeModHost: ' 127.0.0.1 ', doumaModPort: server.address().port } }));
  assert.deepEqual(await x.client.requestBridgeMod('GET', '/bridge/status'), { ok: true });
});
```

  （`setup` は `configPath` を返していないので、返すように1語足す。）
  - `config-defaults.test.cjs` に、写しを探すテストを足す:

```js
test('既定値の写し: アプリは雛形・コマンドの場所・BridgeMOD の接続先を自分で持たず config_defaults を使う', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  const files = fs.readdirSync(path.resolve(__dirname, '..')).filter(name => name.endsWith('.cjs')).map(name => 'electron/' + name).concat(['vite.config.ts', 'scripts/prepare-bridge-runtime.cjs']);
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /["']commands["']\s*,\s*["']minecraft["']/, file + ' にコマンドの場所の写しがある');
    assert.doesNotMatch(source, /(bridgeModHost|doumaModHost|bridgeModPort|doumaModPort)\s*\|\|/, file + ' に BridgeMOD の接続先の写しがある');
    assert.doesNotMatch(source, /giftCooldownMs:\s*300/, file + ' に雛形の写しがある');
  }
  assert.match(read('electron/paths.cjs'), /newBridgeConfig\(\)/);
  assert.match(read('scripts/prepare-bridge-runtime.cjs'), /newBridgeConfig\(\)/);
});
```

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/paths-module.test.cjs electron/test/bridge-mod-client-module.test.cjs electron/test/config-defaults.test.cjs` / Expected: FAIL（雛形に版がない、空白付きのホストに届かない、写しがある）。
- [ ] **Step 3: 直す**（Files のとおり。`server_process.cjs:117` は `bridgeModEndpoint(cfg.options).host.toLowerCase()`。`bridge_settings.cjs` の `writeBridgeConfig` は `bridgeCommandsDir(getBridgeBatDir())` の絶対パスを今までどおり書く。行数の見張り（`electron/test/file-size-limits.test.cjs`）を超えないこと）。
- [ ] **Step 4: 動かす** — Run: `npm run test:app` / Expected: `ℹ fail 0`。
- [ ] **Step 5: commit**（「refactor: アプリの雛形・コマンドの場所・BridgeMOD の接続先を config_defaults から読む」）

---

### Task 4: 画面の既定値と古い名前

**Files:**
- Modify: `src/components/OperationsPage.tsx:399-408`（既定値を `import CONFIG_DEFAULTS from "../../bridge/config_defaults.json";` から読む。`?? o.likeBatchMs`・`?? o.likeCatchupLimit` を消す）
- Modify: `src/components/DashboardPage.tsx:564-582`（ID の承認で書く `options` の既定値4つを消して `...(existingCfg?.options || {})` だけにする。RCON のホストとポートの既定は JSON から）
- Modify: `src/lib/devApiMock.ts:39-40`（`likeBatchWindowMs: 1200`・`maxLikeCatchUpPerEvent: 5`）
- Test: `electron/test/config-defaults.test.cjs`

- [ ] **Step 1: テストを書く**

```js
test('画面: 運用センター・配信ホームは既定値を config_defaults.json から読み、古い名前と既定値の写しを持たない', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  for (const file of ['src/components/OperationsPage.tsx', 'src/components/DashboardPage.tsx']) {
    const source = read(file);
    assert.match(source, /import CONFIG_DEFAULTS from "\.\.\/\.\.\/bridge\/config_defaults\.json";/, file);
    assert.doesNotMatch(source, /likeBatchMs|likeCatchupLimit/, file);
    // 引用符で終わる値のあとは語の境目にならないので、数・true と分けて探す。
    assert.doesNotMatch(source, /(\|\||\?\?)\s*("127\.0\.0\.1"|"commands\/minecraft"|(300|200|1200|5|25575|true)\b)/, file);
  }
  assert.doesNotMatch(read('src/components/DashboardPage.tsx'), /commandsDir:/, '保存のたびに main が上書きするので書かない');
  assert.doesNotMatch(read('src/lib/devApiMock.ts'), /likeBatchMs|likeCatchupLimit/);
});
```

（今この形に当たるのは、運用センターの 399・402・405・408 行目と、配信ホームの 567・568・578〜581 行目だけ（2026-10-22 に確かめた）。どれも直す所。）

- [ ] **Step 2: 動かす** — Run: `node --test electron/test/config-defaults.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**（Files のとおり）。
- [ ] **Step 4: 動かす** — Run: `npm run verify` / Expected: typecheck・test:bridge・test:app（`ℹ fail 0`）・build が通る。
- [ ] **Step 5: commit**（「fix: 運用センターと配信ホームの既定値を config_defaults.json から読み、古い名前を使わない」）

---

### Task 5: 記録

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「処理のコピー」の PR4 の節：やったこと・決めたこと 1〜6・`npm run verify` の数・リリースノートに足すこと）

リリースノートに足すこと:
- 新しく入れた直後など、BRIDGE の設定にコマンドの場所が書かれていないときも、BRIDGE が正しいフォルダー（`commands/minecraft`）の txt の見出しを読みます。
- 知らないギフトのログは、設定に書いていなくても出します。
- BridgeMOD のホスト名の前後に空白があっても、アプリと BridgeMOD の通信がつながります。

- [ ] **Step 1: HANDOFF を書く**
- [ ] **Step 2: `npm run verify`** — Expected: すべて通る。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR4 を書く」）
