# main.cjs の分割 PR1（土台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ipc の窓口の一覧を固定するテストを作り、`electron/main.cjs` からアプリ設定・配置の場所・運営ログイン・ウィンドウの4つを別ファイルに分ける（アプリの動きは変えない）。

**Architecture:** 各ファイルは `createXxx(deps)` を1つだけ外に出し、関数のまとまりと `register(ipcMain)` を返す。main.cjs は requires の直後でモジュールを作り、今の関数名を分割代入で受けるので、main.cjs の中の呼び出し側は変えない。あとで定義される変数（`serverStarting` など）は「呼ばれたときに読む関数」で渡す。

**Tech Stack:** Node.js（CommonJS、node:test）、Electron main（テストでは偽物の electron を vm で渡す）。

**Spec:** docs/superpowers/specs/2026-10-17-main-split-design.md

## Global Constraints

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。`electron/preload.cjs` と `src/` は変えない。
- 関数の中の処理は、移すだけにする。直すのは、受け取る形を変えるのに必要な所だけ（`__dirname` を `appDir` に、変数を直接見ていた所を受け取った関数に）。
- `electron`・`child_process` は main.cjs だけが読み込む。モジュールは `fs`・`path`・`crypto`・`url` などほかの Node の組み込みは自分で読み込んでよい。
- main.cjs の `__dirname` と `process` は、テスト（`loadApp`）では偽物になる（`__dirname` は一時フォルダーの `electron`、`process.resourcesPath` も偽物）。モジュールは自分の `__dirname`・`process` を使わず、main から `appDir`・`process` を受け取る。
- 作業は、このセッションの scratchpad に作った worktree `wt-split`（ブランチ `refactor/main-split-1`）。D 側の作業コピー（`D:/Dev02/game_dev/MyGamePack02/My-game-pack-review`）は Codex が使っているので、ファイルにもブランチにも触らない。
- 文書に Windows の場所を書くときは `/` 区切りにする。`\` のあとに16進数が続くと、Tailwind（`npm run build`）が CSS の文字コードとして読んでビルドが止まる（`electron/test/docs-css-safe.test.cjs` で確かめる）。
- git は PowerShell で worktree に入って行う（`Push-Location <worktree>`）。`git add` が Permission denied のときは先に `git hash-object -w <file>`。commit メッセージはファイルに書いて `git commit -F`、最後に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`。`git stash` は使わない。
- バッククォートを含む文や複数行のスクリプトは、Bash の `node -e "..."` に直接書かない（コマンド置換が起きる）。Write でファイルにしてから実行する。
- 1つのテストファイルは `node --test electron/test/<name>.test.cjs`。全体は `npm run verify`。
- コメントは周りと同じく日本語。既存ファイルの改行（CRLF）は変えない。

## Review Focus

1. 配布版（`app.isPackaged === true`、`process.resourcesPath` あり）の場所が、分ける前と同じになること → Task 3 の「配布版の場所」で確かめる。
2. main.cjs の読み込み順で、まだ作っていない関数を呼んで落ちないこと（`const` の分割代入は巻き上げられない） → 全 Task で `app-regressions` の `loadApp` が通ることで確かめる。
3. 運営ログインの失敗5回で60秒止まり、成功したら数え直すこと → Task 4 の「失敗が5回続いたら60秒止める」で確かめる。
4. サーバーの起動中・MAP の作業中に保存先を変えようとしたら、今と同じく止まること → Task 2 の「保存先は止まっているときだけ変える」で確かめる。
5. 作業中（保存・準備中）にウィンドウを閉じようとしたら止まり、別のページ・外部リンクへの移動は今と同じく防ぐこと → Task 5 の「作業中は閉じない」「移動は index.html だけ」で確かめる。

---

### Task 1: ipc の窓口の一覧を固定するテスト

**Files:**
- Modify: `electron/test/app-regressions.test.cjs`（`loadApp` の偽物の `ipcMain` と戻り値、新しいテスト1件）

**Interfaces:**
- Produces: `loadApp(t)` の戻り値に `channels(): string[]`（`ipcMain.handle` の名前、並べたもの）と `onChannels(): string[]`（`ipcMain.on` の名前、並べたもの）を足す。

- [ ] **Step 1: 偽物の ipcMain で `on` の名前も集め、戻り値に足す**

`loadApp` の中の `const handlers = new Map();` の次の行に足す:

```js
  const onChannels = new Set();
```

`ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} },` を次に変える:

```js
      app, dialog, safeStorage, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: name => onChannels.add(name) },
```

戻り値（`return { root, configPath, ...`）の `invoke: ...,` の次に足す:

```js
    // ipc の窓口の名前（main.cjs の分割で増えたり減ったりしていないかを確かめる。2026-10-17）。
    channels: () => [...handlers.keys()].sort(), onChannels: () => [...onChannels].sort(),
```

- [ ] **Step 2: 一覧のテストを書く**

`function fakeBridge(` の定義の前（`loadApp` の関数のすぐあと）に足す:

```js
// main.cjs を仕事ごとのファイルに分けても、ipc の窓口は1つも増やさず減らさない（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 仕事として窓口を足す・消すときは、その PR でこの一覧も直す。
const IPC_HANDLE_CHANNELS = ["app:config:read","app:config:write","app:version","auth:login","auth:logout","auth:status","bridge:commands:list","bridge:commands:openFolder","bridge:commands:readMeta","bridge:commands:write","bridge:dir","bridge:extractTo","bridge:launch","bridge:logs","bridge:processStatus","bridge:restart","bridge:root","bridge:stop","bridge:syncStatus","clipboard:writeText","config:giftMapping:save","config:mappings:write","config:path","config:read","config:validate","config:write","dialog:pickFile","dialog:pickFolder","euler:clear","euler:openPortal","euler:save","euler:status","folder:open","games:activate","games:clientFolder","games:clientFolders","games:install","games:list","games:recover","games:refreshMods","games:selectClientFolder","giftTemplate:apply","giftTemplate:cancel","giftTemplate:open","giftTemplate:save","gifts:openFolder","gifts:openHtml","gifts:read","gifts:update","gv:gifts:copyPngDataUrl","gv:gifts:fetchImageBase64","gv:gifts:openFolder","gv:gifts:openHtml","gv:gifts:read","gv:gifts:update","gv:settings:read","gv:settings:write","image:saveGiftPanel","minecraft:grantOp","minecraft:launch","minecraft:status","mod:pause","mod:resume","mod:status","mod:testEvent","operations:earnings:save","operations:history","operations:history:clear","operations:stats","operations:stats:export","operations:streamStats","preflight:run","presets:list","presets:load","presets:save","server:checkSetupComplete","server:command","server:copyTemplate","server:copyTemplateStatus","server:datapack:deployNightVision","server:forgeClientStatus","server:forgeInstall","server:forgeInstall:atPath","server:gamerules:apply","server:logs","server:processStatus","server:props:read","server:props:write","server:rconpassword:read","server:setup","server:setup:atPath","server:setup:status","server:start","server:stop","server:worlds:list","settings:backups:create","settings:backups:list","settings:backups:restore","setup:inspectEnvironment","stream:session:end","stream:session:start","stream:session:status","tiktok:liveStatus","tts:checkEngine","tts:getSpeakers","tts:launchEngine","tts:settings:read","tts:settings:write","tts:test","updater:check","updater:install","updater:status","world:backup","world:saves:list","world:saves:load","world:saves:save"];
const IPC_ON_CHANNELS = ["window:close", "window:maximizeToggle", "window:minimize"];

test('ipc の窓口の一覧は、main.cjs を分けても変わらない（116個と、ウィンドウの3個）', t => {
  const app = loadApp(t);
  assert.equal(IPC_HANDLE_CHANNELS.length, 116);
  assert.deepEqual(app.channels(), [...IPC_HANDLE_CHANNELS].sort());
  assert.deepEqual(app.onChannels(), IPC_ON_CHANNELS);
});
```

- [ ] **Step 3: 今の main.cjs で通ることを確かめる（分ける前の姿を固定する）**

Run: `node --test --test-name-pattern="ipc の窓口の一覧" electron/test/app-regressions.test.cjs`
Expected: PASS（1件）。

- [ ] **Step 4: このテストが本当に落ちることを確かめる**

