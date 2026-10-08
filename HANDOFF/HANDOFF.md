# 引継ぎの書（最終更新 2026-07-09）

> **注意**：このファイルは肥大化したため、2026-07-09以降の新しい更新は
> `HANDOFF02.md` に記載する。過去の経緯・監査ログとしてこのファイルはそのまま残す。
> 次回作業者は先に `HANDOFF02.md` の一番下（最新エントリ）を読むこと。

---

## 2026-07-09 修正フェーズ②：完了報告（HANDOFF記載の残タスクを一括で消化）

修正フェーズ①の「次にやること」全項目、および全体監査（07-08）の優先順位リスト（section 7）のうち
**D（Modのjar再ビルドが要るもの）と実機EXE検証を除く全て**を、このセッションで実施・検証済み。

### 最終検証結果（このセッションの最後に実行・全て成功）

- `node --check electron/main.cjs` / `node --check electron/preload.cjs` / `node --check bridge/index.js` / `node --check scripts/prepare-bridge-runtime.cjs`：すべて成功
- `npm run build`（vite build）：成功
- `npm run typecheck`（新規追加。`tsc --noEmit`）：**エラー0件**
- `node bridge/test/simulate_events.js`：**11/11 PASS**（streak回帰テスト4件を新規追加）

### このセッションで完了した項目（優先順位リストsection 7）

1. **P/Q（コード面）**：`server:copyTemplate` を非同期化＋進捗ポーリング対応、EXE/開発ブラウザーの
   フォルダ選択フォールバック分岐、setup.bat手順オーバーレイ、を実装（詳細は下の旧セクション参照）。
   **未了：実機（unpacked EXE）でのForgeインストール／環境構築の動作確認**（次回セッションで必須）。
2. **5章の偽UI全て**：配信統計（タイムライン・折れ線・直近イベント・盛り上がりポイント・トップギフト
   フォールバック）を実データ化。TTS（成功率・波形・ピッチ目盛り・無機能＋ボタン）を実測/削除。
   MappingEditorの💎固定値を実データ化。
3. **6章の地雷全て**：
   - 同梱 `config.minecraft.json` の実データ混入 → `scripts/prepare-bridge-runtime.cjs` が
     `build/bridge-bundle/config.minecraft.json` にクリーンな既定configを生成し、electron-builderの
     extraResources上書き順（`bridge`→`build/bridge-bundle`）でパッケージ側だけ自動的にクリーン化される
     （開発環境の実configファイルには一切手を触れていない）。
   - `ensureConfigExists` の既定configに options/likeEvents/各種イベント/unmappedGiftEvent を完備。
   - `operations-history.json` を JSON配列（読み込み→unshift→全書き込み）から **JSONL（1行1イベント・
     追記のみ）に変更**。bridge/electron 双方が同じ変換・追記ロジックを持ち、旧フォーマットは初回追記時に
     自動移行（手動でのテストで移行→追記→新しい順読み出しの往復を確認済み）。2MB超過時のみ行数を
     チェックして直近2000行に圧縮。
   - `tsconfig.json` を新規作成し `npm run typecheck` を追加。副産物として、参照されていない旧UIの
     残骸（`GiftsTab.tsx` / `GiftsPanelInline.tsx` / `ExportView.tsx` / `SettingsExportView.tsx` /
     `WorldSettingsPage.tsx` / `services/geminiService.ts`）を削除し、型エラーを完全に解消。
4. **streakベースライン修正の回帰テストを追加**（`bridge/test/simulate_events.js`）：
   - 正常な連打進行でdeltaが増分のみになること
   - `repeatEnd` が `1`（非boolean）でも `true` でも終了扱いになること
   - 終了イベント欠落→次streakが `rc<prev` で無視されないこと（今回のバグの直接回帰）
   - TTL失効後に同一rcNumでもbaselineを捨てて発火すること
   - 実装は `bridge/index.js` の streak判定ロジックを `computeStreakDelta()` という純関数に切り出し、
     本番コードとテストが同じロジックを検証する形にした（ロジック自体は変更なし、切り出しのみ）。

### まだ残っている作業（次セッション）

1. **P/Q 実機確認（必須）**：unpacked EXE で「フォルダ選択」「Forgeインストール」「環境構築」
   （進捗バー表示・setup.bat手順オーバーレイ）を実際に動かして確認する。
2. **D：Mod（Java）の `performSilent` が `result==0` を failed 計上する問題**：`DoumaCmdMod` の
   jar再ビルドが必要なため、まとめて対応する（未着手）。
3. **最終検証（配布前）**：`node bridge/test/simulate_events.js` の回帰 ＋ unpacked EXE で
   「初回セットアップ→一括起動→テストイベント→実ライブでいいね連打＋ギフト」を通しで確認。
   **ユーザー承認までEXEは配布しない**（従来ルール継続。このセッションでもEXEパックは実施していない）。
4. HANDOFF.md が肥大化しているため、余裕があれば `docs/handoff-archive/2026-07.md` へ過去分（07-05以前）
   を移動する（section 8の改善アイデアより）。

---

## 2026-07-09 修正フェーズ②：検証通過＋P/Q/R着手（作業中・以下は詳細ログ）

フェーズ①の「次にやること」を順に実施した記録。**このセッション内で `node --check` / `npm run build` / `simulate_events.js` を通しており、以下は全て検証済み。**

### 検証結果（フェーズ①の締め項目）

- `node --check electron/main.cjs` / `node --check electron/preload.cjs` / `node --check bridge/index.js`：すべて成功
- `npm run build`（vite build）：成功（55 modules transformed）
- `node bridge/test/simulate_events.js`：**7/7 PASS**（streak変更の回帰なし）
- `devApiMock.ts` に `bridgeRestart` を追加済み（開発ブラウザーの再起動ボタンがundefinedにならない）

### 今回追加で実施した修正（P/Q/R）

- **P.1**：`InitialSetupPage.handlePickFolder` のcatchを `import.meta.env.DEV` で分岐。EXE（`window.mygamepack`がpreload由来）ではもう手入力モードへ落ちず、実エラーメッセージだけを表示する。開発ブラウザーのみ手入力フォールバックに落ちる。
- **P.2**：`devApiMock.dialogPickFolder` から `window.prompt()` を廃止し、常にthrowして即座に手入力フォールバックへ委ねるように変更（promptのUXが悪く「手入力しろと言われた」という誤解を生んでいたため）。`handleUseExistingSetup`/`handleChooseCompletedFolder` は既存の try/catch でエラーメッセージ表示に落ちることを確認済み（クラッシュしない）。
- **Q.1**：`electron/main.cjs` の `server:copyTemplate` の `copyRecursive` を同期fsから `fs.promises` ベースの非同期版（`copyRecursiveAsync`）に置き換え、25ファイルごとに `setImmediate` でイベントループへ制御を返すようにした。JDK同梱の数千ファイルコピー中もメインプロセスが完全ブロックされなくなった。
  - 進捗は `copyTemplateState`（`{state, copied, total, error}`）に保持し、新規IPC `server:copyTemplateStatus` でポーリング可能に。
  - preload に `serverCopyTemplateStatus`、型定義、devApiMockにモックを追加。
  - `InitialSetupPage.tsx` に `runCopyTemplateWithProgress()` を追加し、`handleForgeInstall`/`handleSetup` から利用。プログレスバー（`setup-copy-progress-v2`）をUIに追加。
- **Q.2**：`setupState === "running" || "launched"` のとき、setup.bat の対話手順（サーバー起動確認→ウィンドウを閉じる→任意キーで続行→自動遷移）を説明する `setup-guide-overlay-v2` を表示するようにした。
- **R**：完了画面「検出された環境」の固定配列を撤去し、新規IPC `setup:inspectEnvironment`（`electron/main.cjs`）で実測に置換。
  - Forge: `libraries/net/minecraftforge/forge/<version>` フォルダ名から検出。Minecraftバージョンはforgeバージョン文字列の先頭から抽出。
  - Java: `spawnSync("java", ["-version"])`（stderr出力）で検出。**同梱JDKは存在しないため、PATH上のjavaを見ている点に注意**（HANDOFF既存記述の「同梱JDK」は実体が無かった＝これも偽記載だったので実態に合わせた）。
  - DoumaMod: `mods/doumacmd-*.jar` の実ファイル名。
  - TikTok API: `gifts.meta.json` の鮮度（24時間以内なら「接続 OK」）。
  - Bridge: `app.getVersion()`。
  - preload `setupInspectEnvironment`、型定義、devApiMockモック（開発モードは「開発モード: 未実測」表示）を追加。
  - `App.tsx` ヘッダーの `v1.0.13` ハードコード・「システム状態: 正常／接続: オンライン／Bridge: 監視中」固定文字列・静止時計も、`appVersion` IPC＋`bridgeProcessStatus`＋`modStatus` のポーリング（5秒間隔）＋`setInterval`時計（30秒間隔）に置き換えた。`status-dot--warn`（赤）をCSSに追加。

### 5章（偽UI）の対応（完了・検証済み）

- **配信統計（`StatsDashboardPage.tsx`）を全面的に実データ駆動に書き換え**：
  - タイムラインの固定 `24%/52%` ドットと固定時刻ラベル → `operations:history` の実イベントを配信区間でフィルタし、実際の相対位置・実時刻から算出。
  - 「ギフト＆いいね推移」の固定polyline → 実イベントを配信区間で5分割ビニングして実データでpolyline生成。
  - 「直近イベント」の固定2行 → `operations:history` の実データ（最新8件）。
  - 「盛り上がりポイント」の固定2件＋無機能な「＋注釈を追加」ボタン → 実イベントの回数上位3件に置換、無機能ボタンは削除。
  - トップギフト/トップギフターの `クリーパー`/`akahoridouma` フォールバック → データが無い場合は「データなし」表示に変更。
  - イベント内訳の「シェア」固定0 → **`bridge/index.js` の `enqueueDoumaModEvent` に `historyType` を追加**（Mod向けキュー種別は従来どおり"other"のまま、operations-history.json への記録だけ share/follow/member の実種別を残すように分離。jar再ビルド不要）。`electron/main.cjs` の `computeStreamStats` を拡張し `share`/`follow`/`member` を個別集計。
- **TTS設定（`TTSSettingsPage.tsx`）**：
  - 「テスト成功率 100%／直近テスト12回成功」固定値 → セッション内の実テスト回数・成功数で計算する実測値に変更（`testStats` state）。
  - 波形＋「00:00 / 00:06」固定表示 → 実際の`Audio`要素の`currentTime`/`duration`から算出し、再生中のみアニメーションする`tts-waveform--active`に変更。
  - テスト定型文の無機能な「＋」ボタンを削除。
  - ピッチスライダーの目盛り表示「-1.0〜+1.0」（実レンジ-0.15〜+0.15と不一致）→ 実レンジに合わせて表示修正。
- **MappingEditor.tsx**：登録済みギフトカードの `💎 1` 固定表示 → `giftsRead()` の実データから `giftDiamondMap`（giftId→diamond_count）を構築し、実際のダイヤ数を表示するように変更。

### 次にやること（このセッションの続き）

1. **6章の残り**：同梱 `config.minecraft.json` のクリーン化、`ensureConfigExists` の既定configにoptions/likeEvents補完、operations-history のJSONL化、tsconfig/型チェック導入。← 次はここから着手する。
2. `simulate_events.js` にstreak修正（TTL失効・repeatEnd truthy判定・新streak開始時のリセット）の回帰テストを追加。
3. 各スライスごとに `node --check` / `npm run build` / `simulate_events.js` を再実行してから次に進むこと（このセッションはFable/Fairy Taleの検証ゲートに従い、スライスごとに検証済み。ここまで全スライスで7/7 PASS・vite build成功を確認済み）。
4. 検証が通るまでEXEは作らない（従来ルール継続）。

---

## 2026-07-09 修正フェーズ①：監査で挙げた最優先バグを実装修正（作業途中・未検証）

下の「2026-07-08 全体監査」で挙げた指摘に沿って、優先度順に修正を進めた記録。
**まだ `vite build` / `node --check` / `simulate_events.js` による検証を通していない。次にやることは末尾参照。**

### 修正済み（コード反映済み・要検証）

