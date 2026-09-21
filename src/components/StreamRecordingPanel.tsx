import React, { useEffect, useState } from 'react';
import type { StreamSession } from '../types/electron';
export default function StreamRecordingPanel() {
  const [active, setActive] = useState<StreamSession | null>(null);
  const [monitoring, setMonitoring] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const refresh = () => window.mygamepack.streamSessionStatus().then(result => {
      if (!cancelled) { setActive(result.active); setMonitoring(Boolean(result.monitoring)); setError(result.error || ''); setLoaded(true); }
    }).catch(e => { if (!cancelled) { setError(String(e.message || e)); setLoaded(true); } });
    void refresh(); const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return <section className="stream-recording-panel" aria-label="配信の自動記録">
    <div><h2>配信は自動で記録します</h2><p>TikTokへ接続すると配信ごとに記録を開始し、終了を検知すると閉じます。同じ配信への再接続は、同じ記録にまとまります。</p>
      <p role="status"><b>{!loaded ? '確認中…' : error ? '記録状態を確認できません' : active ? '● 自動記録中 / ' + new Date(active.startedAt).toLocaleString('ja-JP') + ' から観測' : monitoring ? 'TikTokの接続を待っています' : '待機中：ダッシュボードからTikTokへ接続してください'}</b></p>
      <p>記録できるのは接続中の区間です。接続前・切断中・アプリ停止中の時間は含みません。配信そのものの開始・終了操作はTikTok LIVE STUDIOで行ってください。</p>
      {error && <p role="alert">{error}</p>}
    </div>
  </section>;
}