`IPC_HANDLE_CHANNELS` の中の `"app:version",` を一時的に消して、Step 3 と同じコマンドを動かす。
Expected: FAIL（`IPC_HANDLE_CHANNELS.length` が 115 になる、または一覧が合わない）。確かめたら `"app:version",` を元に戻し、もう一度動かして PASS を確かめる。

- [ ] **Step 5: commit**

```powershell
git add electron/test/app-regressions.test.cjs
git commit -F <メッセージのファイル>   # 「test: ipc の窓口の一覧を固定する（main.cjs の分割の前に）」
```

---

### Task 2: アプリ設定を `electron/app_config.cjs` に分ける

**Files:**
- Create: `electron/app_config.cjs`
- Create: `electron/test/app-config-module.test.cjs`
- Modify: `electron/main.cjs`（App config の区切り、`consumeInstallerSetupReset`、`updater:*`・`app:version`・`app:config:*` の ipc、先頭の配線）
- Modify: `electron/test/game-mods-after-update.test.cjs`（189行目の切り出し元）

**Interfaces:**
- Produces: `createAppConfig({ app, assertGameProfileIdle, assertMapIdle, isServerStarting, getConfigPath, getSettingsBackups, refreshGameModsOnStartup })` → `{ getAppConfigPath(), readAppConfig(), writeAppConfig(data), readPublicAppConfig(), sanitizeRendererAppConfigUpdate(data), consumeInstallerSetupReset(), register(ipcMain) }`。`register` は `updater:status`・`updater:check`・`updater:install`・`app:version`・`app:config:read`・`app:config:write` を登録する。
  - `assertGameProfileIdle()`・`assertMapIdle()` は止めるときに投げる関数。`isServerStarting()` は真偽。`getConfigPath()` は文字列。`getSettingsBackups()` は settingsBackups（`create(kind)` を持つ）。`refreshGameModsOnStartup()` は Promise。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/app-config-module.test.cjs`:

```js
// アプリ設定（app-config.json）の読み書きと、その ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAppConfig } = require('../app_config.cjs');

function setup(t, { packaged = false, serverStarting = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], handlers = new Map();
  const app = { isPackaged: packaged, getPath: () => dir, getVersion: () => '9.9.9' };
  const appConfig = createAppConfig({
    app,
    assertGameProfileIdle: () => calls.push('gameProfileIdle'),
    assertMapIdle: () => calls.push('mapIdle'),
    isServerStarting: () => serverStarting,
    getConfigPath: () => path.join(dir, 'config.minecraft.json'),
    getSettingsBackups: () => ({ create: kind => calls.push('backup:' + kind) }),
    refreshGameModsOnStartup: async () => { calls.push('refreshMods'); },
  });
  appConfig.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, app, appConfig, calls, invoke: (name, ...args) => handlers.get(name)({}, ...args), handlers };
}

test('読み込み: ファイルがない・壊れているときは既定値、書き込みは今の値に足し、保存先は絶対パスにする', t => {
  const { dir, appConfig } = setup(t);
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false });
  fs.writeFileSync(path.join(dir, 'app-config.json'), '{壊れた');
  assert.deepEqual(appConfig.readAppConfig(), { serverFolder: '', setupComplete: false });
  appConfig.writeAppConfig({ serverFolder: 'server', authEmail: 'a@b.cd', authToken: 't', authLoginAt: 'x' });
  appConfig.writeAppConfig({ minecraftPlayerName: 'Steve' });
  const saved = appConfig.readAppConfig();
  assert.equal(path.isAbsolute(saved.serverFolder), true);
  assert.equal(saved.minecraftPlayerName, 'Steve');
  assert.equal(appConfig.getAppConfigPath(), path.join(dir, 'app-config.json'));
  assert.deepEqual(Object.keys(appConfig.readPublicAppConfig()).sort(), ['minecraftPlayerName', 'serverFolder', 'setupComplete'], '画面にはログインの情報を渡さない');
});

test('画面からの書き込みは決まった項目・型だけ', () => {
  const { sanitizeRendererAppConfigUpdate } = createAppConfig({ app: { getPath: () => os.tmpdir() } });
  assert.deepEqual(sanitizeRendererAppConfigUpdate({ setupComplete: true, minecraftPlayerName: 'Steve' }), { setupComplete: true, minecraftPlayerName: 'Steve' });
  assert.throws(() => sanitizeRendererAppConfigUpdate({ authToken: 'x' }), /変更できないアプリ設定です: authToken/);
  assert.throws(() => sanitizeRendererAppConfigUpdate({ setupComplete: 'yes' }), /setupComplete must be a boolean/);
  assert.throws(() => sanitizeRendererAppConfigUpdate({ serverFolder: 'x'.repeat(4097) }), /serverFolder must be a string/);
});

test('ipc: 版・手動配布の知らせ・設定の読み書きを登録する', async t => {
  const { invoke, handlers } = setup(t);
  assert.deepEqual([...handlers.keys()].sort(), ['app:config:read', 'app:config:write', 'app:version', 'updater:check', 'updater:install', 'updater:status']);
  assert.equal(await invoke('app:version'), '9.9.9');
  assert.equal((await invoke('updater:check')).state, 'manual');
  assert.deepEqual([(await invoke('updater:install')).ok, (await invoke('updater:install')).version], [false, '9.9.9']);
  assert.deepEqual(await invoke('app:config:write', { minecraftPlayerName: 'Alex' }), { ok: true });
  assert.equal((await invoke('app:config:read')).minecraftPlayerName, 'Alex');
  await assert.rejects(invoke('app:config:write', null), /data must be an object/);
});

test('保存先は止まっているときだけ変える。サーバーの起動中は理由を返す', async t => {
  const { invoke, calls } = setup(t, { serverStarting: true });
  await assert.rejects(invoke('app:config:write', { serverFolder: 'other' }), /サーバーの起動中は保存先を変更できません。/);
  assert.deepEqual(calls, ['gameProfileIdle', 'mapIdle']);
});

test('自動バックアップの切り替えでは、設定があれば先にバックアップする。初期セットアップを終えたら MOD を入れ替える', async t => {
  const { dir, invoke, calls } = setup(t);
  fs.writeFileSync(path.join(dir, 'config.minecraft.json'), '{}');
  await invoke('app:config:write', { autoBackupOnServerStart: true });
  assert.ok(calls.includes('backup:automatic'));
  await invoke('app:config:write', { setupComplete: true });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(calls.includes('refreshMods'));
});

