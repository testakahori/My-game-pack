import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type MediaAsset = { id: string; name: string; ext: string; kind: 'image' | 'audio' | 'video'; size: number };
export type MediaRule = { id: string; name: string; enabled: boolean; trigger: 'likes' | 'gift' | 'coins'; threshold: number; giftId: string; coinMode: 'unit' | 'streak'; visualId: string; audioId: string; x: number; y: number; width: number; volume: number; duration: number; cooldown: number };
export type MediaProfile = { id: string; name: string; volume: number; rules: MediaRule[] };
export type MediaSettings = { version: number; activeProfile: string; assets: MediaAsset[]; profiles: MediaProfile[] };
export type MediaState = { connection?: { state: string; username: string; mode: string }; settings: MediaSettings; revision: number; canUndo: boolean; paused: boolean; muted: boolean; liveClients: number; previewClients: number; playing: string; previewPlaying: string; queued: number; error: string; ready: boolean; calibrated: boolean; lastEvent: { type: string; at: string } | null; checks: { visual: { at: string; profile: string } | null; audio: { at: string; profile: string } | null } };
type MediaContextValue = { state: MediaState | null; busy: boolean; error: string; notice: string; run: (operation: () => Promise<unknown>, notice?: string) => Promise<boolean>; emergency: (action: string) => Promise<void>; dirty: boolean; setDirty: (value: boolean) => void; discard: number; undo: () => void };
const MediaContext = createContext<MediaContextValue | null>(null);
export const useMediaEffects = () => { const value = useContext(MediaContext); if (!value) throw new Error('MediaEffectsProvider missing'); return value; };

export function MediaEffectsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<MediaState | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false), [discard, setDiscard] = useState(0);
  const lock = useRef(false), generation = useRef(0);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      if (lock.current || !window.mygamepack.effectsState) return;
      const seq = generation.current;
      try { const result = await window.mygamepack.effectsState(); if (!disposed && !lock.current && seq === generation.current) setState(result); }
      catch { if (!disposed) setError('演出の状態を取得できません。アプリを再起動してください。'); }
    };
    void refresh(); const timer = window.setInterval(refresh, 1500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const run = useCallback(async (operation: () => Promise<unknown>, message = '') => {
    if (lock.current) return false;
    lock.current = true; generation.current++; setBusy(true); setError(''); setNotice('');
    try { await operation(); setState(await window.mygamepack.effectsState()); setNotice(message); return true; }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '操作に失敗しました。'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, []);
  const undo = () => { if (dirty) { setDiscard(value => value + 1); setNotice('編集中の演出設定を元に戻しました。'); } else void run(() => window.mygamepack.effectsControl('undo'), '直前の演出設定に戻しました。'); };
  const emergency = async (action: string) => { generation.current++; try { setState(await window.mygamepack.effectsControl(action)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '停止操作に失敗しました。'); } };
  return <MediaContext.Provider value={{ state, busy, error, notice, run, emergency, dirty, setDirty, discard, undo }}>{children}</MediaContext.Provider>;
}

export function MediaSafetyBar({ onOpen }: { onOpen: () => void }) {
  const { state, busy, emergency, error, notice, dirty, undo } = useMediaEffects();
  return <div className="media-safety" aria-label="演出の常設コントロール">
    <div className="media-safety-row"><button type="button" onClick={onOpen} className="media-open"><span className={state?.liveClients ? 'media-led on' : 'media-led'} />演出 <b>{state?.settings.profiles.find(p => p.id === state.settings.activeProfile)?.name || '準備中'}</b></button>
      <span className="media-output-state">{state?.paused ? '一時停止中' : state?.playing || (state?.liveClients ? 'OBS出力 接続中' : 'OBS出力 未接続')}</span>
      <button type="button" className="media-danger" onClick={() => void emergency('stop')}>■ 演出を全停止</button>
      <button type="button" aria-pressed={state?.muted || false} onClick={() => void emergency(state?.muted ? 'unmute' : 'mute')}>{state?.muted ? '音声停止中・解除' : '音声を全停止'}</button>
      <button type="button" aria-pressed={state?.paused || false} onClick={() => void emergency(state?.paused ? 'resume' : 'pause')}>{state?.paused ? '▶ 演出を再開' : 'Ⅱ 演出を一時停止'}</button>
      <button type="button" disabled={busy || (!dirty && !state?.canUndo)} onClick={undo}>↶ 演出設定を元に戻す</button>
    </div>
    {(error || state?.error || notice) && <p className={error || state?.error ? 'media-error' : 'media-notice'} role={error || state?.error ? 'alert' : 'status'}>{error || state?.error || notice}</p>}
  </div>;
}
