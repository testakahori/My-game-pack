import React, { useCallback, useEffect, useMemo, useState } from "react";
import MinecraftBlockIcon from "./MinecraftBlockIcon";

type NameCount = { name: string; count: number };
type StreamStat = {
  start: string; end: string; durationMs: number; events: number;
  gift: number; like: number; share: number; follow: number; member: number; other: number;
  succeeded: number; failed: number;
  diamonds?: number; maxViewers?: number; avgViewers?: number;
  uniqueSenders: number; topCommands: NameCount[]; topSenders: NameCount[];
};
type StreamStats = {
  gapMinutes: number;
  overall: { streams: number; events: number; gift: number; like: number; share: number; follow: number; member: number; other: number; succeeded: number; failed: number; diamonds?: number };
  monthly?: { month: string; streams: number; totalDurationMs: number; diamonds: number };
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
  const [view, setView] = useState<"dashboard" | "list" | "detail">("dashboard");
  const [detailIndex, setDetailIndex] = useState<number>(0);
  const [menuOpen, setMenuOpen] = useState(false);

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
          <div style={{ position: "relative" }}>
            <h1
              onClick={() => setMenuOpen((v) => !v)}
              style={{ cursor: "pointer", userSelect: "none" }}
              title="クリックでメニューを開く"
            >
              配信統計{view === "list" ? "（配信集計）" : view === "detail" ? "（配信詳細）" : "ダッシュボード"} <span style={{ fontSize: 14, opacity: 0.7 }}>▾</span>
            </h1>
            <p>配信イベントの集計と分析をリアルタイム更新します。データは30日間保持されます。</p>
            {menuOpen && (
              <div
                style={{
                  position: "absolute", top: "100%", left: 0, zIndex: 30, marginTop: 6,
                  background: "#0b1524", border: "1px solid rgba(39,216,255,0.4)", borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)", overflow: "hidden", minWidth: 220,
                }}
              >
                {[
                  { key: "dashboard", label: "📊 配信統計ダッシュボード" },
                  { key: "list", label: "📅 配信集計を見る" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => { setView(item.key as "dashboard" | "list"); setMenuOpen(false); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "10px 14px",
                      fontSize: 13, fontWeight: 700, color: "#d5e6f7",
                      background: view === item.key ? "rgba(39,216,255,0.12)" : "transparent",
                      border: "none", cursor: "pointer",
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="stats-summary-tile stats-summary-tile--green" style={{ minWidth: 150 }}>
              <span>🕒</span><small>今月の配信合計時間</small>
              <b>{data.monthly ? fmtDuration(data.monthly.totalDurationMs) : "0分"}</b>
            </div>
            <button onClick={() => refresh()}>↻ 更新</button>
          </div>
        </div>
        <div className="stats-summary-grid">
          {[
            ["▣","配信数",o.streams,"blue"],
            ["⌁","総イベント",o.events,"violet"],
            ["🎁","ギフト",o.gift,"pink"],
            ["♥","いいね",o.like,"pink"],
            ["💎","総ダイヤ",o.diamonds ?? 0,"violet"],
            ["✓","成功率",success,"green"],
          ].map(([icon,label,value,tone]) => (
            <div className={`stats-summary-tile stats-summary-tile--${tone}`} key={String(label)}>
              <span>{icon}</span><small>{label}</small><b>{value}</b>
            </div>
          ))}
        </div>
      </section>

      {/* ══ 配信集計リスト ══ */}
      {view === "list" && (
        <section className="stats-analytics-card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>配信集計 <small style={{ color: "#77899f" }}>（直近30日・{data.streams.length}配信）</small></h2>
            <button type="button" onClick={() => setView("dashboard")} style={{ fontSize: 12 }}>← ダッシュボードへ戻る</button>
          </div>
          {data.streams.length === 0 ? (
            <p className="stats-no-data">まだ配信データがありません。</p>
          ) : (
            <div className="stats-table" style={{ fontSize: 13 }}>
              <p style={{ fontWeight: 800, color: "#8ba0b8" }}>
                <span style={{ minWidth: 170 }}>日付（クリックで詳細）</span>
                <b>配信時間</b>
                <em>総配信時間（累計）</em>
                <strong>💎 総ダイヤ</strong>
              </p>
              {data.streams.map((s, index) => {
                // 累計は古い配信からの積み上げ（streams は新しい順なので後ろから足す）
                const cumulative = data.streams.slice(index).reduce((a, x) => a + x.durationMs, 0);
                return (
                  <p key={s.start}>
                    <button
                      type="button"
                      onClick={() => { setDetailIndex(index); setView("detail"); }}
                      style={{
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                        color: "#3fd5ff", fontWeight: 800, textDecoration: "underline", fontSize: 13, minWidth: 170, textAlign: "left",
                      }}
                    >
                      {fmtRange(s.start, s.end)}
                    </button>
                    <b>{fmtDuration(s.durationMs)}</b>
                    <em>{fmtDuration(cumulative)}</em>
                    <strong>💎 {s.diamonds ?? 0}</strong>
                  </p>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ══ 配信別詳細 ══ */}
      {view === "detail" && (() => {
        const s = data.streams[detailIndex];
        if (!s) return <section className="stats-empty">配信データが見つかりません。<button type="button" onClick={() => setView("list")}>一覧へ戻る</button></section>;
        const detailRows = history
          .map((r) => ({ ...r, t: Date.parse(r.at) || 0 }))
          .filter((r) => r.t >= (Date.parse(s.start) || 0) && r.t <= (Date.parse(s.end) || 0));
        const kinds = Math.max(1, s.gift + s.like + s.share + s.follow + s.member + s.other);
        return (
          <>
            <section className="stats-session-panel">
              <div className="stats-session-title">
                <span>配信詳細</span>
                <h2>{fmtRange(s.start, s.end)}</h2>
                <em>{fmtDuration(s.durationMs)}</em>
                <small>
                  <button type="button" onClick={() => setView("list")} style={{ fontSize: 11 }}>← 配信集計へ戻る</button>
                </small>
              </div>
              <div className="stats-session-metrics">
                {[
                  ["🕒","配信時間",fmtDuration(s.durationMs),""],
                  ["♟","視聴者数（イベント参加）",s.uniqueSenders,"人"],
                  ["📈","最高同接",s.maxViewers || 0,"人"],
                  ["📊","平均同接",s.avgViewers || 0,"人"],
                  ["🎁","ギフト",s.gift,""],
                  ["♥","いいね",s.like,""],
                  ["💎","ダイヤモンド",s.diamonds ?? 0,""],
                  ["✓","成功率",successRate(s.succeeded, s.succeeded + s.failed),""],
                ].map(([icon,label,value,suffix]) => (
                  <div key={String(label)}><span>{icon}</span><small>{label}</small><b>{value}{suffix}</b></div>
                ))}
              </div>
            </section>
            <div className="stats-analytics-grid">
              <section className="stats-analytics-card">
                <h2>イベント内訳</h2>
                <div className="stats-stack">
                  <span style={{width:`${(s.gift/kinds)*100}%`}} />
                  <i style={{width:`${(s.like/kinds)*100}%`}} />
                  <b style={{width:`${((s.share+s.follow+s.member+s.other)/kinds)*100}%`}} />
                </div>
                {[["ギフト",s.gift,"pink"],["いいね",s.like,"violet"],["シェア",s.share,"green"],["フォロー",s.follow,"amber"],["訪問",s.member,"amber"],["その他",s.other,"blue"]].map(([label,value,tone]) => (
                  <p key={String(label)}><span className={`dot dot--${tone}`} />{label}<b>{value}</b><em>{Math.round((Number(value)/kinds)*100)}%</em></p>
                ))}
                <footer>合計 <b>{s.events}</b> イベント</footer>
              </section>
              <section className="stats-analytics-card stats-top-card">
                <h2>トップギフター</h2>
                {s.topSenders.length ? (
                  s.topSenders.slice(0,3).map((sender,index) => <p className="stats-ranker" key={sender.name}><span>{index+1}</span><b>{sender.name}</b><em>×{sender.count}</em></p>)
                ) : <p className="stats-no-data">データなし</p>}
                <h2>人気コマンド</h2>
                {s.topCommands.length ? (
                  s.topCommands.slice(0,3).map((c,index) => <p className="stats-ranker" key={c.name}><span>{index+1}</span><b>{c.name}</b><em>×{c.count}</em></p>)
                ) : <p className="stats-no-data">データなし</p>}
              </section>
              <section className="stats-analytics-card" style={{ gridColumn: "span 2" }}>
                <h2>この配信のイベント（直近20件）</h2>
                <div className="stats-table">
                  {detailRows.length === 0 ? <p className="stats-no-data">データなし</p> : detailRows.slice(-20).reverse().map((row, index) => (
                    <p key={`${row.at}-${index}`}>
                      <time>{fmtTime(row.at)}</time>
                      <span>{EVENT_ICON[row.type] || "⚡"} {EVENT_LABEL[row.type] || row.type}</span>
                      <b>{row.commandFile}</b>
                      <em>{row.sender}</em>
                      <strong>×{row.count}</strong>
                    </p>
                  ))}
                </div>
              </section>
            </div>
          </>
        );
      })()}

      {view === "dashboard" && (loading && !latest ? <section className="stats-empty">集計中…</section> : !latest ? (
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
      ))}
    </div>
  );
}