test('インストーラーの印は配布版でだけ受け取り、初期セットアップをやり直す', t => {
  for (const packaged of [false, true]) {
    const { dir, appConfig } = setup(t, { packaged });
    fs.writeFileSync(path.join(dir, 'require-initial-setup.flag'), '');
    appConfig.writeAppConfig({ setupComplete: true, serverFolder: dir });
    appConfig.consumeInstallerSetupReset();
    assert.equal(fs.existsSync(path.join(dir, 'require-initial-setup.flag')), !packaged);
    assert.equal(appConfig.readAppConfig().setupComplete, !packaged);
    assert.equal(appConfig.readAppConfig().serverFolder, dir, '保存先は残す');
  }
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/app-config-module.test.cjs`
Expected: FAIL（`Cannot find module '../app_config.cjs'`）。

- [ ] **Step 3: `electron/app_config.cjs` を作る（main.cjs から移す）**

```js
// アプリ設定（userData/app-config.json）の読み書きと、その ipc（版・手動配布の知らせを含む）。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、app などは main から受け取る。
const path = require("path");
const fs = require("fs");

const RENDERER_APP_CONFIG_FIELDS = new Set([
  "serverFolder",
  "setupComplete",
  "setupRequiredByInstall",
  "minecraftPlayerName",
  "minecraftLauncherPath",
  "autoBackupOnServerStart",
]);

// あとで main で作られるもの（設定のバックアップ・サーバーの状態など）は、呼ばれたときに読む関数で受け取る。
function createAppConfig({ app, assertGameProfileIdle, assertMapIdle, isServerStarting, getConfigPath, getSettingsBackups, refreshGameModsOnStartup }) {
  function getAppConfigPath() {
    return path.join(app.getPath("userData"), "app-config.json");
  }

  function readAppConfig() {
    const p = getAppConfigPath();
    if (!fs.existsSync(p)) return { serverFolder: "", setupComplete: false };
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
    catch { return { serverFolder: "", setupComplete: false }; }
  }

  function writeAppConfig(data) {
    const p = getAppConfigPath();
    const current = readAppConfig();
    const next = { ...current, ...data };
    if (next.serverFolder) next.serverFolder = path.resolve(next.serverFolder);
    fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  }

  function readPublicAppConfig() {
    const config = readAppConfig();
    const { authEmail: _authEmail, authToken: _authToken, authLoginAt: _authLoginAt, ...publicConfig } = config;
    return publicConfig;
  }

  function sanitizeRendererAppConfigUpdate(data) {
    const next = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (!RENDERER_APP_CONFIG_FIELDS.has(key)) throw new Error(`変更できないアプリ設定です: ${key}`);
      if (["setupComplete", "setupRequiredByInstall", "autoBackupOnServerStart"].includes(key)) {
        if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
        next[key] = value;
        continue;
      }
      if (typeof value !== "string" || value.length > 4096) throw new Error(`${key} must be a string`);
      next[key] = value;
    }
    return next;
  }

  /**
   * The NSIS installer writes this one-shot marker after every successful install.
   * Consuming it here makes an installed build always open behind the setup gate,
   * while preserving the previously selected server folder for returning users.
   */
  function consumeInstallerSetupReset() {
    if (!app.isPackaged) return;

    const markerPath = path.join(app.getPath("userData"), "require-initial-setup.flag");
    if (!fs.existsSync(markerPath)) return;

    try {
      writeAppConfig({
        setupComplete: false,
        setupRequiredByInstall: true,
        setupRequiredAt: new Date().toISOString(),
      });
      fs.unlinkSync(markerPath);
    } catch (error) {
      console.warn("[setup] failed to consume installer reset marker:", error?.message || error);
    }
  }

  // Compatibility IPCs never contact GitHub or launch an installer. Distribution is manual.
  function manualUpdateStatus() {
    return { state: "manual", version: app.getVersion(), percent: 0, error: "", checkedAt: null,
      message: "最新版は配布者から受け取り、インストーラーを実行してください。" };
  }

  function register(ipcMain) {
    ipcMain.handle("updater:status", manualUpdateStatus);
    ipcMain.handle("updater:check", manualUpdateStatus);
    ipcMain.handle("updater:install", () => ({ ok: false, ...manualUpdateStatus() }));

    // アプリバージョン（UIのハードコード表記を廃してこれを使う）
    ipcMain.handle("app:version", () => app.getVersion());

    ipcMain.handle("app:config:read", async () => readPublicAppConfig());

    ipcMain.handle("app:config:write", async (_event, data) => {
      assertGameProfileIdle();
      if (data && ('serverFolder' in data || 'world' in data)) { assertMapIdle(); if (isServerStarting()) throw new Error('サーバーの起動中は保存先を変更できません。'); }
      if (typeof data !== "object" || data === null) throw new Error("data must be an object");
      if (Object.hasOwn(data, "autoBackupOnServerStart") && data.autoBackupOnServerStart !== readAppConfig().autoBackupOnServerStart && fs.existsSync(getConfigPath())) getSettingsBackups().create("automatic");
      const wasSetupComplete = readAppConfig().setupComplete === true;
      writeAppConfig(sanitizeRendererAppConfigUpdate(data));
      // 手動インストール（更新も含む）のあとは初期セットアップをやり直す。終えたら、アプリの更新に合わせて MOD を入れ替える（PR #91 レビュー）。
      if (!wasSetupComplete && readAppConfig().setupComplete === true) setTimeout(() => { refreshGameModsOnStartup().catch(e => console.warn("[games]", e?.message || e)); }, 0);
      return { ok: true };
    });
  }

  return { getAppConfigPath, readAppConfig, writeAppConfig, readPublicAppConfig, sanitizeRendererAppConfigUpdate, consumeInstallerSetupReset, register };
}

module.exports = { createAppConfig };
```

- [ ] **Step 4: モジュールのテストが通ることを確かめる**

Run: `node --test electron/test/app-config-module.test.cjs`
Expected: 6件とも PASS。

- [ ] **Step 5: main.cjs から移した所を消し、配線を足す**

`electron/main.cjs` で次を行う（行番号は分ける前の目安。文字列で探す）。

1. 消す:
   - 「// App config (userData/app-config.json)」の見出し3行から、`function sanitizeRendererAppConfigUpdate(data) {...}` の閉じ `}` まで（560〜610行目あたり）。
   - `consumeInstallerSetupReset` の説明コメント（`/**` から `*/`）と関数全体（662〜683行目あたり）。
   - `// Compatibility IPCs never contact GitHub ...` から `ipcMain.handle("updater:install", ...);` まで（509〜516行目あたり）。`ipcMain.handle("config:validate", ...)` の行は残す。
   - `// アプリバージョン（UIのハードコード表記を廃してこれを使う）` と `ipcMain.handle("app:version", () => app.getVersion());` の2行。
   - 「// IPC: App config」の見出し3行から、`app:config:write` の ipc の閉じ `});` まで（2491〜2506行目あたり）。
2. `const { tasklistNames, minecraftProcesses, readJavaCommandLines, switchBlockedMessage } = require('./minecraft_processes.cjs');` の次の行に足す:

```js
// main.cjs から分けた仕事（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// electron は main だけが読み込み、必要なものを渡す。あとで定義するもの（サーバーの状態など）は、呼ばれたときに読む関数で渡す。
const { createAppConfig } = require('./app_config.cjs');
const appConfig = createAppConfig({
  app,
  assertGameProfileIdle: () => assertGameProfileIdle(),
  assertMapIdle: () => assertMapIdle(),
  isServerStarting: () => serverStarting,
  getConfigPath: () => getConfigPath(),
  getSettingsBackups: () => settingsBackups,
  refreshGameModsOnStartup: () => refreshGameModsOnStartup(),
});
const { getAppConfigPath, readAppConfig, writeAppConfig, consumeInstallerSetupReset } = appConfig;
appConfig.register(ipcMain);
```

- [ ] **Step 6: main.cjs のコードを見ていたテストを、移した先に合わせる**

`electron/test/game-mods-after-update.test.cjs` の189行目を次の2行に置き換える（正規表現は変えない）:

```js
  // app:config:write は electron/app_config.cjs へ移した（2026-10-17 main.cjs の分割）。
  const appConfigSource = read('electron/app_config.cjs');
  const write = appConfigSource.slice(appConfigSource.indexOf('ipcMain.handle("app:config:write"'));
```

- [ ] **Step 7: 全体が通ることを確かめる**

Run: `node --check electron/main.cjs; node --test electron/test/app-config-module.test.cjs electron/test/game-mods-after-update.test.cjs electron/test/app-regressions.test.cjs`
Expected: すべて PASS（ipc の窓口の一覧のテストも通る）。

- [ ] **Step 8: commit**

```powershell
git add electron/app_config.cjs electron/test/app-config-module.test.cjs electron/main.cjs electron/test/game-mods-after-update.test.cjs
git commit -F <メッセージのファイル>   # 「refactor: アプリ設定を app_config.cjs に分ける（main.cjs の分割 PR1）」
```

---

### Task 3: 配置の場所を `electron/paths.cjs` に分ける

**Files:**
- Create: `electron/paths.cjs`
- Create: `electron/test/paths-module.test.cjs`
- Modify: `electron/main.cjs`（Paths の区切り、Helpers の区切りの場所の関数、Paths: Server / Bridge の区切り、Paths: GiftsViewer の場所の関数、先頭の配線）

**Interfaces:**
- Consumes: Task 2 の `readAppConfig()`。
- Produces: `createPaths({ app, process, appDir, readAppConfig })` → `{ getInstalledBridgeRoot, getBridgeDir, getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath, ensureDir, ensureConfigExists, getServerTemplatePath, getServerRoot, getBridgeBatDir, detectBundledNodeExe, getNodeCommand, getToolsPath, ensureToolsExist, getGvToolsDir, getGvDataDir, getGvSettingsPath, getGvToolPath }`（どれも main.cjs の今の関数と同じ引数・戻り値）。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/paths-module.test.cjs`:

```js
// 配置の場所（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 開発版はリポジトリの中、配布版は resources とユーザーのフォルダー。分ける前と同じ場所を返すことを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPaths } = require('../paths.cjs');

