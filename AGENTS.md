# AGENTS.md

このリポジトリで作業する AI エージェント（Codex・Claude など）と開発者への約束事です。

## 正本と作業コピー

- 正本は GitHub `testakahori/My-game-pack`（非公開）の `main` です。手元の作業コピーはどれも正本ではありません。
- 作業の始め方：`git fetch origin` を実行し、`origin/main` から新しいブランチを切ります。
- 1テーマ1PR にします。CI（verify の ubuntu・windows、mod-build）の成功とレビューのあとにマージします。マージは merge commit で行い、squash しません。
- 作業コピーは `git pull` / `git fetch` で更新します。ファイルの同期やコピーで更新しません。
  - 2026-10-08、ファイルを同期していただけの作業コピーが、main より11コミット古いまま、過去の版と同じ内容の未コミット変更を176件抱えていました。丸ごとコミットしていたら、v1.0.44〜1.0.46 の変更が消えていました。
- コミットの前に `git status` と `git diff --stat origin/main` を見て、自分が変えていない変更を含めないでください。
- 古いクローン（v1.0.21）は push できない設定にしてあります（`git remote set-url --push origin no_push`）。

## コミットしないもの

- 秘密
  - サーバーフォルダーの `config/bridgemod-token.txt`
  - Euler Stream の API キー
  - TikTok のアカウント情報
- 実行時に作られるファイル（`bridge/runtime-status.json`、`bridge/operations-history.json`、ログ）。gitignore 済みです。
- `Bridgeやりとり/`。私用のメモ置き場で、攻撃手順を含むレビュー文書もあります。`.git/info/exclude` で管理外にしてあります。

## 変更したら確認すること

- 必ず `npm run verify` を実行します（型チェック、Bridge のシミュレーション、アプリのテスト、ビルド）。
- MOD（BridgeMod・DisplayMod・SaikutuMod・ObsMod・UmetateMod）を変えたとき
  - 契約テスト：`.github/workflows/verify.yml` の mod-build ジョブにある `node scripts/test-*.cjs` をすべて実行します（javac が必要）。
  - ビルド：プロキシ環境では証明書の確認に失敗するので、オフラインで行います。
    - BridgeMod：`BridgeMod/` で `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`
    - SaikutuMod・DisplayMod・ObsMod・UmetateMod：`BridgeMod/gradlew -p <MODのフォルダー> build` に同じ引数を付けます。SaikutuMod と UmetateMod は BridgeMod のクラスを使うので、BridgeMod を先に作ります。
  - ObsMod は、そうてんもんさんの OBSMOD（MOD ID `minecraft_obs_bridge`）を v2.4.7 から取り込んだものです（2026-10-24。ご本人の同意あり）。ゲームのイベントの始まり・終わりなどを OBS 用のツールへ HTTP で送ります。2026-10-25 から DisplayMOD と同じ標準装備としてアプリに同梱し、サーバーにだけ入れます（Minecraft 本体には入れない）。OBS ツールへ送るのは、サーバーの `config/minecraft_obs_bridge/obs-send.properties` で `enabled=true` のときだけです（無ければ送らない。2.4.8 から）。オン・オフと送り先は、運用センターの「動作設定」の「OBS 連携」で決め、アプリの設定（`obsSendEnabled`・`obsSendEndpoint`）に残します。このファイルは、保存したときと、アプリからサーバーを起動するたび（起動の直前）に、アプリの設定どおりに書き直します（`electron/obs_send.cjs`・`electron/obs_ipc.cjs`・`server_process.cjs`）。書く形（UTF-8・BOM なしの2行、OBSMOD がそのまま使える送り先だけ）は、`scripts/test-soutenmon-contracts.cjs` の ObsSendParity が OBSMOD の読み方と照らします。MOD ID（`minecraft_obs_bridge`）と、API のクラス名 `jp.streamtorearn.obsmodule.api.ObsApi`・メソッド名 `publishLifecycle`・`publishEncounter` は、埋め立てゲームの MOD（UmetateMod）がリフレクションで探すので変えません（名前を変えると OBS への通知が黙って止まる。`electron/test/soutenmon-mods.test.cjs` が見張る）。
  - UmetateMod は、埋め立てゲームの妨害イベントの MOD（そうてんもんさんの StackingGame-Events、MOD ID `stackinggame_events`）を v2.6.16 から取り込んだものです（2026-10-24）。BridgeMOD のイベント API（`GameEvents`）で要求を受けます。使う BridgeMOD の API は 1.4.0 にある `GameEvents` だけです。新しい API を使うときは、`UmetateMod/gradle.properties` の `bridge_api_version` を上げます（mods.toml が古い BridgeMOD を許さないように）。
  - 2つとも、取り込んだ README が指す docs・tools は取り込んでいません（届いたものはユーザーの手元にあります）。イベントの一覧の元は `UmetateMod/src/main/resources/event-master/events.master.json` です。直したら `node scripts/sync-event-master.cjs` で、ObsMod の写しと3つの Java を作り直します（ずれはテストが止めます）。Forge なしで動く確かめ（届いたものの selftest）は `node scripts/test-soutenmon-contracts.cjs` です（mod-build の契約テストの1つ）。
  - jar の中身を変えたらバージョンを上げ、`game-packs/*/game.json` などの参照も合わせます。
