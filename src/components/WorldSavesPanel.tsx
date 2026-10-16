import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MapSave } from '../types/electron';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';
import './WorldSavesPanel.css';

export default function WorldSavesPanel({ active }: { active: boolean }) {
  const [saves, setSaves] = useState<MapSave[]>([]);
  const [world, setWorld] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const running = useRef(false);
  const { confirmDiscard } = useUnsavedGuard();
  useUnsavedChanges(false, busy);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const data = await window.mygamepack.worldSavesList(); setSaves(data.saves); setWorld(data.world); setPending(data.recoveryPending); }
    catch (e) { setError(String((e as Error).message || e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  const run = async (saved?: MapSave) => {
    if (running.current || !confirmDiscard()) return;
    if (saved && !window.confirm('「' + saved.name + '」の状態にMAPを戻しますか？\n地形・持ち物・プレイヤーの位置も戻ります。未保存の変更は失われます。残したい場合は先に「保存する」を押してください。\nサーバー稼働中は一度切断され、完了後に再起動します。')) return;
    running.current = true; setBusy(true); setError(''); setNotice(saved ? 'MAPを照合して読み込み中…' : '現在のMAPを保存中…');
    try {
      const result = saved ? await window.mygamepack.worldSavesLoad(saved.id) : await window.mygamepack.worldSavesSave(name);
      setNotice(saved ? '「' + saved.name + '」を読み込みました。' : '「' + result.saved!.name + '」にMAPを保存しました。');
      if (!saved) setName('');
      if (result.restartError) setError('MAP操作は完了しましたが、再起動に失敗しました。ダッシュボードから起動してください。' + result.restartError);
      else if (result.restarted) setNotice(text => text + ' サーバーの起動完了後にMinecraftへ再接続してください。');
      await refresh();
    } catch (e) { setError(String((e as Error).message || e)); setNotice(''); }
    finally { running.current = false; setBusy(false); }
  };
  return <section className="map-saves-panel" aria-labelledby="map-saves-title">
    <header><div><span className="studio-eyebrow">WORLD CHECKPOINTS</span><h2 id="map-saves-title">MAPセーブ・ロード</h2><p>遊ぶ前に名前を付けて保存。壊れた世界も、その時点からもう一度。</p></div><span className="map-world-label">{world || 'MAPを確認中'}</span></header>
    <div className="map-save-new"><label>セーブ名<input aria-label="MAPのセーブ名" maxLength={80} placeholder="例：ダイヤ集め・配信前" value={name} onChange={e => setName(e.target.value)} disabled={busy} /></label><button className="studio-primary" disabled={busy || loading || !world} onClick={() => void run()}>{busy ? '処理中…' : '保存する'}</button></div>
    <p className="panel-hint">「保存する」を押した時だけ、地形・持ち物・各ディメンションをまとめて保存します。名前が空欄なら日時を使います。起動時・読み込み前の自動セーブは行いません。稼働中の操作ではサーバーを一度停止し、完了後に再起動します。</p>
    {pending && <p className="studio-alert">前回のMAP操作が中断されています。次の保存・読込またはサーバー起動時に復旧を試みます。</p>}
    <div className="map-list-heading"><h3>保存したMAP <small>{saves.length}件</small></h3><button className="studio-quiet" disabled={busy || loading} onClick={() => { setError(''); void refresh(); }}>一覧を更新</button></div>
    {!loading && !saves.length && <div className="map-saves-empty">最初のMAPをセーブしておくと、ここからいつでも戻せます。</div>}
    <div className="map-saves-list">{saves.map(saved => <article key={saved.id}><span className="map-save-icon" aria-hidden="true">◇</span><div><b>{saved.name}</b><small>{new Date(saved.createdAt).toLocaleString('ja-JP')} ・ {(saved.bytes / 1048576).toFixed(1)} MB{saved.reason === 'before-load' ? ' ・ 読込前の自動退避' : saved.reason === 'server-start' ? ' ・ 起動前の自動セーブ' : ''}</small></div><button className="studio-quiet" disabled={busy || loading} aria-label={'「' + saved.name + '」をロード'} onClick={() => void run(saved)}>このMAPをロード</button></article>)}</div>
    <p className="panel-hint">保存先：サーバーフォルダーの map-saves。保存したMAPは自動削除しません。ギフト設定は「ギフト設定保存」で別に保存できます。</p>
    {notice && <p role="status" className="studio-notice">{notice}</p>}{error && <p role="alert" className="studio-alert">{error}</p>}
  </section>;
}
