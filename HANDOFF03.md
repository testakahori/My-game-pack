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

---

# 第2弾（2026-07-12 午後）計画書

ユーザー要望8件＋調査結果。対象バージョン: アプリ v1.0.16 / Mod v1.2.0。

## 調査で確定した事実

- **TTS が動かない件**: bridge の TTS 実装は正常（gift/chat ハンドラーで enqueueSpeech）。
  ただし VOICEVOX エンジンが起動していないと `speakText` が**無言で**失敗する
  （audio_query 非200 は警告すら出ない）。一括起動フローでエンジンを起動しておらず、
  ユーザーが手動で VOICEVOX を立ち上げない限り読み上げは鳴らない。
  → 修正: ①一括起動時に読み上げ設定が有効ならエンジン自動起動（ttsLaunchEngine）
  ②bridge にエンジン未接続の警告ログ（60秒に1回まで）を追加。
  ※「視聴者にも聞こえる」は PC スピーカー音を配信ソフトが拾う構成（デスクトップ音声
  キャプチャ）。コード側は PC で確実に鳴らすところまで。
- **いいね発火がギフト発火になる件**: 運用センターの fire("like") は選択中の
  commandFile を type=like で Mod に直送するだけで、Mod は type をキュー振り分けにしか
  使わない。＝「いいねらしさ」ゼロ。→ 修正: いいね発火は config.likeEvents の
  しきい値ラダーをシミュレート（入力いいね数から各ルールの発火回数を計算して発火）。
  入力欄: ギフト発火数(1-100) / いいね発火数(1-10000) に分離。
- **Mod 死活監視の失敗 3127 の正体**: failed は「コマンド1行単位で戻り値0 or 例外」。
  ギフト不発ではない。主犯は announce の飾りコマンド（title/playsound/particle）が
  プレイヤー不在時に0を返すケースと、対象セレクタ不一致。
  → 修正: 飾りコマンドの失敗はカウントしない（Mod v1.2.0）。
- Mod のコマンド実行は「1 tick に最大60行、ファイル単位で順次」。行間ディレイ機構は
  無い。→ ルーレットの回転演出は **bridge 側で setTimeout しながら Mod の新エンドポイント
  /douma/exec（生コマンド配列を実行）へフレームを送る**方式にする。

## 設計

### Mod v1.2.0（DoumaCmdMod.java）
1. `/douma/exec`（POST, 127.0.0.1のみ）: `{commands:["title ..."], count?}` を
   BridgeEvent(inlineCommands) として otherQueue へ。announce なし。
2. 死亡検知: `LivingDeathEvent` で ServerPlayer の死亡を数え、WS で
   `{type:"death", player, deaths}` をブロードキャスト。status JSON に `deaths` 追加。
3. announce の飾り5コマンドは失敗カウント対象外に（performSilentCosmetic）。
4. version 1.1.2 → 1.2.0。ビルドは `gradlew build --offline -Dnet.minecraftforge.gradle.check.certs=false`、
   配置3箇所（実サーバー/テンプレmods/クライアント）。

### bridge/index.js
1. TTS: エンジン未接続警告（60s throttle）。
2. `sendDoumaExec(doumaMod, commands)` ヘルパー（/douma/exec）。
3. **ルーレット**: config.roulette = { enabled, items:[{commandFile,label,weight}],
   stopSound, particle }。`enqueueDoumaModEvent` の入口で key==="roulette" を
   インターセプトして runRoulette()：約12フレーム、間隔 120ms×1.15^i で
   title 差し替え＋クリック音 → 停止時に当選 title＋停止音＋パーティクル →
   当選 commandFile を通常イベントとして発火。ホットリロード対応。
4. **デスルーレット**: config.deathRoulette = { enabled, everyDeaths, items,
   stopSound, particle }。Mod WS の death メッセージで deaths % everyDeaths === 0 の
   とき runRoulette。
5. **コメントギフト**: config.commentGifts = { enabled, rules:[{match, commandFile,
   repeat, sound, particle, enabled}] }。chat ハンドラーで部分一致（ルール毎3秒
   クールダウン）→ 発火＋sound/particle を exec で送出。historyType "comment"。
