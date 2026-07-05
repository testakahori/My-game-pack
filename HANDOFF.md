# 引継ぎの書（最終更新 2026-07-05）

## 2026-07-05 追記：状態検証と開発サーバーjarの1.1.1同期

前回（07-04）の成果物が記載どおりか再検証し、取り残しを1件修正した。

### 検証結果（この環境で再現確認）

- 自動テスト `node bridge/test/simulate_events.js`：**7/7 PASS**
- 1.1.1 jar の SHA-256 が全配備先で一致（記載値 `D534E03A...` と一致）
  - `DoumaCmdMod/build/libs/doumacmd-1.1.1.jar`
  - `server/Douma_Craft/doumacmd-1.1.1.jar`（配布テンプレ）
  - `server/Douma_Craft/mods/doumacmd-1.1.1.jar`（配布テンプレ）
  - `release/win-unpacked/resources/server/Douma_Craft/{,mods/}`（EXE同梱）
- `release/MyGamePack Bridge UI Setup 1.0.9.exe` と `latest.yml` 生成済みを確認
- コード/スクリプトに旧 `1.1.0` のハードコード参照なし（setup.batはバージョン非依存）

### 修正したこと

- **開発サーバー `D:\Dev02\game_dev\MyGamePack02\server\Douma_Craft\mods\` に旧 `doumacmd-1.1.0.jar` が残存していた**ため、`doumacmd-1.1.1.jar`（hash `D534E03A...`）へ差し替え、旧jarを削除。これで全配備先が1.1.1で統一。

### 追加実装：配信統計ダッシュボード

強化案「統計ダッシュボード」を実装した。

- サイドバーに **「配信統計」📊** ページを追加（`src/components/StatsDashboardPage.tsx` 新規）
- `operations-history.json` のイベントを**時刻ギャップで配信セッションに自動分割**し、配信単位で
  ギフト数・いいね数・その他・成功/失敗・最頻ギフト・トップギフター・ユニーク視聴者・配信時間を集計
- 区切り時間（30/60/90/120/180分）をUIから切替可能。既定90分
- 全期間サマリー（配信数・総イベント・ギフト・いいね・成功率・失敗）も表示
- 新IPC `operations:streamStats`（`electron/main.cjs` の `computeStreamStats`）。既存履歴にそのまま効き、
  新規記録は不要。全期間合算のみだった既存 `operations:stats` を配信単位へ拡張した位置づけ
- 分割ロジックは合成データで11項目の単体検証済み（分割・集計・gap統合）。`vite build` 成功

### 追加実装：Minecraftコマンドの完璧化（全MOBスポーン統一）

「マイクラを完璧にしたい」との方針で、コマンドtxt 52本を全数監査し、残っていた演出・堅牢性の
問題を解消した（致命的バグは07-02で解消済み。今回は残りの品質・一貫性）。

- **全召喚MOBを「上空が開いていれば頭上から落下・塞がっていれば足元」フォールバックに統一**。
  視線基準の `^` 座標を summon から完全排除（採掘中の向きでスポーン位置がぶれる問題を根絶）。
  変換: zombie/skeleton/sheep/pig/silverfish/husk/husk01/wither_skeleton/skeleton_knight/
  cat/slime/kirarabbit/iron_golem/zombie-armer/zombiekataguruma/lovedog ＋ animals_happy（16種）
- slow_falling を `gift_spawn_new` タグで**召喚個体だけ**に限定（旧: `@e[type=X,limit=30]` は
  既存の飼育動物・ペットにも掛かっていた）
- lovedog: TITLEは{ListenerName}非置換だったため文言修正（SUBTITLEのみModが置換）、召喚犬に
  slow_falling 追加
- デッドコード除去（pig / ozisan_party の残骸行）
- 健全性チェック強化: summon行の `^` を全面禁止＋一時タグの remove 漏れ検出
- **Mod（jar）の再ビルドは不要**。Modはtxtを実行時に読むため、txt更新だけで反映される
- `creeper`（足元固定が確実で意図的）、`husk_watertower`（滝演出で意図的に上空~10）は対象外で正しい

### EXE再パック（v1.0.9・txt反映版）

上記のコマンドtxt統一を同梱するため `npm run pack:win` で **v1.0.9 を再パック**した
（バージョンは据え置き。旧1.0.9はGitHub未公開のためローカル上書き）。

- `release/MyGamePack Bridge UI Setup 1.0.9.exe`
  - サイズ: 360,036,933 bytes
  - SHA-256: `508dc91ff43aa1fb8e6ecb8d8c13072803f9d570f96756f609ceb2cbe0576a33`
  - SHA-512 (`latest.yml`): `GhqkyWiaeIGh3C4j6sxR1wfi/pd5WrLKRYDXrzWUfwGLn/p8C37yLsD8cyaQNKtFKDhT476soDv9yJ49XXEYmQ==`
  - releaseDate: `2026-07-05T08:38:29Z`
- `release/latest.yml` / `.blockmap` も再生成済み
- **検証**: 同梱 `resources/bridge/commands/minecraft/zombie.txt` が新方式（overhead/feet）になっていることと、
  同梱txtに summon+`^` が 0 件であることを確認
- ビルドは exit 0。途中 `rcedit`（exeメタ書換）が一時ロックで失敗→自動リトライで成功し、NSIS生成完了
- サイズが旧298MB→360MBに増加したのは、bridgeを起動するのに必須の `bridge/node`（Nodeランタイム約103MB、
  `electron/main.cjs` が `resources/bridge/node/node.exe` を使用）＋`bridge/node_modules`（45MB）が同梱されているため。
  異常ではない
- 既知の軽微点: `*.bak` / `logs/` / `test/` / `operations-history.json` も同梱される（計~100KB・無害）。
  将来的に electron-builder の `extraResources` フィルタで除外余地あり（今回のtxt反映には無関係なので未対応）

### 既に実装済み（07-03の「検討中リスト」は完了済み）

HANDOFF下部の07-03「優先度高：配信の安定運用に直結」リストは**すべて実装完了**。運用センター
（サイドバー🛡️）に集約されている:

| 機能 | 実装場所 |
|---|---|
| テストモード | 運用センター → オフライン・テストモード |
| /douma/status キュー可視化 | 運用センター → Mod死活監視（ゲージ、詰まりで警告色） |
| Mod死活監視 | 運用センター 上部（2秒ごとポーリング、応答なしで赤表示） |
| 実行結果フィードバック | status の executed/failed/lastError（Mod 1.1.1）＋運用センター表示 |
| イベント履歴ビューア | 運用センター → イベント履歴テーブル＋配信統計📊ページ |
| Bridge自動再起動 | electron/restart_policy.cjs（クラッシュ時のみ2秒後に再起動） |

### 注意（次の人向け）

- このプロジェクトには tsconfig.json が無く、ビルドは `vite build`（esbuildトランスパイルのみ）。
  型チェックはビルド工程に含まれない点に留意。
- 07-02〜07-05の作業は**ブランチ `feat/bougai-minecraft-fixes` にコミット済み**（内容別に8コミット）。
  main取り込みは `git checkout main && git merge feat/bougai-minecraft-fixes`（fast-forward）。
- コマンドtxtの変更をサーバーへ反映するには、各サーバーの `bridge/commands/minecraft/` へ配布するか、
  EXEを再パック（`npm run pack:win`）して再インストールする。**jar再ビルドは不要**。
- 7DTD側の強化（キュー/再送は移植済み、監視は未実装）は方針により保留中。
- 以降の未完タスクは下記「残っている実環境確認」のとおり、いずれも人がMinecraftに入るか外部サービスへ公開する必要があるもの。

---

# 引継ぎの書（2026-07-04）

## 2026-07-04 追記：次にやることを一括実施

### 完了したもの

- [x] DoumaCmdModを **1.1.1** へ更新してオフラインビルド
- [x] 1.1.1 JARを配布テンプレート、開発mods、実サーバーへ同一ハッシュで配備
- [x] 実サーバー `D:\新しいフォルダー` を起動して1.1.1のロードを確認
- [x] `/douma/status` のキュー、実行数、失敗数、直近エラー、TPS、tick時間、プレイヤー座標を実測
- [x] TikTok未接続のテストギフトを実Modへ送り、履歴と失敗フィードバックを確認
- [x] Bridge自動再起動ポリシーを独立モジュール化してテスト
- [x] サーバー起動前ワールド自動バックアップ
- [x] 実ワールドを更新前にZIPバックアップし、ZIP内の `level.dat` を検証
- [x] 拠点保護エリア内でTNT・マグマ・落とし穴系を抑止
- [x] コンボ、いいね／フォローマイルストーン、トップギフター名の演出
- [x] `# RANDOM` / `# WEIGHT` / `# COOLDOWN` メタ
- [x] 時限倍率モード
- [x] コメント投票とコメントコマンド
- [x] `playsound` とパーティクルの標準演出
- [x] ギフト割り当て設定プリセット
- [x] `config.minecraft.json` スキーマ検証
- [x] 設定、演出エンジン、再起動ポリシーのモジュール分割
- [x] Bridge⇔Mod WebSocket（25577番）を追加
- [x] 7DTD Telnetに最大3回の指数バックオフ再送を追加
- [x] TTS直列キュー
- [x] 配信履歴から総数・成功・失敗・最多ギフト・トップギフターを集計
- [x] TikTokギフト一覧を24時間ごとに自動更新
- [x] `electron-updater` 6.8.9とGitHub Releases更新設定を追加
- [x] コマンドTXTエディタへメタ入力、安全スポーン／演出雛形、保存前健全性検査を追加
- [x] **v1.0.9 Windowsインストーラー** と `latest.yml` を生成

