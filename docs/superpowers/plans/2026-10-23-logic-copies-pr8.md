# 処理のコピー PR8（コマンドとギフト割り当ての画面）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画面（`src/`）が持っているコマンド名・ルーレット・TXT の確かめの写しをなくし、無効のギフト割り当てに「無効（動きません）」の印を出す。

**Architecture:** ファイルごとの事実（ルーレットか・使えない名前か・直し方の文）と、TXT 作成の中身の確かめは、`bridge/` の関数で main が作って ipc で画面に渡す（開発用のブラウザー表示も `vite.config.ts` で同じ関数を使う）。入力のたびに要る名前の比べ方（`.txt` の有無・大文字小文字）だけは `src/lib/commandFiles.ts` に写しを1つ置き、`bridge/command_files.cjs` と同じ例で同じ結果になることをテストで見張る（PR3 の `src/lib/integerInput.ts` と同じ形。画面からは bridge の CJS を読まない）。

**Tech Stack:** Electron（`electron/*.cjs`）、BRIDGE の共通の決まり（`bridge/*.cjs`）、React + TypeScript（`src/`、Vite）、node:test と esbuild（画面のテスト）。

**Spec:** `docs/superpowers/specs/2026-10-18-logic-copies-design.md`（3・4・10・13）。HANDOFF04 の「処理のコピー」の「ユーザーの決定（10-23）」（無効の印・`GiftCommandDialog.tsx` を消す・PR8 と PR9 に分ける・写しでない不具合も同じ PR で直す）。

## Global Constraints

- 画面は決まりの処理を自分で持たない（設計書 3）。例外は `src/lib/commandFiles.ts` の名前の比べ方だけで、`electron/test/ui-command-files.test.cjs` が bridge と同じ結果になることを見張る。
- 新しい ipc の窓口は `bridge:commands:check` の1つだけ（`electron/test/app-regressions.test.cjs` の窓口の一覧を 117 個にする）。preload・`src/types/electron.d.ts`・`src/lib/devApiMock.ts` も合わせる。
- 無効の印の文は「無効（動きません）」。カタログのタイル（小さい札）だけは「無効」と出し、マウスを載せると下の説明が出る。説明（`title`）：「設定ファイル（config.minecraft.json）でこの割り当てが enabled: false になっています。ギフトは数えますが、コマンドは動きません。動かすには設定ファイルの enabled: false を消してください。」画面での切り替えは作らない。
- `checkCommandDraft` の文（そのまま使う）：
  - ファイル名が空：「ファイル名を入力してください」
  - ゲームパックの名前：「ゲームパックのコマンドはパックを再登録して更新してください」（`bridge:commands:write` と同じ）
  - 使えない名前：`commandFileProblem(filename)` の文
  - コマンドの行が0：「コマンドの行がありません（# と // で始まる行はコマンドになりません）」
  - COOLDOWN：「# COOLDOWN は 0〜60000 の整数（ミリ秒）にしてください」（60000 は `COMMAND_COOLDOWN_MAX_MS` から作る）
  - WEIGHT：「# WEIGHT は 1 以上の数にしてください」
  - SOUND：「# SOUND「<値>」は音の ID として正しくありません（例: entity.experience_orb.pickup）」
  - PARTICLE：「# PARTICLE「<値>」は粒子の ID として正しくありません（例: minecraft:happy_villager）」
- コマンドの候補（`<option>`）の使えない名前の印：「⚠ <題名>（名前を直すまで動きません）」。コマンド一覧のカードの印：「⚠ この名前は BridgeMOD で実行できません。<invalidReason>」。
- Java（BridgeMOD・DisplayMOD・SaikutuMod）は変えない。画面の見た目は、印・直し方の文・確かめの結果を出す所だけ変える（設計書 11）。
- Edit で行の終わりの空白を落とさない（PR4 で `}onChange=` になった）。Bash の heredoc では `\\` が崩れるので、バックスラッシュを含むテストは Write か Edit で書く。