6. **視聴者メトリクス**: roomUser イベントで viewerCount 追跡、60秒毎に
   bridge/stream-metrics.jsonl へ {at, viewers} 追記（30日で prune）。
7. **ダイヤ記録**: gift ハンドラーから giftId / diamond(単価×個数) を history 行に追加。

### electron/main.cjs
1. mod:testEvent の like 分岐: likeCount(1-10000) → likeEvents ラダーを解決して発火。
2. `minecraft:grantOp`: appConfig.minecraftPlayerName（英数_ 3-16字に検証）→
   commands dir に `_op.txt`（`op <name>`）を書いて key=_op で発火。
3. 起動時に operations-history / stream-metrics を30日で prune。
4. operations:streamStats の返り値に diamond 合計と monthly（今月合計時間）を追加。
   `operations:viewerMetrics` IPC 追加（区間の平均/最高同接を UI で計算）。

### UI
1. **OperationsPage**: ギフト発火数/いいね発火数の2入力。Mod死活監視の失敗値に
   説明文（コマンド空振りでありギフト不発ではない）。
2. **DashboardPage**: TikTok接続設定の下にマイクラID入力＋「OP権限を付与」。
   保存で appConfig.minecraftPlayerName、一括起動のゲームルール適用後に自動 grantOp。
   一括起動時に TTS 有効ならエンジン自動起動。
3. **イベント設定②**（新ページ AppPage.EVENTS2）: ①のデザイン踏襲。
   ルーレット / デスルーレット / コメントギフト の3セクション。各セクションに
   ToggleSlider（適用）と保存ボタン。項目追加は＋ボタン、コマンドはプルダウン、
   確率(重み)数値、効果音・パーティクルはプリセット＋カスタム入力。
   ルーレット保存時に roulette.txt（ギフト割当用の仮想コマンド）を自動生成。
   サイドバー: イベント設定①（既存の文言変更）/ イベント設定②を追加。
4. **StatsDashboardPage**: ヘッダーに「今月の配信合計時間」タイル。タイトル横の
   ▾メニュー「配信集計を見る」→ 一覧（日付/配信時間/総配信時間/総ダイヤ）→
   日付クリックで配信別詳細（視聴者・最高同接・ギフト/いいね内訳・ダイヤ・
   トップギフター等をカード表示）。データは30日で自動削除（main側prune）。

### 新コマンド txt（bridge/commands/minecraft/）
- hurricane.txt ハリケーン: 周囲の全エンティティ＋プレイヤーに浮遊(高amp)→落下、
  風音＋雲パーティクル。
- storm.txt 暴風雨: weather thunder、鈍足V(300秒＝約10倍遅い)、雷召喚、雨音。
- fissure.txt 地割れ: プレイヤー前方に fill で亀裂（数本、段差つき）、轟音＋土煙。
  DESTRUCTIVE: true（拠点保護対象）。
- roulette.txt: ルーレット用の仮想コマンド（Bridge が横取り。無効時は案内表示のみ）。

## 第2弾 進捗記録

- [x] Mod v1.2.0: LivingDeathEvent→WS death 通知、/douma/exec（生コマンド・inline実行・
  失敗統計に計上しない）、announce 飾り5コマンドの失敗カウント除外、status に deaths。
  gradle offline ビルド成功 → doumacmd-1.2.0.jar を3箇所に配置（旧版撤去済み）。
- [x] bridge: TTS エンジン未接続の警告（60s throttle）／sendDoumaExec／
  ルーレットエンジン（12フレーム減速回転→当選 title＋効果音＋パーティクル→発火。
  busy 中は演出スキップ）／dispatchDoumaEvent で key=roulette を横取り／
  デスルーレット（WS death, everyDeaths の倍数で発動）／コメントギフト
  （部分一致・ルール毎3秒CD・sound/particle は exec で送出）／
  roomUser→stream-metrics.jsonl（60秒毎・30日prune）／history 行に giftId/diamond。
