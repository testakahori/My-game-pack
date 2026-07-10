import React, { useCallback, useEffect, useMemo, useState } from "react";
import MinecraftBlockIcon from "./MinecraftBlockIcon";

type NameCount = { name: string; count: number };
type StreamStat = {
  start: string; end: string; durationMs: number; events: number;
  gift: number; like: number; share: number; follow: number; member: number; other: number;
  succeeded: number; failed: number;
  uniqueSenders: number; topCommands: NameCount[]; topSenders: NameCount[];
};
type StreamStats = {
  gapMinutes: number;
  overall: { streams: number; events: number; gift: number; like: number; share: number; follow: number; member: number; other: number; succeeded: number; failed: number };
  streams: StreamStat[];
};
type HistoryRow = { at: string; type: string; sender: string; commandFile: string; count: number; ok: boolean };

const card = "rounded-2xl border border-gray-700 bg-gray-900/70 p-5";
const SESSION_GAP_MINUTES = 24 * 60;
const TIMELINE_BUCKETS = 5;
const CHART_X = [25, 80, 135, 190, 250];
const CHART_TOP = 15;
const CHART_BOTTOM = 132;

const EVENT_ICON: Record<string, string> = {
  gift: "🎁", like: "♥", share: "🔗", follow: "➕", member: "👋",
};
const EVENT_LABEL: Record<string, string> = {
  gift: "ギフト", like: "いいね", share: "シェア", follow: "フォロー", member: "訪問", other: "その他",
};

function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  return `${h}時間${min % 60}分`;
}
function fmtRange(startIso: string, endIso: string): string {
  const s = new Date(startIso), e = new Date(endIso);
  const d = s.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
  const t = (x: Date) => x.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  return `${d} ${t(s)}〜${t(e)}`;
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function successRate(succeeded: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((succeeded / total) * 100)}%`;
}

function StatTile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-gray-950 p-3 text-center">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-xl font-black ${tone || "text-gray-100"}`}>{value}</div>
    </div>
  );
}

