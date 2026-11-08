// ログファイルの整理（BRIDGE の bridge-*.log と、アプリ本体の main-*.log。2026-11-07 品質レビュー）。
// 前の BRIDGE は新しい 50 個だけを残していたので、起動してすぐ落ちる再起動の繰り返しで、最初に落ちたときのログと前の配信のログが消えていた。
// 今は keepDays 日より古いものだけを消す。数の上限（maxFiles）はゆるく持ち、超えても今日のログは消さない。
"use strict";

const fs = require("fs");
const path = require("path");

const DAY_MS = 24 * 60 * 60 * 1000;

// 消したファイルの名前を返す。読めない・消せないファイルは飛ばす（ログの整理でアプリや BRIDGE を止めない）。
function pruneLogFiles(dir, { prefix, now = Date.now(), keepDays = 7, maxFiles = 500 } = {}) {
  let files;
  try {
    files = fs.readdirSync(dir)
      .filter(name => name.startsWith(prefix) && name.endsWith(".log"))
      .map(name => {
        try { return { name, mtime: fs.statSync(path.join(dir, name)).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const removed = [];
  files.forEach((file, index) => {
    if (file.mtime >= today.getTime()) return;
    if (now - file.mtime <= keepDays * DAY_MS && index < maxFiles) return;
    try { fs.unlinkSync(path.join(dir, file.name)); removed.push(file.name); } catch { /* 次の起動でまた消す */ }
  });
  return removed;
}

module.exports = { pruneLogFiles };
