# HANDOFF03 — 2026-07-12 セッション計画書 & 作業記録

前巻: HANDOFF02.md（v1.0.14 / mod 1.1.2 リリースまで）
リポジトリ: https://github.com/testakahori/My-game-pack （2026-07-12 に public 移行済み）

---

## 0. このセッションでやること（計画書）

ユーザー報告の課題 8 件＋調査で発見した問題 2 件を修正し、v1.0.15 として
GitHub Releases に公開して自動更新を実際に動かすところまで。

### A. mod jar が環境構築後に旧版になる問題【真因特定済み】

**真因（3つの複合）**
1. テンプレート `server/Douma_Craft/` の**ルート**に古い `doumacmd-1.1.1.jar` が残置
   （現行の正しい置き場所は `mods/doumacmd-1.1.2.jar`）。
2. `setup.bat` の最終段が「ルートの doumacmd-*.jar を mods/ へ移動、その際 mods/ の
   既存 doumacmd jar を**全削除**」するため、セットアップのたびに 1.1.2 が消えて
   1.1.1 に置き換わる。
3. `main.cjs` の `refreshDoumaModJar()` がテンプレートの**ルート**を読んでいる
   （mods/ を読むべき）。ルートに 1.1.1 があるため、アプリ更新時にも 1.1.1 を配布し
   1.1.2 を削除するという逆向きの動作。

**修正**
- テンプレートのルート `doumacmd-1.1.1.jar` を削除（git からも削除）。
- `refreshDoumaModJar()` を `テンプレート/mods/` 起点に修正し、さらに
  serverFolder ルートに残る古い doumacmd jar も掃除する。
- `server:copyTemplate` 完了後と `bridge:extractTo` で `refreshDoumaModJar()` を呼び、
  過去バージョンでセットアップ済みのフォルダを再利用しても必ず最新 jar に揃える。
- `setup.bat` はルートに jar が無ければ移動ループが no-op なので変更不要
  （英語のみポリシー維持のため触らない）。

### B. 同梱 config に実アカウント情報が入っている問題【調査で発見】

`bridge/config.minecraft.json`（EXE に同梱され新規セットアップにコピーされる）に
`tiktokUsername: "mikusu_nuts"` と RCON パスワードが入ったまま。
これが「セットアップ後に ID 欄が空でない」原因でもあり、public リポジトリに
push 済みでもある。

**修正**
- リポジトリ内の `bridge/config.minecraft.json` の tiktokUsername / rcon.password を空に。
- `bridge/config.minecraft.json.bak` を git から削除。
- `bridge:extractTo` で新規コピーだった場合は tiktokUsername を空にする保険を追加
  （既存ユーザーの config は preserve されるので影響なし）。
- 注意: git 履歴には残る。RCON パスワードは各ユーザー環境で setup.bat が再生成する
  ものなので実害は開発機のみ → 開発機の RCON_password.txt を再生成して回す。

### C. ID承認 UI（ダッシュボード TikTok カード）

- 適用ボタンの文言を「BRIDGE に適用する」→「**IDを承認する**」に変更。
- ID 入力欄の横のステータスを、config.minecraft.json の tiktokUsername と入力値が
  一致していれば黄緑で「**承認済み**」、そうでなければ赤で「**非承認**」表示。
- 起動時に config から承認済み ID を読み、承認状態を復元する。
- セットアップ直後は B の修正により ID 欄は空＝「非承認」表示。
- イベント設定などの保存時に ID 未承認で失敗する際のエラー文言を
  `tiktokUsername が空です` →
  「**TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。ダッシュボードでIDを入力して承認してください**」
  に変更（config_schema.cjs）。

### D. Forge コンソールのアプリ内表示（別窓廃止）

- `server:start` を `cmd /c run.bat`＋`NO_PAUSE=1`＋stdio パイプ＋`windowsHide` に変更。
  黒い別窓は出さない（誤って閉じる事故を根絶）。
- 出力はリングバッファ（500行）に蓄積し、新 IPC `server:logs` で UI へ。
- 新 IPC `server:processStatus` で稼働状態（running/pid）を返す。
- `server:stop` は stdin に `stop` を書き込む graceful 停止（15秒待ち）→
  だめなら taskkill /F /T にフォールバック。ワールドデータ保護にもなる。
- ダッシュボードの BRIDGE ログパネルを 2 分割し、左 BRIDGE / 右 Forge サーバーログ。

### E. プロセス終了検知でステータスを「停止中」へ

- ダッシュボードのポーリングに `server:processStatus` を追加し、Forge プロセスが
  消えたら forgeState を stopped に（D の実装により Forge は子プロセスなので
  終了は確実に検知できる）。
- Minecraft ランチャー／ゲーム本体は新 IPC `minecraft:status`（tasklist ベース）で
  検知し、Game ノードの表示に使う（F）。

### F. コックピットの World ノード → Game ノード

- パイプラインの「World」を「**Game**」に変更。Minecraft ランチャー（または
  ゲーム本体）のプロセスが生きていれば「起動中」、いなければ「停止中」。
- ワールド名の表示は下段の「配信ワールド」カードに引き続き残す。

### G. 一括停止ボタン

- 「一括起動」の下に「**一括停止**」ボタンを追加（赤ネオン）。
  BRIDGE 停止 → Forge graceful 停止の順で実行。ゲーム終了後にワンクリックで
  全部落とせるように。

### H. Minecraft ランチャーの場所指定（Cドライブ以外対応）

- 新 IPC `dialog:pickFile`（exe フィルタ）を追加し、選んだパスを
  app-config `minecraftLauncherPath` に保存（既存の起動候補ロジックが最優先で
  使う下地は実装済み）。
- ダッシュボードに「ランチャーの場所を指定」ボタンと現在の設定値表示を追加。