### 実サーバーでの確認結果

実サーバー:

`D:\新しいフォルダー`

更新前に作成したバックアップ:

`D:\新しいフォルダー\backups\world-before-1.1.1-20260704-083249.zip`

- サイズ: 49,472,894 bytes
- ZIPエントリ: 87
- `level.dat`: あり

HTTP status実測:

```json
{
  "ok": true,
  "gift": 0,
  "like": 0,
  "other": 0,
  "executed": 6,
  "failed": 6,
  "protectedSkips": 0,
  "tps": 20.0,
  "player": { "online": false }
}
```

プレイヤー未接続でクリーパーを発火したため、対象不在の6コマンドが
`failed=6` として正しく検出された。これは失敗フィードバック機能の確認結果。

WebSocket実測:

- `ws://127.0.0.1:25577` へ接続成功
- Modからリアルタイムstatusを受信
- WebSocketからギフトイベントJSONを送信
- Modから `{"type":"ack","ok":true}` を受信
- HTTP 25576は信頼性の高いフォールバックとして維持

検証後、実サーバーはRCONの `stop` で正常停止済み。

### 生成物

#### DoumaCmdMod

`DoumaCmdMod/build/libs/doumacmd-1.1.1.jar`

SHA-256:

`D534E03A1ABF98FD9808532DEF991ED47CF5220A97BD0E893F8948BB9661C26C`

