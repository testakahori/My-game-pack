import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StreamRecordingPanel from './StreamRecordingPanel';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';
import './StreamAnalytics.css';

import type { Stream, Stats } from '../types/streamStats';
const number = (value: number | null | undefined) => value == null ? '未取得' : value.toLocaleString('ja-JP');
const duration = (ms: number) => Math.floor(ms / 3600000) + '時間' + Math.floor(ms / 60000) % 60 + '分';
const date = (iso: string) => new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const coins = (r: { coins: number | null; unknownCoinGifts: number | null } | null) => r ? number(r.coins) + (r.unknownCoinGifts ? '＋未取得分' : '') : '未取得';
function Tile({ label, value }: { label: string; value: React.ReactNode }) { return <div className="analytics-tile"><span>{label}</span><strong>{value}</strong></div>; }

function EarningsEditor({ stream, onSaved }: { stream: Stream; onSaved: () => Promise<void> }) {
  const initial = stream.earnings ? String(stream.earnings.amount) : '';
  const [value, setValue] = useState(initial), [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const running = useRef(false);
  useUnsavedChanges(value !== saved, busy);
  const save = async () => {
    if (running.current) return;
    const amount = value.trim() ? Number(value) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 1e9 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001)) { setNotice('0以上の金額を小数2桁までで入力してください。'); return; }
    running.current = true; setBusy(true); setNotice('');
    try { await window.mygamepack.operationsEarningsSave(stream.id, amount); setSaved(value); setNotice('受取額を保存しました。'); await onSaved(); }
    catch (e) { setNotice('保存できませんでした: ' + (e instanceof Error ? e.message : String(e))); }
    finally { running.current = false; setBusy(false); }
  };
  return <section className="analytics-earnings"><div><h3>実際の受取額（任意）</h3><p>TikTokで確認したこの配信の受取額を円で入力。コインからの自動換算は行いません。空欄で保存すると未入力に戻せます。</p></div>
    <label>受取額（円）<input type="number" min="0" max="1000000000" step="0.01" value={value} onChange={e => setValue(e.target.value)} disabled={busy} placeholder="未入力" /></label>
    <button type="button" onClick={save} disabled={busy}>{busy ? '保存中…' : '受取額を保存'}</button><p role="status">{notice}</p></section>;
}

