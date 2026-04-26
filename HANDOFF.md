# 引継ぎの書（2026-03-20）

## 今日やったこと

### 1. TikTalk（tiktok-talk）の完成・公開
- AivisSpeechのクラッシュ原因を調査・解決（ユーザー辞書のJSON形式がv1.0.0で変わっていた）
- アプリ内インストールボタンを削除し、公式サイト案内に変更
- README.md 作成
- `electron-builder` でWindows用インストーラー（EXE）をビルド
- GitHub フォーク（testakahori/tiktalk）からプルリクエスト → Nicolas0315/tiktalk にマージ済み
- リリース: https://github.com/testakahori/tiktalk/releases/tag/v1.0.0

### 2. BRIDGE UI に読み上げ設定ページを追加
- `D:\MyGamePack02\bridge_ui\ui` に実装
- サイドバーの「イベント設定」と「ギフト一覧」の間に「🔊 読み上げ設定」を追加

---

## BRIDGE 読み上げ機能の実装内容

### 追加・変更したファイル

| ファイル | 内容 |
|---|---|
| `electron/tts.cjs` | VOICEVOX/AivisSpeech APIラッパー（新規） |
| `src/types.ts` | `AppPage.TTS` を追加 |
| `src/components/Sidebar.tsx` | 🔊 読み上げ設定をナビに追加 |
| `src/App.tsx` | TTSSettingsPage のルーティング追加 |
| `src/components/TTSSettingsPage.tsx` | 設定画面（新規） |
| `electron/main.cjs` | TTS IPC ハンドラー5本追加（末尾） |
| `electron/preload.cjs` | TTS API を contextBridge に追加 |
| `bridge/index.js` | ギフト・コメント読み上げ処理を追加 |

### 動作の仕組み
- 「💾 保存する」→ `userData/tts-settings.json` と `bridge/tts-settings.json` に同期保存
- BRIDGE 起動時に `tts-settings.json` を読んで、コメント・ギフトを読み上げ
- 音声合成はVOICEVOX/AivisSpeechのローカルHTTP APIを直接呼び出し
- 音声再生はPowerShell（`Media.SoundPlayer`）経由
- テスト再生ボタンでUI上から動作確認できる

---

## 明日やること（TODO）

### 動作確認
- [ ] VOICEVOXまたはAivisSpeechを起動した状態でテスト再生が鳴るか確認
- [ ] BRIDGEを起動してコメント読み上げが動くか確認
- [ ] BRIDGEを起動してギフト読み上げが動くか確認
- [ ] 設定の保存・再読み込みが正常に動くか確認

### 検討中
- コメント読み上げのNGワード設定（現状BRIDGEのNGは非対応）
- 読み上げキューの実装（複数コメントが重なったとき）
- BRIDGEのEXEビルドと配布

---

## 関連パス

| 項目 | パス |
|---|---|
| BRIDGE UI プロジェクト | `D:\MyGamePack02\bridge_ui\ui` |
| TikTalk プロジェクト | `D:\Dev02\tiktok-talk` |
| TTS設定ファイル（保存先） | `%APPDATA%\tiktok-bridge-ui\tts-settings.json` |
| Bridgeフォルダ（dev） | `D:\MyGamePack02\bridge_ui\ui\bridge` |

## 起動コマンド

```bash
# BRIDGE UI 開発起動
cd D:\MyGamePack02\bridge_ui\ui
npm run electron:dev
```