#### Windowsインストーラー

`release/MyGamePack Bridge UI Setup 1.0.9.exe`

- サイズ: 298,797,236 bytes
- SHA-256:
  `AE2EE4400F12E3FD20F34E64F437D3226FA72C3BF796554D31A8A1DA62DFD9AF`
- `release/latest.yml` 生成済み
- app.asar内に自動更新、再起動監視、運用センター、メタ対応UIがあることを検査済み

### 自動テスト

`node bridge/test/simulate_events.js`: **7/7 PASS**

1. コマンドTXTパーサー
2. ギフトdedupe
3. HTTP 429 → 再送 → 202
4. 全MinecraftコマンドTXT健全性
5. RANDOM重み／コンボ／マイルストーン／コメントコマンド
6. configスキーマの具体的エラー検出
7. Bridgeクラッシュ時だけ再起動し、手動停止時は再起動しない

追加実機テスト:

- `bridge/test/ws_smoke.js`: WebSocket status受信＋イベント送信＋ack成功
- `npm run build`: 成功
- Bridge / Electron全JS構文検査: 成功
- Gradle `build`: 成功

### 残っている実環境確認

コード・配備・自動テストは完了。以下は外部状態または人がMinecraftへ入る必要がある確認。

- [ ] Minecraftクライアントで実サーバーへ入り、運用センターからMOB発火を目視
- [ ] プレイヤーが保護座標内にいる状態でTNTを送り、`protectedSkips` 増加を確認
- [ ] いいね連打と実TikTokギフトを同時に送り、配信環境でギフト優先を最終確認
- [ ] 7DTD Dedicated Serverへ接続してTelnet再送を実機確認
- [ ] GitHub ReleasesへEXE・blockmap・`latest.yml` を公開し、自動更新を端末間で確認
- [ ] Electron画面のWindows自動操作はアプリ起動承認がタイムアウトしたため、目視QAのみ未完

