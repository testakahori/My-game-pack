const { streamBuckets } = require('./stream_sessions.cjs');
function computeStreamStats({ rows, sessions, viewerMetrics = [], gapMinutes = 90, nowMs = Date.now() }) {
  const gapMs = Math.max(5, Number(gapMinutes) || 90) * 60 * 1000;
  const sorted = rows
    .filter((r) => r.source !== "test")
    .map((r) => ({ ...r, t: Date.parse(r.at) || 0 }))
    .filter((r) => r.t > 0)
    .sort((a, b) => a.t - b.t);

  const buckets = streamBuckets(sorted, sessions, gapMs, nowMs);

  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, count]) => ({ name, count }));



  const intervals = b => b.segments?.length ? b.segments.map(p => [Date.parse(p.startedAt), p.endedAt ? Date.parse(p.endedAt) : b.lastT]) : [[b.startT, b.lastT]];
  const observedDuration = (b, from = -Infinity, to = Infinity) => intervals(b).reduce((sum, [start, end]) => sum + Math.max(0, Math.min(end, to) - Math.max(start, from)), 0);
  const contains = (b, time) => intervals(b).some(([start, end]) => time >= start && time <= end);
  const summarize = (b) => {
    const byCommand = Object.create(null), bySender = Object.create(null);
    // type は gift/like に加えて、historyType経由で share/follow/member が実値として記録される
    // （Mod向けキューは常に"other"だが、統計上の内訳はここで区別する）。それ以外は other に集約。
    let gift = 0, like = 0, share = 0, follow = 0, member = 0, other = 0, succeeded = 0, failed = 0;

    for (const r of b.rows) {
      const count = Number(r.count);
      const amount = Number.isFinite(count) && count >= 0 ? count : 1;
      if (r.ok) succeeded++; else failed++;
      if (r.type === "gift") gift += amount;
      else if (r.type === "like") like += amount;
      else if (r.type === "share") share += amount;
      else if (r.type === "follow") follow += amount;
      else if (r.type === "member") member += amount;
      else other += amount;

      byCommand[r.commandFile || "unknown"] = (byCommand[r.commandFile || "unknown"] || 0) + amount;
      bySender[r.sender || "unknown"] = (bySender[r.sender || "unknown"] || 0) + amount;
    }
    // 配信区間内の視聴者数（bridge が60秒毎に記録）から 最高同接/平均 を求める
    const windowMetrics = viewerMetrics.filter(m => contains(b, m.t));
    const maxViewers = windowMetrics.length ? Math.max(...windowMetrics.map((m) => m.viewers)) : 0;
    const avgViewers = windowMetrics.length
      ? Math.round(windowMetrics.reduce((a, m) => a + m.viewers, 0) / windowMetrics.length)
      : 0;
    return {
      id: b.id || `estimated-${b.startT}`, title: b.title || "", recorded: b.recorded, active: b.active, source: b.source || "estimated", roomId: b.roomId || "", endReason: b.endReason || "", segments: b.segments || [],
      start: new Date(b.startT).toISOString(),
      end: new Date(b.lastT).toISOString(),
      durationMs: observedDuration(b),
      events: b.rows.length,
      gift, like, share, follow, member, other, succeeded, failed,

      maxViewers,
      avgViewers, viewerSamples: windowMetrics.length,
      uniqueSenders: Object.keys(bySender).length,
      topCommands: top(byCommand),
      topSenders: top(bySender),
    };
  };

  const cutoff = nowMs - 30 * 86400000;
  const streams = buckets.filter(b => b.lastT >= cutoff).map(summarize).reverse(); // 新しい配信を先頭に
  const sum = (key) => streams.reduce((a, s) => a + (s[key] || 0), 0);

  // 今月（ローカル時刻基準）の配信合計時間
  const now = new Date(nowMs);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthStreams = streams.filter((s) => {
    const d = new Date(s.start);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  return {
    activeSession: streams.find(s => s.active) || null,
    gapMinutes: gapMs / 60000,
    overall: {
      streams: streams.length,
      events: sum("events"),
      gift: sum("gift"), like: sum("like"), share: sum("share"), follow: sum("follow"),
      member: sum("member"), other: sum("other"),
      succeeded: sum("succeeded"), failed: sum("failed"),

    },
    monthly: {
      month: monthKey,
      streams: monthStreams.length,
      totalDurationMs: buckets.reduce((a, b) => a + observedDuration(b, new Date(now.getFullYear(), now.getMonth(), 1).getTime(), nowMs), 0),

    },
    streams,
  };
}
module.exports = { computeStreamStats };
