# StackingGame-Events v2.6.15

- Lifecycle cleanup unified.
- Common argument validator added for all 13 events.
- See `docs/RELIABILITY_1_TO_5_v2.6.15.md`.

# StackingGame-Events v2.6.13

## v2.6.13 内部設計4項目の整理

今回の版は新イベント追加ではなく、既存13イベントを安全に増やしやすくする土台を改善しています。

1. `BlockInteractionMode` を軽量監査として実処理へ接続。想定外のブロック操作は止めずにWARNを1回だけ出します。Arena境界・保護ブロックの既存ガードはそのままです。
2. Event Master 13件とJava実装Registryの件数・キー・TargetMode・BlockInteractionMode・実装クラスを起動時に自動確認します。
3. 各イベントは `ctx.encounter()` だけを呼び、Encounter key/kind/attackKind はEvent Masterから共通取得します。
4. 一時ブロック・FallingBlock・イベント召喚Mobを `executionId` 単位で追跡します。通常END後のFallingBlock短時間演出は従来どおり残します。

詳細: `docs/CORE_DESIGN_IMPROVEMENTS_v2.6.13.md`

## v2.6.5 ブロック操作ルール・安全処理の軽量共通化

- 13イベントに `BlockInteractionMode` を定義。
- `BlockSafetyService` を追加し、StackingGame固有の削除処理を共通化。
- ARENA型だけ固定Arena外の直接ブロック変更を拒否。PLAYER型は従来どおり通常地形を変更可能。
- TemporaryBlockの配置前に保護判定。復元は一時ブロックが残っている場合のみ。
- BridgeMODを迂回する固有処理の保険としてコマンドブロック3種を保護。
- 黒曜石はイベントから保護するが、プレイヤー採掘は制限しない。

詳細: `docs/BLOCK_SAFETY_v2.6.5.md`


## v2.6.4 13イベント TargetMode統一

13イベントを `PLAYER` 6件 / `ARENA` 7件へ明示分類し、分類元を `GameEventRegistry` に一本化しました。

- PLAYER: `aquatower`, `magmatower`, `voidbomb`, `megablast`, `nether_army`, `meteor_shower`
- ARENA: `aquarium`, `voidbomb_rain`, `void_singularity`, `meteor_purge`, `tornado`, `orbital_laser`, `shockwave_collapse`

ARENA型は `arena.dimension` と固定Arena座標を前提にし、Arena外指定を安全側で拒否します。詳細は `docs/EVENT_TARGET_MODES_v2.6.4.md`。


## v2.6.3 静的解析＋次課題対応

v2.6.2を再静的解析し、Arena座標そのものの配線には致命的な不整合がないことを確認したうえで、次の安全課題を修正しました。

- Arenaを座標だけでなくdimensionまで固定。既定値は `minecraft:overworld`。
- Arena中心型イベント5種は、別dimensionでは開始せず安全側で拒否。
- `StackBlockService` が自身で生成したFallingBlockを管理。
- 演出中(CAPTURED)と放出後(RELEASED)を区別。
- 放出後にArena X/Z外へ出た金/ダイヤFallingBlockは、再配置される前に消去。
- 上空へ吹き上げる演出は許可し、下降してArena上端へ戻った際にY範囲外再配置も防止。
- 放出後6秒を超えた管理FallingBlockは安全側で消去。
- `/stackgame reset` ではイベント由来の一時的な水・溶岩だけ復元し、Mob/FallingBlock/積み上げ/地形はそのまま残す。server stopでは管理中FallingBlockを全消去。
- `/stackgame status` に `managedFalling` を追加。

静的整合チェック、Arena/StackBlockServiceのJava17スタブコンパイル、Arena中心5イベントのJava17スタブコンパイルはPASSしています。完全なForgeGradleビルドはWindows開発環境で実行してください。

## v2.6.2 固定Arena対応

本番MAPの積み上げ範囲を正式なArenaとして扱います。既定値は次の絶対座標です。

```text
X = -6 .. 6   (13 blocks)
Y = 49 .. 56  (8 blocks)
Z = -6 .. 6   (13 blocks)
Volume = 1,352 blocks
```

`stackinggame-common.toml` の `[arena]` で変更できますが、通常運用では変更不要です。
金/ダイヤの積み上げブロックを操作する大型イベントはArena外のブロックを対象にしません。
引数を省略した `meteor_purge`, `void_singularity`, `tornado`, `orbital_laser`, `shockwave_collapse` は固定Arena中心を基準に発生します。
`/stackgame status` でも現在のArena座標とvolumeを確認できます。


Minecraft 1.20.1 / Forge 47.4.10+ / Java 17 / BridgeMOD 1.4.0 GameEvents API.

## v2.6.1 静的解析修正

- `StackingRuntime` の `StackBlockService` import漏れを修正（v2.6.0はこのままではForgeコンパイル不可）。
- `/stackgame reset` で `RequestLedger` もクリアし、BridgeMOD 1.4.0のラウンド境界仕様に合わせた。
- v2.6.0の最優先3修正（BridgeMOD 1.4 API直結 / gold+diamond / obsidian保護）は維持。