---

## 2026-07-03 追記：強化案のうち安定運用機能を実装

### 今回実装したもの

#### 1. 「運用センター」ページを追加

関連ファイル:

- `src/components/OperationsPage.tsx`（新規）
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/types.ts`
- `electron/preload.cjs`
- `electron/main.cjs`

実装内容:

- サイドバーに **「運用センター」** を追加
- `GET /douma/status` を2秒ごとに取得して、サーバー／Modの死活を表示
- gift / like / other のキュー数をゲージ表示
- キュー滞留量に応じてシアン → 黄 → 赤へ警告色を変更
- TikTokへ接続せず、コマンドTXTを選んでギフト／いいねイベントを直接発火できるテストモード
- テスト送信者名とrepeat数（1～100）をUIから指定可能
- イベント履歴を最大1000件保存・一覧表示
- 履歴の消去機能
- `giftCooldownMs` / `maxLikeCatchUpPerEvent` / `likeBatchWindowMs` /
  `maxCommandsPerGift` をUIから編集可能
- ミュート対象ユーザーとTTS用NGワードをUIから設定可能
- 現在のワールドを `server/backups/world-日時.zip` に手動バックアップする機能

#### 2. ElectronからModへ直接アクセスするIPCを追加

追加IPC:

- `mod:status`
- `mod:testEvent`
- `operations:history`
- `operations:history:clear`
- `world:backup`

Modのホスト／ポートは `config.minecraft.json` の
`options.doumaModHost` / `options.doumaModPort` を使用する。
既定値は `127.0.0.1:25576`。

#### 3. Bridgeプロセスのクラッシュ自動復旧

`electron/main.cjs` のBridge起動方法を変更。

- ElectronがNodeプロセスを直接管理
- 意図しない終了時は2秒後に自動再起動
- ユーザーが「Bridge停止」を押した場合は再起動しない
- Bridgeは非表示ウィンドウで動作するため、動作確認はUIの死活監視と
  `bridge/logs/` を使用する

#### 4. イベント履歴

`bridge/index.js` からModへの送信に成功したイベントを
`bridge/operations-history.json` へ記録するようにした。

記録項目:

- 発生日時
- イベント種別
- 視聴者名
- commandFile
- repeat数
- 成否

運用センターから直接送ったテストイベントも同じ履歴へ記録される。

#### 5. ミュート／TTS安全機能

`bridge/index.js`:

- `options.mutedUsers` に登録された表示名・uniqueId・userIdのイベントを無視
- 対象は gift / chat / like / share / follow / member
- `options.ttsNgWords` の単語を `＊` に置換して読み上げ
- TTSをPromiseキューへ入れ、複数コメント・ギフトが同時に来ても直列再生
- いいねバッチ幅の固定値1200msを `options.likeBatchWindowMs` で変更可能にした

#### 6. Mod実行結果の統計をソースへ追加

`DoumaCmdMod/src/main/java/jp/douma/doumacmd/DoumaCmdMod.java`:

- 実行コマンド累計 `executed`
- 失敗累計 `failed`
- 直近エラー `lastError`

を `/douma/status` のJSONへ追加した。

想定レスポンス:

```json
{
  "ok": true,
  "gift": 0,
  "like": 0,
  "other": 0,
  "executed": 123,
  "failed": 1,
  "lastError": "..."
}
```

重要: **Javaソースは更新済みだが、新JARはまだ生成・配備できていない。**
現在配備済みの `doumacmd-1.1.0.jar` は旧status仕様のまま。
旧JARでも死活・キュー表示・テスト発火は動くが、
`executed` / `failed` / `lastError` は新JARへ差し替えるまで表示されない。

#### 7. TNTの地下フォールバック

- `bridge/commands/minecraft/tnt-kuusyuu.txt`
- `bridge/commands/minecraft/tntdaibakuhatu.txt`

頭上30ブロック地点が空気なら上空演出を実行し、
塞がっている坑道・地下ではプレイヤー周囲へTNTを出すよう変更。

#### 8. アプリバージョン

`package.json` を **1.0.9** に更新。

### 今回の検証結果

- `npm run build`：成功
- `node --check bridge/index.js`：成功
- `node --check electron/main.cjs`：成功
- `node bridge/test/simulate_events.js`：**4/4 PASS**
  - コマンドファイルのパース
  - ギフトdedupe
  - HTTP 429後の再送
  - 全MinecraftコマンドTXTの健全性
- ブラウザ表示検証：この実行環境ではViteプロセスを維持できず未完
- Modビルド：コードエラーではなく、Maven取得時のJava証明書エラーで未完
  - `PKIX path building failed`
  - ForgeGradleの証明書検査無効化後も
    `libraries.minecraft.net` / Maven CentralのTLS検証で停止

---

## 次にやること（2026-07-03更新）

### 最優先

- [ ] JavaのPKIX証明書問題を解消して `DoumaCmdMod` を再ビルド
- [ ] 新JARを `server/Douma_Craft/` と `server/Douma_Craft/mods/` へ配備
- [ ] 新JARのバージョンを1.1.1以降へ上げ、旧1.1.0と識別できるようにする
- [ ] サーバー起動後、`/douma/status` に
  `executed` / `failed` / `lastError` が出ることを確認
- [ ] `npm run electron:dev` で運用センターを開き、テストギフトを実際に発火
- [ ] gift / like / other のゲージと履歴が更新されることを確認
- [ ] Bridgeプロセスを意図的に終了し、2秒後に自動再起動することを確認
- [ ] ワールド停止中に手動バックアップを実行し、ZIPから復元できることを確認
- [ ] `npm run pack:win` で **v1.0.9** のインストーラーを生成

### 次の実装候補（未完了）

- [ ] 配信開始時のワールド自動バックアップ
- [ ] 拠点保護エリアと破壊系コマンドの発動抑止
- [ ] ギフトコンボ／マイルストーン／トップギフター名付きボス
- [ ] `# RANDOM` / `# WEIGHT` / `# COOLDOWN` メタ
- [ ] 時限モード
- [ ] コメント投票とコメントコマンド
- [ ] 効果音・パーティクルの標準演出
- [ ] ギフト割り当てプリセット
- [ ] configスキーマ検証
- [ ] index.jsのモジュール分割
- [ ] Bridge⇔ModのWebSocket化
- [ ] electron-updater
- [ ] 7DTD側へのキュー／再送／監視機能の移植
- [ ] 配信単位の統計ダッシュボード

