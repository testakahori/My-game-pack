// 操作履歴・運用の統計・配信統計（視聴者数・受取額）・配信の記録・ギフト案内画像の保存。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、BrowserWindow・dialog は main から受け取る。
const path = require("path");
const fs = require("fs");
const { createStreamSessions, streamBuckets } = require("./stream_sessions.cjs");
const { saveGiftPanelPng } = require("./image_export.cjs");
const { exportStreamStatsMarkdown } = require("./stats_export.cjs");

// BRIDGE の子プロセスは、あとで main で作られるので、呼ばれたときに読む関数で受け取る。
function createOperationsStats({ BrowserWindow, dialog, getBridgeBatDir, bridgeChild }) {
  const streamSessions = createStreamSessions(() => path.join(getBridgeBatDir(), "stream-sessions.json"));

  function getOperationsHistoryPath() { return path.join(getBridgeBatDir(), "operations-history.json"); }

  // operations-history.json は bridge（Node）と electron（main）の両方が書き込む。
  // 従来の「全体読み込み→unshift→全体書き込み」は同時書き込みで履歴が巻き戻る事故があったため、
  // 追記のみ（JSONL: 1行1イベント、古い順）に変更した。読み出し時に新しい順へ変換して返す。
  // 旧フォーマット（JSON配列、新しい順）のファイルもそのまま読めるよう互換を維持する。
  function readOperationsHistory() {
    let raw = "";
    try { raw = fs.readFileSync(getOperationsHistoryPath(), "utf8"); } catch { return []; }
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      // 旧フォーマット（JSON配列）
      try { return JSON.parse(trimmed); } catch { return []; }
    }
    const rows = [];
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { /* 壊れた行はスキップ */ }
    }
    return rows.reverse(); // 新しい順
  }

  // 旧バージョン（JSON配列・新しい順）で運用していたファイルをJSONL（1行1イベント・古い順）へ
  // その場で一度だけ変換する。以降は追記のみで済むため、bridgeとelectronの同時書き込みで
  // 履歴が巻き戻る事故が起きなくなる。
  function migrateOperationsHistoryToJsonlIfNeeded(historyPath) {
    let raw = "";
    try { raw = fs.readFileSync(historyPath, "utf8"); } catch { return; }
    const trimmed = raw.trim();
    if (!trimmed.startsWith("[")) return; // 既にJSONL、または空
    let rows;
    try { rows = JSON.parse(trimmed); } catch { return; }
    if (!Array.isArray(rows)) return;
    const oldestFirst = [...rows].reverse(); // 旧フォーマットは新しい順→古い順に戻す
    const lines = oldestFirst.map((row) => JSON.stringify(row)).join("\n");
    fs.writeFileSync(historyPath, lines ? lines + "\n" : "", "utf8");
  }

  // 30日より古いイベント履歴を起動時に削除（配信集計リストの保持期間）
  function pruneOperationsHistoryOldRows(days = 30) {
    const historyPath = getOperationsHistoryPath();
    try {
      migrateOperationsHistoryToJsonlIfNeeded(historyPath);
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      const lines = fs.readFileSync(historyPath, "utf8").split("\n").filter((l) => l.trim());
      const kept = lines.filter((line) => {
        try { return (Date.parse(JSON.parse(line).at) || 0) >= cutoff; } catch { return false; }
      });
      if (kept.length !== lines.length) {
        fs.writeFileSync(historyPath, kept.length ? kept.join("\n") + "\n" : "", "utf8");
        console.log(`[stats] pruned operations history: ${lines.length} -> ${kept.length} rows (${days}d)`);
      }
    } catch { /* ファイルが無ければ何もしない */ }
  }

  // bridge が記録する視聴者数メトリクス（stream-metrics.jsonl）を読む
  function readViewerMetrics() {
    const p = path.join(getBridgeBatDir(), "stream-metrics.jsonl");
    try {
      return fs.readFileSync(p, "utf8").split("\n").filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean)
        .map((r) => ({ t: Date.parse(r.at) || 0, viewers: Number(r.viewers) || 0 }))
        .filter((r) => r.t > 0);
    } catch { return []; }
  }

  // 配信単位（per-stream）の統計。
  // operations-history.json のイベントを時刻ギャップで「配信セッション」に分割し、
  // 配信ごとにギフト数・発動数・失敗数・最頻ギフト・トップギフターを集計する。
  // gapMinutes 以上イベントが途切れたら別の配信とみなす（既定90分）。
  function computeStreamStats(gapMinutes) {
    return require('./stream_statistics.cjs').computeStreamStats({ rows: readOperationsHistory(), sessions: streamSessions.read(), viewerMetrics: readViewerMetrics(), audience: require("../bridge/audience_stats.cjs").readAudienceStats(path.join(getBridgeBatDir(), "stream-audience.json")), earnings: require("./stream_earnings.cjs").readEarnings(path.join(getBridgeBatDir(), "stream-earnings.json")), gapMinutes });
  }

  function register(ipcMain) {
    ipcMain.handle("stream:session:status", () => {
      const sessions = streamSessions.read();
      const current = streamBuckets([], sessions, 90 * 60000).find(s => s.source === 'automatic' && s.active);
      let runtime = {};
      try { runtime = JSON.parse(fs.readFileSync(path.join(getBridgeBatDir(), 'runtime-status.json'), 'utf8')); } catch {}
      return { active: current && bridgeChild() ? sessions.find(s => s.id === current.id) : null, monitoring: Boolean(bridgeChild()), error: bridgeChild() ? runtime.recording?.error || '' : '' };
    });
    ipcMain.handle("stream:session:start", (_event, title) => streamSessions.start(title));
    ipcMain.handle("stream:session:end", (_event, value) => streamSessions.end(value?.id, value?.endedAt));
    ipcMain.handle("image:saveGiftPanel", (_event, value) => saveGiftPanelPng(dialog, value));

    ipcMain.handle("operations:history", () => readOperationsHistory());
    ipcMain.handle("operations:history:clear", () => {
      fs.writeFileSync(getOperationsHistoryPath(), "[]", "utf8"); return { ok: true };
    });

    ipcMain.handle("operations:stats", () => {
      const rows = readOperationsHistory();
      const byCommand = {};
      const bySender = {};
      let succeeded = 0;
      for (const row of rows) {
        if (row.ok) succeeded++;
        // 回数0の行（音・粒子だけ失敗）を1回と数えない（PR #85 レビュー。stream_statistics と同じ数え方）。
        const count = Number(row.count);
        const amount = Number.isFinite(count) && count >= 0 ? count : 1;
        byCommand[row.commandFile || "unknown"] = (byCommand[row.commandFile || "unknown"] || 0) + amount;
        bySender[row.sender || "unknown"] = (bySender[row.sender || "unknown"] || 0) + amount;
      }
      const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([name, count]) => ({ name, count }));
      return { total: rows.length, succeeded, failed: rows.length - succeeded,
        topCommands: top(byCommand), topSenders: top(bySender) };
    });

    ipcMain.handle('operations:stats:export', (_event, streamId) => exportStreamStatsMarkdown({
      stats: computeStreamStats(), streamId, dialog, parent: BrowserWindow.getFocusedWindow(),
    }));

    ipcMain.handle("operations:earnings:save", (_event, id, amount) => require("./stream_earnings.cjs").saveEarnings(path.join(getBridgeBatDir(), "stream-earnings.json"), computeStreamStats().streams, id, amount));

    ipcMain.handle("operations:streamStats", (_event, gapMinutes) => computeStreamStats(gapMinutes));
  }

  return { pruneOperationsHistoryOldRows, readOperationsHistory, register };
}

module.exports = { createOperationsStats };