## v2.6.0 最優先修正

今回、My-game-pack 1.0.46 に同梱された BridgeMOD 1.4.0 の実ソースに合わせて接続方式を修正しました。

1. `streamtorearn-common-api` へのランタイム依存を廃止。
2. `jp.douma.bridgemod.api.GameEvents` に `stackinggame_events` として直接登録。
3. BridgeMODが保持する `requestId / key / count / listenerName / type / gameSessionId / args / announce / server` をそのまま受付。
4. `WAIT=0 / ACCEPTED=1 / DISCARDED=2` をBridgeMOD 1.4.0仕様どおり返却。
5. reset時は `GameEvents.beginSession("stackinggame_events")` で新sessionへ切替。旧session要求は`DISCARDED`。
6. 積み上げ対象Block Tagを実ゲームに合わせて `diamond_block / gold_block` に変更。
7. 会場フレーム想定の `obsidian / crying_obsidian` はイベント破壊から常時保護。既存configに項目が無くても保護する。

## BridgeMOD 1.4.0 との接続

ゲームパック側の `game.json` では次を一致させてください。

```json
{
  "modId": "stackinggame_events",
  "bridgeEventApi": 1
}
```

これにより生成されるコマンド定義の `GAME_MOD: stackinggame_events` が、このMODの `GameEvents.register()` と一致します。

BridgeMOD 1.4.0は要求受付時の`gameSessionId`を保持し、再送時にも書き換えません。StackingGame側は受信時に`GameEvents.isCurrentSession()`で検証します。

## 積み上げ対象ブロック

`data/stackinggame_events/tags/blocks/stack_blocks.json`

現在の初期値:

- `minecraft:diamond_block`
- `minecraft:gold_block`

砂・砂利・concrete_powderは初期対象から外しました。

## 黒曜石フレーム

`obsidian` と `crying_obsidian` は `ProtectedBlockPolicy` の常時保護対象です。
CraterService / StackBlockService / AquaTower等、ProtectedBlockPolicyを通るイベント破壊では消去しません。

注意: プレイヤーがダイヤピッケルで黒曜石を手動破壊できる仕様は意図的に維持します。今後の黒曜石降下妨害でも、プレイヤー自身が採掘して除去できる前提です。

## 現在の13イベント

- `aquatower`
- `magmatower`
- `aquarium`
- `voidbomb`
- `voidbomb_rain`
- `megablast`
- `nether_army`
- `void_singularity`
- `meteor_shower`
- `meteor_purge`
- `tornado`
- `orbital_laser`
- `shockwave_collapse`

## 今回まだ変更していないもの

Arena固定座標化とFallingBlockのArena外消滅は対応済みです。
黒曜石は「イベント処理では破壊しない／プレイヤーはダイヤピッケル等で採掘できる」仕様を維持します。
今後の黒曜石降下妨害を考慮し、プレイヤーの `BlockEvent.BreakEvent` はキャンセルしません。
## v2.6.6 lifecycle policy
- END/CANCEL/ERROR/TIMEOUT/start failure share one cleanup path for fluid containment and temporary blocks.
- All 13 events are explicitly serial and allow repeated requests to queue, preserving repeated-gift behavior.
- Active event timeout checking is centralized; each event still supplies its own runtime budget.


## v2.6.7 static-review fixes

- ACCEPTED済み要求は開始時に失敗してもFIFO先頭から消さず、同じrequestIdで内部再試行します。
- プレイヤー死亡/リスポーン待ちの間は次イベントを開始しません。
- recovery.json は未ロードchunk等で復元できなかった項目だけ残し、次回起動時に再試行します。
- FallingBlockのイベント後残留演出は意図的に維持しています。


## v2.6.8 event argument unification

Bridgeのイベント固有argsは `count / durationSeconds / intervalTicks / radius / targetX,Y,Z / x1..z2` をcanonical名として使用する。旧 `towerCount / pairs / meteorCount / impactCount / seconds / interval` は互換aliasとして引き続き受理する。詳細は `docs/EVENT_ARGUMENT_CONTRACT_v2.6.8.md`。

## v2.6.11 Event Master
イベント定義メタデータは `event-master/events.master.json` から生成します。


## v2.6.12 Core reliability fixes
- Event Master同期ツールを統合パックへ正式同梱。
- EventManagerはWAIT相当だけ再試行し、DISCARDED相当の恒久開始失敗はFIFOから終端化。
- 終端失敗したrequestIdは台帳へFAILEDとして保持し、同じrequestId再送へDISCARDEDを返す。
- TemporaryBlock通常cleanup時に未ロードchunkがあれば、復元情報をrecovery.jsonへ即時保持。


## v2.6.16 RESET / Event Master packaging fixes
- `/stackgame reset` は実行中イベントのtickと待機列を止め、イベント由来の一時的な水・溶岩だけ復元します。
- RESETではMob/FallingBlock/金・ダイヤ積み上げ/通常地形を削除しません。
- `tools/sync_event_master.py` を同梱し、単体StackingGameパッケージでもEvent Master生成物を同期・`--check`確認できます。