### 強化案の進捗

| 強化案 | 状態 |
|---|---|
| テストモード | 実装済み・実機確認待ち |
| `/douma/status` キュー可視化 | 実装済み・実機確認待ち |
| Mod死活監視 | 実装済み・実機確認待ち |
| 実行結果フィードバック | ソース実装済み・新JAR生成待ち |
| イベント履歴 | 実装済み |
| Bridge自動再起動 | 実装済み・実機確認待ち |
| ユーザーブラックリスト／ミュート | 実装済み |
| ワールドバックアップ | 手動実行のみ実装済み |
| TTS NGワード | 実装済み |
| レート制限UI | 実装済み |
| TNT地下フォールバック | 実装済み |
| 読み上げキュー | 実装済み |
| その他の強化案 | 未実装 |

---

## 今回やったこと：不具合修正＋システム強化（妨害マイクラ）

### 報告されていた不具合と原因

| 不具合 | 原因（特定済み） |
|---|---|
| いいね連打中にギフトが無視される | DoumaCmdMod のイベントキューが「全種別合算1000件」上限で、いいねが溜まるとギフトも **HTTP 429 で拒否**。Bridge側はリトライせず**そのまま破棄**していた |
| クリーパー等が位置によって出ない | コマンドtxtが `^ ^3 ^-2` 等の**視線基準ローカル座標**を使用。プレイヤーが下を向いている（採掘中）とスポーン位置が**地中**に計算され窒息・埋没。`creeper.txt` の `~ ~1 ~` も高さ2の坑道で天井にめり込む |
| （潜在バグ）Manifestingギフト無反応 | `zombiekataguruma.txt` に **summonコマンド自体が欠落**（NBTだけ残存） |
| （潜在バグ）暗闇・採掘低下・採掘上昇が無反応 | `give_blindness/fatigue/haste.txt` が**未実装プレースホルダ `{PlayerMe}`** を使用→常に失敗 |