- [x] main.cjs: mod:testEvent の like をしきい値ラダーのシミュレートに変更
  （likeCount 1〜10000）／minecraft:grantOp（_op.txt→key=_op）／
  起動時 pruneOperationsHistoryOldRows(30)／streamStats に diamonds・
  maxViewers/avgViewers（stream-metrics 参照）・monthly（今月合計時間）。
- [x] UI: 運用センター＝ギフト発火数/いいね発火数の2入力＋失敗カウントの説明文。
  ダッシュボード＝マイクラID入力→OP付与（一括起動時も自動）＋TTSエンジン自動起動。
  イベント設定②ページ新設（3セクション、ToggleSlider適用＋保存、プリセット＋
  カスタムの効果音/パーティクル、重み→確率%表示、＋で無制限追加）。
  配信統計＝タイトル▾メニュー「配信集計を見る」→一覧（日付/配信時間/累計/💎）→
  日付クリックで配信詳細（最高同接・平均同接・ダイヤ・内訳・トップギフター）。
  ヘッダーに今月の配信合計時間タイル。
- [x] 検証: typecheck 0 error / bridge 回帰 11/11 PASS（roulette.txt の
  「コマンド0件」健全性チェックはフォールバック案内行の追加で解消）
- [x] v1.0.16 EXE ビルド完了（`npm run pack:win` exit 0、289MB）。同梱物検証済み＝
  テンプレ mods は doumacmd-1.2.0.jar のみ／config は tiktokUsername・rcon.password 空／
  新コマンドtxt 4種（hurricane/storm/fissure/roulette）同梱。
- [x] コミット（d0f6504）→ origin/main へ push 済み。秘密情報スキャン合格。
- [x] GitHub Release v1.0.16 公開（testakahori/My-game-pack）。資産＝ダッシュ名 exe＋
  blockmap＋latest.yml（exe の sha512 が latest.yml と一致確認済み）。
  → 1.0.15 からの electron-updater 自動更新が有効になる。

## 【次セッションのタスク】面白コマンドを全部作る（ユーザー承認済み 2026-07-12）

ユーザーが「提案してくれたコマンド全部作って」と承認。既存 txt と同じ書式で
`bridge/commands/minecraft/` に追加する。作ったら EventSettings① / ②の
コマンドプルダウンにも自動で載る（ファイル走査のはず。要確認）。

### txt 書式リファレンス（既存に合わせる）
- 先頭に `# TITLE:` `# CATEGORY:` を必ず入れる。演出系は `# SOUND:` `# PARTICLE:`。
- 地形を壊すものは `# DESTRUCTIVE: true`（拠点保護対象になる）。
- `# SUBTITLE: {ListenerName}` でギフト送信者名を差し込める。
- `//` はコメント行（実行されない）。1行1コマンド。行間ディレイは Mod 非対応。
- セレクタは基本 `@a`（全員）/ `@p`（近い人）/ `@e`（エンティティ）。
  地形・召喚は `execute at @p run ...` で座標基準にする。既存の fissure.txt /
  hurricane.txt / storm.txt が良いお手本。
- 効果音IDは `entity.wither.spawn` 等、パーティクルは `minecraft:explosion` 等。

### 作るコマンド一覧（21件）
**天変地異系**
- [ ] meteor.txt メテオ落下: 頭上に fireball/tnt を複数召喚して着弾。爆発音＋炎パーティクル。
      DESTRUCTIVE 検討（TNTなら true）。
- [ ] iceage.txt 氷河期: 周囲を ice/snow に一時変換＋鈍足＋パウダースノー。融解演出。DESTRUCTIVE: true。
- [ ] volcano.txt 火山噴火: 足元から magma_block 噴出＋上空から火の弾。溶岩音。DESTRUCTIVE: true。
- [ ] tornado.txt 竜巻: エンティティを1点へ吸い寄せ→吹き飛ばし（ハリケーンの逆）。風音。
- [ ] flood.txt 洪水: 周囲低地を一時的に water で満たす。水音。DESTRUCTIVE: true。

