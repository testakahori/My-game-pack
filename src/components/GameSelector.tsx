import React, { useEffect, useState } from 'react';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';
import './GameSelector.css';

type GameStatus = { active: string; applied: boolean; serverMods: string; clientMods: string; recoveryRequired: boolean;
  games: { id: string; name: string; modName: string; installed: boolean }[] };

export default function GameSelector({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [selected, setSelected] = useState('common');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { confirmDiscard } = useUnsavedGuard();
  useUnsavedChanges(false, busy);
  const api = (window as any).mygamepack;
  useEffect(() => {
    let disposed = false;
    api?.gamesList?.().then((next: GameStatus) => { if (!disposed) { setStatus(next); setSelected(next.active); } })
      .catch((e: Error) => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, []);
  async function run(action: () => Promise<any>, changed = false) {
    if (busy || !confirmDiscard()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await action();
      if (next.canceled) return;
      setStatus(next); setSelected(next.active);
      setMessage(changed ? '両方のMODフォルダとゲームの設定を切り替えました。' : '登録内容を更新しました。');
      if (changed) { localStorage.removeItem('mc_tiktok_mappings_unified_v1'); onChanged(); }
    } catch (e: any) {
      setError(e?.message || String(e));
      try { setStatus(await api.gamesList()); } catch { /* Keep the original error visible. */ }
    }
    finally { setBusy(false); }
  }
  const game = status?.games.find(g => g.id === selected);
  return <section className="game-selector" aria-label="プレイするゲーム">
    <div className="game-selector-main">
      <label htmlFor="play-game"><strong>どのゲームをプレイしますか？</strong>
        <select id="play-game" value={selected} disabled={busy || !status || status.recoveryRequired} onChange={e => setSelected(e.target.value)}>
          {(status?.games || [{ id: 'common', name: '読み込み中', installed: false }]).map(g => <option key={g.id} value={g.id}>{g.name}{!g.installed ? '（未導入）' : ''}</option>)}
        </select>
      </label>
      <button type="button" className="game-selector-apply" disabled={busy || !game?.installed || status?.recoveryRequired}
        onClick={() => run(() => api.gamesActivate(selected), true)}>{busy ? '処理中…' : 'このゲームに切り替える'}</button>
    </div>
    <p>{game?.installed ? `使用するMOD：${selected === 'common' ? 'BridgeMOD' : `BridgeMOD ＋ ${game.modName}`}` : 'このゲームMODはまだ登録されていません。完成したゲームパックを登録してください。'}</p>
    <p>暗視・アイテムロストなし・昼・晴れは固定です。イベント中のみ時間・天候が一時的に変わります。</p>
    {status && <small>{status.applied ? `適用済み：${status.games.find(g => g.id === status.active)?.name}` : 'この保存先へのMOD切替はまだ行っていません。'} ／ 切替はサーバー・Minecraft・BRIDGEの停止中に行います。</small>}
    <details><summary>MODの保存先・ゲームパックの登録</summary>
      <p>サーバー：{status?.serverMods || '未確認'}<br />Minecraft：{status?.clientMods || '未確認'}</p>
      <p>現在のMODは削除せず退避します。MAPは変更しません。Minecraftの起動構成で別のゲームフォルダを指定している場合は、その保存先を選んでください。</p>
      <div className="game-selector-tools">
        <button type="button" disabled={busy || !status || status.recoveryRequired} onClick={() => run(() => api.gamesInstall())}>ゲームパックを登録</button>
        <button type="button" disabled={busy || !status || status.recoveryRequired} onClick={() => run(() => api.gamesClientFolder())}>Minecraftの保存先を選ぶ</button>
      </div>
    </details>
    {status?.recoveryRequired && <p role="alert">前回の切替が途中で止まっています。<button type="button" disabled={busy} onClick={() => run(() => api.gamesRecover(), true)}>切替前の状態に戻す</button></p>}
    {error && <p role="alert" className="game-selector-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