- **C：streakベースライン残留（`bridge/index.js`）** ← いいね連打中のギフト無視の主因のひとつ
  - `streakLastCount` を `{ count, at }` 保持に変更、`STREAK_TTL_MS`（既定60秒、`options.streakTtlMs`で調整可）で失効。
  - 前回値より小さい repeatCount（新streak開始）や失効時は baseline を捨てて `delta=1`。**もう `delta<=0` で return して飲み込まない**。
  - `repeatEnd` を truthy 判定に変更（`1`/`true` どちらでも終了扱い）。
  - `lastExecAt` / `streakLastCount` を5分ごとに掃除する `stateCleanupTimer`（unref付き）を追加。

- **A/B：configクロバー＆username上書き（`GiftSettingsPage.tsx` / `DashboardPage.tsx`）** ← ギフト全消し・別アカ接続の主因
  - `GiftSettingsPage`：マウント時に `configRead()` の mappings を最優先でロード（localStorageが空でも55件が消えない）。`configToGiftMappings()` を追加。`hydratedRef` で初期ロード前の空配列保存を抑止。mappings変更時に localStorage＋（username設定済みなら）configへ best-effort 保存（`persistMappingsToConfig`）。
  - `DashboardPage.applyBridgeConfig()`：**localStorageが空なら既存config.mappingsを維持**（無条件上書き廃止）。username は「UI入力＞config既存」で、ハードコード `akahoridouma` を全廃。両方空なら明示エラーで停止。
  - `DashboardPage` の username 初期値を `""` にし、config優先で初期化する useEffect を追加（`usernameLoadedRef`ガード）。パイプライン/入力欄の `akahoridouma` フォールバック表示を「未設定/配信アカウント名」に変更。

- **K：gameruleのRcon未定義（`electron/main.cjs`）** ← 常昼/keepInventoryが一度も効いていなかった
  - `server:gamerules:apply` を **Mod経路（`/douma/event`, key=`_gamerules`）へ委譲**。`new Rcon(...)`（未require）を撤去。
  - 内部コマンド `bridge/commands/minecraft/_gamerules.txt` を新規作成。
  - `bridge:commands:list` / `readMeta` で **`_`始まりのファイルをドロップダウンから除外**（内部用を隠す）。

- **H/I：BRIDGE停止・再起動の直列化とPIDフォールバック（`electron/main.cjs`）** ← 再起動が空振りしていた
  - `launchBridge()` / `stopBridge()` を関数化。`stopBridge` は **childのexitをawait（5秒タイムアウト）** してから返す。
  - `bridge:restart` IPCを新設（stop完了→400ms待ち→launch）。UI側の stop→launch 連打を廃止。
  - ウィンドウタイトルkill（効かない）を廃し、`killBridgeByCommandLine()`（このbridgeの commandLine＋dir一致の node.exe だけ Stop-Process）に変更。

- **J：一括起動のMinecraft非致命化＋パス候補（`electron/main.cjs` / `DashboardPage.tsx`）**
  - `getMinecraftLauncherCandidates()`：`app-config.minecraftLauncherPath`＋LOCALAPPDATA/ProgramFiles等の候補を追加。Store版はexplorer shell経由フォールバック。
  - `handleAllStart` で Minecraft起動を **個別try/catchにして警告ログで続行**（BRIDGE起動まで到達する）。

- **L：ワールド読み込みの個別catch（`DashboardPage.tsx`）**
  - `serverPropsRead` を個別 `.catch(() => ({}))` に。server.properties が無くてもワールド一覧が空にならない。

- **N/O：偽ログ・偽ステータスの削除（`DashboardPage.tsx`）**
  - アクティビティログの架空4行を削除→空時は案内文。「すべて表示↗（実は全消去）」→「ログをクリア」。表示を直近4→12件に。
  - 「保護＆バックアップ」カードを実データ化（`safety`ステート：拠点保護 `options.protection.enabled`、起動時バックアップ `autoBackupOnServerStart`、BRIDGEログ監視＝稼働状態）。
  - TikTokノード/アカウント欄の「接続中」を `bridgeState` 連動に。

- **6章の一部（`electron/main.cjs` / `restart_policy.cjs` / `preload.cjs` / `electron.d.ts`）**
  - `RestartPolicy` に上限（既定5回/60秒窓）＋指数バックオフ（`nextDelayMs`/`exhausted`）を実装。無限再起動を防止。
  - 死にIPC `bridge:start`（存在しない `minecraft_start_all.bat` 参照）を削除。preloadの `bridgeStart` も削除。
  - `app:version` IPC＋preload `appVersion`＋型定義を追加（UIハードコード版数の置換用。※App.tsxヘッダーの置換は未実施）。
  - preload/型定義に `bridgeRestart` を追加。

### まだ手を付けていない（次セッションで続き）

- **P/Q**：`server:copyTemplate` の同期fsブロック解消（非同期化）、フォルダ選択のEXE/開発ブラウザー分岐（EXEでエラー時に手入力モードへ落とさない）、セットアップ手順オーバーレイ。
- **D**：Mod（Java）の `performSilent` が `result==0` を failed 計上する問題（`execute if/unless` の不成立を失敗にしない）。**jar再ビルドが必要**なのでまとめて対応予定。
- **R**：完了画面「検出された環境」ハードコード → 実測IPC or 削除。App.tsxヘッダーの固定ステータス＋`v1.0.13` → `appVersion`/実データ接続。
- **5章の残り偽UI**：配信統計のタイムライン/折れ線/直近イベント/盛り上がり注釈、TTSの成功率カード・波形・定型文＋・ピッチ目盛り、MappingEditorの `💎1` 固定。
- **6章の残り**：同梱 `config.minecraft.json` のクリーン化（開発者の実データ・絶対パス commandsDir 除去）、`ensureConfigExists` の既定configにoptions/likeEvents補完、operations-history のJSONL化、tsconfig/型チェック導入。
- **devApiMock**：`bridgeRestart` のモック未追加（開発ブラウザーで再起動ボタンが undefined になる。フォールバックで stop→launch は動く）。次で追加すること。

### 次にやること（この修正フェーズの締め）

1. `bridge_ui/ui` で **`node --check electron/main.cjs` / `node --check bridge/index.js`** を通す（bridge側は確認済みOK）。
2. **`npm run build`（vite build）** を通す（型・JSXエラー確認。特に DashboardPage / GiftSettingsPage）。
3. **`node bridge/test/simulate_events.js`** で回帰（streak変更が既存テストを壊していないか）。
4. `devApiMock.ts` に `bridgeRestart` を追加。
5. 上記「まだ手を付けていない」を優先度順に継続。
6. 検証が通るまでEXEは作らない。

---

## 2026-07-08 全体監査：codexリデザイン後の総点検（指摘と改善策のみ・修正はまだ実施していない）

このセクションは、リデザイン後に「中のシステムが壊れた」との報告を受けて、
コードを全読して行った監査の結果である。**今回は修正を一切行っていない。**
次の作業者はここを上から順に潰していくこと。

読んだファイル：`bridge/index.js`（全行）、`bridge/feature_engine.js`、`bridge/config.minecraft.json`、
`DoumaCmdMod/src/main/java/jp/douma/doumacmd/DoumaCmdMod.java`（全行）、`electron/main.cjs`（全行）、
`electron/preload.cjs`、`electron/tts.cjs`、`electron/restart_policy.cjs`、
`src/App.tsx`、`src/components/DashboardPage.tsx`、`InitialSetupPage.tsx`、`TTSSettingsPage.tsx`、
`StatsDashboardPage.tsx`、`EventSettingsPage.tsx`、`GiftSettingsPage.tsx`、`MappingEditor.tsx`、
`src/lib/devApiMock.ts`、`server/Douma_Craft/setup.bat`、`forge_install.bat`、`setup_world.ps1`、
`bridge/commands/minecraft/cod.txt` ほか。

### 前提：いま確認している画面はどれか（超重要）

EXEは v1.0.12 以降ビルドしていない。ユーザーが `http://127.0.0.1:5175/` の開発ブラウザーで
確認している場合、`window.mygamepack` は **`src/lib/devApiMock.ts` のモック**であり、
以下は「壊れている」のではなく「開発ブラウザーでは最初から実行されない」：

| 機能 | 開発ブラウザー(5175) | EXE / electron:dev |
|---|---|---|
| フォルダを選択 | `window.prompt()` で手入力（モック仕様） | ネイティブダイアログ（`dialog:pickFolder`） |
| Forgeインストール / 環境構築 | ログを1行足すだけで**何もしない** | テンプレコピー→ forge_install.bat / setup.bat 実行 |
| 一括起動 / Forge起動 / Minecraft起動 | フラグ切替＋偽ログのみ | 実プロセス起動 |
| BRIDGE起動/停止 | フラグ切替のみ | node.exe で bridge 実起動 |
| ワールド保存 | `/__dev/server/props/write` 経由で**実フォルダに書く**（副作用あり） | serverFolder の server.properties に書く |
| TTS | vite proxy 経由で実VOICEVOX/AivisSpeechに繋がる | Electron IPC で実エンジン |

→ ユーザー報告の「フォルダ選択で手入力しろと出る」「Forge/環境構築ボタンが本当に動くか怪しい」は、
**開発ブラウザーで見た場合はモックの仕様**。EXEで再現するかは未検証なので、
修正後に必ず **unpacked EXE で** 再確認すること。ただし後述のとおりEXE側にも実バグが複数ある。

---

### 1.【最重要】「いいね連打中にギフト無視／ギフト投げたのに何も起きない」の原因

Mod側のキュー分離（gift 600 / like 120 / other 280）と Bridge側の429リトライは前回どおり健在で、
**「イベントが溜まってギフトが拒否される」経路は現行コードでは基本的に塞がっている**。
今回の監査で見つかった残りの原因は以下。重大度順。

#### A.（致命・データ破壊）一括起動／「BRIDGEに適用」が config の mappings を localStorage で上書きして全消しする

- `DashboardPage.tsx` の `applyBridgeConfig()`（385行付近）は
  `localStorage["mc_tiktok_mappings_unified_v1"]` を読み、**空なら `mappings: []` のまま
  `config.minecraft.json` を上書き保存**する。
- 一方 `GiftSettingsPage.tsx` は **configから一度も読まず localStorage だけ**を正とする
  一方通行構造。リデザイン・キャッシュクリア・別プロファイル・新規インストールで
  localStorage が空になると、config にある **55件のギフト割当が一括起動を押した瞬間に消える**。
- しかも開発モードでは `DEV_SAMPLE_MAPPINGS`（6件のサンプル）で本物を上書きする。
- mappings が消えると全ギフトが「未設定ギフト」（skeleton.txt）に落ちるか、
  `unmappedGiftEvent` が無効なら**完全に無反応**。
  →「ギフトなげたのに何も起こらなかった」の最有力原因。
- **対策**：
  1. mappings の single source of truth を `config.minecraft.json` に統一する。
     `GiftSettingsPage` はマウント時に `configRead()` から mappings をロードし、
     保存時に `configWrite()` する（イベント設定ページは既にこの方式で正しい）。
  2. `applyBridgeConfig()` は localStorage が空・または既存configより件数が大幅に少ない場合、
     **既存 config の mappings を維持**する。無条件上書きを禁止。
  3. 移行措置として、初回起動時に config→localStorage へ一度だけ同期してもよいが、
     最終的に localStorage は表示キャッシュ以外に使わない。

#### B.（致命）tiktokUsername がハードコード既定値 "akahoridouma" で上書きされる

- `DashboardPage.tsx:246` の username 初期値は `localStorage || "akahoridouma"`。
  `applyBridgeConfig()` は username が非空なら常にそれを採用するため、
  ダッシュボードで一度もユーザー名を入力していない環境で一括起動すると、
  config の実運用アカウント（現在 `mikusu_nuts`）が **akahoridouma に書き換わる**。
- Bridge は**別人のライブ**へ接続しに行くので、いいねもギフトも一切反応しない。
  「何も起こらなかった」のもう一つの有力原因。
- **対策**：username の初期値は `configRead()` の値を使う。ハードコード既定値は全廃。
  空のまま一括起動されたら「TikTokユーザー名が未設定です」とエラーで止める。

#### C.（重大）連打ギフトのベースライン残留で、同一人物の次のギフトが無視される

- `bridge/index.js:1223-1236`。streak中は `delta = repeatCount - 前回値` で発火し、
  `data.repeatEnd === true`（**boolean厳密比較**）のときだけ `streakLastCount` を削除している。
