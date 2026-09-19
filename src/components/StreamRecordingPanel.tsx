import React, { useEffect, useState } from 'react';
import type { StreamSession } from '../types/electron';

export default function StreamRecordingPanel({ onChanged }: { onChanged?: () => void }) {
  const api = window.mygamepack;
  const [active, setActive] = useState<StreamSession | null>(null);
  const [title, setTitle] = useState('');
  const [endAt, setEndAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let cancelled = false;
    const refresh = () => api.streamSessionStatus().then(result => { if (!cancelled) { setActive(result.active); setLoaded(true); } }).catch(error => { if (!cancelled) setNotice(String(error.message || error)); });
    void refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [api]);
  const record = async (ending: boolean) => {
    if (busy || !loaded) return;
    setBusy(true);
    try {
      if (ending && active) await api.streamSessionEnd(active.id, endAt ? new Date(endAt).toISOString() : undefined);
      else await api.streamSessionStart(title);
      setActive((await api.streamSessionStatus()).active); setEndAt('');
      setNotice(ending ? '配信の終了を記録しました。' : '配信の開始を記録しました。配信が終わったら終了を記録してください。');
      onChanged?.();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <section className="stream-recording-panel" aria-label="配信の開始・終了記録">
    <div><h2>配信の開始・終了を記録</h2><p>実際のLIVE開始・終了に合わせて押してください。TikTokの配信操作は行いません。</p>
      {active ? <p><b>記録中：{active.title || '今回の配信'}</b> / 開始 {new Date(active.startedAt).toLocaleString('ja-JP')}<br />アプリを閉じても記録は残ります。終了を忘れた場合は時刻を指定できます。</p> : <p>現在、記録中の配信はありません。</p>}
    </div>
    <div className="stream-recording-actions">
      {active ? <><label>終了時刻（空欄なら今）<input aria-label="記録する終了時刻" type="datetime-local" step="1" value={endAt} onChange={e => setEndAt(e.target.value)} disabled={busy} /></label><button type="button" disabled={busy} onClick={() => record(true)}>■ 配信終了を記録</button></> : <><label>配信名（任意）<input aria-label="配信名" maxLength={80} value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /></label><button type="button" disabled={!loaded || busy} onClick={() => record(false)}>● 配信開始を記録</button></>}
    </div>
    {notice ? <p role="status">{notice}</p> : null}
  </section>;
}
