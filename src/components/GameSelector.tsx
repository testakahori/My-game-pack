import React, { useEffect, useRef, useState } from 'react';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';
import './GameSelector.css';
import type { GameStatus, MinecraftLocationDiscovery } from '../types/electron';

export default function GameSelector({ onChanged, onStatus }: { onChanged: () => void; onStatus: (status: GameStatus | null) => void }) {
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [selected, setSelected] = useState('common');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { confirmDiscard } = useUnsavedGuard();
  const dirty = Boolean(status && selected !== status.active);
  const guardId = useUnsavedChanges(dirty, busy);
  const [locations, setLocations] = useState<MinecraftLocationDiscovery | null>(null);
  const [folder, setFolder] = useState('');
  const [scanning, setScanning] = useState(false);
  const api = window.mygamepack;
  useEffect(() => {
    let disposed = false;
    api?.gamesList?.().then((next: GameStatus) => { if (!disposed) { setStatus(next); setSelected(next.active); onStatus(next); } })
      .catch((e: Error) => { if (!disposed) { setError(e.message); onStatus(null); } });
    return () => { disposed = true; };
  }, [onStatus]);
  // App は描画のたびに onChanged を作り直すので、知らせの受け取りを毎回やり直さないよう最新の関数を覚えておく。
  const onChangedRef = useRef(onChanged); onChangedRef.current = onChanged;
  // アプリの更新に合わせて MOD を入れ替えた（または入れ替えられなかった）ら、ゲームの状態を読み直す（選びかけのゲームはそのまま）。
  useEffect(() => {
    let alive = true;
    const off = api?.onGamesChanged?.(result => {
      api.gamesList().then((next: GameStatus) => { if (!alive) return; setStatus(next); onStatus(next); }).catch(() => {});
      // 入れ替えたら、「保存」と同じく割り当ての一時保存を消して設定を読み直し、知らせる（コマンドが増えることがある）。
      if (result?.state === 'done' && result.changed) {
        localStorage.removeItem('mc_tiktok_mappings_unified_v1'); onChangedRef.current();
        setMessage('アプリの更新に合わせて、ゲームのMODを新しい版に入れ替えました。');
      }
    });
    return () => { alive = false; off?.(); };
  }, [onStatus]);
  async function run(action: () => Promise<GameStatus | { canceled: true }>, changed = false, folderChanged = false) {
    if (busy || scanning || !confirmDiscard(guardId)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await action();
      if ('canceled' in next) return;
      setStatus(next); setSelected(next.active); onStatus(next);
      setMessage(folderChanged ? '保存先を変更しました。MODを反映するには「保存」を押してください。' : changed ? 'ゲームを保存しました。ギフトや各イベントを設定できます。' : '登録内容を更新しました。');
      if (folderChanged) { setLocations(null); setFolder(''); }
      if (changed) { localStorage.removeItem('mc_tiktok_mappings_unified_v1'); onChanged(); }
    } catch (e: any) {
      setError(e?.message || String(e));
      try { const next = await api.gamesList(); setStatus(next); onStatus(next); } catch { setStatus(null); onStatus(null); }
    }
    finally { setBusy(false); }
  }
  async function scanFolders() {
    if (busy || scanning) return;
    setScanning(true); setError(''); setMessage('');
    try {
      const result = await api.gamesClientFolders();
      setLocations(result);
      setFolder(result.candidates.find(candidate => candidate.current && candidate.selectable)?.path || '');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setScanning(false); }
  }
  const chosenFolder = locations?.candidates.find(candidate => candidate.path === folder);
  const game = status?.games.find(g => g.id === selected);
  return <section className="game-selector" aria-label="プレイするゲーム">
    <div className="game-selector-main">
      <label htmlFor="play-game"><strong>どのゲームをプレイしますか？</strong>
        <select id="play-game" value={selected} disabled={busy || scanning || !status || status.recoveryRequired} onChange={e => setSelected(e.target.value)}>
          {(status?.games || [{ id: 'common', name: '読み込み中', installed: false }]).map(g => <option key={g.id} value={g.id}>{g.name}{!g.installed ? '（未導入）' : ''}</option>)}
        </select>
      </label>
      <button type="button" className="game-selector-apply" disabled={busy || scanning || !game?.installed || status?.recoveryRequired}
        onClick={() => run(() => api.gamesActivate(selected), true)}>{busy ? '処理中…' : '保存'}</button>
    </div>
    <p>{game?.installed ? `使用するMOD：BridgeMOD ＋ DisplayMOD（表示）${selected === 'common' ? '' : ` ＋ ${game.modName}`}` : 'このゲームMODはまだ登録されていません。完成したゲームパックを登録してください。'}</p>
    <p>① ゲームを選んで保存 → ② ギフト・いいね・ルーレットなどを設定。ゲームごとに設定を保存し、次回の切替時に読み込みます。</p>
    {dirty && <p role="status" className="game-selector-pending">ゲームの変更は未保存です。「保存」を押すと選んだゲームへ切り替わります。</p>}
    <p>暗視・アイテムロストなし・昼・晴れは固定です。イベント中のみ時間・天候が一時的に変わります。</p>
    <p>コマンドの実行通知は非表示です。敵モブの自然発生は停止します。動物・魚の自然発生と、ギフト・コマンドでの召喚は有効です。</p>
    {status && <small>{status.applied ? `適用済み：${status.games.find(g => g.id === status.active)?.name}` : 'ゲームが未保存です。ゲームを選んで「保存」を押してください。'} ／ 切替はサーバー・Minecraft・BRIDGEの停止中に行います。</small>}
    {status?.modsOutdatedAfterUpdate && <p role="alert">アプリの更新でMODが古いままです。サーバーと Minecraft を止めて「保存」を押してください。{status.modsRefreshError ? `（理由：${status.modsRefreshError}）` : ''}</p>}
    {status?.saikutuMigrationNeeded && <p role="status">採掘へ移したコマンド（落とし穴・採掘速度上昇など）が、今の割り当てに残っています。今のゲームのまま「保存」を押すと割り当てを整理し、採掘をまだ使っていなければ採掘へ引き継ぎます（すでに採掘の設定があるときは上書きせず、外した割り当ては退避に残ります）。</p>}
    <details><summary>Minecraftの保存先を探す・MODの保存先を確認</summary>
      <p>サーバー：{status?.serverMods || '未確認'}<br />Minecraft：{status?.clientMods || '未確認'}</p>
      <p>Minecraftを起動せずに、標準の保存先と公式ランチャーの起動構成から探せます。別のランチャーを使う場合や候補にない場合は、手動で指定してください。</p>
      <p>BridgeMODとDisplayMODはすべてのゲームに標準装備されます。サバイバルでは、この2つだけを配置します。</p>
      <div className="game-selector-tools">
        <button type="button" disabled={busy || scanning || !status || status.recoveryRequired} onClick={() => run(() => api.gamesInstall())}>ゲームパックを登録</button>
        <button type="button" disabled={busy || scanning || !status || status.recoveryRequired} onClick={scanFolders}>{scanning ? '候補を確認中…' : locations ? '候補を再検索' : 'Minecraftの保存先を自動検出'}</button>
        <button type="button" disabled={busy || scanning || !status || status.recoveryRequired} onClick={() => run(() => api.gamesClientFolder(), false, true)}>手動で指定</button>
      </div>
      {scanning && <p role="status">標準保存先とランチャーの起動構成を確認しています…</p>}
      {locations && <div className="minecraft-locations">
        <p>普段使う起動構成を確認して、Minecraftの保存先を選んでください。「Forge 1.20.1」は対応する起動構成を確認できた候補です。</p>
        <fieldset disabled={busy || scanning || status?.recoveryRequired}>
          <legend>見つかった保存先（{locations.candidates.length}件）</legend>
          {locations.candidates.map(candidate => <label key={candidate.path} className={['minecraft-location-option', folder === candidate.path ? 'is-selected' : '', !candidate.selectable ? 'is-unavailable' : ''].join(' ')}>
            <input type="radio" name="minecraft-folder" value={candidate.path} checked={folder === candidate.path} disabled={!candidate.selectable} onChange={() => setFolder(candidate.path)} />
            <span className="minecraft-location-info">
              <span className="minecraft-location-heading">{candidate.sources.join(' / ')}{candidate.current && <span className="minecraft-location-badge">現在の保存先</span>}{candidate.recommended && <span className="minecraft-location-badge is-forge">Forge 1.20.1</span>}</span>
              <span className="minecraft-location-path">{candidate.path}</span>
              {candidate.profiles.map((profile, index) => <span className="minecraft-location-profile" key={index}>起動構成：{profile.name} ／ {profile.version}</span>)}
              {!candidate.profiles.length && <span className="minecraft-location-profile">起動構成は確認できませんでした。</span>}
              {candidate.reason && <span className="minecraft-location-warning">{candidate.reason}</span>}
            </span>
          </label>)}
        </fieldset>
        {!locations.candidates.some(candidate => candidate.selectable) && <p role="status">使用できる保存先が見つかりませんでした。Minecraft Launcherの起動構成を確認するか、「手動で指定」を使ってください。</p>}
        {locations.warnings.map(warning => <p key={warning} className="minecraft-location-warning">{warning}</p>)}
        <p>保存先を選ぶ操作では、MODやMAPは変更しません。MODの配置は「保存」で行います。</p>
        <div className="game-selector-tools">
          <button type="button" className="game-selector-apply" disabled={busy || scanning || !chosenFolder?.selectable || chosenFolder.current || status?.recoveryRequired} onClick={() => run(() => api.gamesSelectClientFolder(folder), false, true)}>この保存先を使う</button>
          {chosenFolder?.current && <span className="minecraft-location-current">この保存先を使用中です。</span>}
        </div>
      </div>}
      <p>ゲーム切替では現在のMODを削除せず退避します。MAPは変更しません。</p>
    </details>
    {status?.recoveryRequired && <p role="alert">前回の切替が途中で止まっています。<button type="button" disabled={busy} onClick={() => run(() => api.gamesRecover(), true)}>切替前の状態に戻す</button></p>}
    {error && <p role="alert" className="game-selector-error">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
