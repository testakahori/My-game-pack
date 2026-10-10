# 保護ブロック（コマンドブロック3種）設計書

- 日付：2026-10-10
- 対象：BridgeMOD 1.5.0 → 1.6.0、SaikutuMOD 1.0.2 → 1.0.3
- 状態：ユーザーと会話で合意した内容を書いたもの。実装計画はこの設計書の確認後に作る。

## 1. 目的

MAP の中では、ゲームの進行やイベントの制御にコマンドブロックを使っていることがある。妨害イベントの処理でコマンドブロックが壊れたり置き換わったりすると、ゲームが進まなくなったり、MAP が正しく動かなくなったりする。BridgeMOD とゲーム MOD の自動処理が、次の3種を変えないようにする。

- `minecraft:command_block`
- `minecraft:chain_command_block`
- `minecraft:repeating_command_block`

### 依頼の要件（2026-10-10、ユーザー）

- 保護の判定は、BridgeMOD の爆発・ブロックの破壊・削除・置換・地形の変更の前に通す。
- `isProtectedBlock(level, pos)`・`canModifyBlock(level, pos)` のような共通の API にして、Bridge 標準のイベントから必ず使う。
- 保護対象なら、そのブロックだけを飛ばす。処理全体は止めない。
- できれば、ゲーム MOD からも同じ判定を使えるように公開する。
- 既存の処理への影響は最小限にする。
- 対象外：プレイヤー自身がブロックを壊すこと。

### 会話で決めたこと

- SaikutuMOD（採掘）の内蔵 txt も、今回いっしょに守る。PR は分ける。
- コマンドからの保護は「実行の前後で控えて戻す」方式にする（下の 3 の案1）。
- 保護対象は3種で固定する。設定で増やす機能は作らない。

### 成功の基準

コマンドブロックの真上や足元で、地形を変える妨害（`lavafloor`・`husk_watertower`・採掘の `otosiana` など）を発火しても、次のようになること。

- コマンドブロックが、同じ向き・同じ中身（コマンド・常時実行の設定など）のまま残る。
- 常時実行のインパルス型が、もう一度実行されない。リピート型は動き続ける。
- コマンドブロック以外の地形は、今までどおり変わる。

## 2. 今の状態（2026-10-10 に調べた結果）

### バニラの時点で壊れない経路

3種のコマンドブロックは、硬度 -1・爆発耐性 3,600,000 で、`wither_immune`・`dragon_immune` タグに入っている。BlockEntity を持ち、落下ブロックが着地しても置き換わらない（`canBeReplaced` が false）。そのため、次の経路ではもともと壊れない。

- TNT・クリーパー・火の玉・`level.explode` などの爆発
- ウィザー・エンダードラゴン
- 落下ブロックの着地、水や溶岩の流れ、雷の火

消せるのは、コードからの直接の書き換え（`Level.setBlock` など）と、`/fill`・`/setblock`・`/clone`・`/place` コマンドだけ。`/fill` と `/setblock` は Forge のイベントを出さない。BridgeMOD・SaikutuMOD は Mixin を使っていない。

### Java の直接の書き換え

- BridgeMOD の書き換えはすべて `GiftEffects.set()`（`GiftEffects.java:222-224`）を通る。SaikutuMOD は同じ形の `SaikutuEffects.set()`（`SaikutuEffects.java:137-139`）を持つ。
- どちらも「BlockEntity がない」かつ「岩盤でない」位置だけを書き換えるので、コマンドブロックは結果的に飛ばされている。ただし、種類を名指しした判定ではない。

### コマンドの経路（ここが守られていない）

| 経路 | 実行する場所 | コマンドブロックを消しうるもの |
|---|---|---|
| BRIDGE の txt（`bridge/commands/minecraft/*.txt`） | `BridgeMod.executeEventSlice` → `performSilent`（`BridgeMod.java:663-683`） | `lavafloor`（9×9 の magma 全置換と lava）、`husk_watertower`（setblock で水）。ユーザーがアプリで作る txt も同じ経路 |
| `/bridge/exec` の生コマンド | 同上（`BridgeMod.java:592-603`） | 今の送り手は title・playsound・particle だけ。受け口は任意のコマンドを受ける |
| SaikutuMOD の内蔵 txt（jar の `/commands/*.txt`） | `SaikutuMod.process` → `performPrefixedCommand`（`SaikutuMod.java:117-150`）。BridgeMOD を通らない | `fissure`・`maguma_jigoku`・`otosiana`・`tntdaibakuhatu`（全置換の `fill`） |