### 修正内容

#### 1. DoumaCmdMod（Forge Mod）→ **doumacmd-1.1.0.jar**
`DoumaCmdMod/src/main/java/jp/douma/doumacmd/DoumaCmdMod.java`
- キュー上限を種別分離：gift 600 / like 120 / other 280。**いいねが何万件来てもギフトは拒否されない**
- いいねはキュー内で自動合流（同一keyの連打を1イベントに圧縮）、満杯時は古いいいねから破棄
- 「イベント数/tick」→「**コマンド数/tick 予算制**（60cmd/tick、いいね用に8予約）」に変更。repeat=100級ギフトも複数tickに分割実行され、TPS急落→キュー詰まりの悪循環を根絶
- アナウンス(title)は分割実行でも1回だけ表示
- `/douma <key> <count>` 手動実行も同じキュー経由に統一
- `GET /douma/status` 追加（キュー滞留の確認用: `{"ok":true,"gift":N,"like":N,"other":N}`）
- 配備済み: `bridge_ui/ui/server/Douma_Craft/doumacmd-1.1.0.jar`（配布テンプレ、setup.batも1.1.0対応でバージョン非依存化）＋ `server/Douma_Craft/mods/`（開発サーバー）

#### 2. Bridge（Node）
`bridge_ui/ui/bridge/index.js`
- **ギフト送信リトライ**：429/接続断時に指数バックオフで最大5回再送（フェイクサーバーで実測検証済み）
- **いいねミニバッチ**：1.2秒窓で同一commandFileの発火をまとめて1イベント化（HTTP・キュー圧を削減）
- likeベースラインのキーを `threshold` → `threshold|commandFile` に変更（同じしきい値を2行設定した時に片方が永久に発火しないバグを修正）
- テスト用に主要関数を `module.exports` 化（`require.main` ガード付き、本番動作に影響なし）

