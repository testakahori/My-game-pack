# electron/main.cjs を仕事ごとのファイルに分ける（設計書）

- 日付: 2026-10-17
- 出どころ: アプリレビュー 2026-10-08「main.cjs が大きすぎる」（HANDOFF04 の9番、残っている大きい問題）
- ユーザーの決定（2026-10-17）
  - どこまで分けるか: 全部を仕事ごとに分ける。main.cjs は起動と配線だけにする
  - 作りの方針: 案A。各モジュールは必要なものを main から受け取る（今の `map_saves.cjs`・`game_profiles.cjs` と同じ形）
  - 分け方（下の 3 の表）と進め方（PR 6本、下の 5）: この設計でよい

## 1. 目的

- `electron/main.cjs`（2,954行、ipc の窓口116個）を、仕事ごとのファイルに分ける。
- 1つの仕事を読む・直す・試すときに、ほかの仕事を気にしなくて済むようにする。
- 同じファイルを変える PR 同士がぶつかるのを減らす（#60・#61 で起きた）。
- アプリの動きは変えない。

## 2. 変えないこと（守ること）

- ipc の名前・引数・戻り値・画面に出す文は、1つも変えない。
- `electron/preload.cjs` と画面（`src/`）は変えない。
- 関数の中の処理は、移すだけにする。直すのは、受け取る形を変えるのに必要な所だけ（変数を直接見ていた所を、受け取った関数で見るなど）。
- 処理の中の不具合を見つけても、この作業では直さない。HANDOFF の小さい問題に書く。
- 例外（PR1 の最終レビューで決めた。2026-10-17）: テストで確かめるために戻り値を足すのはよい（`createWindow` がウィンドウを返す。呼び出し側は使わない）。分ける前から誰も呼んでいない関数は、移さずに消してよい（`getToolsPath`・`ensureToolsExist`）。
- `bridge/index.js` の分割は、この作業に含めない。

## 3. 分け方

| ファイル（electron/） | 受け持つこと | 今の main.cjs の行（目安） |
|---|---|---|
| `paths.cjs` | 配置の場所（同梱の BRIDGE・設定・ギフト・サーバー・同梱 node・GiftsViewer のツールとデータ） | 136〜228、334〜378、685〜717、2308〜2353 の場所の部分 |
| `app_config.cjs` | アプリ設定（app-config.json）の読み書きと、その ipc | 560〜611、2491〜2507 |
| `operator_auth.cjs` | 運営ログインと、その ipc | 612〜684、2508〜2552 |
| `window.cjs` | 画面のウィンドウと CSP | 229〜333 |
| `bridge_sync.cjs` | BRIDGE の配布（差分同期・同梱 node の準備・BridgeMOD の jar・ゲーム MOD の入れ替え）、サーバーテンプレートのコピー、BRIDGE の展開 | 718〜1276、2553〜2632 |
| `server_process.cjs` | サーバーの起動・停止・ログ・状態・ポートの確認 | 1277〜1498 のサーバーの部分 |
| `map_operations.cjs` | MAP の保存・読込、ワールドのバックアップ、「いま作業中か」の見張り | 1841〜2083 の MAP の部分 |
| `server_files.cjs` | server.properties・RCON パスワード・配布ワールドの一覧・OP 付与・ゲームルールの古い ipc | 1841〜2083 の OP の部分、2122〜2173、2252〜2274、2706〜2716 |
| `minecraft_client.cjs` | Minecraft の起動、ランチャー・ゲーム本体の稼働の検知 | 1499〜1527、2084〜2121 |
| `bridge_process.cjs` | BRIDGE の起動・停止・再起動・ログ・状態 | 1277〜1498 の BRIDGE の部分、1528〜1640 |
| `bridge_mod_client.cjs` | BridgeMOD との通信、状態・一時停止・再開、テスト発火の受け渡し | 1617〜1840 の通信・テスト発火の部分 |
| `operations_stats.cjs` | 操作履歴・配信統計・視聴者数・統計の書き出し | 1617〜1840 の履歴の部分、2071〜2083 |
| `bridge_settings.cjs` | BRIDGE の設定の読み書き・ギフトの割り当て・テンプレート・配信前チェック・コマンド txt | 415〜526、2633〜2705 |
| `games_ipc.cjs` | ゲームの選択・切り替え・Minecraft の保存先（`games:*` の8個） | 30〜116 |
| `gifts_viewer.cjs` | ギフト一覧（UI タブ・GiftsViewer）の読み込み・更新・画像 | 527〜559、2291〜2490 |
| `tts_ipc.cjs` | 読み上げの設定とエンジン | 2781〜2954 |
| `setup_ipc.cjs` | 初期セットアップ・Forge インストーラー・セットアップの確認・環境の実測・フォルダー選択 | 2174〜2251、2275〜2290、2717〜2780 |