- 終了イベントが来ない／dedupeで落ちた／ライブラリが `repeatEnd: 1` など非booleanを返した場合、
  前回の repeatCount（例：5）が**永久に残留**する。次に同じ人が同じギフトを rc=1 から投げると
  `delta = 1 - 5 <= 0 → return` で **rc が前回値を超えるまで全部無視**される。
- 「いいねを連打してる常連さん（＝よくギフトも投げる人）が不意にギフトを送ると無視される」
  という報告パターンに合致する。
- **対策**：
  1. `streakLastCount` の各エントリに最終更新時刻を持たせ、60秒程度で失効させる。
  2. `repeatEnd` は truthy 判定にする。
  3. `rcNum < prev` の場合は「新しいstreakが始まった」とみなし、prev をリセットして delta=rcNum で発火する。
  4. あわせて `lastExecAt`／`recentEvents`／`likeTriggeredAt` も定期クリーンアップ（配信を跨ぐ長時間稼働対策）。

#### D.（診断を狂わせる）Mod が「条件不成立」を失敗として計上する

- `DoumaCmdMod.java` の `performSilent()` は `result == 0` を `failed++`＋`lastError` 更新にしている。
- ところが現行の召喚txtは「上空が空いていれば頭上／塞がっていれば足元」の
  **2行フォールバック**なので、**毎回必ず片方が result 0** になる。
  タラ(cod.txt)が正常に出ても failed が増え続け、運用センターの失敗数と lastError が
  常に汚染される → 「壊れているように見える」心理的原因。
- **対策**：`execute if/unless` で始まるコマンドの result 0 は失敗計上しない
  （または txt メタ `# ALLOW_ZERO: true` で許容行を指定）。statusには
  `conditionalSkips` として別カウントすると diagnosis に使える。

#### E.（体感遅延→無視に見える）リトライが単一直列キューを塞ぐ

- Bridge の全イベントは `rconQueue`（1本の直列キュー）で送信され、
  `enqueueDoumaModEvent` はギフト時 最大5回・合計~15秒（timeout1.5s×6＋バックオフ）
  キューを占有し得る。Mod停止・サーバー未起動のまま連打が続くと、
  後続イベントが数十秒〜数分遅れ、視聴者には「無視された」ように見える。
- **対策**：Mod死活（`mod:status` 相当のping）を Bridge 自身が保持し、
  停止中は即時失敗＋「Mod未応答のため保留N件」をログ/statusへ出す。
  リトライ待ちはキュー外（イベント個別のタイマー）に逃がす。

#### F.（仕様の明文化）count は Mod 経路で最大100にクランプ

- `repeat=100` のギフトを 2連打（delta=2）すると 200 が 100 に切られる。
  意図的な安全弁だが、どこにも書かれていない。仕様としてHANDOFFとUI（回数入力の説明）に明記するか、
  100超は複数イベントに分割送信する。

#### G.（仕様）Bridge起動直後の最初のいいねイベントは発火しない

- `likeTriggeredAt` は初回イベントで「現在の累計いいね数」をベースライン記録するだけ（正しい設計。
  再接続時の爆発防止）。ただし「配信途中でBRIDGE再起動→最初の10いいねでタラが出ない」は
  この仕様によるもの。ログに `[Like] baseline set total=...` を出して見分けられるようにする。

#### 補足：ギフト無視の実地切り分け手順（次回ライブで）

1. Bridge には既に `[Gift:RAW]` 診断ログがある（受信した全ギフトを記録）。
   ダッシュボードのBRIDGEログでこれを見る。
   - RAWに**出ていない** → TikTok側/接続先アカウント違い（→B）か tiktok-live-connector の取りこぼし。
   - RAWに出て `[Gift:SKIP:dedupe]` → dedupe誤爆（窓2.5s）。
   - RAWに出て何もログが続かない → delta<=0（→C）か cooldown。
   - `-> DoumaMod ...` まで出て発動しない → Mod側。`curl http://127.0.0.1:25576/douma/status` でキューとlastErrorを見る。
2. 運用センターのテストモードで同じ commandFile を発火し、Mod経路単体の健全性を先に確認する。

---

### 2. ダッシュボード（BRIDGE停止/再起動・一括起動・ワールド選択）

#### H.（重大）「BRIDGE再起動」は高確率で空振りする

- `bridge:stop`（main.cjs）は `taskkill` を **spawn するだけで終了を待たずに** 返る。
- `DashboardPage.handleBridgeRestart` は `await bridgeStop()` 直後に `bridgeLaunch()` を呼ぶが、
  `bridge:launch` は `if (!bridgeProcRef) launch()` なので、**旧プロセスがまだ死んでいないと
  何も起動せず ok を返す**。その後旧プロセスが死んでも `bridgeStopRequested = true` のままなので
  自動再起動もされない。→ UIは「再起動しました」と表示するが**実際は停止したまま**。
  ユーザーの「BRIDGE停止、再発動が本当に動いているのか怪しい」はこれ。
- **対策**：
  1. `bridge:stop` はプロセスの `exit` イベントを await する（taskkill 後、最大5秒待ち）。
  2. `bridge:restart` 専用IPCを新設し、main側で「停止完了→起動」を直列に実行する。
     UI側の stop→launch 連打実装は廃止。
  3. 再起動後は `bridge:processStatus` で PID が変わったことを確認してから「再起動しました」を出す。

#### I.（実質無効）PID不明時のBRIDGE停止フォールバックが効かない

- `taskkill /F /FI "WINDOWTITLE eq MC TikTok Bridge"` は、Bridge を `windowsHide: true` の
  ウィンドウ無しで起動しているため**絶対に一致しない**。前セッションから残った Bridge は殺せない。
- **対策**：起動時に PID を `bridge/.bridge.pid` へ書き、停止時はそれを読む。
  さらに保険として `Get-CimInstance Win32_Process` でコマンドラインに
  `index.bundle.cjs --config` を含む node.exe を検索して kill（イメージ名一括killは危険なので不可）。

#### J.（重大）一括起動が「Minecraftランチャー未検出」で全体中断する

- `minecraft:launch` は固定2パス（Program Files (x86) / XboxGames）しか探さず、
  見つからないと throw。`handleAllStart` はこれを catch すると**そこで終了**するため、
  **BRIDGE起動・ゲームルール適用まで到達しない**。
  「一括で動かすボタンが実装されない（たぶんマイクラを開くまでいかない）」の正体はこれ
  （＋開発ブラウザーではそもそも全部モック）。
- **対策**：
  1. Minecraft起動失敗は**警告ログにして続行**する（配信はサーバー＋Bridgeで成立する。
     ランチャーは手動で開けばよい）。
  2. ランチャーパス候補を追加（`%LOCALAPPDATA%\Programs\Minecraft Launcher`、
     Microsoft Store版は `explorer.exe shell:AppsFolder\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft` など）。
  3. app-config.json に `minecraftLauncherPath` を持たせ、設定UIから変更可能にする。

#### K.（確定バグ）ゲームルール適用は一度も成功していない — `Rcon` が未定義

- `main.cjs:1413` `const rcon = new Rcon({...})` — **ファイル先頭に `rcon-client` の require が無い**。
  呼ぶと必ず `ReferenceError: Rcon is not defined`。
  UI側は catch して「ゲームルール適用: サーバー未起動のためスキップ」と**誤った文言**を出すため
  誰も気づかない。常昼・晴れ・keepInventory は**現状一度も適用されていない**。
- さらに `ui/node_modules` に rcon-client が**入っていない**（bridge側にのみ存在）ので、
  require を足すだけでは動かない。
- **対策**：
  1. `npm i rcon-client` を ui 側 dependencies に追加し、`main.cjs` 冒頭で require。
  2. または RCON をやめ、gamerule 適用を Mod への `/douma/event`（other, gamerule用txt）に委譲する
     （経路が一本化されて事故が減る。こちらを推奨）。
  3. catch 時の文言を実エラー内容に変える（誤診の温床）。

#### L. ワールド選択 → server.properties

- `server:props:write` 自体は正しく、選択したワールドは `level-name=haihu_world/<名前>` として
  serverFolder の server.properties に書かれる。**ロジックは生きている**。
- ただし問題が2つ：
  1. `DashboardPage.tsx:303-311` の初期読み込みが `Promise.all([serverPropsRead, serverWorldsList])`
     を**まとめて catch** しているため、server.properties が無い（setup未完）だけで
     **ワールド一覧まで空**になり、セレクトに何も出ない。個別に catch すること。
  2. 反映はサーバー再起動後。一括起動フローは「保存→Forge起動」の順なので問題ないが、
     単体の「保存」ではUIに「次回サーバー起動時に反映」と出るのみ。既に起動中なら
     再起動を促すバナーを出すとよい。
- **setup.bat は無事**。eula自動true（33行目）、server.properties 生成＋RCON設定＋
  `level-name=haihu_world/newworld`（72行目）、doumacmd jar の mods/ 移動、すべて残っている。
  「セットアップの環境構築で eula/server.properties 生成が書き替えられて消された可能性」は**否定**。

#### M. サーバー停止／全停止は「このセッションで起動した場合」しか効かない

- `server:stop` はメモリ上の `serverPid` 頼み。アプリを再起動すると停止不能になり
  「ウィンドウを直接閉じてください」エラー。
- **対策**：RCON `stop`（K修正後）または Mod 経由の stop を第一手段にし、PID は補助にする。

#### N.（信頼性を壊す偽UI）アクティビティログの偽データと誤ボタン

- ログが空のとき**架空の4行**（「[TIKTOK] @akahoridouma に接続しました」等）を表示している
  （`DashboardPage.tsx:650-655`）。実際には何も起きていないのに「接続しました」と出るため、
  ユーザーが実挙動を信じられなくなる直接原因。**即削除**。
- 「すべて表示 ↗」ボタンの実装が `setLog([])`＝**ログ全消去**。ラベルと逆の破壊操作。
  全件表示モーダルに直すか、ラベルを「クリア」にする。
- 表示が直近4件のみ（`log.slice(-4)`）で一括起動の経過が流れて見えない → 高さ可変＋スクロールに。

#### O.（偽UI）静的ステータス表示の一掃

- アプリヘッダー（App.tsx:106-111）「システム状態: 正常／接続: オンライン／Bridge: 監視中」は**全部固定文字列**。
  時計も再レンダー時のみ更新。`bridgeProcessStatus`／`modStatus` に接続するか、削除する。
- ダッシュボードの「保護＆バックアップ: 準備OK・✓ログ監視・✓不正コマンド防御…」も**全部飾り**。
  実データ（運用センターの protection 設定・autoBackupOnServerStart・mod死活）に接続するか削除。
- TikTokノードの「● 接続中」はユーザー名が入力されているだけで点灯する。Bridge実接続
  （BRIDGEログの `[TikTok] Connected` 検知 or Bridgeにstatusエンドポイント追加）に基づかせる。

---

### 3. 初期セットアップ

#### P. 「フォルダを選択できない・手入力しろと出てくる」

- 開発ブラウザー(5175)では `devApiMock.dialogPickFolder` が `window.prompt()` を出す**仕様**
  （ネイティブダイアログが使えないため）。EXEでは `dialog.showOpenDialog` に繋がっており
  コード上の問題は見当たらない。
- ただし `handlePickFolder` はダイアログ呼び出しが**例外を投げた場合に自動で手入力モードへ落とし**、
  「開発ブラウザでは〜手入力してください」という長文エラーを出す。EXEで何らかの理由で
  例外が出た場合もこの文言が出るため、ユーザーには「EXEでも手入力しろと言われた」ように見える。
- **対策**：
  1. EXE（`window.mygamepack` がpreload由来）ではエラー時に手入力モードへ落とさず、
     実エラーメッセージだけ表示する。手入力フォールバックは開発ブラウザー限定にする
     （`import.meta.env.DEV` で分岐）。
  2. 開発ブラウザーは prompt をやめ、最初からパス入力欄を出す（promptはUXが悪く誤解を生む）。
  3. 修正後、**unpacked EXE で「初回前」「完了済み」両画面のフォルダ選択**を実機確認する。

#### Q. Forgeインストール／環境構築ボタン

- EXE側の経路は繋がっている：`serverCopyTemplate`（テンプレコピー）→
  `server:forgeInstall:atPath` / `server:setup:atPath`（新コンソールで bat 起動）。