**襲撃・モブ系**
- [ ] zombiewave.txt ゾンビ襲撃ウェーブ: zombie/skeleton の群れを周囲に時間差スポーン（同一tick可）。
- [ ] chickenrain.txt 鶏の大群: 大量の chicken を頭上に summon（ネタ枠）。
- [ ] bossrush.txt ボスラッシュ: wither / warden を召喚（デスルーレットの罰ゲーム向き）。
- [ ] petsummon.txt ペット召喚: 名前付き wolf/cat を味方付与（ギフトご褒美枠）。

**トラップ・悪戯系**
- [ ] lavafloor.txt 床マグマ化: 足元を数秒だけ lava→元に戻す（Bridge側で戻す or fill 2回）。DESTRUCTIVE注意。
- [ ] skytrap.txt 天空トラップ: プレイヤーを上空へ tp して落下。
- [ ] randomtp.txt ランダムテレポート: 半径数百ブロックのどこかへ spreadplayers。
- [ ] antigravity.txt 重力反転: 高レベル levitation で天井に張り付かせる。
- [ ] anvildrop.txt 空からアンビル: 頭上に anvil を落下 summon（圧殺ネタ）。
- [ ] darkness.txt 暗黒: 高レベル blindness＋darkness で画面を真っ暗に。

**変身・ステータス系**
- [ ] giant.txt 巨大化 / [ ] tiny.txt 縮小: attribute の scale でサイズ変更（1.20.5+）。要MCバージョン確認。
- [ ] superjump.txt スーパージャンプ: jump_boost 高レベル。
- [ ] bullettime.txt 弾丸タイム: 自分 speed↑・周囲 slowness↑。
- [ ] richtime.txt 金持ちタイム: diamond/emerald を空から降らす（大型ギフトご褒美枠）。
- [ ] invisible.txt 透明人間: invisibility 一定時間。

### 完了後
- bridge 回帰テスト（`node bridge/test/...` 11/11 PASS 維持、新txtの「コマンド0件」に注意）。
- 必要なら patch リリース（v1.0.17）。txt は同梱リソースなので EXE 再ビルドで反映。
  ※ txt だけの追加なら既存インストールの `resources/bridge/commands/minecraft/` に
    配ることも可能だが、正式には再ビルド＋Releaseが筋。

## 実機での確認手順（ユーザー向け）

1. 既存 v1.0.15 を起動 → 自動更新ダイアログで v1.0.16 を適用（または Release から
   `MyGamePack-Bridge-UI-Setup-1.0.16.exe` を手動DL）。
2. 「環境構築」を実行 → **Minecraftサーバーを再起動**して Mod v1.2.0 を有効化。
3. ダッシュボードで TikTok ID を承認、マイクラID を入力して OP 付与。
4. イベント設定②でルーレット/デスルーレット/コメントギフトを設定。
5. 一括起動で TTS エンジンが自動起動することを確認（読み上げが鳴る）。

## Mod死活監視「失敗」の説明（ユーザー質問への回答）

失敗カウント＝「実行したコマンド1行ごとの空振り（戻り値0 or 例外）」であり、
ギフトの取りこぼし数ではない。主因はプレイヤー不在・死亡中のときの演出コマンド
（title/playsound/particle）や、対象がいないセレクタ。ギフト自体はキュー投入時点で
202 を返しており、取りこぼす場合は 429（queue_full）としてBridge側でリトライされる。
v1.2.0 から演出コマンドは失敗カウント対象外にしたため、今後この数値は大幅に減る。

## 留意事項

- 旧リポジトリ時代の git 履歴に開発機の RCON パスワードと TikTok ID が残っている
  （public 化前のコミット含め公開済み）。RCON は localhost バインドなので実害は
  限定的だが、開発機の RCON_password.txt は作り直しを推奨。
- setup.bat の「ルート jar を mods へ移動」ロジックは互換のため残置。テンプレートの
  ルートに jar を置かない運用を守ること（refreshDoumaModJar がルート残骸を自動撤去）。
