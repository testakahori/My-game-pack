# ゲームMOD連携APIの更新（BridgeMOD 1.4.0 / DisplayMOD 1.1.0）

2026年10月3日。そうてんもんさんからの確認1〜7を受け、実装と検証を行いました。

## 変更したこと

- ゲームAPI経路ではcountを100ずつに分割せず、1要求のまま渡します。対応範囲は整数1〜100,000です。範囲外は黙って丸めずエラーにします。
- ゲームAPI経路のいいねは、同じユーザー・同じイベントでも閾値到達ごとに別要求です。100いいねごとにcount=2なら、300いいね分はcount=2の3要求です。待機中の内部表現はまとめても、ゲームへは別のrequestIdを付けて渡します。
- requestId・個数・送信者名・args・gameSessionIdを同じ要求として保持します。HTTP再試行でもその番号と引数を書き換えません。
- ゲーム内リセット後に旧要求を識別する、ゲーム番号のAPIを追加しました。利用するかどうかはゲームMOD側が決めます。
- 表示APIでfadeInTicks・stayTicks・fadeOutTicksを指定できます。省略時は従来の10／70／10です。

共通イベントのギフト／いいね／その他キュー、tick予算、タラの負荷制御は維持しています。共通イベントにはrequestId重複除去を設けません。ゲーム固有要求の二重登録防止は、ゲームMOD側のRequestLedger等で行います。

## 入口と受け渡す値

ゲームパックのgame.jsonにbridgeEventApi: 1を指定し、BridgeMODのGameEvents.registerで受け口を登録します。生成されるコマンドtxtのGAME_MODとGAME_KEYが転送先です。アプリのゲームAPI対応は、このメタ情報がある経路を対象にしています。旧式のコマンド文字列呼び出しには、新しいゲームAPIの保証を適用しません。

| キー | 内容 |
|---|---|
| requestId | 同じ1件の再送では不変。別要求は別番号。1〜128文字の英数字と _ . : - |
| eventId | 互換用。同じ値を入れる |
| key | ゲーム側イベント名（eventKeyに相当） |
| count | 整数1〜100,000。回数か強度かはゲームMODが判断 |
| listenerName | 送信者名（senderNameに相当） |
| type | gift / like / other |
| gameSessionId | 受付時点でアプリが保持していたゲーム番号。再送中は不変 |
| args | ゲーム専用の追加引数。省略時は空Map |
| announce | 表示を希望するか。実際の表示タイミングはゲームMODが決める |
| server | サーバー内転送で渡すMinecraftServer |

HTTP入力ではsenderNameも別名として読めますが、転送先の正式なキーはlistenerNameです。requestIdとeventIdを両方送るなら一致させてください。

argsは最大32項目。キーは英字開始の英数字・アンダースコアで64文字まで。値は文字列・有限の数値・真偽値のみです。文字列は1項目1,024文字、合計8,192文字まで。配列・入れ子オブジェクト・null・NaN・Infinityは受け付けません。Bridgeは意味を解釈せず、変更できないMapとして受け口へ渡します。levelの意味は決めつけず、必要ならargsの項目としてゲームMOD自身で扱ってください。

## リセットとゲーム番号

これはゲームMOD側で明示的に使うAPIです。既存のregisterだけを使うゲームを、Bridgeが勝手にリセットしたり、古い要求として捨てたりはしません。

1. ゲーム開始時またはリセットして次のゲームを開始する時、GameEvents.beginSession(modId)を呼びます。新しいUUIDを返します。
2. ゲーム終了時・リセットして待機に戻す時はGameEvents.endSession(modId)を呼びます。旧番号を無効化します。
3. ゲーム側の受け口では、キューへ入れる前にGameEvents.isCurrentSession(modId, event.get("gameSessionId"))を確認します。
4. 一致しない要求はGameEvents.DISCARDEDを返します。再送を促すWAITにはしません。
5. ゲーム自身の待機キューも終了／リセット時に空にします。一時停止や、ゲームが続く中でのプレイヤー死亡では番号を変更しません。

