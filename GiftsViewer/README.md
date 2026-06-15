# Gifts Viewer

TikTok の指定ユーザーから、利用可能なギフト一覧を取得して確認できる Windows 向けアプリです。ギフト画像、名前、ID、Cost を見ながら検索・並び替え・コピーできます。

## 主な機能

- TikTok ユーザーIDを入力してギフト一覧を更新
- ギフト名、ID、Cost、画像をカード表示または一覧表示で確認
- IDまたはギフト名で検索
- Cost 昇順、Cost 降順、名前順で並び替え
- Cost帯で絞り込み
  - `All Cost`
  - `1-99`
  - `100-999`
  - `1000+`
- よく使うギフトをお気に入り登録
- ギフトIDをワンクリックでコピー
- ギフト画像を透過PNGとしてクリップボードへコピー
- 取得した JSON / HTML の保存先フォルダを開く
- 生成済みの `gifts.html` を開く

## インストール方法

### ふつうに使う人

`Gifts Viewer Setup 1.0.3.exe` を実行してください。

すでに古い Gifts Viewer をインストール済みの場合も、同じインストーラーを実行すれば上書き更新できます。初めて使う人も同じインストーラーから新規インストールできます。

### Node.js が入っていないPCで使う場合

インストーラー版は、ビルド時に同梱された実行環境を使う構成にできます。もし `Update` 実行時に Node 関連のエラーが出る場合は、Node.js をインストールしてください。

おすすめは LTS 版です。

1. [Node.js 公式サイト](https://nodejs.org/) を開く
2. `LTS` と書かれた Windows Installer をダウンロード
3. インストーラーを起動
4. 基本的には初期設定のまま `Next` で進める
5. インストール完了後、Gifts Viewer を再起動する

Windows Terminal や PowerShell に慣れている人は、次のコマンドでもインストールできます。

```powershell
winget install OpenJS.NodeJS.LTS
```

インストール確認:

```powershell
node -v
npm -v
```

バージョン番号が表示されればOKです。

## 使い方

1. Gifts Viewer を起動します。
2. `TikTok:` 欄に対象ユーザーIDを入力します。
   - 例: `akahoridouma`
   - `@akahoridouma` のように `@` が付いていても自動で取り除きます。
3. `Update` を押します。
4. 取得が完了するとギフト一覧が表示されます。
5. 必要に応じて検索、並び替え、Cost帯フィルター、表示切り替えを使います。

## 画面の見方

### Cards

画像を見ながら探しやすい表示です。

- `☆ / ★`: お気に入りの追加・解除
- `ID`: ギフトIDをコピー
- `Image`: ギフト画像を透過PNGとしてコピー
- 画像クリック: ギフト画像をコピー
- テキスト部分クリック: ギフトIDをコピー

### List

ID、名前、Cost を比較しながら探しやすい表示です。

- `Fav`: お気に入りの追加・解除
- `Image`: 画像をクリックしてコピー
- `ID`: IDボタンをクリックしてコピー
- `Cost`: ギフトのダイヤ数
- `Copy ID`: IDをコピー

お気に入りに登録したギフトは、検索・ソート後の一覧で上に表示されます。

## 保存されるデータ

取得したデータはアプリのユーザーデータフォルダに保存されます。

- `gifts.full.json`
- `gifts.min.json`
- `gifts.meta.json`
- `gifts.html`

保存先はアプリ内の `Open Folder` から開けます。

お気に入り情報はアプリ画面側のローカル保存領域に保存されます。

## 開発者向け

### セットアップ

```powershell
git clone https://github.com/testakahori/Gifts-Viewer.git
cd Gifts-Viewer
npm install
```

### 開発モード

```powershell
npm run electron:dev
```

### 通常ビルド

```powershell
npm run build
```

### Windows インストーラー作成

```powershell
npm run pack:win
```

生成物は `release/` に出力されます。

## 配布設定メモ

- アプリID: `ai.mygamepack.giftsviewer`
- 製品名: `Gifts Viewer`
- インストーラー形式: NSIS
- 既存インストール済み環境では、同じアプリIDと製品名を使って上書き更新されます。
- アンインストール時もユーザーデータは削除しない設定です。

## 技術構成

- Electron 31
- React 18
- Vite 6
- TypeScript
- tiktok-live-connector
- electron-builder

## ライセンス

このプロジェクトは MIT License です。

内部でギフト情報の取得に [TikTok-Live-Connector](https://github.com/zerodytrash/TikTok-Live-Connector) を利用しています。
