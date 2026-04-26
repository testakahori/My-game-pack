# Gifts Viewer

TikTok の対象ユーザーの**利用可能ギフト一覧**をボタン1発で全取得し、画像付きのリスト画面を自動生成・表示する補助アプリケーションです。Electron + React をベースに構築されています。

## ✨ 特徴

- **ワンクリック更新**: TikTokのユーザーIDを入力し、「Update」ボタンを押すだけで最新のギフト一覧と画像リンクを取得。
- **背景透過対応コピー**: リストからギフト画像をクリックするだけで、**背景透過（透明）を維持したままクリップボードへ画像を直接コピー**できます。
- **HTMLの自動生成**: 取得したJSONをもとに、軽量で閲覧しやすい静的HTML（`gifts.html`）をローカルに自動生成します。

## 📦 利用方法

### インストーラを使う場合（おすすめ）

Releases ページから `Gifts Viewer Setup X.X.X.exe` をダウンロードし、インストールして起動してください。

### 開発環境で動かす場合

```cmd
# 1. リポジトリをクローン
git clone https://github.com/your-username/GiftsViewer.git

# 2. 依存パッケージをインストール
npm install

# 3. 開発モードでアプリを起動
npm run electron:dev

# ※ 本番ビルド用のexeを作る場合
npm run pack:win
```

## 🛠 使い方

1. 起動画面の「TikTok:」欄に、ギフトを取得したい対象者のユーザーIDを入力します（例: `akahoridouma`）。
2. **Update** のボタンを押します。
3. しばらく待つと、画面上に読み込まれたギフトリストが表示されます。
4. 一覧からの操作：
   - **画像のクリック**: その背景が透過されたギフトの画像ごとクリップボードにコピーされます。
   - **テキスト領域のクリック**: そのギフトの「ID」がクリップボードにコピーされます。
5. **Open Folder** / **Open HTML** ボタンより、生成されたjsonやhtmlの生データが入ったフォルダを開くことができます。

## ⚙️ 技術構成

- **Electron 31** (配布とシステム間制御)
- **React 18 & Vite 6** (UI画面)
- **TypeScript**
- **TikTok-Live-Connector**

## 📜 ライセンスについて (License)

このプロジェクト自体は [MIT License](LICENSE) の元で公開されています。

### 📌 サードパーティライブラリ

当アプリケーションは、内部でギフト情報の取得に以下のライブラリを利用しています。

- **[TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector)**  
  Licensed under MIT License.
