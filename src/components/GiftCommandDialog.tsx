import React, { useEffect, useRef, useState } from 'react';
import type { GiftAssignment } from '../types/electron';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';

type Command = { name: string; title: string; category: string; description?: string };
export default function GiftCommandDialog({ giftId, giftName, hasCards, onClose, onSaved }: {
  giftId: string; giftName: string; hasCards: boolean; onClose: () => void;
  onSaved: (mappings: GiftAssignment[], command: Command, repeat: number, syncImage: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [commands, setCommands] = useState<Command[]>([]);
  const [expected, setExpected] = useState<GiftAssignment[]>([]);
  const [commandFile, setCommandFile] = useState('');
  const [repeat, setRepeat] = useState('1');
  const [baseline, setBaseline] = useState({ commandFile: '', repeat: '1' });
  const [syncImage, setSyncImage] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [retry, setRetry] = useState(0);
  const savingRef = useRef(false);
  const dirty = commandFile !== baseline.commandFile || repeat !== baseline.repeat;
  useUnsavedChanges(dirty, saving);
  const { confirmDiscard } = useUnsavedGuard();
  const command = commands.find(c => c.name === commandFile);
  const count = Number(repeat);
  const validCount = repeat.trim() !== '' && Number.isInteger(count) && count >= 1 && count <= 100;
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    let canceled = false;
    setLoading(true); setLoadError('');
    Promise.all([window.mygamepack.configRead(), window.mygamepack.bridgeCommandsReadMeta()]).then(([config, meta]) => {
      if (canceled) return;
      const rows = (config.mappings || []).filter(row => String(row.giftId) === giftId);
      if (rows.length > 1) throw new Error('このギフトが重複登録されています。ギフト設定で重複を解消してください。');
      const next = { commandFile: rows[0]?.commandFile || '', repeat: String(rows[0]?.repeat ?? 1) };
      setExpected(rows); setCommands(meta.filter(c => !c.name.startsWith('_'))); setCommandFile(next.commandFile); setRepeat(next.repeat); setBaseline(next);
    }).catch(e => { if (!canceled) setLoadError(String(e?.message || e)); }).finally(() => { if (!canceled) setLoading(false); });
    return () => { canceled = true; };
  }, [giftId, retry]);
  const close = () => { if (!savingRef.current && (!dirty || confirmDiscard())) onClose(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || loading || loadError || !command || !validCount) return;
    savingRef.current = true; setSaving(true); setSaveError('');
    try {
      const result = await window.mygamepack.configGiftMappingSave({ giftId, name: expected[0]?.name || giftName, commandFile, repeat: count, expected });
      onSaved(result.mappings, command, count, hasCards && syncImage);
    } catch (e) { setSaveError('保存できませんでした: ' + String((e as Error)?.message || e)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <dialog ref={dialog} className="gift-command-dialog" aria-labelledby="gift-command-title" onCancel={e => { e.preventDefault(); close(); }}>
    <form onSubmit={event => void save(event)}>
      <header><div><span className="studio-eyebrow">GIFT × COMMAND</span><h2 id="gift-command-title">{giftName}のコマンド設定</h2></div><button type="button" className="studio-icon-button" aria-label="コマンド設定を閉じる" disabled={saving} onClick={close}><i className="fa-solid fa-xmark" /></button></header>
      <p className="gift-command-intro">このギフトを受け取ったときに、Minecraftで実行する内容です。</p>
      {loading ? <p role="status">設定を読み込み中…</p> : loadError ? <div className="studio-alert" role="alert">{loadError}<button type="button" onClick={() => setRetry(n => n + 1)}>再読み込み</button></div> : <>
        <fieldset disabled={saving}>
          <label className="panel-field"><span>実行するコマンド</span><select aria-label="実行するコマンド" autoFocus value={commandFile} required onChange={e => setCommandFile(e.target.value)}>
            <option value="">コマンドを選択</option>
            {commandFile && !command && <option value={commandFile} disabled>見つからないコマンド: {commandFile}</option>}
            {[...new Set(commands.map(c => c.category || 'その他'))].map(category => <optgroup key={category} label={category}>{commands.filter(c => (c.category || 'その他') === category).map(c => <option key={c.name} value={c.name}>{c.title}</option>)}</optgroup>)}
          </select></label>
          {command?.description && <p className="gift-command-description">{command.description}</p>}
          {!commands.length && <p role="alert">コマンドがありません。初期セットアップを確認してください。</p>}
          <label className="panel-field"><span>ギフト1個あたりの実行回数</span><input type="number" min="1" max="100" step="1" required value={repeat} onChange={e => setRepeat(e.target.value)} /></label>
          <p className="panel-hint">1〜100回。連続で贈られたギフトは、その個数分実行します。</p>
          {hasCards && <label className="panel-check"><input type="checkbox" checked={syncImage} onChange={e => setSyncImage(e.target.checked)} />この画像の効果名・回数も更新</label>}
          {hasCards && <p className="panel-hint">編集中の画像にある同じギフトへ反映します。色と配置は保ちます。</p>}
        </fieldset>
        <div className="gift-command-summary"><span>{giftName}</span><i className="fa-solid fa-arrow-right" /><b>{command?.title || '未選択'} {validCount ? `×${count}` : ''}</b></div>
      </>}
      {saveError && <p className="studio-alert" role="alert">{saveError}</p>}
      <footer><small>保存すると、ギフト設定にも反映されます。</small><div><button type="button" className="studio-quiet" disabled={saving} onClick={close}>キャンセル</button><button type="submit" className="studio-primary" disabled={loading || saving || Boolean(loadError) || !command || !validCount}>{saving ? '保存中…' : 'コマンド設定を保存'}</button></div></footer>
    </form>
  </dialog>;
}
