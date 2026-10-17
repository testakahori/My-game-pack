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
  - 運営ログインのパスワード（リポジトリに置くのはハッシュだけ）
- 実行時に作られるファイル（`bridge/runtime-status.json`、`bridge/operations-history.json`、ログ）。gitignore 済みです。
- `Bridgeやりとり/`。私用のメモ置き場で、攻撃手順を含むレビュー文書もあります。`.git/info/exclude` で管理外にしてあります。

## 変更したら確認すること

- 必ず `npm run verify` を実行します（型チェック、Bridge のシミュレーション、アプリのテスト、ビルド）。
- MOD（BridgeMod・DisplayMod・SaikutuMod）を変えたとき
  - 契約テスト：`.github/workflows/verify.yml` の mod-build ジョブにある `node scripts/test-*.cjs` をすべて実行します（javac が必要）。
  - ビルド：プロキシ環境では証明書の確認に失敗するので、オフラインで行います。
    - BridgeMod：`BridgeMod/` で `gradlew build --offline "-Dnet.minecraftforge.gradle.check.certs=false"`
    - SaikutuMod・DisplayMod：`BridgeMod/gradlew -p <MODのフォルダー> build` に同じ引数を付けます。
  - jar の中身を変えたらバージョンを上げ、`game-packs/*/game.json` などの参照も合わせます。
- テスト発火は BRIDGE に渡し、本番と同じ処理（`bridge/index.js` の `handleGift` などに ctx を渡す形）を通します（2026-10-16）。本番の処理を直せば、テスト発火にも同じ直しが効きます。テストのときだけの分かれ道（`ctx.run` があるとき）を足すときは、本番の要求が変わらないことを `electron/test/test-fire-parity.test.cjs` で確かめます。
- 新しいテストは、修正前のコードで落ちることを確かめます。確かめるときは `git archive` で取り出した一時コピーを使い、共有の作業ツリーで `git stash` は使いません。古い退避を誤って戻す事故が起きかけました。

## 書き方

- 巨大なファイルに追記しません。新しい処理は小さなモジュールに分け、テストを付けます（例：`bridge/command_files.cjs`、`src/lib/*.ts`）。対象は次のファイルです。
  - `bridge/index.js`（約2,400行）
  - `src/components/DashboardPage.tsx`（約1,100行）
  - `src/index.css`（約7,500行）
- `electron/main.cjs` は、アプリの起動と終了、各モジュールの配線だけを持ちます（2026-10-17〜18 に分けました。設計書 `docs/superpowers/specs/2026-10-17-main-split-design.md`）。新しい ipc や処理は、その仕事を持つモジュールに足します。
  - 行数の上限：`electron/main.cjs` は 400 行、ほかの `electron/*.cjs` は各 800 行です。超えると `electron/test/file-size-limits.test.cjs` が落ち、CI で止まります。超えそうなときは、足す前に分けます。
  - モジュールは `createXxx(deps)` を1つだけ外に出し、ipc は `register(ipcMain)` で自分で登録します。`electron`・`child_process` は main だけが読み込んで渡します（テストの `loadApp` が偽物に差し替えるため）。
  - 作業中かを読む関数（`serverProcess.isStarting()`・`bridgeProcess.isActive()` など）は、分割代入で受けず、呼ばれたときにオブジェクトから読みます（テストが差し替えて配線を確かめるため）。
  - 分けたファイル（`electron/`）：
    - `paths.cjs`：配置の場所
    - `app_config.cjs`：アプリ設定と更新
    - `operator_auth.cjs`：運営ログイン
    - `window.cjs`：画面のウィンドウと CSP
    - `setup_ipc.cjs`：初期セットアップ・Forge・環境の実測・フォルダー選択
    - `games_ipc.cjs`：ゲームの選択・切り替え・Minecraft の保存先
    - `tts_ipc.cjs`：読み上げ
    - `bridge_settings.cjs`：BRIDGE の設定・ギフトの割り当て・テンプレート・配信前チェック・コマンド txt
    - `gifts_viewer.cjs`：ギフト一覧
    - `bridge_sync.cjs`：BRIDGE の配布・サーバーテンプレートのコピー・BRIDGE の展開
    - `server_process.cjs`：サーバーの起動・停止・ログ・状態
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
