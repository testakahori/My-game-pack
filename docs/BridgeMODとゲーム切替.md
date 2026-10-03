# BridgeMODとゲーム切替

2026-10-03更新。今回の変更は未公開・未適用です。採掘と要求番号の詳細は[採掘MODと統一コマンド](採掘MODと統一コマンド.md)を参照。

## DOUMAMODからの置き換え

- DOUMAMODのJava処理をBridgeModディレクトリへ移し、MOD IDを`bridgemod`、表示名をBridgeMODに変更。
- ゲーム内コマンドは`/bridge zombie 1`、大技の内部コマンドは`bridgeeffect`。
- HTTPは`/bridge/event`、`/bridge/exec`、`/bridge/status`。ポートは従来と同じ。変更する場合は`BRIDGE_MOD_PORT`。
- アプリ・BRIDGE・コマンド一覧・同梱txtも新名称を使用。旧`/douma`コマンドと旧HTTP入口は登録しない。
- 旧設定の`douma_mod`・`doumaModHost`・`doumaModPort`は読み取り互換を維持する。旧MODを起動する意味ではない。
- ワールド中の既存Mobタグ・天候の保存ファイル名は互換のため維持する。
- ギフト600／いいね120／その他280の別キュー、60コマンドのtick予算といいね8予約枠、Java効果の生成予算を引き継ぐ。

## 固定環境

暗視・アイテムロストなし・昼・晴れはBridgeMODが維持する。設定スイッチは設けない。アプリを開いていない場合もサーバー側で適用される。

`sendCommandFeedback false`と`commandBlockOutput false`も固定する。コマンドの実行通知とコマンドブロックの出力を非表示にし、手動で変更されても固定値へ戻す。

敵モブだけ自然発生を禁止する。ForgeでMONSTERに分類されるMobの自然発生・チャンク生成時の出現・巡回隊・増援を止め、村への自動ゾンビ襲撃も止める。ファントムの自然発生も対象。牛・羊・魚を残すため、`doMobSpawning true`を固定し、敵だけを出現理由で判定する。ピースフルへの変更は行わない。既に存在するMob、スポナー、スポーンエッグ、ギフト・コマンド・ゲームMODが意図的に召喚するMobは対象外。ゲームMODでの意図的な召喚にはNATURAL等を使わず、COMMAND・EVENT等を使用する。

流星群の夜、暴風雨など、BridgeMODのイベントが持つ一時変更は優先する。終了後は昼・晴れへ戻る。参加・効果解除後に暗視を再付与する。

アプリからの`_gamerules.txt`実行と暗視データパック生成は停止。旧NightVision_Packはサーバー停止中にワールドの`.mygamepack-retired-packs`へ退避し、削除しない。古いMAPを復元してパックが戻っても、次の起動前に同じ処理を行う。

「固定」は製品UIと通常運用のルール。サーバー所有者によるjar改造や管理用コマンド入力そのものを禁止するセキュリティ機能ではない。

## ゲームを選ぶ

配信ホーム・ギフト設定・コマンド一覧の上部でゲームを選ぶ。

| 選択 | 両方のmodsフォルダに配置するもの | 選べるコマンド |
|---|---|---|
| サバイバル | BridgeMOD＋DisplayMOD | 共通コマンド |
| 埋め立て | BridgeMOD＋DisplayMOD＋UmetateMOD | 共通＋登録された埋め立てのコマンド |
| RUN | BridgeMOD＋DisplayMOD＋RunMOD | 共通＋登録されたランのコマンド |
| 採掘 | BridgeMOD＋DisplayMOD＋saikutuMOD | 共通＋採掘の14コマンド |

BridgeMODとDisplayMODは全ゲームの標準装備。アプリでの切替には両方のjarが必要。独立APIは表示MODが欠けた場合もゲーム本体を止めない。APIと表示タイミングは[DisplayMOD連携ガイド](DisplayMOD連携ガイド.md)を参照。

UmetateMOD・RunMODの本体はまだ存在しないため、初期状態は「未導入」。ゲームパックを登録するまで切り替えられない。実ゲームのAPI・コマンドは未確定であり、架空の呼び出し仕様を製品へ組み込んではいない。

選択欄だけの変更ではファイルを入れ替えず、「このゲームに切り替える」で適用する。

