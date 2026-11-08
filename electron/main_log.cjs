// アプリ本体（main）の console.warn・console.error を、userData/logs/main-YYYYMMDD.log に残す（2026-11-07 品質レビュー）。
// 配信中に main で起きたエラーは、これまで画面にもファイルにも残らず、あとから確かめられなかった。
// 1日1ファイルで、7日より古いものは起動のときに消す（決め方は bridge/log_cleanup.cjs の1か所）。
// 運用センターの「ログのフォルダーを開く」（logs:openFolder）で、このフォルダーを開く。
// electron は読み込まず、app・shell は main から受け取る。
const path = require("path");
const fs = require("fs");
const util = require("util");
const { pruneLogFiles } = require("../bridge/log_cleanup.cjs");
const { redactSecrets } = require("../bridge/tiktok_connection.cjs");

// ファイル名の日付はこの PC の日付（YYYYMMDD）。
function dayStamp(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

// target は書き換える console（テストは偽物を渡す）。now はテストが日付を決めるためのもの。
function createMainLog({ app, shell, target = console, now = () => new Date() }) {
  const logsDir = () => path.join(app.getPath("userData"), "logs");

  function write(level, args) {
    try {
      const at = now();
      const text = args.map(value => (typeof value === "string" ? value : util.inspect(value))).join(" ");
      fs.mkdirSync(logsDir(), { recursive: true });
      fs.appendFileSync(path.join(logsDir(), `main-${dayStamp(at)}.log`), `[${at.toISOString()}] [${level}] ${redactSecrets(text)}\n`, "utf8");
    } catch { /* ログを書けなくてもアプリは止めない */ }
  }

  // 起動のとき（app.whenReady の中）に1回だけ呼ぶ。画面への出力（開発時のターミナル）はそのまま残す。
  let installed = false;
  function install() {
    if (installed) return;
    installed = true;
    pruneLogFiles(logsDir(), { prefix: "main-", keepDays: 7, now: now().getTime() });
    for (const level of ["warn", "error"]) {
      const original = target[level].bind(target);
      target[level] = (...args) => { original(...args); write(level.toUpperCase(), args); };
    }
  }

  function register(ipcMain) {
    ipcMain.handle("logs:openFolder", async () => {
      fs.mkdirSync(logsDir(), { recursive: true });
      const error = await shell.openPath(logsDir());
      if (error) throw new Error(`ログのフォルダーを開けませんでした: ${error}`);
      return { ok: true, path: logsDir() };
    });
  }

  return { install, register, logsDir };
}

module.exports = { createMainLog };
