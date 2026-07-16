# コードレビュー結果 — v1.0.19（2026-07-16）

対象: `6246ec1..HEAD`（v1.0.18 → v1.0.19 の全変更）
範囲: `electron/main.cjs` / `bridge/index.js` / `src/components/DashboardPage.tsx` / `src/components/EventSettings2Page.tsx` / `src/types/electron.d.ts` / `src/lib/devApiMock.ts` / `bridge/commands/minecraft/*.txt`

## 総評

品質評価: **4/5**（Critical なし / Medium 4件 / Low 6件）

過去バグ（キュー詰まり・視線基準 `^` 座標・Mod 未開通での即失敗）への対策が丁寧。特に以下は良い設計:

- `waitForDoumaMod` のタイムアウト記憶 — 一括起動で gamerules→OP付与 と連続150秒ずつ待って計5分固まる事故を防止
- `grantOpOffline` の usercache.json 参照 — サーバー停止中でも ops.json へ直接登録
- 廃止ファイルの「墓標リスト」方式（`BRIDGE_REMOVED_BUNDLE_FILES`）— 名前完全一致のみ削除でユーザー自作 txt に触れない
- title への JSON エスケープ（`mcJsonStringEscape`）

以下は指摘一覧（**全10件 2026-07-16 に対応済み** — 末尾の「対応記録」参照）。

---

## Medium（修正推奨）

### [x] M1. 廃止コマンド（giant/invisible/tiny）を参照する既存ユーザー設定の掃除がない

**場所**: `bridge/index.js:1203`（`normalizeRouletteItems`）、および各発火経路

**現象**: ファイル自体は `BRIDGE_REMOVED_BUNDLE_FILES`（`electron/main.cjs:517-524`）で配信先から撤去される。しかし**既存ユーザーの bridge-config.json に残ったルーレット項目・ギフト割当・いいねルール**が `giant.txt` / `invisible.txt` / `tiny.txt` を指したままだと、参照先の txt が存在しない状態になる。

**影響**: ルーレットの回転演出は出るのに当選しても何も起きない = **配信中の無反応事故**。原因がユーザーに見えないため問い合わせになりやすい。

**修正案**: `normalizeRouletteItems` および発火直前に「txt が実在しない項目は除外＋警告ログ」を入れる。

```js
// bridge/index.js の normalizeRouletteItems 内
.filter((item) => {
  const p = path.join(commandsDirAbs, "minecraft", path.basename(item.commandFile));
  if (fs.existsSync(p)) return true;
  console.warn(`[Roulette] 存在しないコマンドを除外: ${item.commandFile}`);
  return false;
})
```

**補足**: ギフト割当・いいねルール側にも同様の参照が残る可能性があるため、設定読み込み時に一括で健全性チェックを掛けるほうが確実。

---

### [x] M2. zombiewave.txt — 遠距離組の召喚が地形に埋まるリスク

**場所**: `bridge/commands/minecraft/zombiewave.txt`（第4波 村人ゾンビ、第5波 ゾグリン）

**現象**: 水平 ±13〜15 ブロック先を**プレイヤーの足元 Y そのまま**で召喚している。

```
execute at @p run summon minecraft:zombie_villager ~13 ~ ~
execute at @p run summon minecraft:zoglin ~14 ~ ~2
execute at @p run summon minecraft:zoglin ~-15 ~ ~1
```

**影響**: 斜面・段丘では地中に埋まって窒息、崖下だと空中湧き。**過去に踏んだ「MOB不出現」と同型の問題**。

**修正案**: 遠距離組だけでも Y を +1〜+2 する。または `positioned over motion_blocking` 基準にする。

```
execute at @p run summon minecraft:zoglin ~14 ~1 ~2
```

**不整合**: 同じ v1.0.19 で `bossrush.txt` は `~6 ~6 ~5` / `~-5 ~1 ~-4` のように埋まり防止の Y オフセットを入れており、zombiewave とルールが不揃い。

---

### [x] M3. skytrap.txt — ネザーで天井岩盤の上に置き去りになる

**場所**: `bridge/commands/minecraft/skytrap.txt:9`

```
execute at @p positioned over motion_blocking run tp @p ~ ~85 ~
```

**現象**: ネザーでは heightmap が**天井の岩盤**を返すため、y≈212 付近（岩盤屋根の上）へ飛ばされる。

**影響**: 自力で戻れなくなる。slow_falling も無意味。

**修正案**: オーバーワールド限定にする（ネザー時は何も起きない＝安全側）。

```
execute at @p if dimension minecraft:overworld positioned over motion_blocking run tp @p ~ ~85 ~
```

**優先度メモ**: オーバーワールド限定の配信運用なら優先度は下がる。

---

### [x] M4. storm.txt — 雷雨が永続する（doWeatherCycle=false との相互作用）

**場所**: `bridge/commands/minecraft/storm.txt:6` と `bridge/commands/minecraft/_gamerules.txt`

**現象**: `_gamerules.txt` で `doWeatherCycle false` を適用しているため、`weather thunder 300` の 300秒カウントダウンが進まず、**嵐が発動したら手動で解除するまで永続**する。

**影響**: 従来からの挙動だが、v1.0.19 でイベントが「超大型の嵐（雷20発）」に強化されたので目立つ。配信の絵面が戻らない。

**修正案（いずれか）**:
1. Bridge/Mod 側で「storm 発火の 300秒後に `weather clear` を送る」仕掛けを入れる（txt 内では遅延実行ができないため）
2. 運用ルールとして「ダッシュボードのコンソール欄から `weather clear`」を HANDOFF に明記

---

## Low（任意・気づいた点）

### [x] L1. 操作履歴の count 不一致

**場所**: `electron/main.cjs:1643-1645`