function setup(t, { packaged = false, appConfig = {}, platform = 'win32' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'userData'), documents = path.join(root, 'documents'), resources = path.join(root, 'resources');
  const app = { isPackaged: packaged, getPath: name => ({ userData, documents, appData: path.join(root, 'appData') })[name] };
  const paths = createPaths({ app, process: { resourcesPath: resources, platform }, appDir: path.join(root, 'repo', 'electron'), readAppConfig: () => appConfig });
  return { root, userData, documents, resources, repo: path.join(root, 'repo'), paths };
}

test('開発版の場所は、リポジトリ（main.cjs の1つ上）の中', t => {
  const { repo, paths } = setup(t, { packaged: false });
  assert.equal(paths.getInstalledBridgeRoot(), path.join(repo, 'bridge_runtime'));
  assert.equal(paths.getBridgeDir(), path.join(repo, 'bridge_runtime', 'bridge'));
  assert.equal(paths.getBridgeBatDir(), path.join(repo, 'bridge'));
  assert.equal(paths.getConfigPath(), path.join(repo, 'bridge', 'config.minecraft.json'));
  assert.equal(paths.getServerTemplatePath(), path.join(repo, 'server', 'Douma_Craft'));
  assert.equal(paths.getServerRoot(), path.join(repo, 'server', 'Douma_Craft'));
  assert.equal(paths.getGiftsMinPath(), path.join(repo, 'GiftsViewer', 'data', 'gifts', 'gifts.min.json'));
  assert.equal(paths.getGvDataDir(), path.join(repo, 'GiftsViewer', 'data', 'gifts'));
  assert.equal(paths.getGvToolsDir(), path.join(repo, 'GiftsViewer', 'tools'), 'tools-bundled がなければ tools');
  fs.mkdirSync(path.join(repo, 'GiftsViewer', 'tools-bundled'), { recursive: true });
  assert.equal(paths.getGvToolPath('fetch_gifts.cjs'), path.join(repo, 'GiftsViewer', 'tools-bundled', 'fetch_gifts.cjs'));
});

test('配布版の場所は、resources とユーザーのフォルダー。保存先が決まっていれば、そこを優先する', t => {
  const { userData, documents, resources, paths } = setup(t, { packaged: true });
  assert.equal(paths.getInstalledBridgeRoot(), path.join(resources, 'bridge'));
  assert.equal(paths.getServerTemplatePath(), path.join(resources, 'server', 'Douma_Craft'));
  assert.equal(paths.getServerRoot(), path.join(documents, 'MyGamePack', 'Server'), '初回の保存先はアプリの外');
  assert.equal(paths.getBridgeBatDir(), path.join(userData, 'bridge'), 'セットアップ前は userData/bridge');
  assert.equal(paths.getGvToolsDir(), path.join(resources, 'gv-tools'));
  assert.equal(paths.getGvDataDir(), path.join(userData, 'gv-data', 'gifts'));
  assert.equal(paths.getGvSettingsPath(), path.join(userData, 'gv-settings.json'));
  const server = path.join(userData, 'myServer');
  fs.mkdirSync(server, { recursive: true });
  const configured = setup(t, { packaged: true, appConfig: { serverFolder: server, setupComplete: true } }).paths;
  assert.equal(configured.getServerRoot(), path.resolve(server));
  assert.equal(configured.getBridgeBatDir(), path.join(server, 'bridge'));
  const missing = setup(t, { packaged: true, appConfig: { serverFolder: path.join(userData, 'gone'), setupComplete: true } }).paths;
  assert.equal(missing.getServerRoot(), path.resolve(path.join(userData, 'gone')), '保存先が消えていても別のサーバーに切り替えない');
});

