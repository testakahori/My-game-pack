# OBSMOD v2.4.8

- MyGamePack に標準装備として同梱する版（2026-10-25）。サーバーにだけ入れる（`displayTest="IGNORE_SERVER_VERSION"` を付け、Minecraft 本体に無くてもサーバー一覧で MOD が合わないと出さない）。
- OBS ツールへ送るのは、サーバーの `config/minecraft_obs_bridge/obs-send.properties` に `enabled=true` と書いたときだけ。無ければ送らず、`/health` の確かめもしない。送り先は `endpoint=`（http・https）で、無ければ `events.generated.json` の `controller.endpoint`。
- MyGamePack のアプリの画面（運用センター）から、オン・オフと送り先を変えられるようにする予定。

# OBSMOD v2.4.6

- Central attack classification and event mapping.
- Configurable encounter de-duplication.
- See `docs/RELIABILITY_1_TO_5_v2.4.6.md`.

# Minecraft OBS Bridge / OBSMOD v2.4.0

Minecraft 1.20.1 / Forge 47.4.10 / Java 17 target.

## v2.4.0

StackingGame-Events v2.5.0 の大型オリジナルイベント6種をLifecycle通知対象へ追加しました。

- `void_singularity`
- `meteor_shower`
- `meteor_purge`
- `tornado`
- `orbital_laser`
- `shockwave_collapse`

既存 `events.generated.json` が存在する場合も、起動時に不足している `eventStartEvents` を追記して保存します。
ユーザーが既存イベントを無効化している設定は上書きしません。

Lifecycle APIはv2.3.0と同じです。

```java
ObsApi.publishLifecycle(server, payload);
```

`START / END / CANCEL / RESET` を `event_start / event_end / event_cancel / event_reset` としてOBSToolへ非同期送信します。

## v2.4.3 Event Master
StackingGame/Mob/Buff/Debuffの共通イベント台帳に対応しました。


## v2.4.4 Event Master default alignment
- StackingGameの`encounterEnabledByDefault`をevents.generated.json生成/移行へ反映。
- 既存ユーザーが明示したtrue/falseは維持し、nullだけEvent Master既定値で補完。
- Event Master既定が「発生のみ」のStackingGame Encounterは新規生成時に無効。


## v2.4.7 Event Master packaging fix
- `tools/sync_event_master.py` を同梱しました。単体OBSMODパッケージでも `python tools/sync_event_master.py --check` でEvent Masterとのズレを確認できます。
- Runtimeの通知仕様はv2.4.6から変更していません。