- サーバー、BRIDGE、Minecraft本体とランチャーが停止していることを確認。
- サーバー側はアプリで選んだサーバーフォルダ。Minecraft側は既定でユーザーの`.minecraft`。別の起動構成のゲームディレクトリを使う場合は「Minecraftの保存先を選ぶ」で指定。
- 現在のmodsフォルダは丸ごと各保存先の`.mygamepack-mod-switch/<処理ID>/previous`へ退避。新しいmodsには必要なjarだけを配置する。他のMODも削除しない。
- 両側のコピーを準備・照合してから入れ替える。片側失敗は両側を戻す。アプリが途中終了した場合は次回「切替前の状態に戻す」で復旧するまで起動を止める。
- ギフト割り当て、いいね、各イベント・ルーレット設定をゲームごとに保存・復元。初めて選ぶゲームの割り当ては空から開始（採掘のみ旧14コマンドの割り当てを引き継ぐ）。アカウント・RCON・配信統計は共通のまま保持。
- MAPそのものの保存・ロード・変更は行わない。

## ゲームMOD完成後の登録形式

配布フォルダに`game.json`とjarをまとめ、「ゲームパックを登録」でフォルダを選ぶ。

```json
{
  "format": 1,
  "id": "umetate",
  "modId": "umetatemod",
  "serverJar": "UmetateMod.jar",
  "clientJar": "UmetateMod.jar",
  "commands": []
}
```

これは形式の例。jar名・modIdは完成したMODに合わせる。`run`の場合はidを`run`にする。両側共通のjarならserverJarとclientJarは同じでよい。登録時にjar内のMOD IDも照合する。

`commands`の各項目：

| 項目 | 内容 |
|---|---|
| key | 小文字英数字・アンダースコアの一意な識別子 |
| title | ギフト設定で表示する日本語名 |
| command | ゲームMODが実装したMinecraftコマンド1行。先頭の`/`は省略可 |
| commonDisplay | 任意のboolean。即時イベントでBridgeMODから共通表示を出す場合のみtrue。省略・falseはゲーム側が実開始時に表示 |

commandには`{Count}`・`{ListenerName}`・`{RequestId}`を使用できる。キーは`game_umetate_<key>.txt`等に分離する。既定ではBridgeMODはゲーム側に渡す前の共通タイトルを出さない。DisplayMODの独立APIを用意済み。ゲームMODが実際に開始するときの呼び出しは、各ゲームMODの完成時に接続・検証する。OBSMODは今後の実装。

プレイヤーの入力は全ゲームで `/bridge <key> <count>`。Java受付APIは`bridgeEventApi: 1`で選択でき、要求番号・名前・個数をMapで受け取る。詳細は採掘MODの連携ガイドを参照。ゲームMOD内の待機列・処理上限・実開始通知の実装まで自動的に完成するものではない。

ゲームMODに追加の必須ライブラリMODがある場合は別途対応が必要。現在の配布形式はBridgeMOD・DisplayMOD・ゲームMODの構成を対象とする。

## 検証と公開

ゲーム切替の成功・未導入・不正ファイル・停止条件・片側失敗の巻戻し、既存アプリの回帰テスト、BridgeMODのビルド、専用MinecraftサーバーとUIの操作を確認する。

UmetateMOD・RunMODとの実連動は、完成した本物のjarを使うまで未検証。アプリの更新はユーザーからの更新依頼後に行う。

## Minecraftの保存先を探す

ホームの「Minecraftの保存先を探す・MODの保存先を確認」から「Minecraftの保存先を自動検出」を押します。標準の `%APPDATA%/.minecraft` と、標準・現在の保存先にある公式ランチャーの `launcher_profiles.json`／`launcher_profiles_microsoft_store.json` を確認します。ドライブ全体の走査やAIは使いません。

起動構成名・バージョン・実際の保存先を見て選び、「この保存先を使う」で記憶します。Forge 1.20.1の構成が見つかった候補には目印を表示しますが、自動決定はしません。MODの実配置は、Minecraft・ランチャー・サーバー・BRIDGEを停止してから「このゲームに切り替える」で行います。

消えた保存先は理由付きで選択不可にします。サーバーと同じ場所や親子関係の場所、modsがリンクになっている場所も選べません。検索・選択だけでフォルダーを作成したり、MOD・MAP・ランチャー設定を変更したりしません。公式ランチャー以外や、別の場所にあるランチャー設定は「手動で指定」を使ってください。
