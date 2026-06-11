# Gifts Viewer

TikTok の対象ユーザーの**利用可能ギフト一覧**をボタン1発で全取得し、画像付きのリスト画面を自動生成・表示する補助アプリケーションです。Electron + React をベースに構築されています。

## ✨ 特徴

- **ワンクリック更新**: TikTokのユーザーIDを入力し、「Update」ボタンを押すだけで最新のギフト一覧と画像リンクを取得。
- **ギフト名の日本語表示**: TikTok API へ日本語（ja-JP）でリクエストするため、ギフト名は「ハートミー」「空飛ぶダイヤモンド」のように日本語で取得・表示されます（TikTok側に日本語訳が無い一部ギフトは英語のままです）。
- **背景透過対応コピー**: リストからギフト画像をクリックするだけで、**背景透過（透明）を維持したままクリップボードへ画像を直接コピー**できます。
- **検索・並び替え**: ID／ギフト名での絞り込み検索と、コスト順・名前順の並び替えに対応。
- **HTMLの自動生成**: 取得したJSONをもとに、軽量で閲覧しやすい静的HTML（`gifts.html`）をローカルに自動生成します。

## 📦 利用方法

### インストーラを使う場合（おすすめ）

`Gifts Viewer Setup X.X.X.exe` を実行してインストールし、起動してください。

### 開発環境で動かす場合

このアプリは [minecraft-tiktok-bridge](https://github.com/testakahori/minecraft-tiktok-bridge) リポジトリの `GiftsViewer/` ディレクトリに含まれています。

```cmd
# 1. リポジトリをクローン
git clone https://github.com/testakahori/minecraft-tiktok-bridge.git
cd minecraft-tiktok-bridge/GiftsViewer

# 2. 依存パッケージをインストール
npm install

# 3. 開発モードでアプリを起動
npm run electron:dev

# ※ 本番ビルド用のexe（インストーラ）を作る場合
npm run pack:win
```

## 🛠 使い方

1. 起動画面の「TikTok:」欄に、ギフトを取得したい対象者のユーザーIDを入力します（例: `akahoridouma`）。
2. **Update** のボタンを押します。
3. しばらく待つと、画面上に読み込まれたギフトリストが表示されます。
4. 一覧からの操作：
   - **画像のクリック**: その背景が透過されたギフトの画像ごとクリップボードにコピーされます。
   - **テキスト領域のクリック**: そのギフトの「ID」がクリップボードにコピーされます。
   - **右上の検索ボックス**: ID やギフト名で一覧を絞り込めます。
   - **並び替え**: コストの昇順／降順、名前順で並び替えできます。
5. **Open Folder** / **Open HTML** ボタンより、生成されたjsonやhtmlの生データが入ったフォルダを開くことができます。

> 💡 取得したデータ（`gifts.full.json` / `gifts.min.json` / `gifts.html` など）は、インストール版ではユーザーデータフォルダ配下に保存されます。**Open Folder** ボタンで直接開けます。

## ⚙️ 技術構成

- **Electron 31** (配布とシステム間制御)
- **React 18 & Vite 6** (UI画面)
- **TypeScript**
- **TikTok-Live-Connector** (ギフト情報の取得・言語は ja-JP を指定)

## 📜 ライセンスについて (License)

このプロジェクト自体は MIT License の元で公開されています。

### 📌 サードパーティライブラリ

当アプリケーションは、内部でギフト情報の取得に以下のライブラリを利用しています。

- **[TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector)**  
  Licensed under MIT License.