export default function StatsDashboardPage() {
  const api = (window as any).mygamepack;
  const [data, setData] = useState<StreamStats>({
    gapMinutes: SESSION_GAP_MINUTES,
    overall: { streams: 0, events: 0, gift: 0, like: 0, share: 0, follow: 0, member: 0, other: 0, succeeded: 0, failed: 0 },
    streams: [],
  });
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [stats, rows] = await Promise.all([
        api.operationsStreamStats(SESSION_GAP_MINUTES),
        api.operationsHistory ? api.operationsHistory() : Promise.resolve([]),
      ]);
      setData(stats);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const o = data.overall;
  const latest = data.streams[0];
  const totalKinds = Math.max(1, o.gift + o.like + o.share + o.follow + o.member + o.other);
  const success = successRate(o.succeeded, o.succeeded + o.failed);

  // 直近ストリーム区間に属する実イベント（新しい順→古い順に並べ替え）
  const latestRows = useMemo<Array<HistoryRow & { t: number }>>(() => {
    if (!latest) return [];
    const startT = Date.parse(latest.start) || 0;
    const endT = Date.parse(latest.end) || Date.now();
    return history
      .map((r) => ({ ...r, t: Date.parse(r.at) || 0 }))
      .filter((r) => r.t >= startT && r.t <= endT)
      .sort((a, b) => a.t - b.t);
  }, [history, latest]);

  const timelinePoints = useMemo(() => {
    if (!latest || latestRows.length === 0) return [] as Array<{ key: string; pct: number; icon: string; tone: string; title: string }>;
    const startT = Date.parse(latest.start) || 0;
    const endT = Date.parse(latest.end) || startT + 1;
    const span = Math.max(1, endT - startT);
    return latestRows.slice(-40).map((r, index) => ({
      key: `${r.at}-${index}`,
      pct: Math.min(100, Math.max(0, ((r.t - startT) / span) * 100)),
      icon: EVENT_ICON[r.type] || "⚡",
      tone: r.type === "gift" ? "gift" : r.type === "like" ? "like" : "other",
      title: `${EVENT_ICON[r.type] || "⚡"} ${EVENT_LABEL[r.type] || r.type} / ${r.sender} / ${fmtTime(r.at)}`,
    }));
  }, [latest, latestRows]);

  const timelineLabels = useMemo(() => {
    if (!latest) return [] as string[];
    const startT = Date.parse(latest.start) || 0;
    const endT = Date.parse(latest.end) || startT;
    const span = endT - startT;
    return Array.from({ length: TIMELINE_BUCKETS }, (_, index) => {
      const t = new Date(startT + (span * index) / (TIMELINE_BUCKETS - 1));
      return t.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    });
  }, [latest]);

  const chartPoints = useMemo(() => {
    if (!latest) return { gift: "", like: "" };
    const startT = Date.parse(latest.start) || 0;
    const endT = Date.parse(latest.end) || startT + 1;
    const span = Math.max(1, endT - startT);
    const bucketMs = span / CHART_X.length;
    const giftBuckets = new Array(CHART_X.length).fill(0);
    const likeBuckets = new Array(CHART_X.length).fill(0);
    for (const r of latestRows) {
      const idx = Math.min(CHART_X.length - 1, Math.floor((r.t - startT) / bucketMs));
      const amount = Number(r.count || 1);
      if (r.type === "gift") giftBuckets[idx] += amount;
      else if (r.type === "like") likeBuckets[idx] += amount;
    }
    const maxValue = Math.max(1, ...giftBuckets, ...likeBuckets);
    const toPoints = (values: number[]) =>
      values.map((v, i) => `${CHART_X[i]},${Math.round(CHART_BOTTOM - (v / maxValue) * (CHART_BOTTOM - CHART_TOP))}`).join(" ");
    return { gift: toPoints(giftBuckets), like: toPoints(likeBuckets) };
  }, [latest, latestRows]);

  const recentEvents = useMemo(() => history.slice(0, 8), [history]);

  const highlights = useMemo(() => {
    return [...history]
      .sort((a, b) => Number(b.count || 1) - Number(a.count || 1))
      .slice(0, 3);
  }, [history]);

  return (
    <div className="stats-page stats-design-page page-surface max-w-none">
      <section className="stats-summary-panel">
        <div className="stats-heading-row">
          <div><h1>配信統計ダッシュボード</h1><p>配信イベントの集計と分析をリアルタイム更新します。</p></div>
          <div><button onClick={() => refresh()}>↻ 更新</button></div>
        </div>
        <div className="stats-summary-grid">
          {[
            ["▣","配信数",o.streams,"blue"],
            ["⌁","総イベント",o.events,"violet"],
            ["🎁","ギフト",o.gift,"pink"],
            ["♥","いいね",o.like,"pink"],
            ["✓","成功率",success,"green"],
            ["×","失敗",o.failed,"red"],
          ].map(([icon,label,value,tone]) => (
            <div className={`stats-summary-tile stats-summary-tile--${tone}`} key={String(label)}>
              <span>{icon}</span><small>{label}</small><b>{value}</b>
            </div>
          ))}
        </div>
      </section>

      {loading && !latest ? <section className="stats-empty">集計中…</section> : !latest ? (
        <section className="stats-empty">まだイベント履歴がありません。運用センターでテストイベントを発火すると集計されます。</section>
      ) : (
        <>
          <section className="stats-session-panel">
            <div className="stats-session-title"><span>配信 #1</span><h2>{fmtRange(latest.start, latest.end)}</h2><em>リアルタイム</em><small>配信時間 {fmtDuration(latest.durationMs)} / 視聴者 {latest.uniqueSenders}人</small></div>
            <div className="stats-session-metrics">
              {[
                ["♟","視聴者",latest.uniqueSenders,"人"],
                ["🎁","ギフト",latest.gift,""],
                ["♥","いいね",latest.like,""],
                ["⚡","その他イベント",latest.other,""],
              ].map(([icon,label,value,suffix]) => <div key={String(label)}><span>{icon}</span><small>{label}</small><b>{value}{suffix}</b></div>)}
            </div>
            <div className="stats-timeline">
              <div>
                {timelinePoints.map((p) => (
                  <i
                    key={p.key}
                    style={{ left: `${p.pct}%` }}
                    className={`stats-timeline-dot--${p.tone}`}
                    title={p.title}
                  />
                ))}
              </div>
              {timelineLabels.map((label, index) => <small key={`${label}-${index}`}>{label}</small>)}
            </div>
          </section>

          <div className="stats-analytics-grid">
            <section className="stats-analytics-card">
              <h2>イベント内訳 ⓘ</h2>
              <div className="stats-stack">
                <span style={{width:`${(o.gift/totalKinds)*100}%`}} />
                <i style={{width:`${(o.like/totalKinds)*100}%`}} />
                <b style={{width:`${((o.share+o.follow+o.member+o.other)/totalKinds)*100}%`}} />
              </div>
              {[["ギフト",o.gift,"pink"],["いいね",o.like,"violet"],["シェア",o.share,"green"],["訪問",o.member,"amber"]].map(([label,value,tone]) => (
                <p key={String(label)}><span className={`dot dot--${tone}`} />{label}<b>{value}</b><em>{Math.round((Number(value)/totalKinds)*100)}.0%</em></p>
              ))}
              <footer>合計 <b>{o.events}</b></footer>
            </section>

            <section className="stats-analytics-card stats-line-card">
              <h2>ギフト＆いいね 推移</h2>
              <div className="stats-chart-legend"><span>━ ギフト</span><i>━ いいね</i></div>
              <svg viewBox="0 0 260 150" role="img" aria-label="ギフトといいねの推移">
                <g className="grid"><path d="M25 15V132H250M25 44H250M25 73H250M25 102H250M80 15V132M135 15V132M190 15V132" /></g>
                <polyline className="gift" points={chartPoints.gift} />
                <polyline className="like" points={chartPoints.like} />
              </svg>
            </section>

            <section className="stats-analytics-card stats-gauge-card">
              <h2>成功率 ⓘ</h2>
              <div className="stats-gauge" style={{"--rate": success === "—" ? "0" : success.replace("%","")} as React.CSSProperties}><span>{success}</span></div>
              <div><p><b className="ok">成功</b><strong>{o.succeeded}</strong></p><p><b className="ng">失敗</b><strong>{o.failed}</strong></p></div>
            </section>

            <section className="stats-analytics-card stats-top-card">
              <h2>トップギフト</h2>
              {latest.topCommands[0] ? (
                <div className="stats-top-gift"><span><MinecraftBlockIcon /></span><div><b>{latest.topCommands[0].name}</b><small>💎 {latest.topCommands[0].count}</small></div><em>100%</em></div>
              ) : (
                <p className="stats-no-data">データなし</p>
              )}
              <h2>トップギフター</h2>
              {latest.topSenders.length ? (
                latest.topSenders.slice(0,3).map((sender,index) => <p className="stats-ranker" key={sender.name}><span>{index+1}</span><b>{sender.name}</b><em>💎 {sender.count}</em></p>)
              ) : (
                <p className="stats-no-data">データなし</p>
              )}
            </section>
          </div>

          <div className="stats-bottom-grid">
            <section>
              <h2>直近イベント</h2>
              <div className="stats-table">
                {recentEvents.length === 0 ? (
                  <p className="stats-no-data">データなし</p>
                ) : recentEvents.map((row, index) => (
                  <p key={`${row.at}-${index}`}>
                    <time>{fmtTime(row.at)}</time>
                    <span>{EVENT_ICON[row.type] || "⚡"} {EVENT_LABEL[row.type] || row.type}</span>
                    <b>{row.commandFile}</b>
                    <em>{row.sender}</em>
                    <strong>{row.count}</strong>
                  </p>
                ))}
              </div>
            </section>
            <section>
              <h2>盛り上がりポイント <small>（回数上位イベント）</small></h2>
              {highlights.length === 0 ? (
                <p className="stats-no-data">データなし</p>
              ) : highlights.map((row, index) => (
                <div className="stats-highlight" key={`${row.at}-${index}`}>
                  <span>{EVENT_ICON[row.type] || "⚡"}</span>
                  <div>
                    <b>{EVENT_LABEL[row.type] || row.type}発生</b>
                    <small>{fmtTime(row.at)}　{row.sender} さんから {row.commandFile}（×{row.count}）</small>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