- 表の行の範囲の中にあって、名前からは置き場が分かりにくい ipc の置き場（PR1 の計画を書くときに確かめた。2026-10-17）
  - `updater:*`・`app:version` → `app_config.cjs`（PR1）
  - `config:path`・`settings:backups:*`・`preflight:run`・`config:validate`・`bridge:root`・`bridge:dir` → `bridge_settings.cjs`（PR2）
  - `bridge:syncStatus` → `bridge_sync.cjs`（PR3）
  - `clipboard:writeText` → `gifts_viewer.cjs`（PR2）
  - `dialog:pickFolder`・`dialog:pickFile`・`folder:open` → `setup_ipc.cjs`（PR2）
  - `server:command` → `server_process.cjs`、`presets:*`・`world:*` → `map_operations.cjs`、`server:datapack:deployNightVision`・`server:gamerules:apply` → `server_files.cjs`（PR4）
  - `euler:*`・`tiktok:liveStatus` → `bridge_process.cjs`、`stream:session:*`・`image:saveGiftPanel` → `operations_stats.cjs`（PR5）
- main.cjs に残すもの: `electron` などの読み込み、アプリの起動と終了（今の 379〜414）、各モジュールを作って必要なものを渡す配線。目標は 400 行以下。
- 表の行は目安。移すときに、一緒に動く関数がほかの区切りにあれば、使う側のモジュールへ置く。2つのモジュールの両方が使うものは、下の 4 の決まりで受け渡す。

## 4. モジュールの決まり

- 各モジュールは `createXxx(deps)` を1つだけ外に出す。`deps` には、そのモジュールが使うものを名前つきで渡す（例: `createServerProcess({ fs, path, spawn, getServerRoot, appendLog, ... })`）。
- 戻り値は、そのモジュールの関数のまとまり。ほかのモジュールが使う関数と、そのモジュールのテストで確かめる関数を入れる（PR1 の最終レビュー M2 で足した。2026-10-17）。
- ipc の窓口は、そのモジュールが `register(ipcMain)` で自分で登録する。main は作ったあとに `register` を呼ぶ。
- `electron` は main.cjs だけが読み込む。`ipcMain`・`dialog`・`shell`・`app`・`BrowserWindow`・`net`・`clipboard`・`nativeImage`・`safeStorage`・`session` は main から渡す。
  - 理由: テスト（`electron/test/app-regressions.test.cjs` の `loadApp`）は main.cjs を仮想の環境で動かし、`electron` を偽物に差し替えている。モジュールが自分で `electron` を読み込むと、偽物に差し替わらない。
- `child_process`（`spawn`・`spawnSync`）も main.cjs だけが読み込み、モジュールには渡す。テスト（`loadApp`）は `child_process` も偽物に差し替えている（サーバー・BRIDGE の起動を試すため）。
- main.cjs の `__dirname` と `process` も、テストでは偽物になる（`__dirname` は一時フォルダーの `electron`、`process.resourcesPath` も偽物）。モジュールは自分の `__dirname`・`process` を使わず、main から `appDir`・`process` を受け取る。
- 「いま作業中か」の判定は、持ち主のモジュールが関数として外に出し、止める側はそれを受け取って使う。
  - サーバー: `isStarting()`・`isStopping()`・`child()`（`server_process`）
  - MAP: `isBusy()`・`assertIdle()`（`map_operations`。今の `assertMapIdle`）
  - 初期セットアップ: `isRunning()`（`setup_ipc`）
  - ゲームの切り替え: 今の `gameProfiles` のまま
- モジュール同士が互いを読み込み合う形（循環）は作らない。必要なときは main で関数を後から渡す（`setXxx` ではなく、`deps` に「呼ばれたときに取りに行く関数」を渡す）。
- 改行は CRLF（`core.autocrlf=true`）。コメントは周りと同じく日本語。

## 5. 進め方（PR 6本）

つながりの少ないものから順に分ける。1本ごとに `npm run verify` と CI が通り、ユーザーの許可を得てマージしてから次へ進む。

1. **土台**
   - ipc の窓口の名前の一覧を固定するテスト（下の 6）
   - `paths.cjs`・`app_config.cjs`・`operator_auth.cjs`・`window.cjs`