範囲の保護（`GiftEffects.Protection`、X・Z の四角い範囲）はあるが、本番では BRIDGE とアプリが `protectionEnabled: false` を固定で送るので、常に無効になっている。ブロックの種類で守る仕組みはない。

## 3. 方針

### 採用：案1 実行の前後で控えて戻す

妨害のコマンドを実行する前に、近くの読み込み済みチャンクにあるコマンドブロックを控える。実行のあとで、変わってしまったものだけを元に戻す。Java の書き換えは `canModifyBlock` で名指しの判定をする。

- 利点：ビルドの仕組みを変えない。ユーザーが作る txt・`/bridge/exec`・ゲーム MOD の txt を、同じ仕組みで守れる。
- 欠点：置き換えられた瞬間の、周りへの通知（レッドストーンの更新など）は防げない。同じ処理の中で戻すので、見た目は変わらない。

### 採らなかった案

- 案2 Mixin で `Level.setBlock` を止める：一瞬も置き換わらず一番きれいだが、Mixin のビルド用プラグインが要る。手元のビルドは証明書の問題でオフライン前提で、取得できないおそれがある。
- 案3 危ない txt だけを Java に書き直す：ユーザーが作る txt と `/bridge/exec` を守れない。書き直す量も一番多い。

## 4. 設計

### 4.1 公開 API（BridgeMOD 1.6.0）

パッケージ `jp.douma.bridgemod.api`。

```java
public final class ProtectedBlockIds {          // Minecraft に依存しない
    public static final List<String> IDS = List.of(
        "minecraft:command_block", "minecraft:chain_command_block", "minecraft:repeating_command_block");
    public static boolean isProtectedId(String id);   // 完全一致。null・名前空間なしは false
}

public final class BlockProtection {
    public static boolean isProtectedBlock(BlockState state);
    public static boolean isProtectedBlock(BlockGetter level, BlockPos pos);
    public static boolean canModifyBlock(BlockGetter level, BlockPos pos);   // !isProtectedBlock
    /** action を実行し、その間に変わった保護ブロックを戻す。戻した数を返す。label はログ用。 */
    public static int runProtected(MinecraftServer server, String label, Runnable action);
}
```

- `isProtectedBlock(BlockState)` はブロックのレジストリ名を `ProtectedBlockIds.isProtectedId` に渡して判定する。保護対象の一覧は `ProtectedBlockIds` の1か所だけに置く。
- `runProtected` は、`action` が例外を投げても戻す処理を行い、そのあとで例外を投げ直す。
- 入れ子で呼ばれた場合（`runProtected` の中で `runProtected`）は、内側では控えずにそのまま `action` を実行する。外側がまとめて戻す。サーバーのメインスレッドだけで使う前提で、入れ子は `ThreadLocal` ではなく静的な深さの数で見分ける。

### 4.2 組み込む場所

| 場所 | 変更 |
|---|---|
| `BridgeMod.onServerTick` の、3つのキュー処理（`BridgeMod.java:168-170`） | 3つのキューのどれかに要求があれば、3つの `processQueue` をまとめて `runProtected(server, "bridgemod", …)` で包む。すべて空なら包まない。txt と `/bridge/exec` は、どちらもこの中で実行される |
| `GiftEffects.set()` | 先頭で `BlockProtection.canModifyBlock` を呼び、false なら飛ばす。今の「BlockEntity がある・岩盤」の判定は残す |
| `SaikutuMod` の tick の、3つの `process` 呼び出し（`SaikutuMod.java:111`） | 同じく、要求があれば `runProtected(server, "saikutumod", …)` で包む |
| `SaikutuEffects.set()` | `canModifyBlock` を呼ぶ |