#### 3. コマンドtxt（bridge/commands/minecraft/）
- 視線依存 `^ ^N ^M` → ワールド相対 `~ ~N ~` ＋ **「上空が塞がっていれば足元にフォールバック」の2行パターン**に統一：
  `taiden` `cod` `villager` `wither` `warden` `ghast` `blaze_phantom` `witch_sabbat` `ozisan_party`
- `creeper.txt`：足元 `~ ~ ~` に変更（プレイヤーが立てている空間＝確実に空いている。クリーパー高1.7で収まる）
- `zombiekataguruma.txt`：欠落していた summon コマンドを修復
- `give_blindness/fatigue/haste.txt`：`{PlayerMe}` → `@a` に修正
- `hukitobasu.txt`：不可視アーマースタンドが**無限に蓄積するリーク**を修正（kill追加）
- `lovedog.txt`：`~ ~1 ~` → `~ ~ ~`
- `fall_sand.txt`：タイトル（砂落下）と実動作（give砂64個）が食い違っていたため、頭上7x7の砂落下に実装し直し（上空が塞がっていれば発動しない安全設計）

#### 4. Electron（main.cjs）＋ バージョン
- `refreshDoumaModJar()` 追加：**アプリ更新時に既存ユーザーの serverFolder/mods の doumacmd jar を自動差し替え**（今までは bridge しか再展開されず Mod が旧版のまま残った）
- package.json を **1.0.8** に更新（bridgeVersion 比較で bridge+jar が再展開される）

### 検証（実施済み）
- Mod：gradle ビルド成功（`gradlew build -Dnet.minecraftforge.gradle.check.certs=false`※プロキシ環境のため）
- Bridge：`node --check` OK、`node bridge/test/simulate_events.js` **4/4 PASS**
  - パーサー / dedupeキー / **429→リトライ→202の実動作** / 全txtの健全性（プレースホルダ残存・^座標残存・非コマンド行の検出）

---

## 次やること（TODO）

### 最優先：実機確認
- [ ] EXEビルド（v1.0.8）の完了確認 → `release/MyGamePack Bridge UI Setup 1.0.8.exe`（未完なら `cd bridge_ui/ui && npm run pack:win`）
- [ ] サーバー起動して `mods/doumacmd-1.1.0.jar` がロードされるか確認（起動ログに `[Douma] Bridge HTTP listening on 127.0.0.1:25576`）
- [ ] ライブ実機テスト：いいね連打しながらギフト → ギフトが必ず発動するか（Bridgeログに `Send ok after retry` が出ることがある＝正常）
- [ ] 採掘中（下向き・坑道内）にクリーパー系ギフト → 足元/頭上に出現するか
- [ ] `curl http://127.0.0.1:25576/douma/status` でキュー滞留を確認

### 検討中（今後の強化案）

#### 優先度高：配信の安定運用に直結
- **テストモード**：TikTok接続なしでUIから任意のギフト/いいねイベントを手動発火（配信前の動作確認が一瞬で終わる。現状はライブを開始しないと確認できない）
- UI に /douma/status のキュー可視化パネルを追加（Bridgeページにゲージ表示、詰まりかけたら警告色）
- **Mod死活監視**：Bridgeが /douma/status を定期ポーリングし、応答がなければUIに「サーバー落ちてる/Mod未ロード」警告
- **実行結果フィードバック**：Modがコマンド失敗数をレスポンスやstatusで返す→「発動したはずなのに何も起きない」を配信中に検知できる
- イベント履歴ビューア（誰が・いつ・何を送って・何が発動したかをUIで一覧。視聴者への「届いてないよ」対応に使える）
- Bridgeプロセスの自動再起動（クラッシュ時にElectronが検知して再スポーン）