### I. アプリ自動更新の実現

- エラーの原因: これまで配布リポジトリが private で latest.yml に到達できなかった。
  リポジトリは public の My-game-pack に移行済み・electron-builder の publish 先も
  変更済み（2026-07-12 コミット 832784d）。
- 本セッションで v1.0.15 に bump → EXE ビルド → `gh release create` で
  Setup.exe / .blockmap / latest.yml を GitHub Releases に公開。
- **注意**: 既存インストールの v1.0.14 は旧リポジトリ（minecraft-tiktok-bridge）を
  見ているため自動更新できない。v1.0.15 だけは手動インストールが必要。
  それ以降（1.0.16〜）は自動更新が効く。

### 検証
- `npm run typecheck`、Bridge 回帰テスト（simulate_events.js）、electron 構文チェック。
- 一括起動/停止・Forge ログ表示・承認 UI は EXE 実機で最終確認（ユーザー）。

---

## 進捗記録（都度更新）

- [x] 調査完了・本計画書作成（12:25）
- [x] A: mod jar 問題修正（12:40）
  - テンプレートルートの doumacmd-1.1.1.jar と、実サーバールートの doumacmd-1.0.0.jar を削除
  - refreshDoumaModJar をテンプレート mods/ 起点に修正＋serverFolder ルートの残骸 jar 撤去を追加
  - server:copyTemplate 完了時と bridge:extractTo で refreshDoumaModJar を実行
- [x] B: config サニタイズ（12:42）
  - bridge/config.minecraft.json の tiktokUsername / rcon.password を空に（mappings 54件は維持）
  - config.7dtd.json の tiktokUsername も空に。config.minecraft.json.bak を git から削除
  - bridge:extractTo で新規コピー時に tiktokUsername / rcon.password を空にする保険を追加
- [x] C: ID承認 UI（12:50）
  - ボタン文言「IDを承認する」／承認中…／承認済み。入力欄横に黄緑「承認済み」・赤「非承認」
  - config の tiktokUsername から承認状態を復元。保存時エラー文言も変更（config_schema.cjs）
- [x] D/E: Forge 内蔵コンソール & 終了検知（12:55）
  - server:start を NO_PAUSE=1＋stdio パイプ＋windowsHide に変更（黒い別窓廃止）
  - server:stop は stdin へ stop → 15秒待ち → taskkill フォールバック（graceful 停止）
  - 新 IPC: server:logs / server:processStatus / minecraft:status / dialog:pickFile
  - ダッシュボードのログパネルを BRIDGE｜Forge の2分割。プロセス消滅時は「停止中」へ自動同期
- [x] F/G/H: Game ノード・一括停止・ランチャー指定（12:58）
  - パイプライン World → Game（ランチャー/ゲーム本体 javaw を tasklist で検知、起動中/停止中）
  - 一括起動の下に赤の「一括停止」ボタン（BRIDGE→Forge の順で停止）
  - 「🎮 ランチャーの場所を指定」ボタン（exe 選択→app-config の minecraftLauncherPath へ保存。
    既存の起動候補ロジックが最優先で使用）
- [x] 検証: typecheck 0 error / electron 構文 OK / bridge 回帰 11/11 PASS（13:00）
- [x] I: v1.0.15 ビルド & GitHub Release 公開（13:15）
  - `MyGamePack Bridge UI Setup 1.0.15.exe`
    SHA-256 `4880225CB22D96C2B3841638F5E4E57C7E3D711B1F1D20BEEFA3CDE62883EC3F`
  - win-unpacked で同梱検証：テンプレートルートに doumacmd なし／mods は 1.1.2 のみ／
    config の tiktokUsername・rcon.password は空
  - https://github.com/testakahori/My-game-pack/releases/tag/v1.0.15 に
    Setup.exe / .blockmap / latest.yml を公開（アセット名は latest.yml が参照する
    ダッシュ区切り `MyGamePack-Bridge-UI-Setup-1.0.15.exe` に合わせた）
  - `releases/latest/download/latest.yml` が取得可能なことを確認済み → 以後のバージョン
    から「更新を確認」で自動更新が動く
- [x] 最終コミット・push（fb6fbaa ほか）

## 次にやること（実機確認・ユーザー作業）

1. **v1.0.15 を手動インストール**（v1.0.14 は旧 private リポジトリを見ているため
   自動更新できない。今回だけ手動。以後は自動更新が効く）。
2. 初期セットアップをやり直す場合：ID 欄が空＝赤「非承認」で始まるか、
   ID 入力→「IDを承認する」→黄緑「承認済み」になるか。
3. 一括起動：黒い別窓が出ず、ダッシュボード下部の「Forgeサーバーログ」に
   起動ログが流れるか。Game ノードがランチャー起動で「起動中」になるか。
4. ゲーム終了後に「一括停止」→ BRIDGE・Forge とも停止し、表示が「停止中」になるか。
5. mods フォルダに doumacmd-1.1.2.jar だけが入っているか（1.1.1 が消えているか）。
6. 運用センターの「更新を確認」がエラーなく「最新です」になるか。
7. ランチャーを C ドライブ以外に入れている場合：「🎮 ランチャーの場所を指定」で
   exe を選んでから一括起動。

## 留意事項

- 旧リポジトリ時代の git 履歴に開発機の RCON パスワードと TikTok ID が残っている
  （public 化前のコミット含め公開済み）。RCON は localhost バインドなので実害は
  限定的だが、開発機の RCON_password.txt は作り直しを推奨。
- setup.bat の「ルート jar を mods へ移動」ロジックは互換のため残置。テンプレートの
  ルートに jar を置かない運用を守ること（refreshDoumaModJar がルート残骸を自動撤去）。