BridgeのGET /bridge/statusとWebSocket状態通知にgameSessionsが含まれます。アプリは通知で知っている番号を新規要求へ付け、送信待ち・HTTP再送中も保持します。BridgeMODからゲームMODへ渡す瞬間に最新番号へ付け替えることはしません。手入力の /bridge コマンドは、サーバーがその入力を受け付けた時の番号を保持します。

番号がまだ通知されていない、または切替直後で古い番号しか届いていない場合、ゲーム側の判定ではその要求を受け付けません。安全のため新しいゲームへ勝手に付け直さない仕様です。ゲーム側は新しい番号を設定してから配信イベントを受け付ける運用にしてください。外部送信ツールも、要求を最初に作る時点の番号を維持する必要があります。

この仕組みはメモリ内です。サーバー再起動時は番号を破棄し、次のゲーム開始で別番号になります。ゲームの待ち列やrequestId台帳の永続保存は追加していません。

### ゲーム側の応答

| 戻り値 | 意味 |
|---|---|
| WAIT = 0 | まだ受け入れていない。Bridgeに同じ要求を保持してもらう |
| ACCEPTED = 1 | ゲームが所有する待ち列に受け入れた。または同じ番号を既に受け入れ済み |
| DISCARDED = 2 | 旧ゲーム番号などで失効した。Bridgeは要求を消費し、再送しない |

DISCARDEDはBridgeのdiscardedGameRequests診断値へ計上し、コマンド成功回数へ加算しません。ゲームの失効判定はゲーム側が行います。

最小の実装例は [SessionReceiver.java](../examples/game-integration/SessionReceiver.java) です。待ち列上限500は例であり、ゲーム作者側の仕様に合わせて変更します。例のstartEventに、ゲーム開始時の表示・OBS呼び出し・ゲーム本体の処理を渡してください。

## 表示API

DisplayApi.show(Object server, Map<String, ?> payload)の呼び出し方は維持しています。ゲームからはOptionalDisplayの任意呼び出しを推奨します。

    OptionalDisplay.show(server, Map.of(
        "title", "AquaTower 開始",
        "subtitle", "{ListenerName} さん ×{Count}",
        "listenerName", senderName,
        "count", count,
        "fadeInTicks", 0,
        "stayTicks", 120,
        "fadeOutTicks", 20,
        "sound", "minecraft:entity.experience_orb.pickup",
        "particle", "minecraft:happy_villager"
    ));

20tickが通常約1秒です。本表示はstayTicks、フェードを含む合計は3項目の合計です。fadeInTicks／fadeOutTicksは0以上、stayTicksは1以上、合計1,200tickまでの整数を指定します。不正値は表示APIがfalseとして返すため、ゲームを止める理由にはしないでください。

senderNameはlistenerNameの別名として利用できます。両方指定する場合は同じ値にしてください。ゲーム固有の強度やlevelを表示したい場合は、ゲーム側でtitle／subtitleの文言を組み立てます。

タイトル・サブタイトルは引き続き後勝ちです。表示キュー・優先度・最低表示時間の保護は追加していません。表示MODはゲーム進行を管理せず、OBSMODも呼びません。DisplayMODなしでも、OptionalDisplayがfalseを返して表示だけ省略できます。

## 今回確認した範囲

Minecraft 1.20.1／Forge 47.4.10／通常のForge Server／サーバーJava 21／MOD対象Java 17。

- 実際のForgeとテスト用クライアントで、150個の無分割転送、送信者と引数の分離、同じ番号の再送、別要求、3キューの旧要求、遅延再送、一時停止、終了、指定表示時間のパケットを確認。
- 大量いいね120件とギフト20件を同時に処理し、FIFO、名前、タラ64匹上限、自然魚とギフト魚を残す整理処理を確認。
- DisplayMODの未導入／導入済み／表示APIの例外／リンク不一致を契約テストで確認。

StackingGame-EventsとOBSMODの本体は今回のリポジトリにありません。今回作ったのは相手側から利用できる受け口・サンプル・検証用MODです。そうてんもんさん側の本体を接続済み、動作確認済みとはしていません。OBSMODは今までどおり、ゲームの実開始時にゲームMODから独立して呼び出してください。