- ただし実バグ・リスク：
  1. `server:copyTemplate` の copyRecursive が **同期fs でメインプロセスをブロック**。
     テンプレには JDK 一式（数百MB・数千ファイル）が含まれ、初回コピー中は
     **アプリ全体が無応答**になる。async 化＋進捗を `bridge:syncStatus` 同様に通知すること。
  2. setup.bat は対話式（server.properties 生成のためサーバーを一度起動→ユーザーが
     サーバーウィンドウを閉じて任意キー）。UI側にその手順ガイドが無いので、
     コンソールに戸惑って放置→「動かない」になりやすい。UIに手順オーバーレイを出す。
  3. 開発ブラウザーではモックが「ログを足すだけ」なので、ここで動作確認しても意味がない。
- `waitForSetupComplete`（3秒×120回の自動完了ポーリング）は良い実装。維持。

#### R.（偽UI）完了画面「検出された環境」がすべてハードコード

- 「Forge 1.20.1／Minecraft 1.20.1／Java Eclipse Temurin 17／Bridge v1.0.13／TikTok API 接続 OK」は
  **固定配列**（InitialSetupPage.tsx:438-449）。実際には何も検出していない。
- **対策**：検証IPC `setup:inspectEnvironment` を新設し、
  serverFolder の `libraries/` `run.bat` `mods/doumacmd-*.jar`、同梱JDKの `java -version`、
  `app.getVersion()`、TikTok疎通（gifts.meta.json の鮮度等）を実測して返す。作らないなら削除。
  ついでにアプリバージョン表記（App.tsx の `v1.0.13` ハードコード）も `app.getVersion()` IPC に置換。

---

### 4. 読み上げ（TTS）— 「自分には聞こえるが視聴者に聞こえない」

#### S. 原因は構造上のもの（バグではない）

- Bridge の読み上げは `bridge/index.js speakText()` が WAV を生成し、
  PowerShell `Media.SoundPlayer` で **このPCの既定出力デバイス**に再生しているだけ。
  配信に音を乗せるのは **TikTok LIVE Studio 側のキャプチャ設定**の役目で、
  「デスクトップ音声（PCサウンド）」を取り込んでいなければ視聴者には聞こえない。
- 「ライブ配信が始まったらライブに接続して配信に載せる」というAPIは TikTok側に存在しない。
  Bridge は既に接続リトライ（5秒毎・無限）を持つので「先にBRIDGEを起動しておけば
  配信開始後に自動接続される」は現状でも成立する。
- **対策（実装案）**：
  1. **恒久ガイドUI**：読み上げ設定ページに「配信に乗せる設定」ステップ
     （LIVE Studio → 音声ミキサー → PCサウンドをON）を図解で常設。
     （現在の一文注記 `tts-stream-audio-note` はあるが目立たない）
  2. **出力デバイス選択**：`SoundPlayer` はデバイス指定不可。確実にやるなら
     (a) VB-CABLE 等の仮想オーディオデバイス利用を前提に、再生コマンドを
     ffplay / SoX 等のデバイス指定可能なプレイヤー同梱に置き換え、
     tts-settings.json に `outputDevice` を追加。
     (b) LIVE Studio に「アプリ音声キャプチャ」があるので、TTS再生専用の小さな
     常駐プレイヤープロセス（ウィンドウ名固定）にして、それをアプリ単位で拾わせる手もある。
  3. **配信前セルフチェック**に「テスト音声を鳴らすので LIVE Studio のメーターが振れるか確認」
     という項目を入れる（自動検証は不可能なので人間確認をフロー化）。

#### T. TTSの細かい不備

- `tts:test`（main.cjs）は `volume` を synthesis に渡していない（UI側 `Audio.volume` にのみ適用）。
  Bridge 本番再生は `volumeScale` を使うため、**テストと本番で音量が変わる**。揃えること。
- TTSSettingsPage の偽UI：
  - ステータスカード「テスト成功率 100%／直近テスト: 12回成功」は**完全な固定値**。実測にするか削除。
  - 波形と「00:00 / 00:06」は飾り。誤解されるなら削除か再生時のみアニメ。
  - テスト定型文の「＋」ボタンは無機能。実装するか削除。
  - ピッチスライダーの目盛り表示が「-1.0〜+1.0」だが実レンジは -0.15〜+0.15。表示を実値に合わせる。
- `writeTtsSettings` は userData と serverFolder/bridge の両方へ書く実装で正しい。
  ただし Bridge は毎イベントで tts-settings.json を読み直すため反映は即時（再起動不要）。UI文言に明記可。

---

### 5. デザインだけで実装されていない／嘘の表示（全洗い出し）

| 場所 | 偽物の内容 | 対応 |
|---|---|---|
| 配信統計 | サマリー・成功率ゲージ・配信分割は**本物**（operations:streamStats） | 維持 |
| 配信統計 | タイムラインのドット位置(24%/52%)と時刻(08:40〜09:40)が**固定** | 実イベント時刻から算出 |
| 配信統計 | 「ギフト＆いいね推移」折れ線が**固定polyline** | 実履歴を時間ビン集計して描画 |
| 配信統計 | 「直近イベント」テーブルが**固定2行**（sakura等の架空データ） | operations:history の実データ表示 |
| 配信統計 | 「盛り上がりポイント」「＋注釈を追加」**無機能** | 実装するか削除 |
| 配信統計 | イベント内訳の「シェア」が常に0（otherに合算されている） | historyのtype別集計を拡張（share/follow/member を type=other でなく実typeで記録） |
| 配信統計 | トップギフト「クリーパー」・トップギフター「akahoridouma」のfallback | 「データなし」を表示 |
| ダッシュボード | アクティビティログの架空4行（→N） | 削除 |
| ダッシュボード | 保護＆バックアップカード全部（→O） | 実データ接続 or 削除 |
| ダッシュボード | TikTok「● 接続中」（→O） | 実接続状態に |
| アプリヘッダー | システム状態/接続/Bridge監視中/時計（→O） | 実データ接続 |
| 初期セットアップ完了画面 | 「検出された環境」5項目（→R） | 実測IPC or 削除 |
| 読み上げ設定 | テスト成功率カード・波形・定型文＋（→T） | 実測 or 削除 |
| ギフト一覧 | 「サーバー連携」サマリーカードは実測か未確認（恐らく静的） | 次回確認。静的なら modStatus に接続 |
| MappingEditor | 登録済みカードの `💎 1` が全ギフト固定 | ギフトカタログから実ダイヤ数を引く |

---

### 6. 配布・構成の地雷（今回の症状と別だが放置すると事故る）

1. **同梱 `bridge/config.minecraft.json` に開発者の実データが入ったまま**：
   `tiktokUsername: mikusu_nuts`、RCONパスワード実値、
   `commandsDir: "D:\\Dev02\\...\\bridge\\commands\\minecraft"`（絶対パス）。
   新規ユーザーのPCでは commandsDir が存在せず、**Bridgeが起動直後に exit(1)** する
   （`bridge/index.js:820`）。configWrite を一度通れば `config:write` が commandsDir を
   serverFolder 内へ矯正するので直るが、素の状態が壊れている。
   → ビルド時（prepare-bridge-runtime）に「クリーンな既定config」へ差し替えるステップを追加。
2. **死にIPC `bridge:start`**：`minecraft_start_all.bat` は存在しない（bridge_runtime/ に無い）。
   preload の `bridgeStart` ともども削除（実起動は `bridge:launch` に統一済み）。
3. **RestartPolicy が無限再起動・バックオフなし**：config不正等で即死するBridgeを**2秒毎に永久再起動**
   し続ける。5回で停止＋UI通知＋指数バックオフに。restartCount のUI表示は既にあるので活かす。
4. `ensureConfigExists` の既定configに `options`／`likeEvents`／`unmappedGiftEvent` が無い。
   既定値を完全な形にする（configWrite の commandsDir 矯正も `options` が無いと効かない）。
5. `operations-history.json` に **bridge（Node）と electron（main）の双方が read→unshift→write**
   しており、同時書き込みで履歴が巻き戻る可能性。追記型（JSONL）にするか、書き込みを
   electron 側に一本化（bridgeはIPCではなくファイルなので、実務的にはJSONL化が楽）。
6. tsconfig が無く型チェックが走らない（既知）。`Rcon` 未定義のような事故は
   `tsc --noEmit` があれば防げた。electron側だけでも `// @ts-check` + JSDoc か eslint(no-undef) を導入。
7. アプリバージョンのハードコード（App.tsx `v1.0.13`、InitialSetupPage の `Bridge v1.0.13`）
   → `app.getVersion()` を返すIPCに統一。

---

### 7. 修正の優先順位（次セッションへの作業指示）

1. **A/B: config クロバー修正**（mappings・username。データ破壊なので最優先）
2. **K: Rcon 未定義修正**（rcon-client導入 or Mod委譲）
3. **H/I: BRIDGE停止・再起動の直列化とPIDフォールバック**
4. **J: 一括起動のMinecraft失敗を非致命化＋パス候補追加**
5. **C: streakベースラインのTTL/リセット**
6. **N/O: 偽ログ・偽ステータスの削除**（信頼回復のため早めに）
7. **L: ワールド読み込みの個別catch**
8. **P/Q: セットアップのEXE実機確認＋copyTemplateの非同期化**
9. **D: Mod の result==0 失敗計上をやめる**（jar再ビルドが必要なのでまとめて）
10. **5章の偽UI群**を実データ接続 or 削除
11. **6章の地雷**（クリーンconfig同梱、RestartPolicy上限、JSONL化）
12. 修正後の検証：`node bridge/test/simulate_events.js`（回帰）＋ unpacked EXE で
    「初回セットアップ→一括起動→テストイベント→実ライブでいいね連打＋ギフト」を通しで確認。
    **ユーザー承認までEXEは配布しない**（従来ルール維持）。

---

### 8. もっとこうしたらいいのに（改善アイデア・提案。すべて未実装）

**アーキテクチャ**

- **設定の一元化**：localStorage を設定ストアとして使うのを全廃し、
  `config.minecraft.json`＋`app-config.json` に統一。Bridge は `fs.watch` で
  **ホットリロード済み**なので、mappings／likeEvents の変更は実は**BRIDGE再起動不要**。
  イベント設定ページの「保存後は BRIDGE を再起動してください」「次回 BRIDGE 起動から有効」は
  実装と食い違っており、「保存すれば即反映されます」に直せる（＝運用がだいぶ楽になる）。
- **Bridge に status サーバーを持たせる**：現状 Bridge の状態は stdout ログでしか分からない。
  Bridge 自身が `127.0.0.1:25578/status`（TikTok接続状態・roomId・直近イベント時刻・保留数）を
  返せば、ダッシュボードの「接続中」表示・偽UI一掃・切り分けが全部本物になる。
- **タイトル演出の一本化**：現在アナウンス(title/playsound/particle)が
  Bridge の RCON 経路と Mod の announce の**二重実装**。Mod 経路に一本化して
  RCON 経路の prelude を削除すると保守が半分になる。
- **type の正確な記録**：share/follow/member を Mod へ `type:"other"` で送っているため
  統計で区別できない。Mod の normalizeType を拡張し（other扱いのままキューは共有でよい）、
  operations-history に実typeを書く。

**配信オペレーション**

- **配信前セルフチェックボタン**（運用センター or ダッシュボード）：
  ①serverFolder存在 ②server.properties/eula ③Mod死活(/douma/status)
  ④RCON疎通 ⑤TikTokユーザー名設定 ⑥TTSエンジン死活 ⑦ワールド選択
  を一括診断して✓/✗リスト表示。「怪しいけど確認できない」を配信前に潰せる。
- **一括起動のステップUI化**：各段階（設定保存→Forge→Minecraft→(手動)LIVE接続→Bridge→gamerule）を
  チェックリスト表示し、失敗した段だけ「リトライ」「スキップ」を選べるようにする。
  現在の「途中で全部止まる」設計は配信直前に一番困る。
- **Forge起動の完了検知**：現在 `server:start` は bat を投げた瞬間に「起動しました」。
  実際は数十秒かかる。RCON か log tail（`Done (xx.xxs)!`）で「受付開始」を検知して
  ステータスを本物にする。BRIDGE起動を「サーバー準備完了後」に自動遅延させると事故が減る。
- **運用センターに「直近RAWギフト受信」パネル**：`[Gift:RAW]` 相当をUI表示すれば
  「届いてない／届いたが無視」の切り分けが視聴者対応中でも一目でできる。

**ゲーム演出・設定UX**

- ギフト設定にテスト発火ボタン（各ルートの「▶試す」→ mod:testEvent）。運用センターまで
  行かなくてもその場で確認できる。