## 決めたこと（違っていれば直す）

1. 画面が決まりを得る方法は上の Architecture のとおり（設計書 14 で作る人に任された所）。名前の比べ方だけを写しにするのは、入力のたびに使うため（ipc を待つと選んだコマンドの題名がちらつく）。
2. コマンドセット（TXT 作成）は、ファイル名を黙って書き換えない（今は空白を `_` にし、日本語を消す。`ネコ_neko` が `_neko.txt` になる）。`.txt` を付けるだけにし、使えない名前は main の理由を出して保存を止める。
3. コマンドセットの保存に失敗したら、main の理由をそのまま出す。ファイルのダウンロードとフォルダーを開くのはやめる（今は理由を捨て、手でフォルダーへ移すよう案内し、main の確かめを素通りさせている）。
4. 同じ名前のファイルがあるときは、保存の前に「<名前> はもうあります。上書きしますか？」と聞く（`husk.txt` を黙って上書きしていた）。既定のファイル名は `my_husk.txt` にする。
5. コマンドセットの見出しの確かめ（COOLDOWN・WEIGHT・SOUND・PARTICLE）は、BRIDGE と BridgeMOD が実際に使う決まり（`boundedInt` の 0〜60000、`weightOf`、`isResourceId`）にそろえる。画面独自の確かめ（`{` で始まる行・`{PlayerMe}`・視線の `^` 座標）は残し、番号は「N 個目のコマンド」と書く（今は空行を数えないので行番号がずれる）。
6. 候補の印は短くし、直し方の全文はコマンド一覧のカードに出す。
7. 無効の割り当ても、カタログの「設定済み」の数と絞り込みには入れる（割り当てはある。動かないだけ）。

## Review Focus

1. 手で書いた割り当て `Neko.TXT`・`neko`（`.txt` なし）に、ギフト設定の一覧・画像作成のカード・ルーレットの項目で題名（`# TITLE`）が出る → Task 4 の比べ方のテストと、写しを探すテスト。
2. もうある名前（`husk.txt`）で TXT を保存すると、上書きの前に聞き、やめれば何も書かない → Task 3 のテスト。
3. main が断った保存（`foo.txt.txt`・`ネコ.txt`・ゲームパックの名前）は、main の理由が出て、ファイルはダウンロードされない → Task 2・Task 3 のテスト。
4. 無効の割り当てのコマンドを編集画面で変えて保存しても `enabled: false` が残り、印も出たまま → Task 6 のテスト。
5. `Roulette.TXT` というファイルは、コマンド一覧の早見表にも、ルーレット・デスルーレットの項目の候補にも出ない → Task 1・Task 4 のテスト。

---

### Task 1: コマンドの一覧の1行を bridge で作り、ルーレットの印を付ける

**Files:**
- Create: `bridge/command_rows.cjs`
- Modify: `bridge/command_files.cjs`（`sameCommandFile` を足す）、`electron/gift_templates.cjs:50`（`commandOf` は `sameCommandFile` を使う）、`electron/bridge_settings.cjs:102-124・196`（`readCommandMetadata` は `commandListRow` を使う。`bridge:commands:list` は `roulette` も渡す）、`vite.config.ts:128-153`（開発用の一覧も `commandListRow`）、`src/types/electron.d.ts:78-80`（`roulette?: boolean`）、`package.json` の `build.files`（`bridge/command_rows.cjs`）
- Test: Create `electron/test/command-rows.test.cjs`、Modify `electron/test/app-regressions.test.cjs`（readMeta・list の印）、`electron/test/config-defaults.test.cjs`（写しを探す）

**Interfaces:**
- Produces: `sameCommandFile(a: unknown, b: unknown): boolean`（`ensureTxt(a).toLowerCase() === ensureTxt(b).toLowerCase()`、どちらかが空なら false）。`commandListRow(name: string, text: string | null): { name, title, category, description, chatKey, roulette?: true, invalidName?: true, invalidReason?: string }`（`text` が null なら title は name、category・description は空）。`bridge:commands:readMeta` の行と `bridge:commands:list` の行（`{ name, title, invalidName?, invalidReason?, roulette? }`）。