ルーレット当選時、履歴には `payload.count`（テスト入力の回数）が記録され、実際に発火した `winner.repeat` と食い違う。集計を見るとき紛らわしい程度。

### [x] L2. rouletteDescCache が無期限

**場所**: `bridge/index.js:1186-1198`

Bridge 側は説明文を初回読取でキャッシュ、テスト発火側（main.cjs の `readCommandDescriptionMain`）は毎回読む。そのため txt の説明を書き換えると**本番とテストで表示が食い違う**期間が生じる。Bridge 再起動で解消するが、キャッシュに mtime チェックを足すと確実。

### [x] L3. allow-flight 書換の行末

**場所**: `electron/main.cjs:1141-1146`

`/^allow-flight=false\s*$/m` の `\s*$` が CRLF の `\r` を巻き込むため、置換行だけ LF になる。サーバーの読み込みには無害。

### [x] L4. server:command はレンダラーから無条件

**場所**: `electron/main.cjs:1211-1219`

`stop` や `op` も送れる脱出ハッチ。ローカル専用UIなら許容範囲だが、運営ログインゲートを設けている思想と合わせるなら、ログイン済みセッションでのみ有効化する選択肢がある。

### [x] L5. マイクラID保存時のブロック（UX）

**場所**: `src/components/DashboardPage.tsx:699-711` 周辺（`handleSaveMcId`）

サーバー起動直後に ID を保存すると `waitForDoumaMod` で最大150秒待つが、その間ダッシュボードの ID 欄にビジー表示がなく、Forge ログを見ていないと固まったように見える。

### [x] L6. fissure.txt の深部使用

**場所**: `bridge/commands/minecraft/fissure.txt`

プレイヤーが y≒−50 付近にいると最深の掘削（〜−14/−18）が岩盤層に届き、**奈落穴が開く**可能性がある。さらに深いと fill が世界外エラーで丸ごと不発（安全側）。`DESTRUCTIVE: true` なので仕様と割り切るのも可。

---

## 確認済み — 問題なしだった点

- **Mod の repeat 上限**: 懸念だった `MAX_COUNT=30` の乖離は**解消済み**。ワークスペース内の Java ソースは `DoumaCmdMod/src/main/java/jp/douma/doumacmd/DoumaCmdMod.java:45` の `MAX_COUNT = 100` の1つだけ。配置済み jar（3箇所 + release、すべて 2026-07-12 17:44 ビルド・22645B で同一）はソース最終更新（17:38）より後のビルド。**UI/Bridge の repeat 上限100と互換**。
- **1.20.1 構文互換**: `positioned over` / `if dimension` / `effect ... infinite` はいずれも 1.20.1 で使用可。richtime の `Count:4b` NBT 形式も 1.20.1 で正しい書式。
- **負荷**: fill の体積はすべて上限（32768）の1%未満。richtime のアイテムエンティティ約50体・zombiewave の50体も単発なら許容範囲。

---

## 対応記録（2026-07-16 全10件 解決済み）

- **M1**: `bridge/index.js` `normalizeRouletteItems` に txt 実在フィルタ＋警告ログを追加。**複製実装の `electron/main.cjs` `fireDoumaEventMaybeRoulette` にも同じフィルタを追加**（`commandTxtPathMain` ヘルパー新設）。存在しない項目は抽選対象から外れるだけなので、残った項目で正常に回る。
- **M2**: `zombiewave.txt` — 距離10以上のハスク/ドラウンド/村人ゾンビを `~1`、最遠のゾグリンを `~2` に変更（近距離ゾンビ10体は従来どおり足元基準）。
- **M3**: `skytrap.txt` — tp と slow_falling を `if dimension minecraft:overworld` でガード。ネザーでは音と演出のみ発生（安全側）。
- **M4**: 常設 datapack（NightVision_Pack、`server:datapack:deployNightVision` で毎起動配備）に `douma_storm` スコアボードタイマーを実装。`storm.txt` が `#storm` に 6000 tick（=300秒）をセットし、datapack の tick 関数が減算・0 で `weather clear` を1回実行。datapack 未配備の旧ワールドでは scoreboard 行が失敗するだけで嵐自体は従来どおり動く。
- **L1**: `mod:testEvent` の両ブランチで、操作履歴と fired 配列に実際の発火回数（ルーレット時は `winner.repeat`）を記録するよう変更。
- **L2**: `rouletteDescCache` を mtime 付きキャッシュに変更。txt の説明を書き換えると Bridge 再起動なしで反映される。
- **L3**: allow-flight 置換の正規表現を `[ \t]*(\r?)$` にして CRLF の行末を保持。
- **L4**: `server:command` に `isOperatorAuthed()` チェック（auth:status と同一判定）を追加。UI は LoginPage で全体ゲート済みのため通常フローは影響なし（多層防御）。
- **L5**: `handleSaveMcId` で OP 付与開始時に「最大2〜3分かかることがあります」の info メッセージを表示（`mcIdMsg` に info 種別を追加、水色表示）。
- **L6**: `fissure.txt` 末尾に岩盤修復行を追加（overworld 限定・y=-64 の掘削範囲 45×45 を `bedrock replace air` で塞ぐ。既存地形には触らない）。

**検証**: `node --check`（main.cjs / bridge/index.js）と `npm run typecheck`（tsc --noEmit）がともにパス。

**残作業（リリース時）**: アプリ再起動で bridge 差分同期・サーバー起動で datapack 再配備が自動で走るため追加手順なし。実機確認項目 — ①廃止コマンド入りルーレットが残項目だけで回る ②storm 発火の5分後に自動で晴れる ③ネザーで skytrap がテレポートしない ④zombiewave が斜面でも全数出現する。