- 包む単位は tick ごとのキュー処理全体にする。SaikutuMOD は内蔵 txt を1行ずつ（1 tick に最大52行）実行するので、行ごとに包むと控える回数が増えるため。
- `GiftEffects.tick`・`SaikutuEffects` の tick（Java の処理）は `set()` の判定で守られるので、包まない。
- ゲーム MOD への転送（`GameEvents.offer`）は、BridgeMOD の包みの中で行われるが、ゲーム MOD はキューに入れるだけで、実行は自分の tick で行う。そのため、ゲーム MOD は自分の実行を `runProtected` で包む必要がある（SaikutuMOD は上の表のとおり）。

### 4.3 控える範囲

`runProtected` を呼ぶたびに、サーバーのすべてのディメンションについて、次のチャンクを見る。

- 各プレイヤーの周り：描画距離（`PlayerList.getViewDistance()`）内のチャンク
- 強制読み込みのチャンク（`ServerLevel.getForcedChunks()`）
- オーバーワールドのスポーン地点から半径11チャンク（`ServerLevel.setDefaultSpawnPos` の `TicketType.START` と同じ半径）

チャンクは `ServerChunkCache.getChunkNow` で、読み込み済みのものだけを取る（読み込みを起こさない）。そのチャンクの `getBlockEntities()` から、ブロックの状態が保護対象のものを控える。控えるのは、位置・ディメンション・`BlockState`・BlockEntity のインスタンスの3つ。NBT は戻すときだけ取り出す。

範囲の外になるのは、上の3つ以外の理由で一時的に読み込まれたチャンク（ポータルの先など）だけ。読み込まれていないチャンクには、もともと `/fill` が「読み込まれていません」で失敗するので届かない。

### 4.4 「変わった」とみなす条件

次のどちらかなら戻す。

- その位置の `BlockState` が、控えたものと違う（別のブロック、向きや条件付きの違いも含む）。
- その位置の BlockEntity が、控えたインスタンスと別物（同じコマンドブロックで上書きされて中身が空になった場合も含む）。

`/data` で中身だけを書き換えた場合は戻さない（壊す・消す・置き換える、のどれでもないため）。

### 4.5 戻し方

1. 控えた BlockEntity から `saveWithoutMetadata()` で NBT を取り出す（取り除かれた BlockEntity でも、値はそのまま残っている）。
2. `level.setBlock(pos, 控えた BlockState, Block.UPDATE_CLIENTS)` で、周りへ通知せずに置く。
3. `BlockEntity.loadStatic(pos, state, nbt)` で BlockEntity を作り、`level.setBlockEntity` で置く。`loadStatic` は level が null の状態で読み込むので、`setAutomatic` が実行を予約しない。そのため、常時実行のインパルス型がもう一度実行されることはない（ワールドの読み込みと同じ）。コマンド・成功回数・名前・最後の出力・`powered`・`auto`・`conditionMet` も戻る。
4. `level.blockUpdated(pos, block)` で周りへ通知し、レッドストーンや比較器の状態をそろえる。BlockEntity の `powered` は戻してあるので、自分への `neighborChanged` で実行が予約されることはない。

- リピート型・チェーン型の次の実行予約（`scheduleTick`）は、置き換えで消えない。戻したあとは同じブロックなので、予約どおりに動き続ける。
- 1か所を戻すときに例外が出たら、その位置をログに出して次の位置へ進む。

### 4.6 ログと数

- 戻したら、サーバーのログに `[BlockProtection] restored minecraft:command_block at x,y,z in minecraft:overworld (bridgemod)` の形で出す（最後の括弧は `label`）。
- BridgeMOD の状態（`/bridge/status` と WebSocket の状態）に、`protectedBlockRestores`（戻した数の累計）を足す。アプリの運用画面への表示は今回は足さない。

### 4.7 受け入れること・守れない範囲

