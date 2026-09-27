import { useEffect, useId, useRef, useState } from 'react';
import { useUnsavedChanges } from '../UnsavedChanges';
import type { EulerSettingsStatus } from '../types/electron';
import './EulerApiKeySettings.css';

export default function EulerApiKeySettings({ bridgeRunning, bridgePid }: { bridgeRunning: boolean; bridgePid?: number | null }) {
  const [status, setStatus] = useState<EulerSettingsStatus | null>(null);
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const revision = useRef(0);
  const id = useId();
  useUnsavedChanges(Boolean(key), busy);

  useEffect(() => {
    const current = ++revision.current;
    void window.mygamepack.eulerStatus().then(value => {
      if (revision.current === current) setStatus(value);
    }).catch(() => { if (revision.current === current) setError('APIキーの設定状態を取得できませんでした。'); });
    return () => { revision.current += 1; };
  }, [bridgeRunning, bridgePid]);

  async function run(action: 'save' | 'clear' | 'restart') {
    if (locked.current) return;
    if (action === 'clear' && !window.confirm('このPCに保存したEuler Stream APIキーを削除しますか？')) return;
    if (action === 'restart' && !window.confirm('BRIDGEを再起動してAPIキーの変更を適用します。TikTok接続が一時的に切れます。続けますか？')) return;
    locked.current = true;
    revision.current += 1;
    setBusy(true); setError(''); setMessage('');
    try {
      let next: EulerSettingsStatus;
      if (action === 'restart') {
        await window.mygamepack.bridgeRestart();
        next = await window.mygamepack.eulerStatus();
      } else {
        next = action === 'save' ? await window.mygamepack.eulerSave(key) : await window.mygamepack.eulerClear();
        setKey(''); setVisible(false);
      }
      setStatus(next);
      setMessage(action === 'save' ? '保存しました。キーの有効性は接続時に確認されます。' : action === 'clear' ? '保存したキーを削除しました。' : 'BRIDGEを再起動しました。接続状態をご確認ください。');
    } catch (caught) {
      // Never render IPC errors that might contain an entered credential.
      setError(action === 'restart' ? '再起動できませんでした。BRIDGEの状態を確認してください。' : '設定を変更できませんでした。入力内容と、アプリの保存先・暗号化の状態を確認してください。');
      console.error('Euler settings operation failed:', action, caught instanceof Error ? caught.name : 'Error');
    } finally { locked.current = false; setBusy(false); }
  }

  return <details className="euler-settings">
    <summary>Euler Stream APIキー <span>{status?.configured ? '設定済み' : '任意'}</span></summary>
    <p>無料枠のAPIキーを利用できます。利用上限はEuler Streamのプランに従います。</p>
    <button type="button" className="euler-link" onClick={() => void window.mygamepack.eulerOpenPortal().catch(() => setError('Euler Streamのページを開けませんでした。'))}>公式サイトでキーを取得 ↗</button>
    <label htmlFor={id}>APIキー {status?.configured ? '（変更する場合に入力）' : ''}</label>
    <div className="euler-input">
      <input id={id} type={visible ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={key} disabled={busy || !status?.storageAvailable} onChange={event => setKey(event.target.value)} placeholder={status?.configured ? '保存済みのキーは表示しません' : '取得したAPIキーを貼り付け'} />
      <button type="button" disabled={busy} aria-pressed={visible} onClick={() => setVisible(value => !value)}>{visible ? '隠す' : '表示'}</button>
    </div>
    <div className="euler-actions">
      <button type="button" disabled={busy || !status?.storageAvailable || !key.trim()} onClick={() => void run('save')}>{busy ? '処理中…' : 'キーを保存'}</button>
      {status?.configured && <button type="button" disabled={busy} onClick={() => void run('clear')}>削除</button>}
    </div>
    <small>キーはこのPCで暗号化して保存します。設定のバックアップやギフト設定の書き出しには含みません。</small>
    {status && !status.storageAvailable && <p role="alert">暗号化を利用できません。アプリを再起動してお試しください。</p>}
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    {message && <p role="status">{message}</p>}
    {status?.restartRequired && <div className="euler-restart"><p>稼働中のBRIDGEへ反映するには再起動が必要です。配信状態の確認・ギフト一覧の更新には保存後すぐに適用されます。</p><button type="button" disabled={busy} onClick={() => void run('restart')}>BRIDGEを再起動して適用</button></div>}
  </details>;
}