- [ ] **Step 1: テストを書く**
  - `command-rows.test.cjs`：`commandListRow('Roulette.TXT', '# TITLE: くじ\n')` は `roulette: true`・title「くじ」。`commandListRow('neko.txt', '# TITLE: ネコ\n# CATEGORY: 妨害\n// 説明\nsay hi\n')` は `{ name: 'neko.txt', title: 'ネコ', category: '妨害', description: '説明', chatKey: 'neko' }` と同じ（`roulette`・`invalidName` のキーがない）。`commandListRow('foo.txt.txt', null)` は `invalidName: true`、`invalidReason` が `/\.txt が2つあります/`、title は `foo.txt.txt`。`sameCommandFile`：`('Neko.TXT','neko')` true、`(' neko.txt ','NEKO.txt')` true、`('neko','neko2')` false、`('', '')` false。
  - `app-regressions.test.cjs` の「旧版で保存した使えない名前…」に、`Roulette.TXT` を置いて readMeta の行が `roulette: true`、list の行も `roulette: true`、`cod.txt` の行には `roulette` が無いことを足す（list の `cod.txt` のキーは今のテストどおり `["name", "title"]`）。
  - `config-defaults.test.cjs` に：`electron/bridge_settings.cjs` と `vite.config.ts` は `commandListRow(` を使い、`chatKey: publicCommandKey(` を持たない。`electron/gift_templates.cjs` は `sameCommandFile(` を使い `.toLowerCase() ===` を持たない。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/command-rows.test.cjs electron/test/config-defaults.test.cjs` と `node --test --test-name-pattern="旧版で保存した使えない名前" electron/test/app-regressions.test.cjs` / Expected: FAIL（`command_rows.cjs` がない、`roulette` がない）。
- [ ] **Step 3: 直す**（`commandListRow` は `parseCommandText`・`publicCommandKey`・`isRouletteCommand`・`commandFileProblem` を使う。main は今のファイルの選び方（`selectableCommandNames`）、開発用は今の選び方（`isTxtName` と sort）のまま、1行を作る所だけを共通にする）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `node --test electron/test/config-schema.test.cjs` / Expected: PASS（`build.files` の確かめも通る）。
- [ ] **Step 5: commit**（「refactor: コマンドの一覧の1行を bridge の1か所で作り、ルーレットの印を付ける」）

---

### Task 2: TXT 作成の確かめを bridge に置き、ipc で渡す

**Files:**
- Modify: `bridge/command_rows.cjs`（`checkCommandDraft` を足す）、`bridge/event_rules.cjs`（`COMMAND_COOLDOWN_MAX_MS = 60000` を出す）、`bridge/index.js:1770`（`boundedInt(…, 0, COMMAND_COOLDOWN_MAX_MS, …)`）、`electron/bridge_settings.cjs`（`ipcMain.handle("bridge:commands:check", …)`）、`electron/preload.cjs`（`bridgeCommandsCheck`）、`src/types/electron.d.ts`、`vite.config.ts`（POST `/__dev/commands/check`）、`src/lib/devApiMock.ts`（`bridgeCommandsCheck` はその窓口に送る）
- Test: `electron/test/command-rows.test.cjs`、`electron/test/app-regressions.test.cjs`（窓口の一覧）、`electron/test/bridge-settings-module.test.cjs`（窓口の動き）、`electron/test/config-defaults.test.cjs`

**Interfaces:**
- Consumes: Task 1 の `sameCommandFile`。
- Produces: `checkCommandDraft({ filename: unknown, content: unknown, existingNames: string[] }): { filename: string, commands: string[], problems: string[], exists: boolean }`（`filename` は `ensureTxt(String(filename ?? "").trim())`、`commands` は `parseCommandText(content).commands`、`exists` は `existingNames` に `sameCommandFile` で同じ名前があるか）。`window.mygamepack.bridgeCommandsCheck({ filename: string, content: string }) => Promise<同じ形>`。main の `existingNames` はコマンドの場所の `isTxtName` のファイル全部（無ければ空）。

- [ ] **Step 1: テストを書く**
  - `command-rows.test.cjs`：Global Constraints の文が、それぞれの入力で出る（`filename: ''`、`'game_saikutu_dig'`、`'ネコ'`、`'foo.txt.txt'`、中身が `'# TITLE: x\n// メモ\n'`（コマンド0）、`# COOLDOWN: 0.5`・`-1`・`60001`、`# WEIGHT: 0.5`・`x`、`# SOUND: a:b:c`、`# PARTICLE: Minecraft:flame`）。正しい例（`filename: ' neko '`、`# COOLDOWN: 60000`、`# WEIGHT: 2.5`、`# SOUND: entity.player.levelup`、`say hi` が1行）は `{ filename: 'neko.txt', commands: ['say hi'], problems: [], exists: false }`。`existingNames: ['NEKO.TXT']` なら `exists: true`。
  - `app-regressions.test.cjs`：窓口の一覧に `"bridge:commands:check"` を足し、117 個（テストの名前の「116個」も直す）。
  - `bridge-settings-module.test.cjs`：`bridge:commands:check` に `{ filename: 'husk', content: 'say x' }` を渡すと、コマンドの場所に `husk.txt` があれば `exists: true`、無ければ false。
  - `config-defaults.test.cjs`：`bridge/index.js` は `COMMAND_COOLDOWN_MAX_MS` を使い、`0, 60000,` を持たない。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/command-rows.test.cjs electron/test/bridge-settings-module.test.cjs electron/test/config-defaults.test.cjs` と窓口の一覧のテスト / Expected: FAIL（`checkCommandDraft` がない、窓口がない）。
- [ ] **Step 3: 直す**（COOLDOWN は `/^\d+$/` で 0〜`COMMAND_COOLDOWN_MAX_MS`、WEIGHT は `weightOf(value) !== Number(value)` なら問題、SOUND・PARTICLE は `isResourceId`。見出しが無いものは確かめない。preload は文字列でなければ投げる（`bridgeCommandsWrite` と同じ形）。`devApiMock` は `fetch("/__dev/commands/check", { method: "POST", body: JSON.stringify(...) })`）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run test:bridge`・`npm run typecheck` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: TXT 作成の確かめを BRIDGE と同じ決まりで main が行い、画面に渡す」）