export default function StatsDashboardPage() {
  const [data, setData] = useState<Stats>({ streams: [] });
  const [view, setView] = useState<'history' | 'compare'>('history');
  const [selectedId, setSelectedId] = useState('');
  const [days, setDays] = useState(7), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const guard = useUnsavedGuard();
  const detailPanel = useRef<HTMLElement>(null);
  const mounted = useRef(false), refreshing = useRef(false), exporting = useRef(false);
  useUnsavedChanges(false, busy);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { const result = await window.mygamepack.operationsStreamStats(90); if (mounted.current) { setData(result); setError(''); } }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { refreshing.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); const timer = window.setInterval(refresh, 5000); return () => { mounted.current = false; window.clearInterval(timer); }; }, [refresh]);
  const exportStats = async (id?: string) => {
    if (exporting.current) return;
    exporting.current = true; setBusy(true); setNotice('');
    try { const result = await window.mygamepack.operationsStatsExport(id); if (result.ok) setNotice(result.streams + '配信をMDで保存しました: ' + result.path); }
    catch (e) { setNotice('書き出せませんでした: ' + (e instanceof Error ? e.message : String(e))); }
    finally { exporting.current = false; setBusy(false); }
  };
  const selected = data.streams.find(s => s.id === selectedId) || data.streams[0];
  const comparison = data.comparisons?.find(c => c.days === days);
  const chartStreams = useMemo(() => data.streams.filter(s => s.received).slice(0, 14).reverse(), [data.streams]);
  const chartMax = Math.max(1, ...chartStreams.map(s => s.received?.coins || 0));
  return <div className="page-surface stream-analytics">
    <header className="analytics-header"><div><span className="analytics-eyebrow">LIVE JOURNAL</span><h1>配信統計</h1><p>1回の配信を振り返る。続けた変化を見つける。</p></div><div className="analytics-actions"><button type="button" onClick={() => void refresh()} disabled={loading}>↻ 更新</button><button type="button" className="analytics-primary" onClick={() => void exportStats()} disabled={busy || !data.streams.length}>全履歴をMDで保存</button></div></header>
    <StreamRecordingPanel />
    {error && <p role="alert" className="analytics-alert">統計を読み込めませんでした: {error}</p>}
    {notice && <p role="status">{notice}</p>}
    <nav className="analytics-tabs" aria-label="統計の表示"><button type="button" aria-pressed={view === 'history'} onClick={() => { if (view === 'history' || guard.confirmDiscard()) setView('history'); }}>配信ごとの履歴 <span>{data.streams.length}</span></button><button type="button" aria-pressed={view === 'compare'} onClick={() => { if (view === 'compare' || guard.confirmDiscard()) setView('compare'); }}>7日・30日で比較</button></nav>
    {!data.streams.length ? <section className="analytics-panel"><h2>{loading ? '読み込み中…' : 'まだ配信の記録がありません'}</h2><p>Bridgeを起動してTikTok LIVEに接続すると、自動で1配信ずつ記録します。</p></section> : view === 'history' ? <>
      <section className="analytics-panel analytics-history"><h2>過去の配信もここから選べます</h2><p>受信数は接続中に取得した値です。旧バージョンで未記録の数字は「未取得」と表示します。</p><div className="analytics-table-wrap"><table><thead><tr><th>配信開始（観測）</th><th>接続時間</th><th>ギフト個数</th><th>コイン相当</th><th>いいね数</th><th>受取額（円）</th><th>詳細</th></tr></thead><tbody>{data.streams.map(s => <tr key={s.id} className={selected?.id === s.id ? 'is-selected' : ''}><th scope="row">{date(s.start)}{s.active && <span className="analytics-live">記録中</span>}{s.source !== 'automatic' && <small>過去の{s.source === 'manual' ? '手動' : '推定'}記録</small>}</th><td>{duration(s.durationMs)}</td><td>{number(s.received?.gifts)}</td><td>{coins(s.received)}</td><td>{number(s.received?.likes)}</td><td>{s.earnings ? number(s.earnings.amount) : '未入力'}</td><td><button type="button" aria-label={date(s.start) + 'の配信詳細'} aria-pressed={selected?.id === s.id} onClick={() => { if (selected?.id === s.id || guard.confirmDiscard()) { setSelectedId(s.id); window.requestAnimationFrame(() => detailPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" })); } }}>見る</button></td></tr>)}</tbody></table></div></section>
      {selected && <section ref={detailPanel} className="analytics-panel analytics-detail"><header className="analytics-header"><div><span className="analytics-eyebrow">SELECTED LIVE</span><h2>{date(selected.start)} の配信</h2><p>{selected.active ? '接続を観測中' : date(selected.end) + ' まで観測'} · {duration(selected.durationMs)}</p><small>配信ID: {selected.roomId || '未取得'}</small></div><button type="button" onClick={() => void exportStats(selected.id)} disabled={busy}>この配信をMDで保存</button></header>
        {!selected.received && <p className="analytics-alert">この配信は受信数を記録する前のデータです。コマンド回数からギフト数や売上を推測して埋めることはできません。</p>}
        <div className="analytics-tiles"><Tile label="受信ギフト（個）" value={number(selected.received?.gifts)} /><Tile label="TikTokコイン相当" value={coins(selected.received)} /><Tile label="受信いいね" value={number(selected.received?.likes)} /><Tile label="コメント" value={number(selected.received?.comments)} /><Tile label="フォロー通知" value={number(selected.received?.follows)} /><Tile label="シェア通知" value={number(selected.received?.shares)} /><Tile label="訪問通知" value={number(selected.received?.visits)} /><Tile label="最高同時視聴者" value={selected.viewerSamples ? number(selected.maxViewers) : '未取得'} /></div>
        <p className="analytics-note">コイン相当は受信ギフトの単価 × 個数です。実際の受取額とは異なります。フォロー・シェア・訪問は受信した通知の回数で、純増人数ではありません。</p>
        {selected.received && <><p className="analytics-note">受信集計の開始: {date(selected.received.startedAt)} · 集計対象の接続時間: {duration(selected.received.durationMs)}</p><h3>受け取ったギフト</h3><div className="analytics-table-wrap"><table><thead><tr><th>ギフト</th><th>1個のコイン数</th><th>個数</th><th>コイン相当</th></tr></thead><tbody>{selected.received.giftBreakdown.map((gift, index) => <tr key={gift.id + ':' + index}><th scope="row">{gift.name}</th><td>{number(gift.coinValue)}</td><td>{number(gift.count)}</td><td>{gift.coinValue == null ? '未取得' : number(gift.coins)}</td></tr>)}</tbody></table>{!selected.received.giftBreakdown.length && <p>この配信で受信したギフトはまだありません。</p>}</div></>}
        <EarningsEditor key={selected.id} stream={selected} onSaved={refresh} />
        <details className="analytics-diagnostics"><summary>コマンドの動作記録を見る（売上集計とは別）</summary><p>要求履歴 {number(selected.events)}件 · 成功 {number(selected.succeeded)}件 · 失敗 {number(selected.failed)}件。コマンド履歴は直近30日の保持上限内のみです。</p>{selected.topCommands.map(c => <p key={c.name}>{c.name}：{number(c.count)}回</p>)}</details>
      </section>}
    </> : <section className="analytics-panel"><header className="analytics-header"><div><h2>続けた変化を比較</h2><p>配信の開始日で期間に振り分けます。今回の期間には記録中の配信も含みます。</p></div><label>比較期間 <select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>直近7日 vs その前の7日</option><option value={30}>直近30日 vs その前の30日</option></select></label></header>
      {comparison ? <><p className="analytics-note">受信数あり: 今回 {comparison.current.trackedStreams}/{comparison.current.streams}配信 · 前回 {comparison.previous.trackedStreams}/{comparison.previous.streams}配信。未取得の配信は受信数の合計に含めません。受取額は入力済みの今回 {comparison.current.earningStreams}配信・前回 {comparison.previous.earningStreams}配信の合計です。</p><div className="analytics-table-wrap"><table><thead><tr><th>指標</th><th>直近{days}日</th><th>その前の{days}日</th><th>差分</th></tr></thead><tbody>{([
        ['配信数', 'streams'], ['ギフト個数', 'gifts'], ['コイン相当（単価取得分）', 'coins'], ['いいね数', 'likes'], ['コメント数', 'comments'], ['フォロー通知', 'follows'], ['シェア通知', 'shares'], ['訪問通知', 'visits'], ['受取額（円・入力分）', 'earnings'], ['1時間あたりコイン相当', 'coinsPerHour'],
      ] as const).map(([label, key]) => { const a = comparison.current[key], b = comparison.previous[key]; return <tr key={key}><th scope="row">{label}</th><td>{number(a)}</td><td>{number(b)}</td><td>{a == null || b == null ? '比較不可' : (a - b > 0 ? '+' : '') + number(Math.round((a - b) * 100) / 100)}</td></tr>; })}<tr><th scope="row">接続時間</th><td>{duration(comparison.current.durationMs)}</td><td>{duration(comparison.previous.durationMs)}</td><td>—</td></tr></tbody></table></div>{Boolean(comparison.current.unknownCoinGifts || comparison.previous.unknownCoinGifts) && <p className="analytics-alert">単価を取得できなかったギフトがあります。コイン相当は取得できた分の小計です。</p>}</> : <p>比較データを読み込んでいます。</p>}
      <h3>配信ごとのコイン相当（受信記録のある最新14配信）</h3><div className="analytics-bars" role="img" aria-label="配信ごとのコイン相当。正確な値は各行に表示しています。">{chartStreams.map(s => <div className="analytics-bar-row" key={s.id}><span>{date(s.start)}</span><div><i style={{ width: ((s.received?.coins || 0) / chartMax * 100) + '%' }} /></div><b>{coins(s.received)}</b></div>)}{!chartStreams.length && <p>次回の配信から、ここに推移を表示します。</p>}</div>
    </section>}
  </div>;
}
