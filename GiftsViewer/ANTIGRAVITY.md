# Gifts Viewer - プロジェクト憲法 (ANTIGRAVITY)

## 🎯 アプリ目的

TikTok の特定ユーザーの「利用可能ギフト一覧」を取得し、以下の機能を提供する軽量配布アプリ：

- Update ボタン1発で取得
- JSON保存（userData配下）
- HTML生成
- Electron UIで一覧表示
- IDクリックでコピー
- Open Folder / Open HTML 可能

## 🏗 技術スタック

- Electron 31
- React 18
- Vite 6
- TypeScript
- tiktok-live-connector (MIT)

## 📌 MVP（最小構成）の範囲

- ユーザー名（TikTok ID）を指定し、Updateボタンでギフト情報をローカルへ取得・保存する。
- 取得したJSONをもとにHTMLを自動生成し、アプリ内UIまたはブラウザで閲覧可能にする。

## 🚀 現在のステップ

- **依存モジュールの解決**: `tiktok-live-connector` が見つからずに取得処理が失敗する問題を `npm install` により解消する。（進行中）
- 生成される `gifts.html` などにおいて、ギフト画像が正しく表示されるかの確認を行なう。