---

### Task 3: コマンドセット（TXT 作成）は main の確かめと理由を使う

**Files:**
- Create: `src/lib/ipcError.ts`（`ipcErrorMessage(error: unknown): string`。`DashboardPage.tsx:64-66` の `errorMessage` と同じ式）
- Modify: `src/components/CommandSetManager.tsx`、`src/components/DashboardPage.tsx:64-66`・`src/components/InitialSetupPage.tsx:14`（`ipcErrorMessage` を使う）
- Test: Create `electron/test/command-set-manager.test.cjs`

**Interfaces:**
- Consumes: Task 2 の `bridgeCommandsCheck`。

- [ ] **Step 1: テストを書く**（`command-set-manager.test.cjs`）
  - `ipcErrorMessage`（`transformSync` で読む）：`new Error("Error invoking remote method 'bridge:commands:write': Error: コマンドファイル名「ネコ.txt」は使えません")` → `コマンドファイル名「ネコ.txt」は使えません`、`'x'` → `'x'`。
  - `CommandSetManager.tsx` の本文で：`normalizeFileName`・`downloadText(fn, content)` を catch の中に・`bridgeCommandsOpenFolder`・`.split("\n")` で数える式・`'\\n'`（バックスラッシュと n の2文字）・`"husk.txt"` を持たない。`bridgeCommandsCheck(`・`ipcErrorMessage(`・`window.confirm(` を持ち、`confirm` の文は `もうあります。上書きしますか？` を含む。保存は `check.filename`（確かめが返した名前）で書く。
  - `DashboardPage.tsx`・`InitialSetupPage.tsx` は `Error invoking remote method` の式を持たず `ipcErrorMessage` を使う。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/command-set-manager.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**
  - 中身（`buildContent()`）とファイル名が変わるたびに `bridgeCommandsCheck` を呼び、古い返事は捨てる（`useEffect` の中で取り消しの印）。確かめを待つ間は保存できない。
  - 「コマンド行：N 行」は `check.commands.length`、保存先は `check.filename`、問題は `check.problems` と画面独自の確かめ（`check.commands` に対して。文は「N 個目のコマンド: …」）。
  - 保存：`check.exists` なら `window.confirm(`${check.filename} はもうあります。上書きしますか？`)`、やめたら何もしない。失敗したら `ipcErrorMessage(e)` を出す。`bridgeCommandsWrite` が無いとき（ブラウザー）のダウンロードは今のまま。
  - ひな形のボタンは本当の改行（`"\n"`）を入れる。既定のファイル名は `my_husk.txt`。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run typecheck` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: TXT 作成は main の確かめと理由を使い、名前を黙って書き換えず、上書きの前に聞く」）

---

### Task 4: 画面のコマンドの探し方とルーレットの判定

**Files:**
- Create: `src/lib/commandFiles.ts`
- Modify: `src/components/ImageEditorPage.tsx:93-95`、`src/components/MappingEditor.tsx:49・61-62・225・291`、`src/components/EventSettings2Page.tsx:137・178・312`、`src/components/EventSettingsPage.tsx:56`、`src/components/CommandsListPage.tsx:64-65`
- Test: Create `electron/test/ui-command-files.test.cjs`

**Interfaces:**
- Consumes: Task 1 の行の `roulette`、`sameCommandFile`（bridge 側。比べる相手）。
- Produces: `src/lib/commandFiles.ts`：`ensureTxt(name: unknown): string`、`commandFileStem(name: unknown): string`（`.txt` を1つ除く。フォルダーは除かない）、`sameCommandFile(a: unknown, b: unknown): boolean`、`findCommandFile<T extends { name: string }>(list: T[], commandFile: unknown): T | undefined`。

- [ ] **Step 1: テストを書く**（`ui-command-files.test.cjs`。`transformSync` で読む）
  - 同じ例で bridge と同じ：`['a', ' A.TXT ', 'tnt.v2', '', 0, null, 'foo.txt.txt', 'Neko.TXT', 'neko', 'ネコ.txt']` のそれぞれで `ensureTxt` は bridge の `ensureTxt`、`commandFileStem(ensureTxt(x))` は bridge の `bridgeCommandKey(ensureTxt(x))`。その全部の組で `sameCommandFile` は bridge の `sameCommandFile`。
  - `findCommandFile([{ name: 'neko.txt', title: 'ネコ' }], 'Neko.TXT')?.title` は `'ネコ'`、`'neko'` でも `'ネコ'`、`'inu'` は undefined。
  - 写しを探す：`src/components/` の上の5つのファイルは `replace(/\.txt$/i`・`endsWith(".txt")`・`"roulette.txt")` の比べ方（`!== "roulette.txt"`・`=== "roulette.txt"`）・`f.name === value`・`c.name === m.commandFile`・`titleMap[` を持たない。`CommandsListPage.tsx`・`EventSettings2Page.tsx` は `.roulette` で除く。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/ui-command-files.test.cjs` / Expected: FAIL（`commandFiles.ts` がない）。
- [ ] **Step 3: 直す**（題名は `findCommandFile(…)?.title`、無ければ `commandFileStem`。`MappingEditor` の候補の「現在の設定」の出し分けも `sameCommandFile`。ルーレットは `!row.roulette` で除く。`EventSettings2Page` の `roulette.txt` を書く所（保存）は変えない）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run typecheck` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: 画面のコマンドの探し方を .txt・大文字小文字を区別しない1つにし、ルーレットは main の印で除く」）

---

### Task 5: 使えない名前の印に直し方の文を出し、使われていない GiftCommandDialog を消す

**Files:**
- Modify: `src/lib/commandLabel.ts`（`invalidReason?` を受け、`INVALID_COMMAND_NAME_HINT` をなくし、`invalidCommandMessage(file): string` を足す）、`src/components/CommandsListPage.tsx:10・189-193`、行の型（`MappingEditor.tsx:26`・`EventSettingsPage.tsx:32`・`EventSettings2Page.tsx:37`・`EventTestPanel.tsx:19`）に `invalidReason?: string`
- Delete: `src/components/GiftCommandDialog.tsx`
- Test: `electron/test/ui-safety.test.cjs:190-196`

**Interfaces:**
- Produces: `commandOptionLabel(file: { name: string; title?: string; invalidName?: boolean; invalidReason?: string }): string`、`invalidCommandMessage(file): string`（Global Constraints の文。`invalidReason` が無いときは「コマンド一覧で名前を確かめてください」）。

- [ ] **Step 1: テストを書く**（`ui-safety.test.cjs` の「コマンド候補…」を直す）：`commandOptionLabel({ name: 'ネコ.txt', title: 'ネコ', invalidName: true, invalidReason: '…' })` は `'⚠ ネコ（名前を直すまで動きません）'`。`invalidCommandMessage({ name: 'foo.txt.txt', invalidName: true, invalidReason: 'コマンドファイル名「foo.txt.txt」は終わりに .txt が2つあります。…' })` は `'⚠ この名前は BridgeMOD で実行できません。コマンドファイル名「foo.txt.txt」は終わりに .txt が2つあります。…'`。`src/` に `INVALID_COMMAND_NAME_HINT`・`半角英数字に変えると使えます`・`GiftCommandDialog` が無く、`src/components/GiftCommandDialog.tsx` のファイルも無い。`CommandsListPage.tsx` は `invalidCommandMessage(` を使う。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/ui-safety.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run typecheck` / Expected: PASS。
- [ ] **Step 5: commit**（「fix: 使えない名前の印に main の直し方の文を出し、使われていない GiftCommandDialog を消す」）

---

### Task 6: 無効のギフト割り当てに「無効（動きません）」の印を出す

**Files:**
- Modify: `src/lib/giftMappingRows.ts`（`DISABLED_MAPPING_MARK`・`DISABLED_MAPPING_HINT`・`isDisabledMapping`・`disabledGiftIds`）、`src/components/MappingEditor.tsx`（登録済みのカード `:319-323` と、編集中のギフト `:195-201`）、`src/components/GiftSettingsPage.tsx:194`（プレビューの状態）、`src/components/GiftsGridSection.tsx:261-270`（タイルの札）、`src/components/ImageEditorPage.tsx:46・86・277-279`（割り当ては `fromConfigMappings` で読み、ギフトの一覧の項目に印）、`src/index.css`（`.gift-disabled-mark`。`.ops-wip-badge` の形に合わせる）、`src/types/electron.d.ts:50・57-62`（`enabled?: boolean`）
- Create: `src/components/DisabledMappingMark.tsx`
- Test: `electron/test/gift-mapping-rows.test.cjs`、Create `electron/test/disabled-mapping-mark.test.cjs`

**Interfaces:**
- Produces: `DISABLED_MAPPING_MARK = "無効（動きません）"`、`DISABLED_MAPPING_HINT`（Global Constraints の説明）、`isDisabledMapping(m?: { enabled?: boolean } | null): boolean`（`m?.enabled === false`）、`disabledGiftIds(mappings: Array<{ giftId?: unknown; enabled?: boolean }>): Set<string>`（giftId は前後の空白を除いた文字列）。`<DisabledMappingMark compact?: boolean />`（`<span className="gift-disabled-mark" title={DISABLED_MAPPING_HINT}>`、`compact` なら「無効」）。

- [ ] **Step 1: テストを書く**
  - `gift-mapping-rows.test.cjs`：`disabledGiftIds([{ giftId: ' 5655 ', enabled: false }, { giftId: '1' }, { giftId: '2', enabled: true }])` は `new Set(['5655'])`。`isDisabledMapping({ enabled: false })` true、`({})`・`null` false。無効の行を `updateMapping` と同じ形（`{ ...row, commandFile: 'heal.txt' }`）で変えてから `toConfigMappings` すると `enabled: false` が残る。
  - `disabled-mapping-mark.test.cjs`：`MappingEditor` を `renderToString`（`ui-safety.test.cjs` の `loadComponent` と同じ読み方、`globalThis.window = { mygamepack: {} }`）で、`mappings` に無効の割り当て（giftId `'5655'`）と有効の割り当て（`'1'`）を渡し、`defaultGiftId: '5655'` にすると、「無効（動きません）」が登録済みのカードの数だけ（1つ）と編集中のギフトに出て、編集中の所に「保存しても無効のままです」が出る。有効の割り当てだけなら「無効（動きません）」は出ない。`GiftsGridSection.tsx`・`GiftSettingsPage.tsx`・`ImageEditorPage.tsx` の本文は `DisabledMappingMark` と `isDisabledMapping(` または `disabledGiftIds(` を使い、`ImageEditorPage.tsx` は `fromConfigMappings(` で割り当てを読む。`src/lib/giftPanel.ts`（絵を描く所）は印を使わない。
- [ ] **Step 2: 動かす** — Run: `node --test electron/test/gift-mapping-rows.test.cjs electron/test/disabled-mapping-mark.test.cjs` / Expected: FAIL。
- [ ] **Step 3: 直す**（編集中のギフトが無効なら、印と「このギフトの割り当ては設定ファイルで無効になっています。保存しても無効のままです。」を出す。プレビューの状態は「設定済み・無効（動きません）」。タイルの札は「済」の代わりに `compact` の印。画像作成の印は一覧の項目だけで、パネルの絵には描かない）。
- [ ] **Step 4: 動かす** — Run: Step 2 と同じ、続けて `npm run typecheck` / Expected: PASS。
- [ ] **Step 5: commit**（「feat: 無効のギフト割り当てに「無効（動きません）」の印を、一覧・カタログ・画像作成・編集に出す」）

---

### Task 7: 記録

**Files:**
- Modify: `HANDOFF/HANDOFF04.md`（「処理のコピー」の PR8 の節：やったこと・決めたこと 1〜7・`npm run verify` の結果・リリースノートに足すこと。PR9 の次にやること（TikTok ID の写しを GiftsViewer も含めて・イベント設定②の既定値（値がないときのデスルーレットの回数を 3 と 1 のどちらにそろえるかをユーザーに聞く）・読み上げの数の丸めとテストの音量））

リリースノートに足すこと:
- TXT 作成で、使えないファイル名は理由を出して保存を止めます（前は名前を書き換えたり、ファイルをダウンロードさせたりしていました）。同じ名前のファイルがあるときは、上書きの前に確かめます。
- TXT 作成のひな形のボタンが、正しく2行のコマンドを入れます。
- 設定ファイルで無効（enabled: false）にしたギフトの割り当てに、「無効（動きません）」の印が出ます。
- 大文字の Roulette.TXT や .txt を書いていない割り当てでも、コマンドの題名が出ます。

- [ ] **Step 1: HANDOFF を書く**
- [ ] **Step 2: `npm run verify`・`node scripts/test-bridge-contracts.cjs`** — Expected: すべて通る。
- [ ] **Step 3: commit**（「docs: HANDOFF に処理のコピー PR8 を書く」）
