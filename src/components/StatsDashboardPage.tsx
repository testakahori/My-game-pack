import React, { useCallback, useEffect, useState } from "react";

type NameCount = { name: string; count: number };
type StreamStat = {
  start: string; end: string; durationMs: number; events: number;
  gift: number; like: number; other: number; succeeded: number; failed: number;
  uniqueSenders: number; topCommands: NameCount[]; topSenders: NameCount[];
};
type StreamStats = {
  gapMinutes: number;
  overall: { streams: number; events: number; gift: number; like: number; other: number; succeeded: number; failed: number };
  streams: StreamStat[];
};

const card = "rounded-2xl border border-gray-700 bg-gray-900/70 p-5";
const GAP_OPTIONS = [30, 60, 90, 120, 180];

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
  const [gap, setGap] = useState(90);
  const [data, setData] = useState<StreamStats>({ gapMinutes: 90, overall: { streams: 0, events: 0, gift: 0, like: 0, other: 0, succeeded: 0, failed: 0 }, streams: [] });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (g: number) => {
    setLoading(true);
    try { setData(await api.operationsStreamStats(g)); }
    catch { /* ignore */ }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { refresh(gap); }, [gap, refresh]);

  const maxGift = Math.max(1, ...data.streams.map((s) => s.gift));
  const o = data.overall;

  return (
    <div className="max-w-6xl space-y-5">
      <div className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">配信統計ダッシュボード</h2>
            <p className="text-xs text-gray-400">イベント履歴を配信ごとに区切って集計します。{data.gapMinutes}分以上途切れたら別配信として扱います。</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-400">配信の区切り</span>
            <select className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-1.5 text-gray-100"
              value={gap} onChange={(e) => setGap(Number(e.target.value))}>
              {GAP_OPTIONS.map((g) => <option key={g} value={g}>{g}分</option>)}
            </select>
            <button className="rounded-lg bg-gray-700 px-3 py-1.5 font-bold" onClick={() => refresh(gap)}>更新</button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <StatTile label="配信数" value={o.streams} />
          <StatTile label="総イベント" value={o.events} />
          <StatTile label="ギフト" value={o.gift} tone="text-pink-300" />
          <StatTile label="いいね" value={o.like} tone="text-cyan-300" />
          <StatTile label="成功率" value={successRate(o.succeeded, o.succeeded + o.failed)} tone="text-emerald-300" />
          <StatTile label="失敗" value={o.failed} tone="text-red-300" />
        </div>
      </div>

      {loading && data.streams.length === 0 ? (
        <div className={`${card} text-center text-sm text-gray-400`}>集計中…</div>
      ) : data.streams.length === 0 ? (
        <div className={`${card} text-center text-sm text-gray-400`}>
          まだイベント履歴がありません。配信するか、運用センターのテストモードでイベントを発火すると集計されます。
        </div>
      ) : (
        <div className="space-y-4">
          {data.streams.map((s, i) => (
            <div key={s.start} className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex items-baseline gap-3">
                  <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs font-bold text-gray-300">
                    配信 #{data.streams.length - i}
                  </span>
                  <span className="text-sm font-bold text-gray-100">{fmtRange(s.start, s.end)}</span>
                </div>
                <span className="text-xs text-gray-500">配信時間 {fmtDuration(s.durationMs)} / 視聴者 {s.uniqueSenders}人</span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                <StatTile label="イベント" value={s.events} />
                <StatTile label="ギフト" value={s.gift} tone="text-pink-300" />
                <StatTile label="いいね" value={s.like} tone="text-cyan-300" />
                <StatTile label="その他" value={s.other} />
                <StatTile label="成功" value={s.succeeded} tone="text-emerald-300" />
                <StatTile label="失敗" value={s.failed} tone={s.failed > 0 ? "text-red-300" : "text-gray-100"} />
              </div>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800" title={`ギフト ${s.gift}`}>
                <div className="h-full bg-gradient-to-r from-pink-500 to-fuchsia-500 transition-all"
                  style={{ width: `${Math.round((s.gift / maxGift) * 100)}%` }} />
              </div>

              <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-gray-500">最多ギフト</div>
                  {s.topCommands.length ? s.topCommands.map((c) => (
                    <div key={c.name} className="flex justify-between text-gray-300">
                      <span className="truncate">{c.name}</span><span className="ml-2 shrink-0 text-gray-400">{c.count}</span>
                    </div>
                  )) : <div className="text-gray-600">—</div>}
                </div>
                <div>
                  <div className="mb-1 text-gray-500">トップギフター</div>
                  {s.topSenders.length ? s.topSenders.map((c) => (
                    <div key={c.name} className="flex justify-between text-gray-300">
                      <span className="truncate">{c.name}</span><span className="ml-2 shrink-0 text-gray-400">{c.count}</span>
                    </div>
                  )) : <div className="text-gray-600">—</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