test('同梱の node を探し、なければ PATH の node。Windows 以外は node', t => {
  const { repo, paths } = setup(t, { packaged: false });
  assert.equal(paths.detectBundledNodeExe(), null);
  assert.equal(paths.getNodeCommand(), 'node');
  const exe = path.join(repo, 'bridge', 'node', 'node.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, '');
  assert.equal(paths.getNodeCommand(), exe);
  assert.equal(setup(t, { platform: 'linux' }).paths.getNodeCommand(), 'node');
});

test('BRIDGE の設定がなければ、すべての項目がそろった形で作る（作ったあとは書き換えない）', t => {
  const { root, paths } = setup(t);
  const file = path.join(root, 'new', 'config.minecraft.json');
  paths.ensureConfigExists(file);
  const created = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(created.options.commandTransport, 'bridge_mod');
  assert.deepEqual(created.mappings, []);
  fs.writeFileSync(file, '{"keep":true}');
  paths.ensureConfigExists(file);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"keep":true}');
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/paths-module.test.cjs`
Expected: FAIL（`Cannot find module '../paths.cjs'`）。

- [ ] **Step 3: `electron/paths.cjs` を作る（main.cjs から移す）**

```js
// 配置の場所（同梱の BRIDGE・設定・ギフト・サーバー・同梱 node・GiftsViewer）。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// app・process・appDir（main.cjs の __dirname）は main から受け取る。テストは main.cjs を一時フォルダーで動かすので、自分の __dirname は使わない。
const path = require("path");
const fs = require("fs");

function createPaths({ app, process, appDir, readAppConfig }) {
  // ✅ 重要：dev/prod ではなく「パッケージ済みか」で分岐する
  // - electron . / electron:dev / electron:prod（未パッケージ） => ui/bridge_runtime を見る
  // - exe化（electron-builder）後（パッケージ）             => <install>/resources/bridge を見る
  function getInstalledBridgeRoot() {
    if (!app.isPackaged) {
      return path.resolve(appDir, "..", "bridge_runtime"); // ui/bridge_runtime
    }
    return path.join(process.resourcesPath, "bridge"); // <install>/resources/bridge
  }

  /**
   * resources/bridge/
   * ├─ start_all.bat
   * ├─ node/                     (同梱nodeをここに置くなら)
   * ├─ server/
   * └─ bridge/
   *    ├─ config.minecraft.json
   *    ├─ tools/
   *    │   ├─ fetch_gifts.js
   *    │   └─ gifts_to_html.js
   *    └─ data/
   *        └─ gifts/
   *            ├─ gifts.min.json
   *            ├─ gifts.full.json
   *            ├─ gifts.meta.json
   *            └─ gifts.html
   */
  function getBridgeDir() {
    return path.join(getInstalledBridgeRoot(), "bridge");
  }

  function getConfigPath() {
    return path.join(getBridgeBatDir(), "config.minecraft.json");
  }

  // gifts データは GiftsViewer と共有（tools-bundled を使うため）
  function getGiftsDir() {
    const dir = !app.isPackaged
      ? path.resolve(appDir, "..", "GiftsViewer", "data", "gifts")
      : path.join(app.getPath("userData"), "gv-data", "gifts");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function getGiftsMinPath() {
    return path.join(getGiftsDir(), "gifts.min.json");
  }

  function getGiftsMetaPath() {
    return path.join(getGiftsDir(), "gifts.meta.json");
  }

  function getGiftsHtmlPath() {
    return path.join(getGiftsDir(), "gifts.html");
  }

  function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
  }

  function ensureConfigExists(configPath) {
    if (fs.existsSync(configPath)) return;

    ensureDir(path.dirname(configPath));

    // options/likeEvents/各種イベントを欠いた最小configだと、config:write の commandsDir矯正
    // （options が無いと発火しない）や各イベントの既定動作が効かなくなるため、完全な形で書き出す。
    const defaultConfig = {
      tiktokUsername: "",
      rcon: { host: "127.0.0.1", port: 25575, password: "" },
      mappings: [],
      likeEvents: [],
      unmappedGiftEvent: { commandFile: "", repeat: 1, enabled: false },
      shareEvent: { commandFile: "", repeat: 1, enabled: false },
      followEvent: { commandFile: "", repeat: 1, enabled: false },
      memberEvent: { commandFile: "", repeat: 1, enabled: false },
      options: {
        giftCooldownMs: 300,
        maxCommandsPerGift: 200,
        commandTransport: "bridge_mod",
        bridgeModHost: "127.0.0.1",
        bridgeModPort: 25576,
        maxLikeCatchUpPerEvent: 5,
        logUnknownGifts: true,
      },
    };

    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");
  }

  // テンプレートパス（常にバンドル版を返す）
  function getServerTemplatePath() {
    if (!app.isPackaged) return path.resolve(appDir, "..", "server", "Douma_Craft");
    return path.join(process.resourcesPath, "server", "Douma_Craft");
  }

  function getServerRoot() {
    // app-config.json に保存されたフォルダを優先
    const cfg = readAppConfig();
    // 指定先が消えていても別のサーバーに切り替えない。診断画面で同じパスを示す。
    if (cfg.serverFolder) return path.resolve(cfg.serverFolder);
    // 初回の保存先はアプリの外。更新・アンインストールでワールドを失わない。
    if (!app.isPackaged) return path.resolve(appDir, "..", "server", "Douma_Craft");
    return path.join(app.getPath("documents"), "MyGamePack", "Server");
  }

  function getBridgeBatDir() {
    // dev: ui/bridge をそのまま使用
    if (!app.isPackaged) {
      return path.resolve(appDir, "..", "bridge");
    }
    // packaged: setupComplete=true なら serverFolder/bridge、それ以外は userData/bridge（フォールバック）
    const cfg = readAppConfig();
    if (cfg.setupComplete && cfg.serverFolder && fs.existsSync(cfg.serverFolder)) {
      return path.join(cfg.serverFolder, "bridge");
    }
    return path.join(app.getPath("userData"), "bridge");
  }

  function detectBundledNodeExe() {
    // 置き方が複数あり得るので順に探す。
    // v1.0.12以降: resources/bridge/bridge-runtime.zip を serverFolder/bridge へ必要時展開する。
    const candidates = [];
    try { candidates.push(path.join(getBridgeBatDir(), "node", "node.exe")); } catch {}
    try { candidates.push(path.join(app.getPath("userData"), "bridge", "node", "node.exe")); } catch {}
    try { candidates.push(path.join(getInstalledBridgeRoot(), "node", "node.exe")); } catch {}
    if (app.isPackaged) candidates.push(path.join(process.resourcesPath, "node", "node.exe"));

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }

    return null;
  }

  function getNodeCommand() {
    if (process.platform !== "win32") return "node";
    const bundled = detectBundledNodeExe();
    return bundled || "node"; // 最悪PATH
  }

  function getToolsPath(name) {
    return path.join(getBridgeDir(), "tools", name);
  }

  function ensureToolsExist() {
    const fetchJs = getToolsPath("fetch_gifts.js");
    const htmlJs = getToolsPath("gifts_to_html.js");
    if (!fs.existsSync(fetchJs)) throw new Error(`tools not found: ${fetchJs}`);
    if (!fs.existsSync(htmlJs)) throw new Error(`tools not found: ${htmlJs}`);
  }

  // GiftsViewer
  function getGvToolsDir() {
    if (!app.isPackaged) {
      // tools-bundled を優先（.cjs バンドル済み）、なければ tools
      const bundled = path.resolve(appDir, "..", "GiftsViewer", "tools-bundled");
      if (fs.existsSync(bundled)) return bundled;
      return path.resolve(appDir, "..", "GiftsViewer", "tools");
    }
    return path.join(process.resourcesPath, "gv-tools");
  }

  function getGvDataDir() {
    const dir = !app.isPackaged
      ? path.resolve(appDir, "..", "GiftsViewer", "data", "gifts")
      : path.join(app.getPath("userData"), "gv-data", "gifts");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function getGvSettingsPath() {
    return path.join(app.getPath("userData"), "gv-settings.json");
  }

  function getGvToolPath(name) {
    return path.join(getGvToolsDir(), name);
  }

  return {
    getInstalledBridgeRoot, getBridgeDir, getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath,
    ensureDir, ensureConfigExists, getServerTemplatePath, getServerRoot, getBridgeBatDir,
    detectBundledNodeExe, getNodeCommand, getToolsPath, ensureToolsExist,
    getGvToolsDir, getGvDataDir, getGvSettingsPath, getGvToolPath,
  };
}

module.exports = { createPaths };
```

- [ ] **Step 4: モジュールのテストが通ることを確かめる**

Run: `node --test electron/test/paths-module.test.cjs`
Expected: 4件とも PASS。

- [ ] **Step 5: main.cjs から移した所を消し、配線を足す**

1. 消す:
   - 「// Paths (A方式: Bridge同梱)」の見出しから、`ensureConfigExists` の閉じ `}` まで（136〜227行目あたり）。
   - `function detectBundledNodeExe() {...}`（337〜351行目あたり）。
   - `function getNodeCommand() {...}`・`function getToolsPath(name) {...}`・`function ensureToolsExist() {...}`（362〜377行目あたり）。「// Helpers: run process and capture logs」の見出しは、ウィンドウの ipc（`window:*`）が Task 5 で移るまで残してよい。
   - 「// Paths: Server / Bridge (UI統合用)」の見出しから、`getBridgeBatDir` の閉じ `}` まで（685〜716行目あたり）。
   - 「// Paths: GiftsViewer」の見出しの下の `getGvToolsDir`・`getGvDataDir`・`getGvSettingsPath`・`getGvToolPath` の4つ（2311〜2335行目あたり）。`autoUpdateGiftsIfStale` は残す（PR2 で移す）。
2. Task 2 で足した `appConfig.register(ipcMain);` の次の行に足す:

```js
const { createPaths } = require('./paths.cjs');
// テスト（loadApp）は main.cjs を一時フォルダーで動かし、__dirname と process を偽物にする。モジュールにはこちらを渡す。
const paths = createPaths({ app, process, appDir: __dirname, readAppConfig });
const {
  getInstalledBridgeRoot, getBridgeDir, getConfigPath, getGiftsDir, getGiftsMinPath, getGiftsMetaPath, getGiftsHtmlPath,
  ensureDir, ensureConfigExists, getServerTemplatePath, getServerRoot, getBridgeBatDir,
  getNodeCommand, getGvDataDir, getGvSettingsPath, getGvToolPath,
} = paths;
```

3. 分割代入した名前のうち main.cjs で使っていないものがあれば外す（Grep で `\bname\(` を確かめる。`detectBundledNodeExe`・`getToolsPath`・`ensureToolsExist`・`getGvToolsDir` は main.cjs で直接は使っていないので入れていない）。逆に、main.cjs で使っているのに入れ忘れた名前があれば、`node --check` は通っても実行時に ReferenceError になるので、Grep で消した関数名がすべて分割代入か、モジュールの中だけで使われていることを確かめる。

- [ ] **Step 6: 全体が通ることを確かめる**

Run: `node --check electron/main.cjs; npm run test:app`
Expected: すべて PASS（ipc の窓口の一覧のテストも通る）。

- [ ] **Step 7: commit**

```powershell
git add electron/paths.cjs electron/test/paths-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: 配置の場所を paths.cjs に分ける（main.cjs の分割 PR1）」
```

---

### Task 4: 運営ログインを `electron/operator_auth.cjs` に分ける

**Files:**
- Create: `electron/operator_auth.cjs`
- Create: `electron/test/operator-auth-module.test.cjs`
- Modify: `electron/main.cjs`（運営ログイン認証の区切り、`auth:*` の ipc、先頭の配線）

**Interfaces:**
- Consumes: Task 2 の `readAppConfig()`・`writeAppConfig(data)`。
- Produces: `createOperatorAuth({ readAppConfig, writeAppConfig, credentials?, now? })` → `{ verifyOperatorPassword(password): boolean, operatorLoginToken(email): string, isValidLoginEmail(email): boolean, isOperatorAuthed(): boolean, register(ipcMain) }`。`register` は `auth:status`・`auth:login`・`auth:logout` を登録する。`credentials`（`{ salt, hash, iterations, keyLen }`）と `now`（`() => number`）はテストで差し替えるためのもので、本番は既定値。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/operator-auth-module.test.cjs`:

```js
// 運営ログインと、その ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 本物のパスワードはリポジトリに置かないので、テストでは自分で作ったハッシュを渡す。
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createOperatorAuth } = require('../operator_auth.cjs');

const credentials = { salt: 'test-salt', iterations: 1000, keyLen: 32,
  hash: crypto.pbkdf2Sync('test-pass', 'test-salt', 1000, 32, 'sha256').toString('hex') };

function setup() {
  let config = {}, clock = 1_000_000;
  const handlers = new Map();
  const auth = createOperatorAuth({ readAppConfig: () => config, writeAppConfig: data => { config = { ...config, ...data }; },
    credentials, now: () => clock });
  auth.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { auth, invoke: (name, ...args) => handlers.get(name)({}, ...args), config: () => config, advance: ms => { clock += ms; }, handlers };
}

test('ipc: ログインの状態・ログイン・ログアウトを登録する', () => {
  assert.deepEqual([...setup().handlers.keys()].sort(), ['auth:login', 'auth:logout', 'auth:status']);
});

test('正しいパスワードでログインし、メールアドレスとトークンを保存する（パスワードは保存しない）。ログアウトで消す', async () => {
  const { auth, invoke, config } = setup();
  assert.deepEqual(await invoke('auth:status'), { authenticated: false, email: '' });
  assert.deepEqual(await invoke('auth:login', { email: ' op@example.com ', password: 'test-pass' }), { ok: true, email: 'op@example.com' });
  assert.equal(config().authToken, auth.operatorLoginToken('op@example.com'));
  assert.ok(!JSON.stringify(config()).includes('test-pass'));
  assert.deepEqual(await invoke('auth:status'), { authenticated: true, email: 'op@example.com' });
  assert.equal(auth.isOperatorAuthed(), true);
  await invoke('auth:logout');
  assert.deepEqual(await invoke('auth:status'), { authenticated: false, email: '' });
  assert.equal(auth.isOperatorAuthed(), false);
});

test('メールアドレスの形とパスワードを確かめ、トークンが合わなければログインしていない扱い', async () => {
  const { auth, invoke, config } = setup();
  assert.match((await invoke('auth:login', { email: 'not-mail', password: 'test-pass' })).message, /メールアドレスの形式が正しくありません/);
  assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'wrong' })).message, /パスワードが違います/);
  Object.assign(config(), { authEmail: 'op@example.com', authToken: 'forged' });
  assert.deepEqual(await invoke('auth:status'), { authenticated: false, email: '' });
  assert.equal(auth.verifyOperatorPassword('test-pass'), true);
  assert.equal(auth.isValidLoginEmail('a@b.cd'), true);
});

test('失敗が5回続いたら60秒止める。過ぎたら試せて、成功したら数え直す', async () => {
  const { invoke, advance } = setup();
  for (let i = 0; i < 5; i++) assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'wrong' })).message, /パスワードが違います/);
  assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).message, /ログイン試行が多すぎます。60秒後に再試行してください/);
  advance(30_000);
  assert.match((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).message, /30秒後/);
  advance(30_001);
  assert.equal((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).ok, true);
  for (let i = 0; i < 4; i++) await invoke('auth:login', { email: 'op@example.com', password: 'wrong' });
  assert.equal((await invoke('auth:login', { email: 'op@example.com', password: 'test-pass' })).ok, true, '4回の失敗では止めない');
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/operator-auth-module.test.cjs`
Expected: FAIL（`Cannot find module '../operator_auth.cjs'`）。

- [ ] **Step 3: `electron/operator_auth.cjs` を作る（main.cjs から移す）**

```js
// 運営ログインと、その ipc。main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// リポジトリは public のため平文パスワードは一切置かない。PBKDF2ハッシュのみを埋め込む。
// ログイン成功後は authEmail + authToken(HMAC) を app-config.json に保存し、次回起動時は
// トークン再計算で照合する（パスワード自体は保存しない）。
const crypto = require("crypto");

const OPERATOR_AUTH = {
  salt: "fa2e3d72dcba1a83977e4cac983c5366",
  hash: "8365be19bbae0379de9af9cb411e3883ae9faa82d6eb244ce5e1725a810d1c0c",
  iterations: 210000,
  keyLen: 32,
};

// credentials と now はテストで差し替えるためのもの。本番は既定値（上のハッシュと今の時刻）。
function createOperatorAuth({ readAppConfig, writeAppConfig, credentials = OPERATOR_AUTH, now = () => Date.now() }) {
  function verifyOperatorPassword(password) {
    const derived = crypto.pbkdf2Sync(
      String(password),
      credentials.salt,
      credentials.iterations,
      credentials.keyLen,
      "sha256"
    );
    const expected = Buffer.from(credentials.hash, "hex");
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  }

  function operatorLoginToken(email) {
    return crypto
      .createHmac("sha256", credentials.hash)
      .update(String(email).trim().toLowerCase())
      .digest("hex");
  }

  function isValidLoginEmail(email) {
    const v = String(email || "").trim();
    return v.length >= 5 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  let failedAuthAttempts = 0;
  let authLockedUntil = 0;

  // 運営ログイン済みかどうか（auth:status と同じ判定）。UI 全体は LoginPage でゲートされて
  // いるが、コンソール送信のような強い操作は main 側でも二重に確認する（多層防御）。
  function isOperatorAuthed() {
    try {
      const cfg = readAppConfig();
      const email = String(cfg.authEmail || "").trim();
      return !!email && cfg.authToken === operatorLoginToken(email);
    } catch { return false; }
  }

  function register(ipcMain) {
    ipcMain.handle("auth:status", async () => {
      const cfg = readAppConfig();
      const email = String(cfg.authEmail || "").trim();
      if (!email || !cfg.authToken) return { authenticated: false, email: "" };
      const valid = cfg.authToken === operatorLoginToken(email);
      return { authenticated: valid, email: valid ? email : "" };
    });

    ipcMain.handle("auth:login", async (_event, payload) => {
      const current = now();
      if (current < authLockedUntil) {
        const seconds = Math.max(1, Math.ceil((authLockedUntil - current) / 1000));
        return { ok: false, message: `ログイン試行が多すぎます。${seconds}秒後に再試行してください` };
      }
      const email = String(payload?.email || "").trim();
      const password = String(payload?.password || "");
      if (!isValidLoginEmail(email)) {
        return { ok: false, message: "メールアドレスの形式が正しくありません" };
      }
      if (!verifyOperatorPassword(password)) {
        failedAuthAttempts += 1;
        if (failedAuthAttempts >= 5) {
          failedAuthAttempts = 0;
          authLockedUntil = now() + 60000;
        }
        return { ok: false, message: "パスワードが違います" };
      }
      failedAuthAttempts = 0;
      authLockedUntil = 0;
      writeAppConfig({
        authEmail: email,
        authToken: operatorLoginToken(email),
        authLoginAt: new Date().toISOString(),
      });
      return { ok: true, email };
    });

    ipcMain.handle("auth:logout", async () => {
      writeAppConfig({ authEmail: "", authToken: "" });
      return { ok: true };
    });
  }

  return { verifyOperatorPassword, operatorLoginToken, isValidLoginEmail, isOperatorAuthed, register };
}

module.exports = { createOperatorAuth };
```

- [ ] **Step 4: モジュールのテストが通ることを確かめる**

Run: `node --test electron/test/operator-auth-module.test.cjs`
Expected: 4件とも PASS。

- [ ] **Step 5: main.cjs から移した所を消し、配線を足す**

1. 消す:
   - 「// 運営ログイン認証」の見出し3行から、`function isOperatorAuthed() {...}` の閉じ `}` まで（612〜660行目あたり。`consumeInstallerSetupReset` は Task 2 で消してある）。
   - 「// IPC: 運営ログイン認証」の見出し3行から、`ipcMain.handle("auth:logout", ...)` の閉じ `});` まで（2508〜2551行目あたり）。
2. Task 3 で足した paths の分割代入の次の行に足す:

```js
const { createOperatorAuth } = require('./operator_auth.cjs');
const operatorAuth = createOperatorAuth({ readAppConfig, writeAppConfig });
// コンソール送信（server:command）などの強い操作は、main 側でもログイン済みかを確かめる。
const { isOperatorAuthed } = operatorAuth;
operatorAuth.register(ipcMain);
```

3. Grep で `verifyOperatorPassword|operatorLoginToken|isValidLoginEmail|failedAuthAttempts|authLockedUntil|OPERATOR_AUTH` が main.cjs に残っていないことを確かめる。

- [ ] **Step 6: 全体が通ることを確かめる**

Run: `node --check electron/main.cjs; npm run test:app`
Expected: すべて PASS。

- [ ] **Step 7: commit**

```powershell
git add electron/operator_auth.cjs electron/test/operator-auth-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: 運営ログインを operator_auth.cjs に分ける（main.cjs の分割 PR1）」
```

---

### Task 5: ウィンドウを `electron/window.cjs` に分ける

**Files:**
- Create: `electron/window.cjs`
- Create: `electron/test/window-module.test.cjs`
- Modify: `electron/main.cjs`（CSP・Window の区切り、`window:*` の ipc、`isDev` のあとの配線、`pathToFileURL` の require）

**Interfaces:**
- Produces: `createAppWindow({ BrowserWindow, session, dialog, shell, appDir, isDev, isBusy })` → `{ installProdOnlyCsp(), createWindow(): BrowserWindow, register(ipcMain) }`。`register` は `ipcMain.on` で `window:minimize`・`window:maximizeToggle`・`window:close` を登録する。`isBusy()` は「保存・準備中で閉じられない」ときに真。

- [ ] **Step 1: 失敗するテストを書く**

`electron/test/window-module.test.cjs`:

```js
// 画面のウィンドウ・CSP・ウィンドウ操作の ipc（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// 閉じる確認・移動の制限・権限の拒否・CSP は、分ける前と同じであることを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createAppWindow } = require('../window.cjs');

function setup({ isDev = false, busy = false } = {}) {
  const calls = { opened: [], dialogs: [], headers: null, permissionCheck: null, permissionRequest: null, devtools: false, onChannels: new Map() };
  const windowListeners = {}, contentsListeners = {};
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.webContents = {
        setWindowOpenHandler: fn => { this.openHandler = fn; },
        on: (name, fn) => { contentsListeners[name] = fn; },
        openDevTools: () => { calls.devtools = true; },
      };
    }
    on(name, fn) { windowListeners[name] = fn; }
    loadFile(file) { calls.loaded = file; }
    static fromWebContents(sender) { return sender.win; }
  }
  const session = { defaultSession: {
    webRequest: { onHeadersReceived: fn => { calls.headers = fn; } },
    setPermissionCheckHandler: fn => { calls.permissionCheck = fn; },
    setPermissionRequestHandler: fn => { calls.permissionRequest = fn; },
  } };
  const dialog = { showMessageBox: (_win, options) => { calls.dialogs.push(options.title); return Promise.resolve(); }, showMessageBoxSync: () => 0 };
  const shell = { openExternal: url => { calls.opened.push(url); return Promise.resolve(); } };
  const appDir = path.join(path.parse(process.cwd()).root, 'app', 'electron');
  const appWindow = createAppWindow({ BrowserWindow: FakeWindow, session, dialog, shell, appDir, isDev, isBusy: () => busy });
  appWindow.register({ on: (name, fn) => calls.onChannels.set(name, fn) });
  return { appWindow, calls, windowListeners, contentsListeners, appDir };
}

test('ウィンドウ: 枠なし・サンドボックス・preload を付け、dist/index.html を開く。権限はすべて断る', () => {
  const { appWindow, calls, appDir } = setup();
  const win = appWindow.createWindow();
  assert.equal(win.options.frame, false);
  assert.deepEqual(win.options.webPreferences, { preload: path.join(appDir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true });
  assert.equal(calls.loaded, path.join(appDir, '..', 'dist', 'index.html'));
  assert.equal(calls.permissionCheck(), false);
  let granted = null;
  calls.permissionRequest(null, 'media', value => { granted = value; });
  assert.equal(granted, false);
  assert.equal(calls.devtools, false, '開発版でなければ開発者ツールを開かない');
});

test('作業中は閉じない（保存・準備中の知らせを出す）。作業中でなければ閉じる', () => {
  for (const busy of [true, false]) {
    const { appWindow, calls, windowListeners } = setup({ busy });
    appWindow.createWindow();
    let prevented = false;
    windowListeners.close({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, busy);
    assert.deepEqual(calls.dialogs, busy ? ['保存・準備中です'] : []);
  }
});

test('移動は index.html だけ。外部リンクは http(s) だけを OS のブラウザで開き、それ以外は開かない', () => {
  const { appWindow, calls, contentsListeners, appDir } = setup();
  const win = appWindow.createWindow();
  const index = pathToFileURL(path.join(appDir, '..', 'dist', 'index.html')).href;
  const navigate = url => { let prevented = false; contentsListeners['will-navigate']({ preventDefault: () => { prevented = true; } }, url); return prevented; };
  assert.equal(navigate(index + '#/home'), false, 'アプリの中のページ（#）は移動できる');
  assert.equal(navigate(pathToFileURL(path.join(appDir, 'other.html')).href), true);
  assert.equal(navigate('https://example.com/a'), true);
  assert.deepEqual(win.openHandler({ url: 'http://example.com/b' }), { action: 'deny' });
  win.openHandler({ url: 'javascript:alert(1)' });
  win.openHandler({ url: 'ms-settings:privacy' });
  assert.deepEqual(calls.opened, ['https://example.com/a', 'http://example.com/b']);
});

test('CSP は開発版（ELECTRON_DEV=1）では付けず、それ以外では付ける', () => {
  const dev = setup({ isDev: true });
  dev.appWindow.installProdOnlyCsp();
  assert.equal(dev.calls.headers, null);
  const prod = setup();
  prod.appWindow.installProdOnlyCsp();
  let headers = null;
  prod.calls.headers({ responseHeaders: { a: ['b'] } }, value => { headers = value.responseHeaders; });
  assert.deepEqual(headers.a, ['b']);
  assert.match(headers['Content-Security-Policy'][0], /^default-src 'self'; script-src 'self';/);
});

test('ipc: 最小化・最大化の切り替え・閉じるを登録する', () => {
  const { calls } = setup();
  assert.deepEqual([...calls.onChannels.keys()].sort(), ['window:close', 'window:maximizeToggle', 'window:minimize']);
  const done = [];
  let maximized = false;
  const win = { minimize: () => done.push('min'), close: () => done.push('close'), isMaximized: () => maximized,
    maximize: () => { done.push('max'); maximized = true; }, unmaximize: () => { done.push('unmax'); maximized = false; } };
  const event = { sender: { win } };
  calls.onChannels.get('window:minimize')(event);
  calls.onChannels.get('window:maximizeToggle')(event);
  calls.onChannels.get('window:maximizeToggle')(event);
  calls.onChannels.get('window:close')(event);
  assert.deepEqual(done, ['min', 'max', 'unmax', 'close']);
  calls.onChannels.get('window:close')({ sender: {} });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `node --test electron/test/window-module.test.cjs`
Expected: FAIL（`Cannot find module '../window.cjs'`）。

- [ ] **Step 3: `electron/window.cjs` を作る（main.cjs から移す）**

```js
// 画面のウィンドウと CSP、ウィンドウ操作の ipc。main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
// electron は読み込まない。BrowserWindow・session・dialog・shell と appDir（main.cjs の __dirname）は main から受け取る。
const path = require("path");
const { pathToFileURL } = require("url");

// isBusy は「保存・準備中で閉じられない」とき（初期セットアップ・MAP の作業・サーバーの起動と停止・ゲームの切り替え）に真を返す関数。
function createAppWindow({ BrowserWindow, session, dialog, shell, appDir, isDev, isBusy }) {
  // ELECTRON_DEV=1 のときは付けない（Vite開発や調査が楽）
  // それ以外は付ける（electron:prod / exe）
  function installProdOnlyCsp() {
    if (isDev) return;

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            [
              "default-src 'self'",
              "script-src 'self'",
              "style-src 'self' 'unsafe-inline'",
              // gifts画像URLが https のため許可
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              // TTS テスト再生の base64 wav data URI を許可
              "media-src 'self' data:",
              "connect-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          ],
        },
      });
    });
  }

  function createWindow() {
    const iconPath = path.join(appDir, "..", "assets", "icon.ico");
    const indexHtml = path.join(appDir, "..", "dist", "index.html");
    const indexPageUrl = pathToFileURL(indexHtml).href;

    const win = new BrowserWindow({
      width: 1488,
      height: 1000,
      minWidth: 1120,
      minHeight: 720,
      frame: false,
      autoHideMenuBar: true,
      icon: iconPath,
      webPreferences: {
        preload: path.join(appDir, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.on("close", event => {
      if (!isBusy()) return;
      event.preventDefault();
      void dialog.showMessageBox(win, { type: "info", title: "保存・準備中です",
        message: "ワールドと設定を準備しています。保存とサーバー停止が終わるまで、このアプリを開いたままお待ちください。" });
    });

    const openExternalHttpUrl = (rawUrl) => {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
        void shell.openExternal(parsed.href);
      } catch {}
    };

    // 外部リンクは http(s) だけOSブラウザで開く。
    // 任意のカスタムプロトコルをshellへ渡すと、別アプリの危険なURLハンドラを起動し得る。
    win.webContents.setWindowOpenHandler(({ url }) => {
      openExternalHttpUrl(url);
      return { action: "deny" };
    });

    // preload API はこのアプリのindex.htmlだけに公開する。別のローカルHTMLへの
    // file:// 遷移を許すと、そのHTMLから特権IPCを呼べるため必ず遮断する。
    win.webContents.on("will-navigate", (e, url) => {
      const targetWithoutHash = String(url).split("#", 1)[0];
      if (targetWithoutHash === indexPageUrl) return;
      e.preventDefault();
      openExternalHttpUrl(url);
    });

    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    win.webContents.on("will-prevent-unload", (event) => {
      const choice = dialog.showMessageBoxSync(win, {
        type: "question", title: "未保存の変更があります",
        message: "編集中の設定が保存されていません。",
        detail: "変更を残す場合は編集に戻り、保存してから終了してください。",
        buttons: ["編集に戻る", "変更を破棄して終了"], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (choice === 1) event.preventDefault();
    });
    win.loadFile(indexHtml);

    if (isDev) {
      win.webContents.openDevTools({ mode: "detach" });
    }
    return win;
  }

  function register(ipcMain) {
    ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
    ipcMain.on("window:maximizeToggle", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    });
    ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  }

  return { installProdOnlyCsp, createWindow, register };
}

module.exports = { createAppWindow };
```

- [ ] **Step 4: モジュールのテストが通ることを確かめる**

Run: `node --test electron/test/window-module.test.cjs`
Expected: 5件とも PASS。

- [ ] **Step 5: main.cjs から移した所を消し、配線を足す**

1. 消す:
   - 「// CSP (prod only-ish)」の見出しから、`function createWindow() {...}` の閉じ `}` まで（229〜332行目あたり）。
   - `ipcMain.on("window:minimize", ...)` から `ipcMain.on("window:close", ...)` までの7行（353〜360行目あたり）。
   - 「// Helpers: run process and capture logs」の見出し3行（中身は Task 3 と上で空になっている）。
   - `const { pathToFileURL } = require("url");`（Grep で main.cjs にほかの `pathToFileURL` がないことを確かめてから）。
2. `const isDev = process.env.ELECTRON_DEV === "1";` の次の行に足す:

```js
const { createAppWindow } = require('./window.cjs');
// 保存・準備中（初期セットアップ・MAP の作業・サーバーの起動と停止・ゲームの切り替え）はウィンドウを閉じない。
const appWindow = createAppWindow({ BrowserWindow, session, dialog, shell, appDir: __dirname, isDev,
  isBusy: () => initialSetupRunning || mapOperationBusy || serverStarting || serverStopping || gameProfileBusy });
const { installProdOnlyCsp, createWindow } = appWindow;
appWindow.register(ipcMain);
```

3. Grep で main.cjs の `session` が、`require("electron")` と上の配線のほかに残っていなければ、そのままでよい（electron の分割代入は変えない。使っていない名前があっても動きは変わらない）。

- [ ] **Step 6: 全体が通ることを確かめる**

Run: `node --check electron/main.cjs; npm run test:app`
Expected: すべて PASS（ipc の窓口の一覧のテストで、`window:*` の3個も同じ）。

- [ ] **Step 7: commit**

```powershell
git add electron/window.cjs electron/test/window-module.test.cjs electron/main.cjs
git commit -F <メッセージのファイル>   # 「refactor: ウィンドウを window.cjs に分ける（main.cjs の分割 PR1）」
```

---

### Task 6: 設計書に見つけたことを足し、全体を確かめる

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-main-split-design.md`（3 の表・4 の決まり・5 の PR2）
- Modify: `HANDOFF/HANDOFF04.md`（9番の「main.cjs の大きさ」）

- [ ] **Step 1: 設計書に、計画を書くときに見つけたことを足す**

3 の表の `gifts_viewer.cjs` の行の前に1行足す:

```markdown
| `games_ipc.cjs` | ゲームの選択・切り替え・Minecraft の保存先（`games:*` の8個） | 30〜116 |
```

3 の表の下（「main.cjs に残すもの」の前）に足す:

```markdown
- 表の行の範囲の中にあって、名前からは置き場が分かりにくい ipc の置き場（PR1 の計画を書くときに確かめた。2026-10-17）
  - `updater:*`・`app:version` → `app_config.cjs`（PR1）
  - `config:path`・`settings:backups:*`・`preflight:run`・`config:validate`・`bridge:root`・`bridge:dir` → `bridge_settings.cjs`（PR2）
  - `bridge:syncStatus` → `bridge_sync.cjs`（PR3）
  - `clipboard:writeText` → `gifts_viewer.cjs`（PR2）
  - `dialog:pickFolder`・`dialog:pickFile`・`folder:open` → `setup_ipc.cjs`（PR2）
  - `server:command` → `server_process.cjs`、`presets:*`・`world:*` → `map_operations.cjs`、`server:datapack:deployNightVision`・`server:gamerules:apply` → `server_files.cjs`（PR4）
  - `euler:*`・`tiktok:liveStatus` → `bridge_process.cjs`、`stream:session:*`・`image:saveGiftPanel` → `operations_stats.cjs`（PR5）
```

4 の決まりの「`electron` は main.cjs だけが読み込む。」の箇条の次に足す:

```markdown
- `child_process`（`spawn`・`spawnSync`）も main.cjs だけが読み込み、モジュールには渡す。テスト（`loadApp`）は `child_process` も偽物に差し替えている（サーバー・BRIDGE の起動を試すため）。
```

5 の「2. **端の仕事**」の行を次に変える:

```markdown
2. **端の仕事**: `games_ipc.cjs`・`gifts_viewer.cjs`・`tts_ipc.cjs`・`setup_ipc.cjs`・`bridge_settings.cjs`
```

- [ ] **Step 2: HANDOFF04 に PR1 のことを書く**

`HANDOFF/HANDOFF04.md` の9番の `   - main.cjs の大きさ` の行を次に変える（PR 番号は PR を作ったあとで入れる）:

```markdown
   - main.cjs の大きさ（10-17 から進行中。設計書 `docs/superpowers/specs/2026-10-17-main-split-design.md`。PR 6本で仕事ごとのファイルに分ける）
     - PR1（土台）：ipc の窓口の一覧を固定するテスト、`app_config.cjs`・`paths.cjs`・`operator_auth.cjs`・`window.cjs`。ブランチ `refactor/main-split-1`。
     - Codex が D 側の作業コピーで UI/UX を直しているので、分割は scratchpad の worktree（`wt-split`）で進めている。D 側のブランチは切り替えない。
```

- [ ] **Step 3: 全体を確かめる**

Run: `npm run verify`
Expected: typecheck・test:bridge・test:app・build がすべて PASS。

Run: `(Get-Content electron/main.cjs).Count`
Expected: 分ける前（2,954行）より 300 行ほど少ない。

Grep ツールで `TODO|test\.skip|\.only\(` を、このブランチで変えたファイル（`git diff --name-only origin/main...HEAD`）から探す。
Expected: 何も出ない。

- [ ] **Step 4: commit**

```powershell
git add docs/superpowers/specs/2026-10-17-main-split-design.md HANDOFF/HANDOFF04.md
git commit -F <メッセージのファイル>   # 「docs: main.cjs の分割の設計書に見つけたことを足し、HANDOFF に PR1 を書く」
```