- 配信者に配るインストーラーは `npm run release:win` の1本で作ります（`docs/手動配布とアプリ更新.md`）。ビルドと準備を必ず通し、MOD の jar は作っておいたものを同梱します。jar の元と今のソースが違うと止まるので、先に jar を作り直します（採掘MOD は BridgeMOD を使って作るので、BridgeMOD を直したら採掘MOD も）。MOD を作ると jar の横に元の中身のハッシュ（`<jar>.inputs.json`、`scripts/jar_inputs.gradle`）が書かれ、これで比べます。jar の場所の決まりは `scripts/mod_jars.cjs` の1か所です。`scripts/package-windows.cjs` は直接動かせません。
- テスト発火は BRIDGE に渡し、本番と同じ処理（`bridge/index.js` の `handleGift` などに ctx を渡す形）を通します（2026-10-16）。本番の処理を直せば、テスト発火にも同じ直しが効きます。テストのときだけの分かれ道（`ctx.run` があるとき）を足すときは、本番の要求が変わらないことを `electron/test/test-fire-parity.test.cjs` で確かめます。
- 新しいテストは、修正前のコードで落ちることを確かめます。確かめるときは `git archive` で取り出した一時コピーを使い、共有の作業ツリーで `git stash` は使いません。古い退避を誤って戻す事故が起きかけました。

## 書き方

- 巨大なファイルに追記しません。新しい処理は小さなモジュールに分け、テストを付けます（例：`bridge/command_files.cjs`、`src/lib/*.ts`）。対象は次のファイルです。
  - `bridge/index.js`（約2,400行）
  - `src/components/DashboardPage.tsx`（約1,100行）
  - `src/index.css`（約7,500行）
- `electron/main.cjs` は、アプリの起動と終了、各モジュールの配線だけを持ちます（2026-10-17〜18 に分けました。設計書 `docs/superpowers/specs/2026-10-17-main-split-design.md`）。新しい ipc や処理は、その仕事を持つモジュールに足します。
  - 行数の上限：`electron/main.cjs` は 400 行、ほかの `electron/*.cjs` は各 800 行です。超えると `electron/test/file-size-limits.test.cjs` が落ち、CI で止まります。超えそうなときは、足す前に分けます。
  - 下の一覧の分けたファイルは、`createXxx(deps)` を1つだけ外に出し、ipc は `register(ipcMain)` で自分で登録します。`electron`・`child_process` は自分で読み込まず、main から受け取ります（テストの `loadApp` は main.cjs が読み込むものだけを偽物に差し替えるため）。
    - 前からある `initial_setup.cjs`・`minecraft_processes.cjs`・`process_runner.cjs`・`world_setup.cjs` は `child_process` を自分で読み込みます。`loadApp` でも本物が動くので、テストでは呼ばれない形にするか、関数を渡して差し替えます。`preload.cjs` は画面側なので `electron` を読み込みます。
  - サーバー・BRIDGE・MAP の作業中かを読む関数（`serverProcess.child()`・`isStarting()`・`isStopping()`、`bridgeProcess.child()`・`isActive()`、`mapOperations.isBusy()`・`assertIdle()`）は、分割代入で受けず、呼ばれたときにオブジェクトから読みます（テストが差し替えて配線を確かめるため）。
    - 初期セットアップとゲームの切り替えの作業中（`isInitialSetupRunning`・`isGameProfileBusy`・`assertGameProfileIdle`）は、テストが本当に作業中にして確かめるので、main は分割代入で受けています。
  - 分けたファイル（`electron/`）：
    - `paths.cjs`：配置の場所
    - `app_config.cjs`：アプリ設定と更新
    - `window.cjs`：画面のウィンドウと CSP
    - `setup_ipc.cjs`：初期セットアップ・Forge・環境の実測・フォルダー選択
    - `games_ipc.cjs`：ゲームの選択・切り替え・Minecraft の保存先
    - `tts_ipc.cjs`：読み上げ
    - `bridge_settings.cjs`：BRIDGE の設定・ギフトの割り当て・テンプレート・設定のバックアップ・配信前チェック・コマンド txt・設定ファイルと BRIDGE の場所（`config:path`・`bridge:root`・`bridge:dir`）
    - `gifts_viewer.cjs`：ギフト一覧
    - `bridge_sync.cjs`：BRIDGE の配布・サーバーテンプレートのコピー・BRIDGE の展開
    - `server_process.cjs`：サーバーの起動・停止・ログ・状態・コンソールへの送信
    - `map_operations.cjs`：MAP の保存・読込・プリセット
    - `server_files.cjs`：server.properties・RCON パスワード・配布ワールド・OP の付与・ゲームルール
    - `minecraft_client.cjs`：Minecraft の起動と稼働の確かめ
    - `bridge_process.cjs`：BRIDGE の起動・停止・再起動・ログ・状態、Euler の鍵、TikTok LIVE の確かめ
    - `bridge_mod_client.cjs`：BridgeMOD との通信・一時停止と再開・テスト発火の受け渡し
    - `operations_stats.cjs`：操作履歴・統計・配信の記録・ギフト案内画像
- 改行は CRLF です（`core.autocrlf=true`）。既存ファイルの改行は変えません。
- `.bat` / `.cmd` は、コメントや echo も含めて英語だけで書きます。
- コードのコメントと画面の文言は日本語で書きます。

## 引継ぎ

- 区切りごとに、`HANDOFF/HANDOFF04.md` の先頭へ「やったこと・次にやること」を書き、docs の PR で main に入れます。