- likeEvents の重複しきい値警告（同じ threshold＋同じ commandFile を2行作った時）。
- MappingEditor の未設定ギフト絞り込み（「commandFile 空だけ表示」トグル）と、
  config内に存在するが gifts カタログに無い giftId の警告表示。
- `# COOLDOWN` メタが streak ギフトには効かない（cooldown チェックは非streak時のみ）。
  連打系にもファイル単位のレート制限をかけたい場合は Mod 側 count 制御に寄せる。

**品質・保守**

- `npm run typecheck`（`tsc --noEmit`）と、electron/*.cjs への `node --check`＋eslint(no-undef) を
  pre-pack に組み込む（Rcon事故の再発防止）。
- `simulate_events.js` に今回のバグの回帰テストを追加：
  ①streak終了イベント欠落→次streakが発火する ②applyBridgeConfig相当のマージで
  mappings が空配列にならない ③bridge:stop→launch の直列化。
- HANDOFF.md が1300行超で日付が前後している。`docs/handoff-archive/2026-07.md` へ
  過去分を移し、HANDOFFは「現在の構成＋直近の状態＋TODO」だけにする。
- 未使用の GiftsTab/GiftsPanelInline/ExportView/SettingsExportView/WorldSettingsPage/
  geminiService 等、旧UIの残骸が src/ に残っている。App.tsx から参照されていないものを
  整理（削除 or legacy/ へ移動）してビルド対象を明確化する。

---


## 2026-07-07 追記：デザイン後に壊れていた実機能の復旧・開発ブラウザー検証

### 今日やったこと

#### 初期セットアップ

- 初期セットアップ前の「フォルダを選択」が開発ブラウザーで動かない問題を修正。
  - EXE / Electronでは従来どおりネイティブフォルダ選択を使う。
  - 開発ブラウザーでは native ダイアログが使えない場合に、手入力フォールバック欄を出すようにした。
- セットアップ先フォルダを指定すると、黒い入力枠に選択パスが反映されるようにした。
- 「リセット」でフォルダ指定を解除し、黒い入力枠も空に戻るようにした。
- `Forge をインストールする` は `serverForgeInstallAtPath()` 経由で `forge_install.bat` 起動ルートを通ることを確認。
- `環境構築をする` は `serverSetupAtPath()` 経由で `setup.bat` 起動ルートを通り、完了確認後に自動でダッシュボードへ遷移することを確認。
- セットアップ完了後画面には、既存の「フォルダを開く」に加えて、設定対象フォルダを選び直す「フォルダを選択」を分離済み。

#### ダッシュボード

- 配信準備コックピットの順番をユーザー指定どおり **TikTok → Forge Server → World → Bridge** に変更。
- 右側ライブ手順を以下に変更。
  1. forge server起動
  2. Minecraft起動
  3. TIKTOK LIVE STUDIO でライブ接続
  4. BRIDGE起動
  5. 配布ワールド選択
  6. 保護・安全設定
  7. TIKTOK LIVE 配信開始
- TikTok LIVE Studio は自動起動フローには組み込まず、「手動で行う手順」として表示する方針にした。
- ライブ手順とTikTok接続設定に残っていた `♪` アイコンを TikTok マークSVGへ差し替え。
- 一括起動の処理を以下の順で実行するように変更。
  1. 必要ならワールド設定保存
  2. Bridge設定を `config.minecraft.json` へ反映
  3. Forgeサーバー起動
  4. Minecraftランチャー起動
  5. TikTok LIVE Studio接続は手動手順としてログ表示
  6. Bridge起動
  7. gamerule再適用
- `BRIDGE停止` と `BRIDGE再起動` ボタンを一括起動の横に追加。
- アクティビティログ下に **BRIDGEログ専用パネル** を追加。
  - 稼働中/停止中
  - PID
  - CPU%
  - MEM
  - Bridge stdout/stderr/起動停止ログ
  を表示する。
- 左下の「Bridgeプロセス」カードも実ステータスをポーリングし、稼働中/停止中、CPU/MEMを反映するようにした。
- Electron側で `bridge:logs` IPCを追加し、Bridge起動時の stdout/stderr と停止/再起動ログをリングバッファで保持するようにした。

#### ギフト一覧

- ギフト一覧で同じギフトが複数表示される問題を修正。
  - IDを優先して重複排除し、fallbackとして名前＋ダイヤ数でも重複排除。
- 「人気」「アニメーション」など反応しないジャンルボタンを削除。
- 「HTMLを開く」「フォルダを開く」ボタンは押しても実用上わかりづらく、ユーザー要望に合わせて削除。
- 検索を修正。名前・IDで絞り込みできる。
- 並び替えを修正。
  - コスト 低→高
  - コスト 高→低
  - 名前 A→Z
- コピー操作を確認。コピー後にトーストが表示される。

#### ギフト設定

- 右側の「詳細を表示」は用途が不明で押しても何も起きないため削除。
- 「コマンド再読込」は読み込み件数がわかるメッセージを出すようにした。
- 「登録済みギフト」の「もっと見る」を、全件表示/折りたたみとして動くようにした。
- 登録済みギフトの文字サイズを拡大。
  - タイトル、コマンド名、ダイヤ数などを見やすくした。

#### 読み上げ設定

- コメント読み上げ/ギフト読み上げのON/OFFをUIに復帰。
- Bridge側は `chat` イベントで `commentEnabled`、ギフトで `giftEnabled` を見て読み上げる構造が残っていることを確認。
- リスナー側に聞こえない問題は、アプリ内では鳴っていても TikTok LIVE Studio 側でデスクトップ音声/アプリ音声を取り込んでいない可能性が高い。
  - 次回、TikTok LIVE Studioの音声入力/デスクトップ音声キャプチャ設定を実配信環境で確認する。

#### 配信統計

- 「配信の区切り」UIを削除。
- 何時間も配信するユーザー向けに、画面上はリアルタイム更新として表示するようにした。
- 開発ブラウザーで「配信の区切り」文言とセレクトが消えていることを確認。

### 開発ブラウザーで確認したこと

URL:

`http://127.0.0.1:5175/`

- `npm run build` 成功。
- 初期セットアップ:
  - 初回前画面でフォルダ未選択状態は黒い箱が空。
  - 「フォルダを選択」→ 開発ブラウザー用手入力 → `D:\新しいフォルダー (2)` を反映。
  - 「リセット」で黒い箱が空に戻る。
  - Forgeボタンで「起動済み」へ変化。
  - setupボタンで自動完了し、ダッシュボードへ遷移。
- ダッシュボード:
  - 一括起動クリックで開発モードログに以下が出る。
    - `[FORGE] 開発モード: serverStart`
    - `[MINECRAFT] 開発モード: ランチャー起動要求`
    - `[BRIDGE] 開発モード: @akahoridouma で起動`
  - 左下Bridgeカードが「稼働中」になり、CPU/MEMが更新される。
  - `BRIDGE停止` で「停止中」へ変化。
  - `BRIDGE再起動` で停止→起動ログが出て、再び「稼働中」へ戻る。
- ギフト一覧:
  - 551件表示。
  - `ハートミー` 検索で1件に絞り込み。
  - 検索クリアで551件に戻る。
  - コスト高→低で `TikTok Universe` など高額ギフトが先頭に来る。
  - 名前A→Zで名前順に切り替わる。
  - コピーで `ID コピー: ...` トーストが表示される。
- 配信統計:
  - 「配信の区切り」文言なし。
  - セレクトなし。

### 注意点 / まだ実環境で見ること

- 今回のブラウザー検証は開発モードのモックを含む。EXE/Electronでの実プロセス起動はまだ最終確認が必要。
- `forge_install.bat` と `setup.bat` は開発ブラウザーではモック確認。実EXEでは対象フォルダを確認してから実行する。
- BridgeはTikTok LIVEが実際に開始されていないと接続エラーになる可能性がある。
  - 実運用確認では、Forge → Minecraft → TikTok LIVE Studioで配信接続 → Bridge の順で試す。
- TTSが配信リスナーに聞こえない件は、TikTok LIVE Studio側の音声取り込み設定確認が必要。
- イベント設定の「いいね押しても反応しない」系は、デザインだけでなく実Bridge/Mod/TikTok接続込みでの確認が必要。

### 次にやること

- [ ] 開発ブラウザーのスクリーンショットをユーザーに提示する。
  - 初期セットアップ前
  - 初期セットアップ完了済み
  - ダッシュボードBRIDGEログ付き
  - ギフト一覧
- [ ] Electron / EXEでネイティブフォルダ選択が開くことを確認する。
- [ ] 実フォルダに対して `forge_install.bat` と `setup.bat` を実行確認する。
- [ ] 実Bridge起動時にBRIDGEログパネルへ stdout/stderr が流れることを確認する。
- [ ] TikTok LIVE Studio起動後、実ライブ接続状態でBridgeを起動し、接続エラーが出ない順番を確認する。
- [ ] TTS音声が配信に乗るよう、TikTok LIVE Studioのデスクトップ音声/アプリ音声キャプチャ設定を確認する。
- [ ] イベント設定を実Bridge/Mod接続で確認する。
  - いいね
  - ギフト
  - シェア
  - 訪問
  - コメント読み上げ
- [ ] ユーザー承認前にEXEは作らない。

### 主な変更ファイル

- `src/components/InitialSetupPage.tsx`
- `src/components/DashboardPage.tsx`
- `src/components/Sidebar.tsx`
- `src/components/GiftsViewerPage.tsx`
- `src/components/GiftSettingsPage.tsx`
- `src/components/MappingEditor.tsx`
- `src/components/TTSSettingsPage.tsx`
- `src/components/StatsDashboardPage.tsx`
- `src/lib/devApiMock.ts`
- `src/index.css`
- `electron/main.cjs`
- `electron/preload.cjs`
- `src/types/electron.d.ts`

## 2026-07-06 追記：v1.0.12 Bridgeランタイム最小化（node_modules同梱廃止）

### 方針変更

当初は `node/node_modules` を `bridge-runtime.zip` として1ファイル同梱し、必要時に展開する案を検討した。
しかし実測で、zip/tar展開はいずれも `node_modules` の数千ファイル実体化が重く、初回セットアップで数分かかる可能性があった。

そこで最終的に、より軽い方式として **Bridge本体をesbuildで依存込みの単一JSへバンドル**し、
`node_modules` 自体を配布・展開しない構成に変更した。

### 実装内容

- `scripts/prepare-bridge-runtime.cjs` を追加。
  - `bridge/index.js` を `build/bridge-bundle/index.bundle.cjs` へ依存込みでバンドル
  - `bridge/node/node.exe` だけを `build/bridge-bundle/node/node.exe` へコピー
  - `bridge-runtime-manifest.json` に bundle/node のSHA-256とサイズを記録
- `package.json`:
  - バージョンを **1.0.12** へ更新
  - `pack:win` 前に `prepare:bridge-runtime` を実行
  - `extraResources` から `bridge/node/**` と `bridge/node_modules/**` を除外
  - 代わりに `build/bridge-bundle` を `resources/bridge` へ同梱
- `electron/main.cjs`:
  - Bridge起動時は `index.bundle.cjs` があれば優先
  - `node.exe` はSHA-256一致まで確認し、古いnode.exeを誤採用しない
  - 既存サーバーフォルダへ `index.bundle.cjs` と `node/node.exe` だけを同期
  - 旧方式の `node_modules` が残っていても使わない（安全のため削除はしない）

### Nodeをユーザーに入れてもらう案について

技術的には、相手PCにNodeが入っていて、PATHが通っていて、さらに必要なnpm依存が正しく入っていれば動く。
ただし配信用アプリとしては、Nodeバージョン差・PATH未設定・依存不足でトラブル化しやすい。

今回のv1.0.12では、ユーザーにNodeインストールを要求しないまま、`node_modules` 大量同梱も避ける構成にした。
現時点ではこの方式が一番バランスが良い。

### 検証結果

- `node --check electron/main.cjs`：成功
- `node --check scripts/prepare-bridge-runtime.cjs`：成功
- `npm run build`：成功
- `node bridge/test/simulate_events.js`：**7/7 PASS**
- `build/bridge-bundle` だけでBridge直接起動確認:
  - `HasNodeModules=False` の状態でTikTok接続待ちまで進むことを確認
- v1.0.12最終unpacked EXEで実起動確認:
  - ウィンドウ `MC TikTok Bridge (統合UI)` 表示
  - `D:\新しいフォルダー\bridge\index.bundle.cjs` 同期済み
  - 旧 `node.exe`（v24.14.1相当）をSHA不一致として検出し、同梱 `node.exe`（hash `58E74...`）へ置換
  - 実サーバーフォルダ上で `node\node.exe index.bundle.cjs --config config.minecraft.json` が起動することを確認

### 生成物

- `release\MyGamePack Bridge UI Setup 1.0.12.exe`
  - サイズ: `288,207,015 bytes`
  - SHA-256: `DEDF84B9B92271B3ADF6356C1E3886A7E358C40498DA09F63B56066690F0BC5F`
- `release\latest.yml` も v1.0.12 へ更新済み
- 最終検証済みunpacked:
  - `release-1.0.12-final\win-unpacked`

---

## 2026-07-06 追記：v1.0.11 起動不能対策（Bridge同期の根本修正）

### 起きていたこと

v1.0.10 をインストール後、「アプリが開かない」ように見える状態を確認した。実際にはEXEが即クラッシュしていたのではなく、
`electron/main.cjs` の `ensureBridgeExtracted()` が **ウィンドウ生成前** に同期実行され、既存サーバー
`D:\新しいフォルダー\bridge` へ約7,600ファイル/約134MBのBridge一式をコピーしようとしていた。

特に `app-config.json` の `bridgeVersion` が旧 `1.0.5` のままだったため、起動のたびに重い同期に入っていた。

### 修正したこと

- `app.whenReady()` の順序を変更し、**先に `createWindow()` でウィンドウを表示**してからBridge同期を開始するようにした。
- Bridge更新コピーをバックグラウンド化。失敗してもアプリ起動を塞がず、運用センターに `Bridge同期` 状態を表示。
- `copyBridgeDifferential()` を追加し、全コピーではなく差分コピーに変更。
- `node` / `node_modules` は通常更新時に丸ごとスキップ:
  - `node`: `node.exe` のサイズが同じならスキップ
  - `node_modules`: `package.json` / `package-lock.json` と主要依存が揃っていればスキップ
- `config.minecraft.json` / `config.7dtd.json` / `tts-settings.json` / 履歴系は既存があれば上書きしない。
- 配布同梱から `logs/` / `test/` / `presets/` / `operations-history.json` / `runtime-status.json` を除外。

### 実機確認

- `node --check electron/main.cjs`：成功
- `node --check electron/preload.cjs`：成功
- `npm run build`：成功
- `node bridge/test/simulate_events.js`：**7/7 PASS**
- v1.0.11 unpacked EXEで実起動確認:
  - ウィンドウ `MC TikTok Bridge (統合UI)` が表示されることを確認
  - `app-config.json` は `bridgeVersion: "1.0.11"` へ更新
  - `D:\新しいフォルダー\bridge\.bridge-sync-state.json` を生成
  - 同期結果: `copiedFiles: 1`、`skippedHeavyDirs: ["node", "node_modules"]`

### 生成物

- `release\MyGamePack Bridge UI Setup 1.0.11.exe`
  - サイズ: `298,405,478 bytes`
  - SHA-256: `B817FC490B9394A176D43E079BF58BC42325EBFE57DEF3161BBF1C2554EE5A2D`
- `release\latest.yml` も v1.0.11 に更新済み
- 作成・検証に使った完全な unpacked 本体:
  - `release-1.0.11\win-unpacked`

### アンインストールが重い件の見立て

旧版アンインストールが重い主因は、インストール先に `resources\bridge\node` と `resources\bridge\node_modules` が
大量ファイルとして展開され、アンインストール時にそれらを削除するため。今回の修正で「起動時コピー」は軽くなったが、
「旧版アンインストールの大量ファイル削除」自体は残る。

次の本格改善案:

- Bridgeランタイムを `node` / `node_modules` の展開フォルダとしてインストール先へ置かず、単一の圧縮アーカイブとして同梱する。
- アプリ初回起動またはセットアップ時に、必要な時だけサーバーフォルダ/ユーザーデータへ展開する。
- これによりインストーラー/アンインストーラーが扱うファイル数を大幅に減らせる。

---

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

### インストーラ改善：旧バージョン自動アンインストール（v1.0.10）

「新しいEXEを入れる前に、いちいち旧版を手動アンインストールするのが手間」への対応。

- `build/installer.nsh` を新規作成（electron-builderが既定で `!include` するカスタムスクリプト）。
  `customInit` マクロで、インストール開始時に**旧バージョンのアンインストーラを HKCU と HKLM の両方から
  検出してサイレント実行**してから新版を入れる。過去の版（インストール方式が異なり取り残されたもの）も掃除する。
- バージョンを **1.0.10** へ更新（挙動が変わったので識別のため）。
- **includeされている事の検証済み**: `build/installer.nsh` に一時的な `!warning` マーカーを入れて
  `makensis` がそれを出力することを確認（`build/installer.nsh:9` を処理）→ その後マーカー除去して最終ビルド。
- 生成物 `release/MyGamePack Bridge UI Setup 1.0.10.exe`
  - サイズ: 298,824,942 bytes（bridge/node＋server同梱JDKで約300MBが通常。1.0.9再パックの360MBの方が異常値だった）
  - SHA-256: `fbba0f162c6767b3e1f103e2c4fd01c2b14452450d54d8f8828335d9607b928c`
  - SHA-512 (`latest.yml`): `aJYdHgI/10t8yVmPNIJg6TGAJOJmVI/zwikAtVitmPtpfzNun4ekUmty1smeselEXE4VGpALBsAx6rO3LC1ngQ==`
- 注意点:
  - `perMachine:false`＋`allowElevation:false` のため、**per-machineで入った旧版の除去には管理者権限が要り、
    昇格なしでは消えない場合がある**（per-userの通常インストールはHKCUから確実に除去される）。
  - この自動アンインストールの実挙動は、実機で「旧版インストール済み→新版インストール」を1回試して要確認
    （makensisへの取り込みはビルドで検証済みだが、実行時の除去は未実機確認）。

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

---

## 2026-07-07 追記：承認デザインの実装と読み上げ機能の調査

### 今日完了したこと

#### ダッシュボード

- 承認済み「配信準備コックピット」デザインへ刷新。
- Forge → Bridge → TikTok → 配布ワールドの接続フロー、ライブ手順、接続設定、保護状態、ログを再構成。
- 配布ワールドの表示を、格子状の仮画像ではなくMinecraftワールドとして読める表現へ修正。
- TikTokを音符の代用アイコンではなくTikTokとして判別できるマークへ修正。
- ユーザー確認済み。ダッシュボードは現状で承認済み。

#### ギフト設定

- 承認スクリーンショットに合わせ、ギフト選択、右側プレビュー、ルート編集、登録済みギフトをネオンUIへ刷新。
- TikTokから取得した実際のギフト画像を保持し、勝手な代替画像への変更を廃止。
- 画像位置に出ていた格子状の仮ボックスと `no img` 表示を除去。
- 「スケルトン降下！」等のコマンド欄は、スライム固定画像ではなくコマンド内容に応じたMinecraftアイコン表示へ修正。

#### イベント設定

- 参照画像に合わせ、5種類のイベントサマリー、いいね閾値ラダー、未設定ギフト／フォロー／シェア／訪問カードを実装。
- 上段・下段のシェアを青いチェーンアイコンで統一。
- 上段・下段の訪問を黄緑色の発光人物アイコンで統一。
- アプリ上部のBridgeアイコンをクリーパー顔、MyGamePackアイコンを青い `MC` へ修正。
- ビルド成功、ブラウザーコンソール error / warn 0件を確認。

#### 読み上げ設定（デザイン）

- `src/components/TTSSettingsPage.tsx` を、参照画像の音声コントロールデザインへ全面刷新。
- 4ステータスカード、VOICEVOX／AivisSpeech選択、停止警告、ボイス選択、4分割チューニング、波形付きテスト再生を実装。
- 声優・キャラクターを特定できる画像は使用せず、同じ匿名人物シルエットをミント／紫／ピンク／橙などの発光色で区別。
- ボイス選択時に上段の選択中ボイスと保存状態が更新されるReact側の表示動作はブラウザーで確認済み。
- `npm run build` 成功、ブラウザーコンソール error / warn 0件。
- 最新確認画像:
  - `C:\Users\MAKI\AppData\Local\Temp\tts-settings-anonymous-voices.png`

### 現在未完了：読み上げの実動作

ユーザー確認で次の問題が判明した。

- ボイスを実用上選択できない。
- 「VOICEVOXを起動する」「AivisSpeechを起動する」を押しても起動しない。
- VOICEVOX選択時はVOICEVOXのキャラ／スタイル一覧、AivisSpeech選択時はAivisSpeechのモデル一覧を出したい。
- テスト再生も実際に鳴らしたい。

#### 調査で判明した原因

1. 開発ブラウザー用 `src/lib/devApiMock.ts` は現在、
   - `ttsCheckEngine` が常に `false`
   - `ttsLaunchEngine` は成功を返すだけで何も起動しない
   - `ttsTest` は常に失敗
   となっている。したがって `http://127.0.0.1:5174/` 上では起動・モデル取得・テスト再生が絶対に成功しない。
2. UIはエンジン停止中に共通の `FALLBACK_SPEAKERS` を表示しており、VOICEVOX／AivisSpeechで一覧が分かれていない。
3. エンジン切替時に旧エンジンの `speakerId` を保持するため、新エンジンに存在しないIDが残る可能性がある。
4. Electron側は以下の固定ポートを使用。
   - VOICEVOX: `127.0.0.1:50021`
   - AivisSpeech: `127.0.0.1:10101`
   - `/version` で死活確認、`/speakers` でモデル取得、`/audio_query` → `/synthesis` でWAV生成。
5. Electronの起動先EXEは1か所に決め打ちされている。ただし、このPCでは実ファイルが次の場所に存在することまでは確認済み。
   - `C:\Users\MAKI\AppData\Local\Programs\VOICEVOX\VOICEVOX.exe`
   - `C:\Users\MAKI\AppData\Local\Programs\AivisSpeech\AivisSpeech.exe`
6. 実行中プロセスと50021／10101番ポートの確認コマンドは、再帰検索が30秒でタイムアウトしたため未完。EXEの存在確認だけは完了している。

### 次にやること（読み上げを実用化）

- [ ] `electron/main.cjs` のエンジン起動を修正。
  - 起動済みなら即成功。
  - `cwd` をEXEのフォルダへ設定して起動。
  - 必要ならElectronの `shell.openPath()` を使う。
  - 固定パスだけでなく候補パス／検出結果を返す。
  - 起動後はHTTP APIが応答するまで最大60秒程度待ち、成功・タイムアウト・EXE未検出を具体的に返す。
- [ ] VOICEVOX／AivisSpeechを個別に実起動し、プロセスと待受ポートを確認。
- [ ] 各エンジンの `/speakers` 実レスポンスを取得し、モデル名＋スタイルIDをUIへ表示。
- [ ] `TTSSettingsPage.tsx` のモデル一覧をエンジン別にする。
  - VOICEVOX選択時はVOICEVOXの一覧のみ。
  - AivisSpeech選択時はAivisSpeechの一覧のみ。
  - エンジン切替時は、そのエンジンの先頭モデルか以前保存した同エンジンのモデルへ切替。
  - 共通 `FALLBACK_SPEAKERS` は廃止し、停止中は「起動するとモデル一覧を取得します」を表示。
- [ ] モデル選択をドロップダウンと発光人物カードの両方から確実に変更できるようにする。
- [ ] `tts:test` で、選択中エンジン・speaker/style ID・速度・音量・ピッチ・抑揚を使ってWAVを生成し、実際に再生できることを確認。
- [ ] 開発ブラウザーのモックを状態保持型にする。
  - エンジンごとの別モデル一覧。
  - 起動ボタン後に状態を `ok` へ遷移。
  - テスト再生UIの成功状態を検証可能にする。
  - 実音声エンジンの最終確認は `npm run electron:dev` で行う。
- [ ] エンジン切替 → 起動 → モデル一覧取得 → モデル選択 → テスト再生、の一連をElectron実機で確認。
- [ ] 修正後に開発ブラウザーとElectronの両方でスクリーンショットを撮り、ユーザー確認をもらう。
- [ ] ユーザー承認まではEXEを作らない。

### 主な変更ファイル

- `src/components/DashboardPage.tsx`
- `src/components/GiftSettingsPage.tsx`
- `src/components/EventSettingsPage.tsx`
- `src/components/EventTypeIcon.tsx`
- `src/components/TTSSettingsPage.tsx`
- `src/components/Sidebar.tsx`
- `src/components/MinecraftBlockIcon.tsx`
- `src/components/MinecraftCommandIcon.tsx`
- `src/index.css`
- `src/lib/devApiMock.ts`
- 次回修正対象: `electron/main.cjs`, `electron/tts.cjs`, `src/components/TTSSettingsPage.tsx`, `src/lib/devApiMock.ts`

---

## 2026-07-06 v1.0.13 — ネオンUI実装・再インストール時セットアップゲート

### 実装したこと

- ユーザー承認済みの「配信準備コックピット」デザインを全ページ共通のデザインシステムとして実装。
  - 深いネイビー背景、シアン／バイオレットのネオン枠、ガラス調パネル、状態色、フォーム、ボタン、スクロールバーを統一。
  - サイドバー、上部システムステータス、ダッシュボード、ギフト設定、イベント設定、読み上げ設定、ギフト一覧、運用センター、配信統計を同じ世界観へ更新。
  - 初期セットアップ完了画面は、発光チェック、4段階完了レール、サーバーフォルダ、検出環境、ダッシュボード復帰アクションを持つ専用画面へ刷新。
  - 初期セットアップ初回画面は、注意事項、フォルダ選択、Forge／環境構築の既存機能を保持したままネオン調へ刷新。
- 新しいEXEをインストールした直後は、以前の `%APPDATA%` 設定が残っていても必ず初回セットアップ画面から始まるよう変更。
  - NSISがインストール完了時に `%APPDATA%\tiktok-bridge-ui\require-initial-setup.flag` を作成。
  - アプリ初回起動時にフラグを1回だけ消費して `setupComplete=false` に戻す。
  - 既存の `serverFolder` は消さないため、以前のサーバーをそのまま引き継げる。
- 初回画面の目立つ位置に「もうすでにセットアップ済みです」ボタンを追加。
  - 保存済みサーバーフォルダがあれば即座に全ページを開放。
  - 保存先がない場合だけ既存サーバーフォルダ選択を表示。
  - Bridgeランタイム差分展開は画面を待たせずバックグラウンド実行。
- ページ遷移時のスクロール位置を先頭へ戻す処理を追加。
- ダッシュボード初回表示時に空ログ末尾へ自動スクロールしていた不具合を修正。
- ギフト設定ページは、初期タブを「ギフト設定」に変更。
- Electron既定ウィンドウを 1488×1000、最小サイズを 1120×720 に変更。
- ブラウザー表示確認用の開発時専用APIモックを追加。製品ビルドには含まれない。

### 検証

- `npm run build` 成功。
- in-app Browser（1280×720）で全9画面を巡回。
- 「もうすでにセットアップ済みです」→ダッシュボード開放を確認。
- 1120×720の最小ウィンドウ幅で主要レイアウトの崩れなし。
- ブラウザーコンソール error / warn 0件。

### 次やること

- [ ] `release/MyGamePack Bridge UI Setup 1.0.13.exe` を実機インストールし、起動直後に必ず初回セットアップ画面になることを最終確認。
- [ ] 既存ユーザー状態で「もうすでにセットアップ済みです」を押し、保存済みサーバーフォルダとBridgeがそのまま使えることを確認。
- [ ] 実データのTikTokギフト画像を使い、ギフト設定／ギフト一覧の発光カード表示を最終目視確認。
- [ ] 配信中の実データで運用センターの死活監視と配信統計を確認。

---

## 2026-07-07 追記：TTS実動作修正と、デザイン変更後の機能退行チェック

### ユーザーからの指摘

読み上げ設定デザイン後、以下の機能不具合が疑われた。

- VOICEVOX / AivisSpeech のボイス一覧を同期しても、ドロップダウンに候補が出ない。
- テスト再生が「ぴっ」という音だけで、実際の音声合成になっていない。
- ギフト設定／ギフト一覧のギフト数が一部だけになっている。
- ギフト画像クリックでコピーできない。
- `bridge\commands\minecraft` のコマンドが数個しか反映されていない。
- ダッシュボードの一括起動が反応しない。
- 配布ワールド `fill_world` / `newworld` / `sakura` が反映されない。
- 初期セットアップのフォルダ選択、セットアップ完了画面の「フォルダを開く」が動かない。
- デザイン変更で既存機能を壊していないか不安、という確認。

### 切り分け結果

かなりの部分は **開発ブラウザー用 `src/lib/devApiMock.ts` が薄いサンプルデータしか返していなかったこと** が原因だった。

開発ブラウザー `http://127.0.0.1:5174/` はElectron IPCではなく `devApiMock.ts` を使うため、
EXE側で本物のファイルを読む処理があっても、ブラウザー確認では少数のモックデータしか見えない状態だった。

ただし、すべてがモック原因ではない。次はEXEにも影響する実バグとして扱った。

- 初期セットアップ完了画面の「フォルダを開く」が、フォルダを開く処理ではなくフォルダ選択処理に繋がっていた。
- TTS起動処理は、開発ブラウザー側では実エンジンを起動しないモックのままだった。
- TTSテスト再生も、開発ブラウザー側では実WAV合成に繋がっていなかった。

### 実装・修正したこと

#### TTS / VOICEVOX / AivisSpeech

- `vite.config.ts` に開発時専用のTTSプロキシと起動補助APIを追加。
  - `/__tts/voicevox` → `127.0.0.1:50021`
  - `/__tts/aivis` → `127.0.0.1:10101`
  - `POST /__tts/launch/:engine` でローカルEXEを起動し、API応答待ちを行う。
- `src/lib/devApiMock.ts` のTTSモックを、実VOICEVOX/AivisSpeech APIに接続する形へ変更。
  - `/version` で死活確認。
  - `/speakers` を取得し、キャラ名＋スタイル名をドロップダウン用に平坦化。
  - `/audio_query` → `/synthesis` で実WAVを生成。
- `electron/main.cjs` のTTS起動処理を強化。
  - 既に起動済みなら即成功。
  - EXE候補を探し、EXEのフォルダを `cwd` にして起動。
  - 起動後、API応答を最大60秒程度待つ。
  - `ENGINE_PORTS` を `tts.cjs` から参照。
- `TTSSettingsPage.tsx` をドロップダウン中心へ修正。
  - ユーザーが赤枠で指摘した横並びのボイスカード群は削除。
  - VOICEVOX選択時はVOICEVOXの一覧、AivisSpeech選択時はAivisSpeechの一覧を同期して出す方針。
  - 同期前は「エンジンを起動して同期してください」を表示。
  - テスト再生は、同期済みボイスがない場合は押せない。

#### 開発ブラウザー用データAPI

`vite.config.ts` に、開発ブラウザーで本物に近いデータを返すAPIを追加した。

- `GET /__dev/gifts/read`
  - `GiftsViewer/data/gifts/gifts.min.json` と `gifts.meta.json` を読む。
- `GET /__dev/commands/minecraft`
  - `bridge/commands/minecraft/*.txt` を全件読み、`# TITLE:` も拾う。
- `GET /__dev/worlds/list?root=...`
  - 指定サーバールート配下の `haihu_world` フォルダを列挙。
- `GET /__dev/server/props/read?root=...`
  - `server.properties` を読む。
- `POST /__dev/server/props/write`
  - `server.properties` を更新。
- `GET /__dev/folder/open?path=...`
  - 開発ブラウザーからExplorerでフォルダを開く。
- `GET /__dev/image/base64?url=...`
  - ギフト画像URLをサーバー側で取得し、data URL化する。

`src/lib/devApiMock.ts` 側も上記APIを使うよう変更。

- ギフトはサンプル24件ではなく、実ファイルの全件を返す。
- コマンドはハードコード数件ではなく、実 `.txt` 全件を返す。
- ワールドは `D:\新しいフォルダー (2)\haihu_world` を見に行く既定値へ変更。
- 開発ブラウザーのフォルダ選択は、ネイティブダイアログが使えないため `prompt()` でパス入力する暫定方式。
- ギフト画像コピーは `ClipboardItem` が使える場合は画像としてコピー、無理ならdata URL文字列コピーへフォールバック。

#### 初期セットアップのフォルダを開く

- `electron/main.cjs`
  - `folder:open` IPCを追加し、`shell.openPath()` でフォルダを開けるようにした。
- `electron/preload.cjs`
  - `folderOpen(folderPath)` をRendererへ公開。
- `src/types/electron.d.ts`
  - `folderOpen` の型を追加。
- `src/components/InitialSetupPage.tsx`
  - セットアップ完了画面の「📁 フォルダを開く」が `handlePickFolder` ではなく `handleOpenFolder` を呼ぶよう修正。
  - エラー時に画面上へメッセージを出すようにした。

### 検証済み

- `npm run build` 成功。
- 実ファイル確認:
  - `bridge\commands\minecraft` の `.txt` は **52件**。
  - `D:\新しいフォルダー (2)\haihu_world` は **`fill_world` / `newworld` / `sakura`** の3件。
- 開発API確認:
  - `/__dev/gifts/read` は **554件** を返す。
  - `/__dev/commands/minecraft` は **52件** を返す。
  - `/__dev/worlds/list?root=D:\新しいフォルダー (2)` は **`fill_world` / `newworld` / `sakura`** を返す。
- CDPで開発ブラウザーを開いて確認:
  - `window.mygamepack.giftsRead()` → **554件**。
  - `window.mygamepack.gvGiftsRead()` → **554件**。
  - `window.mygamepack.bridgeCommandsList()` → **52件**。
  - `window.mygamepack.serverWorldsList()` → **`fill_world` / `newworld` / `sakura`**。
  - ギフト設定画面の `.gift-tile` は **551件** 描画確認。
  - 先頭20件のギフト画像URLは全て空ではなく、TikTokの実画像URLが入っていた。
  - TTS画面のドロップダウンは存在し、VOICEVOX側で **118件**、disabledではないことを確認。
- TTS実API確認:
  - `http://127.0.0.1:5174/__tts/voicevox/version` → `0.25.1`
  - `http://127.0.0.1:5174/__tts/aivis/version` → `1.1.0-dev`
  - VOICEVOX `/audio_query` → `/synthesis` で **audio/wav 約116KB** を生成確認。
  - AivisSpeech `/audio_query` → `/synthesis` で **audio/wav 約212KB** を生成確認。

### 注意：EXE側について

現時点で「EXEも全部OK」とはまだ断言しないこと。

- ギフト件数、コマンド件数、ワールド列挙の問題は、開発ブラウザー用モックが主原因と判断できる。
  - EXE側はElectron IPCで本物のファイルを読む設計なので、同じ少数モック問題は起きにくい。
- ただし、初期セットアップ完了画面の「フォルダを開く」はEXEにも影響する実バグだったため修正済み。
- TTS起動・テスト再生はコード上は実APIへ繋がったが、最終的には `npm run electron:dev` またはunpacked EXEで実クリック確認が必要。
- ダッシュボードの一括起動、Forgeインストール、環境構築ボタンは副作用が大きいため、開発ブラウザーではモック確認に留めている。EXE実機確認が必要。
- ユーザーの指示どおり、**スクショ確認とユーザー承認前に新しいEXEは作らない**。

### ブラウザー確認について

- Codex内蔵ブラウザーは一覧には出たが、タブ取得でタイムアウトした。
- そのため、今回は依存を追加せず、既存ChromeのCDPを使って `http://127.0.0.1:5174/` を検証した。
- スクショ保存先:
  - `C:\Users\MAKI\AppData\Local\Temp\mygamepack-tts-check-3.png`

### 次にやること

- [ ] AivisSpeechへ切り替えた時、UI上の表示文言・選択状態・ドロップダウン候補が確実にAivisSpeechへ切り替わるか再確認。
  - 途中確認ではAivisSpeechボタンは見つかるが、クリック後の画面テキストがVOICEVOXのままに見える結果があり、要再検証。
- [ ] TTSのドロップダウンを実際に変更し、`speakerId` が変わるか確認。
- [ ] UIの「テスト再生」ボタンから実WAVが鳴ることを、開発ブラウザーとElectronで確認。
- [ ] ギフト画像クリックコピーを実ブラウザーで確認。
- [ ] ダッシュボードの一括起動ボタンのクリック経路を確認。
  - 開発ブラウザーではモック応答まで。
  - EXE / ElectronではForgeサーバーとBridgeを実起動するため、ユーザー確認後に実行。
- [ ] 初期セットアップ:
  - フォルダ選択ボタンが開発ブラウザーでは `prompt()` で動くことを確認。
  - Electron / EXEではネイティブフォルダ選択が開くことを確認。
  - セットアップ完了画面の「フォルダを開く」がExplorerを開くことを確認。
- [ ] Forgeインストール、環境構築ボタンは副作用があるため、テスト実施前に現在の対象フォルダを再確認する。
- [ ] スクリーンショットを取り直し、ユーザーへ提示。
- [ ] ユーザー承認後にだけEXEビルドへ進む。

### 主な変更ファイル

- `vite.config.ts`
- `src/lib/devApiMock.ts`
- `src/components/TTSSettingsPage.tsx`
- `src/components/InitialSetupPage.tsx`
- `src/index.css`
- `electron/main.cjs`
- `electron/preload.cjs`
- `src/types/electron.d.ts`

---

## 2026-07-07 追記：ギフト一覧デザイン・ダッシュボード一括起動・初期セットアップv2途中状態

### 今日やったこと

#### ギフト一覧ページ

- ユーザー指定のスクショ準拠デザインへ `src/components/GiftsViewerPage.tsx` を刷新。
- TikTokから取得した実ギフト画像はそのまま使う方針を維持。勝手な代替画像や格子状プレースホルダーは使わない。
- 上部に以下のサマリーカードを実装。
  - 総ギフト数
  - 最終更新
  - 最安ギフト
  - 最高額ギフト
  - サーバー連携
- 「最安ギフト」「最高額ギフト」の左側アイコンはダイヤモンド形SVGにした。
- 「サーバー連携」は緑四角で塞がらないよう、チェスト＋通信波の専用SVGにした。
- ギフトカードは実画像、ID、ダイヤ数、コピー操作を持つネオンカードに変更。
- 開発ブラウザーでギフト一覧を表示し、**554件**が表示対象になっていることを確認。
- スクリーンショット保存先:
  - `C:\Users\MAKI\AppData\Local\Temp\mygamepack-gift-list-v2.png`

#### ダッシュボード一括起動

- `src/components/DashboardPage.tsx` の一括起動処理を、単なる既存関数の順番呼び出しから専用フローへ修正。
- 現在の実装順:
  1. 必要なら配布ワールド設定を保存
  2. Bridge設定（TikTokユーザー名、RCON、ギフトマッピング）を `config.minecraft.json` へ同期
  3. Forgeサーバー起動APIを呼ぶ
  4. BRIDGE起動APIを呼ぶ
  5. ゲームルール適用
  6. 完了ログを出す
- Bridge設定同期は `applyBridgeConfig()` に分離し、手動の「BRIDGEに適用」と一括起動で共通利用するようにした。
- 既存 `options` を丸ごと潰さないよう、既存値を保持して不足分だけ既定値を補う形に変更。
- 開発ブラウザーで一括起動ボタンをクリックし、BRIDGE起動・ゲームルール適用・一括起動完了ログが出るところまで確認。
- ただし、ログ表示は直近4件のみのため、「一括起動開始」「Forge起動」がスクショ上で流れて見えなくなっている。
  - 次回、Bridgeログ専用枠と起動フローの視覚化を追加する。
- スクリーンショット保存先:
  - `C:\Users\MAKI\AppData\Local\Temp\mygamepack-dashboard-allstart.png`

#### 初期セットアップ画面

- `src/components/InitialSetupPage.tsx` を、初回前／完了済みの2画面ともスクショ準拠のv2構成に置き換えた。
- 完了済み画面:
  - 赤堀堂馬のMinecraft風アバターSVGを追加。
  - 犬のMinecraft風SVGを追加。
  - 中央に発光ポータル、チェックマーク、完了レールを配置。
  - サーバーフォルダ、検出環境、ダッシュボード復帰、セットアップやり直し、準備完了バナーを配置。
- 初回前画面:
  - 右上に建設中のMinecraftゲート／クレーン／足場／浮遊ブロックのSVGを追加。
  - Forgeインストールは青い金床＋ハンマーのイメージにした。
  - 環境構築はコマンドブロック＋歯車のイメージにした。
  - 下部に青→橙→緑ブロックのセットアップフローを追加。
  - 既存ユーザー用の「もうすでにセットアップ済みです」ボタンは残した。
- `src/index.css` に `setup-v2` 専用CSSを追加し、既存CSSを壊さないようクラス名を分けた。

#### 検証

- `npm run build` 成功。
- in-app Browserを表示状態にして `http://127.0.0.1:5174/` をリロード。
- ギフト一覧スクショ取得済み。
- ダッシュボード一括起動の開発ブラウザー上モック確認済み。
- 初期セットアップ2画面のスクリーンショット確認は、ユーザーからのHANDOFF更新指示で中断。次回必ず撮る。
- ユーザー承認前なので、**EXEは作成していない**。

### 現在の注意点

- ダッシュボード一括起動は、現状だと「Forge → Bridge」順で実装されている。
- ユーザーから最新指示として、実運用の理想順は以下ではないかと指摘あり。
  1. Forge起動
  2. Minecraft起動
  3. TikTok LIVE Studioで配信接続
  4. BRIDGE起動
- ただし、TikTok LIVE Studio自体はアプリから自動起動／制御せず、**手順画像として表示するだけ**にする。
- BRIDGEはTikTokライブアカウントを読みに行くため、TikTok LIVEをオンにする前に起動するとエラーになりうる。次回この前提で起動フローと表示を見直す。

### 次にやること

#### 最優先：ダッシュボードのBridgeログ表示

- [ ] ユーザーが赤い四角で囲んだダッシュボード下部の広い領域に、Bridge専用ログパネルを追加する。
- [ ] Bridgeが起動中／停止中／エラー中なのか、視覚的にすぐわかるようにする。
  - 例: 状態バッジ、最新ログ、接続先TikTokユーザー、RCON接続、最終イベント時刻、エラー文。
- [ ] アクティビティログとは別に、Bridgeプロセスの起動・停止・接続待ち・エラーを見せる。
- [ ] 既存の左下「Bridgeプロセス」小カードと、下部Bridgeログの表示内容が矛盾しないようにする。

#### 一括起動の実動作テストと順番修正

- [ ] 一括起動ボタンで、Forge・Minecraft・BRIDGEが実際に作動するかテストする。
  - 開発ブラウザーではモック確認。
  - Electron / EXE側では副作用があるため、対象フォルダと起動中プロセスを確認してから実施。
- [ ] 一括起動フローを次の考え方に合わせて見直す。
  1. Forgeサーバー起動
  2. Minecraft起動
  3. TikTok LIVE Studioで配信接続（これは機能として自動実行しない。手順表示のみ）
  4. BRIDGE起動
- [ ] TikTok LIVE Studioはアプリから起動フローに組み込まない。
- [ ] BRIDGE起動前に「TikTok LIVE Studioで配信を開始／接続しましたか？」が視覚的にわかる手順表示を入れる。
- [ ] 現在の一括起動コードは `Forge → Bridge` なので、Minecraft起動処理を入れるか、手動確認を挟む表示にするか検討して実装。

#### 右側「ライブ手順（起動フロー）」の文言修正

- [ ] ダッシュボード右側のライブ手順を以下に書き換える。
  1. Forgeサーバー起動
  2. Minecraft起動
  3. TikTok LIVE Studioで配信接続
  4. BRIDGE接続
  5. 配布ワールド選択
  6. 保護・安全設定
  7. 配信開始
- [ ] 3番目のTikTok LIVE Studioは、自動実行ではなく「ユーザーが外部で行う手順」として見える表現にする。
- [ ] ライブ手順の状態色・アイコンも順番に合わせて調整する。

#### 初期セットアップのスクショ確認

- [ ] 初期セットアップ完了済み画面を開発ブラウザーで表示してスクショを撮る。
  - 赤堀アバターと犬が入っていることを確認。
  - ポータル、完了レール、サーバーフォルダ、検出環境がスクショ意図に合っているか確認。
- [ ] 初期セットアップ初回前画面を開発ブラウザーで表示してスクショを撮る。
  - 建設中のMCゲート、クレーン、Forge台、コマンドブロック、下部フローが意図どおり見えるか確認。
- [ ] スクショをユーザーに提示し、承認をもらう。
- [ ] ユーザー承認前にEXEを作らない。

### 主な変更ファイル

- `src/components/GiftsViewerPage.tsx`
- `src/components/DashboardPage.tsx`
- `src/components/InitialSetupPage.tsx`
- `src/index.css`

---

## 2026-07-07 追記：開発サーバー5175・初期セットアップ前画像差し替え

### ここまでやったこと

#### 開発サーバー／ブラウザー確認

- Claude Code側が `5174` のローカルブラウザーを掴んでいたため、競合回避として **別ポート `5175`** を使用。
- `bridge_ui/ui` で以下を起動。
  - `npm run dev -- --host 127.0.0.1 --port 5175 --strictPort`
- 接続確認:
  - `http://127.0.0.1:5175/` が **HTTP 200**。
  - in-app Browserで `http://127.0.0.1:5175/` を開けることを確認。
- 開発画面スクショ取得済み。
  - `C:\Users\MAKI\AppData\Local\Temp\mygamepack-dev-5175-screen.png`
- この時点のスクショではダッシュボードが表示されていた。

#### 初期セットアップ「完了前」画面の画像差し替え

ユーザー指定により、初期セットアップ前画面の赤丸①②③に該当する仮SVGアイコンを、指定PNGへ差し替えた。

- 赤丸①: 上部右側の建設シーン
  - 差し替え先: `assets/初期セットアップ完了前01.png`
  - 対応箇所: `ConstructionScene`
- 赤丸②: Forgeインストールカード左側の金床アイコン
  - 差し替え先: `assets/初期セットアップ完了前02.png`
  - 対応箇所: `ForgeAnvilArt`
- 赤丸③: 環境構築カード左側のコマンドブロック／歯車アイコン
  - 差し替え先: `assets/初期セットアップ完了前03.png`
  - 対応箇所: `CommandBlockArt`

変更ファイル:

- `src/components/InitialSetupPage.tsx`
  - `初期セットアップ完了前01.png`
  - `初期セットアップ完了前02.png`
  - `初期セットアップ完了前03.png`
  をimport。
  - 既存SVG描画を `<img>` 表示へ差し替え。
  - ボタン処理やセットアップ処理は触っていない。
- `src/index.css`
  - `.setup-construction-scene--image`
  - `.setup-step-art--image`
  を追加。
  - 画像が潰れないよう `object-fit: contain` にした。

#### 検証

- `npm run build` 成功。
- Vite buildで以下の画像がdistへ含まれることを確認。
  - `assets/初期セットアップ完了前01-*.png`
  - `assets/初期セットアップ完了前02-*.png`
  - `assets/初期セットアップ完了前03-*.png`
- in-app Browserで `http://127.0.0.1:5175/` をリロードし、初期セットアップ前画面が表示状態であることをDOMで確認。
  - `.setup-first-v2` が存在。
  - `.setup-complete-v2` は存在しない。
- ただし、画像差し替え後の最終スクショ取得前にユーザーからHANDOFF更新指示が来たため、**差し替え後スクショは次回必ず撮る**。

### 次にやること

#### 最優先

- [ ] `http://127.0.0.1:5175/` の開発ブラウザーで初期セットアップ前画面をスクショ撮影する。
- [ ] 赤丸①②③に指定PNGが入っているか視覚確認する。
  - ① `初期セットアップ完了前01.png`
  - ② `初期セットアップ完了前02.png`
  - ③ `初期セットアップ完了前03.png`
- [ ] スクショをユーザーに提示する。

#### その次

- [ ] 前回から残っているダッシュボード下部のBridgeログパネルを実装する。
- [ ] 右側ライブ手順を以下に修正する。
  1. Forgeサーバー起動
  2. Minecraft起動
  3. TikTok LIVE Studioで配信接続
  4. BRIDGE接続
  5. 配布ワールド選択
  6. 保護・安全設定
  7. 配信開始
- [ ] 一括起動の実動作確認を行う。
  - Forgeサーバー起動
  - Minecraft起動
  - TikTok LIVE Studioは自動実行せず、手順表示のみ
  - BRIDGE起動
- [ ] ユーザー承認前にEXEを作らない。