2. **端の仕事**: `games_ipc.cjs`・`gifts_viewer.cjs`・`tts_ipc.cjs`・`setup_ipc.cjs`・`bridge_settings.cjs`
3. **配布**: `bridge_sync.cjs`
4. **サーバー側**: `server_process.cjs`・`map_operations.cjs`・`server_files.cjs`・`minecraft_client.cjs`
5. **BRIDGE 側**: `bridge_process.cjs`・`bridge_mod_client.cjs`・`operations_stats.cjs`
6. **仕上げ**
   - main.cjs を配線だけにする
   - 行数の見張りテスト（下の 6）
   - AGENTS.md の「巨大なファイル」の一覧から main.cjs を外し、分けたファイルの一覧を足す

- 設計書はこの1つ。実装計画は PR ごとに作る（PR1 の計画 → 実装 → 最後のレビュー → マージ → PR2 の計画 …）。
- 各 PR のブランチは、その時点の origin/main から切る。

## 6. テスト

- **ipc の窓口の一覧**（PR1 の最初に作る）
  - `loadApp` で main.cjs を動かし、登録された ipc の名前をすべて集める。分ける前の一覧（116個）と同じであることを確かめる。
  - 各 PR で、名前が1つでも増えたり減ったりしたら落ちる。仕事として ipc を足すとき（Codex の UI の作業など）は、その PR でこの一覧も足す。
- **今のテスト**: 各 PR で `npm run verify`（typecheck・test:bridge・test:app・build）がすべて通ること。
- **テストが中の変数を書き換えている所の置き換え**
  - 今の5か所: サーバーの子プロセス（`serverProcRef`・`serverPid`）、サーバーの終了待ち（`waitChildExit`）、BRIDGE の子プロセス（`bridgeProcRef`・`bridgePid`）、テスト発火の返事の待ち時間（`testEventReplyMs`）、ゲームの選択の記録の場所（`getServerRoot` などを使う）。
  - そのモジュールを分ける PR で、モジュールが外に出す関数に置き換える。例: `serverProcess.attach(child)`（子プロセスを持たせる。起動の処理も同じ関数を使う）、`createBridgeModClient({ replyMs })`。
  - main.cjs は、作ったモジュールをいちばん外側の変数に置き、テストの `vm.runInContext` から届くようにする。
- **コードを正規表現で見ているテスト**（`bridge-minor-fixes`・`game-mods-after-update`・`app-regressions`）: 見ている処理を移した PR で、移した先のファイルを見るように直す。中身の正規表現は変えない。
- **行数の見張り**（PR6）: main.cjs は 400 行以下、`electron/*.cjs` の各ファイルは 800 行以下。超えたら CI で止まる。超えそうなときは、足す前に分ける。
- **モジュールごとのテスト**: 移すだけなので、全部には足さない。移すときに受け取る形を変えた所（「いま作業中か」の関数など）には、そのモジュールだけを作って確かめるテストを足す。

## 7. Codex の UI/UX の作業と並行して進める

- Codex は D 側の作業コピー（`My-game-pack-review`）の `feat/ui-ux-audit-20261017` で `src/` を直している（2026-10-17 時点で未 commit）。
- この分割は別の作業フォルダー（git worktree）で進め、D 側の作業コピーには触らない（ブランチも切り替えない）。
- 分割が変えるのは `electron/` と `electron/test/`・文書だけ。今のところ Codex の変更とは重ならない。
- Codex が main.cjs や preload.cjs に手を入れたときは、そのあとの分割の PR を出す前に main を取り込み、その変更を新しいファイルへ移す。ipc の窓口が増えていたら、6 の一覧も足す。

## 8. 範囲外

- 関数の中の処理の作り直し（重複の整理、エラー処理の見直しなど）。「処理のコピー」の問題は別に扱う。
- 設定の既定値の置き場（別の大きい問題）。
- `bridge/index.js`・`src/components/DashboardPage.tsx`・`src/index.css` の分割。
- 画面・preload・ipc の名前の変更。
- Tailwind が読む範囲を `src/index.css`（`source()`）で絞ること。今は git が追跡しているファイル全体を読むので、文書に `\` + 16進数の場所を書くとビルドが止まる。`src/` は Codex の UI の作業と重なるので別の PR で行い、それまでは `electron/test/docs-css-safe.test.cjs` で追跡しているテキストファイル全体を確かめる（PR1 の最終レビュー M1）。
