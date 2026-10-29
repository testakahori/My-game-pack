import React, { useEffect, useState } from 'react';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';
import './GameSelector.css';
import type { GameStatus, MinecraftLocationDiscovery } from '../types/electron';
// 選択肢にサバイバルを出さない（中では「まだゲームを選んでいない状態」として残す。2026-10-29 ユーザーの決定）。
import { gameChoices, gameDirty, savedGame, shownGame } from '../lib/gameChoices';

export default function GameSelector({ onChanged, onStatus }: { onChanged: () => void; onStatus: (status: GameStatus | null) => void }) {
  const [status, setStatus] = useState<GameStatus | null>(null);
  // まだ読み込んでいない（選んだゲームが決まっていない）ときは null。読み込みに失敗したあとも、そのゲームを決め打ちしない（2回目のレビューの軽い1）。
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const { confirmDiscard } = useUnsavedGuard();
  // 新しく入れた人が何も選んでいないときは未保存にしない（採掘などを選べば未保存になる）。
  const dirty = gameDirty(status, selected);
  const guardId = useUnsavedChanges(dirty, busy);
  const [locations, setLocations] = useState<MinecraftLocationDiscovery | null>(null);
  const [folder, setFolder] = useState('');
  const [scanning, setScanning] = useState(false);
  const api = window.mygamepack;
  // 「マップを初期化」は、今のゲームに初期マップ（games.json の maps）があり、保存済みのときに出す（サバイバルには無い。埋め立て PR3）。
  const activeGame = status?.games.find(g => g.id === status.active);
  const canResetMap = Boolean(status && savedGame(status) && activeGame?.maps?.length);
  // ほかのゲームから切り替えたときにマップを初期に戻すゲーム（今は埋め立て）。
  const resetGames = (status?.games || []).filter(g => g.resetMapOnSwitch).map(g => g.name).join('・');
  useEffect(() => {
    let disposed = false;
    api?.gamesList?.().then((next: GameStatus) => { if (!disposed) { setStatus(next); setSelected(shownGame(next)); onStatus(next); } })
      .catch((e: Error) => { if (!disposed) { setError(e.message); onStatus(null); } });
    return () => { disposed = true; };
  }, [onStatus]);
  // アプリの更新に合わせて MOD を入れ替えた（または入れ替えられなかった）ら、ゲームの状態を読み直す（選びかけのゲームはそのまま）。
  useEffect(() => {
    let alive = true;
    const off = api?.onGamesChanged?.(result => {
      api.gamesList().then((next: GameStatus) => { if (!alive) return; setStatus(next); setSelected(current => current ?? shownGame(next)); onStatus(next); }).catch(() => {});
      // 設定は書き換えないので読み直さない（読み直すと画面ごと作り直され、知らせが消える。PR #91 再レビュー）。
      if (result?.state === 'done' && result.changed) setMessage('アプリの更新に合わせて、ゲームのMODを新しい版に入れ替えました。');
    });
    return () => { alive = false; off?.(); };
  }, [onStatus]);
  // 「今すぐ入れ替える」：アプリの更新に合わせた入れ替えをもう一度試す。「保存」と違ってほかの MOD は退避しない。
  async function refreshModsNow() {
    if (busy || scanning) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await api.gamesRefreshMods();
      setStatus(next); setSelected(current => current ?? shownGame(next)); onStatus(next);
      setMessage('ゲームのMODを新しい版に入れ替えました。');
    } catch (e: any) {
      setError(e?.message || String(e));
      try { const next = await api.gamesList(); setStatus(next); setSelected(current => current ?? shownGame(next)); onStatus(next); } catch { /* 表示はそのまま */ }
    }
    finally { setBusy(false); }
  }
  // 「マップを初期化」：今のゲームのマップを初期の状態に戻す。サーバーが動いていたら、確かめの画面より先に理由を出す。
  async function resetMap() {
    if (busy || scanning || !activeGame) return;
    setError(''); setMessage('');
    const server = await api.serverProcessStatus().catch(() => null);
    if (server?.running) { setError('サーバーが動いています。サーバーを止めてから「マップを初期化」を押してください。'); return; }
    if (!window.confirm(`${activeGame.name}のマップを初期の状態に戻します。\n今のマップは消え、元に戻せません。残したいときは、先に「MAPセーブ・ロード」で保存してください。\n初期化しますか？`)) return;
    setBusy(true);
    try {
      const next = await api.gamesResetMap();
      setStatus(next); setSelected(current => current ?? shownGame(next)); onStatus(next);
      setMessage(`${activeGame.name}のマップを初期の状態に戻しました。`);
    } catch (e: any) {
      setError(e?.message || String(e));
      try { const next = await api.gamesList(); setStatus(next); setSelected(current => current ?? shownGame(next)); onStatus(next); } catch { /* 表示はそのまま */ }
    }
    finally { setBusy(false); }
  }
  async function run(action: () => Promise<GameStatus | { canceled: true }>, changed = false, folderChanged = false) {
    if (busy || scanning || !confirmDiscard(guardId)) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await action();
      if ('canceled' in next) return;
      setStatus(next); setSelected(shownGame(next)); onStatus(next);
      setMessage(folderChanged ? '保存先を変更しました。MODを反映するには「保存」を押してください。' : changed ? 'ゲームを保存しました。ギフトや各イベントを設定できます。' : '登録内容を更新しました。');
      if (folderChanged) { setLocations(null); setFolder(''); }
      if (changed) { localStorage.removeItem('mc_tiktok_mappings_unified_v1'); onChanged(); }
    } catch (e: any) {
      setError(e?.message || String(e));
      try { const next = await api.gamesList(); setStatus(next); setSelected(current => current ?? shownGame(next)); onStatus(next); } catch { setStatus(null); onStatus(null); }
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
      <label htmlFor="play-game"><strong>プレイするゲーム</strong>
        <select id="play-game" value={selected ?? ''} disabled={busy || scanning || !status || status.recoveryRequired} onChange={e => setSelected(e.target.value)}>
          {/* ゲームを選ばないと遊べない。何も選んでいないときの見出し（選べない。2026-10-29 ユーザーの決定） */}
          {status && !shownGame(status) && <option value="" disabled>選んでください</option>}
          {(status ? gameChoices(status.games) : [{ id: '', name: '読み込み中', installed: true }]).map(g => <option key={g.id} value={g.id}>{g.name}{!g.installed ? '（未導入）' : ''}</option>)}
        </select>
      </label>
      <button type="button" className="game-selector-apply" disabled={busy || scanning || !game?.installed || status?.recoveryRequired}
        onClick={() => game && run(() => api.gamesActivate(game.id), true)}>{busy ? '処理中…' : '保存'}</button>
    </div>
    {/* いつも出すもの：今の状態・未保存・マップの初期化・知らせ・エラー。説明は下の「くわしく」へ（2026-10-29 ユーザーの決定）。 */}
    {status && <small>{savedGame(status) ? `適用済み：${status.games.find(g => g.id === status.active)?.name}` : 'ゲームが未保存です。ゲームを選んで「保存」を押してください。'} ／ 切替はサーバー・Minecraft・BRIDGEの停止中に行います。</small>}
    {game && !game.installed && <p>このゲームMODはまだ登録されていません。完成したゲームパックを登録してください。</p>}
    {dirty && <p role="status" className="game-selector-pending">ゲームの変更は未保存です。「保存」を押すと選んだゲームへ切り替わります。{game?.resetMapOnSwitch ? `${game.name}に切り替えると、${game.name}のマップは初期の状態から始まります（前に遊んだ${game.name}のマップは消えます）。` : ''}</p>}
    {canResetMap && <div className="game-selector-tools game-selector-map">
      <button type="button" disabled={busy || scanning || status?.recoveryRequired} onClick={resetMap}>マップを初期化</button>
      <span>{activeGame?.name}のマップを、初期の状態に戻します（サーバーを止めてから）。</span>
    </div>}
    {status?.modsOutdatedAfterUpdate && <div role="alert" className="game-selector-pending">
      <p>アプリの更新でMODが古いままです{status.modsRefreshError ? `（理由：${status.modsRefreshError}）` : ''}。サーバーと Minecraft を止めてから「今すぐ入れ替える」を押してください（ほかのMODはそのまま残ります。次にアプリを起動したときも自動で試します）。</p>
      <button type="button" disabled={busy || scanning || status.recoveryRequired} onClick={refreshModsNow}>今すぐ入れ替える</button>
    </div>}
    {status?.saikutuMigrationNeeded && <p role="status">採掘へ移したコマンド（落とし穴・採掘速度上昇など）が、今の割り当てに残っています。{shownGame(status) ? '今のゲームのまま「保存」を押すと' : '採掘などのゲームを選んで「保存」を押すと'}割り当てを整理し、採掘をまだ使っていなければ採掘へ引き継ぎます（すでに採掘の設定があるときは上書きせず、外した割り当ては退避に残ります）。</p>}
    {status?.recoveryRequired && <p role="alert">前回の切替が途中で止まっています。<button type="button" disabled={busy} onClick={() => run(() => api.gamesRecover(), true)}>切替前の状態に戻す</button></p>}
    {error && <p role="alert" className="game-selector-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    <details><summary>くわしく</summary>
      {game?.installed && <p>使用するMOD：BridgeMOD ＋ DisplayMOD（表示）{` ＋ ${game.modName}`}</p>}
      <p>① ゲームを選んで保存 → ② ギフト・いいね・ルーレットなどを設定。ゲームごとに設定を保存し、次回の切替時に読み込みます。</p>
      <p>暗視・アイテムロストなし・昼・晴れは固定です。イベント中のみ時間・天候が一時的に変わります。</p>
      <p>コマンドの実行通知は非表示です。敵モブの自然発生は停止します。動物・魚の自然発生と、ギフト・コマンドでの召喚は有効です。</p>
      <p>ゲーム切替では現在のMODを削除せず退避します。MAPは変更しません{resetGames ? `（${resetGames}に切り替えたときだけ、そのゲームのマップを初期の状態から使います）` : ''}。</p>
    </details>
    <details><summary>Minecraftの保存先を探す・MODの保存先を確認</summary>
      <p>サーバー：{status?.serverMods || '未確認'}<br />Minecraft：{status?.clientMods || '未確認'}</p>
      <p>Minecraftを起動せずに、標準の保存先と公式ランチャーの起動構成から探せます。別のランチャーを使う場合や候補にない場合は、手動で指定してください。</p>
      <p>BridgeMODとDisplayMODはすべてのゲームに標準装備されます。サーバーには、OBS 連携の OBSMOD も配置します（Minecraft 本体には配置しません）。</p>
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
    </details>
  </section>;
}
