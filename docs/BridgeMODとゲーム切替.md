# BridgeMODとゲーム切替

開発中の仕様。アプリのバージョン番号・公開リリース・インストール済みアプリは変更していません。

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

流星群の夜、暴風雨など、BridgeMODのイベントが持つ一時変更は優先する。終了後は昼・晴れへ戻る。参加・効果解除後に暗視を再付与する。

アプリからの`_gamerules.txt`実行と暗視データパック生成は停止。旧NightVision_Packはサーバー停止中にワールドの`.mygamepack-retired-packs`へ退避し、削除しない。古いMAPを復元してパックが戻っても、次の起動前に同じ処理を行う。

「固定」は製品UIと通常運用のルール。サーバー所有者によるjar改造や管理用コマンド入力そのものを禁止するセキュリティ機能ではない。

## ゲームを選ぶ

配信ホーム・ギフト設定・コマンド一覧の上部でゲームを選ぶ。

| 選択 | 両方のmodsフォルダに配置するもの | 選べるコマンド |
|---|---|---|
| 共通コマンドのみ | BridgeMOD＋DisplayMOD | 共通コマンド |
| 埋め立て | BridgeMOD＋DisplayMOD＋UmetateMOD | 共通＋登録された埋め立てのコマンド |
| ラン | BridgeMOD＋DisplayMOD＋RunMOD | 共通＋登録されたランのコマンド |

DisplayMODは独立した任意の表示MOD。通常配布には同梱するが、なくてもゲームは続行する。APIと表示タイミングは[DisplayMOD連携ガイド](DisplayMOD連携ガイド.md)を参照。

UmetateMOD・RunMODの本体はまだ存在しないため、初期状態は「未導入」。ゲームパックを登録するまで切り替えられない。実ゲームのAPI・コマンドは未確定であり、架空の呼び出し仕様を製品へ組み込んではいない。

選択欄だけの変更ではファイルを入れ替えず、「このゲームに切り替える」で適用する。

- サーバー、BRIDGE、Minecraft本体とランチャーが停止していることを確認。
- サーバー側はアプリで選んだサーバーフォルダ。Minecraft側は既定でユーザーの`.minecraft`。別の起動構成のゲームディレクトリを使う場合は「Minecraftの保存先を選ぶ」で指定。
- 現在のmodsフォルダは丸ごと各保存先の`.mygamepack-mod-switch/<処理ID>/previous`へ退避。新しいmodsには必要なjarだけを配置する。他のMODも削除しない。
- 両側のコピーを準備・照合してから入れ替える。片側失敗は両側を戻す。アプリが途中終了した場合は次回「切替前の状態に戻す」で復旧するまで起動を止める。
- ギフト割り当て、いいね、各イベント・ルーレット設定をゲームごとに保存・復元。初めて選ぶゲームの割り当ては空から開始。アカウント・RCON・配信統計は共通のまま保持。
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

commandには既存の`{Count}`・`{ListenerName}`を使用できる。キーは`game_umetate_<key>.txt`等に分離する。既定ではBridgeMODはゲーム側に渡す前の共通タイトルを出さない。DisplayMODの独立APIを用意済み。ゲームMODが実際に開始するときの呼び出しは、各ゲームMODの完成時に接続・検証する。OBSMODは今後の実装。

この登録形式はMinecraftコマンドを入口に使うためのもの。Java APIでの連携が必要になった場合は、実ゲームMODの仕様を確認して追加する。ゲームMOD内の待機列・処理上限・実開始通知の実装まで自動的に完成するものではない。

ゲームMODに追加の必須ライブラリMODがある場合は別途対応が必要。現在の配布形式はBridgeMOD・任意のDisplayMOD・ゲームMODの構成を対象とする。

## 検証と公開

ゲーム切替の成功・未導入・不正ファイル・停止条件・片側失敗の巻戻し、既存アプリの回帰テスト、BridgeMODのビルド、専用MinecraftサーバーとUIの操作を確認する。

UmetateMOD・RunMODとの実連動は、完成した本物のjarを使うまで未検証。アプリの更新はユーザーからの更新依頼後に行う。