- 置き換えられた瞬間の、周りへの通知は起きる。隣のレッドストーンや、置き換えた先のブロックの性質（溶岩が隣の水と反応するなど）による影響は残りうる。
- 4.3 の範囲の外は守れない。
- ゲーム MOD が `runProtected` も `canModifyBlock` も使わずに行う処理は守れない（StackingGame などは各ゲーム MOD 側で対応する。依頼の対象外）。
- 同じ tick の中で、置き換えのあとに `execute if block` などで同じ位置を調べるコマンドがあると、置き換わった状態が見える。今の txt にはない。

## 5. 版と互換性

- BridgeMOD を 1.6.0 にする（公開 API が増えるため）。
- SaikutuMOD を 1.0.3 にし、`mods.toml` の bridgemod の `versionRange` を `[1.4.0,)` から `[1.6.0,)` に上げる。上げないと、古い BridgeMOD と組み合わせたときに `NoClassDefFoundError` で落ちる。
- `game-packs/saikutu/game.json` の jar 名（`saikutumod-1.0.2.jar`）を 1.0.3 に合わせる。そのほか、版の番号を持つ箇所は実装計画で洗い出す。
- `docs/ゲームMOD連携API_v1.4.md` に「保護ブロック API（BridgeMOD 1.6.0 から）」の節を足す。内容は、ゲーム MOD からの使い方（`canModifyBlock` と `runProtected`）、守る範囲、守れない範囲。

## 6. テスト

1. 契約テスト（CI の mod-build。`scripts/test-bridge-contracts.cjs` と同じく、javac で直接動かす）
   - `ProtectedBlockIds.isProtectedId` が3種で true。`minecraft:structure_block`・`minecraft:stone`・`command_block`（名前空間なし）・空文字・null で false。
2. 配線のテスト（`npm run verify`。`electron/test/mod-limits-wiring.test.cjs` と同じく、ソースを照合する）
   - `BridgeMod.onServerTick` の `processQueue` 3つが `runProtected` の中にある。
   - `GiftEffects.set()` と `SaikutuEffects.set()` が `canModifyBlock` を呼ぶ。
   - SaikutuMOD の tick の `process` 3つが `runProtected` の中にある。
   - SaikutuMOD の `mods.toml` が bridgemod `[1.6.0,)` を要求する。
3. 実機テスト（手元。`BridgeMod/test/terrain-attacks.cjs` と同じく、使い捨ての Forge サーバー）
   - プレイヤーの足元と周りに、次の3つを置く。
     - 常時実行のインパルス型：スコア `#imp` を +1 する
     - 常時実行のリピート型：スコア `#rep` を +1 し続ける
     - チェーン型（中身あり）
   - `lavafloor`・`husk_watertower`・`/bridge/exec` の `fill`、採掘の `otosiana`・`maguma_jigoku`・`fissure`・`tntdaibakuhatu` を発火する。
   - 確かめること
     - 3つが同じ向き・同じコマンドで残っている（`data get block` の比較）。
     - `#imp` が増えていない。`#rep` は増え続けている。
     - コマンドブロック以外の地形は変わっている。
     - サーバーのログに `[BlockProtection] restored` が出ていて、`protectedBlockRestores` が増えている。
4. 開発版のアプリで、実際のゲームとして確かめる（2026-10-10 と同じく、退避 → 確認 → 復元）。

## 7. PR の分け方

1. BridgeMOD：`ProtectedBlockIds`・`BlockProtection`・`onServerTick` と `GiftEffects.set()` への組み込み・状態の数・契約テスト・配線のテスト・実機テストの追加・1.6.0・連携 API の文書。
2. SaikutuMOD：`runProtected` と `canModifyBlock` の利用・1.0.3・`versionRange`・`game.json`・配線のテスト。1 のマージ後に出す。

## 8. 終わったら報告すること（依頼のとおり）

- どの処理に保護の判定を足したか（4.2 の表）
- どのブロックを守るか（3種）
- ゲーム MOD から使えるか（`BlockProtection` の使い方）

## 9. 今回やらないこと

- 保護対象を設定で増やす機能。
- アプリの運用画面に `protectedBlockRestores` を出すこと。
- StackingGame など、ほかのゲーム MOD への組み込み。
- TNT大爆発の作り直し（強さの上限をやめる設計書で扱う）。作り直すときは、地形を削る処理で `canModifyBlock` を使う。