#### 配信演出・ゲーム性
- **ギフトコンボ演出**：同一ギフトが短時間にN連続でエスカレート（ゾンビ10連→ゾンビボス出現、TNT5連→大空襲など）
- **マイルストーンイベント**：累計いいね1万・フォロワー100人到達などで超大型イベント自動発火
- トップギフターの名前をボスMOBに付けて登場させる（承認欲求ドリブン設計）
- **ルーレットギフト**：1つのギフトにランダム効果（お助け50%/妨害50%）を割り当てる `# RANDOM` メタ対応
- 時限モード：「5分間 妨害効果2倍タイム」などのバフ/デバフ時間帯
- コメント投票：視聴者がコメントで次の妨害を多数決（!1 クリーパー !2 TNT…）
- コメントコマンド（!攻撃 等の視聴者コマンド）機能
- 効果音・パーティクルの演出強化（発動時にplaysound＋パーティクルを標準プリロード化）

#### 安全・荒らし対策
- **ユーザーブラックリスト/ミュート**：特定視聴者のイベントを無効化（UI設定）
- 拠点保護エリア：座標範囲を設定し、地形破壊系（TNT・マグマ・落とし穴）はエリア内では発動しない
- ワールド自動バックアップ（配信開始時にworldをzipスナップショット→事故っても巻き戻せる）
- TTS用NGワードフィルタ ※前回からの持ち越し
- レート制限のUI設定化（giftCooldownMs / maxLikeCatchUpPerEvent / バッチ窓などを画面から調整）

#### コマンドtxt資産の拡充・整備
- tnt-kuusyuu / tntdaibakuhatu も上空フォールバックパターン化（現状は地下だと埋まった場所で爆発）
- コマンドtxtのUI内エディタ（メタ・座標パターンのテンプレ付きで新規作成、保存前に健全性チェック実行）
- `# WEIGHT` / `# COOLDOWN` などのメタ拡張（ファイル単位の個別クールダウン）
- ギフトID→txt割り当てのプリセット保存（「マイクラ用」「7DTD用」「ソフト妨害デー」等の一括切替）
- tiktok_gifts の自動更新（現在は update_gifts.bat 手動実行）

#### 技術基盤（中長期）
- index.js のモジュール分割（events/transport/tts/config に分離。テスト網を広げる土台）
- Bridge⇔Mod を WebSocket 化（双方向通信で実行結果・TPS・プレイヤー座標をリアルタイム取得）
- config.minecraft.json のスキーマバリデーション（起動時に誤設定を具体的に指摘）
- electron-updater による自動アップデート（毎回インストーラー配布が不要になる）
- 7DTD側にも同等のキュー/リトライ強化を移植（現状はMinecraft側のみ強化済み）
- 読み上げキュー（TTS が重なった時の直列化）※前回からの持ち越し
- 統計ダッシュボード（配信ごとのギフト数・発動数・失敗数・最頻ギフトを集計）

---

## 関連パス

| 項目 | パス |
|---|---|
| BRIDGE UI プロジェクト | `D:\Dev02\game_dev\MyGamePack02\bridge_ui\ui` |
| Bridge本体（dev実行対象） | `bridge_ui\ui\bridge\index.js` |
| コマンドtxt | `bridge_ui\ui\bridge\commands\minecraft\` |
| Forge Mod ソース | `bridge_ui\ui\DoumaCmdMod\`（build: `gradlew.bat build -Dnet.minecraftforge.gradle.check.certs=false`） |
| Mod jar 配布テンプレ | `bridge_ui\ui\server\Douma_Craft\doumacmd-1.1.0.jar` |
| 開発サーバー | `server\Douma_Craft\`（mods に 1.1.0 配備済み） |
| シミュレーションテスト | `bridge_ui\ui\bridge\test\simulate_events.js`（`node test\simulate_events.js`） |

## 起動コマンド

```bash
# BRIDGE UI 開発起動
cd D:\Dev02\game_dev\MyGamePack02\bridge_ui\ui
npm run electron:dev

# オフライン検証
cd bridge && node test\simulate_events.js

# EXE ビルド
npm run pack:win
```
