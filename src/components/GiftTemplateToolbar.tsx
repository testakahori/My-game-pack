import React, { useEffect, useRef, useState } from 'react';
import type { GiftAssignment, GiftTemplatePreview } from '../types/electron';
import { useUnsavedChanges, useUnsavedGuard } from '../UnsavedChanges';

function TemplatePreviewDialog({ preview, busy, error, onClose, onApply }: {
  preview: GiftTemplatePreview; busy: boolean; error: string; onClose: () => void; onApply: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="gift-command-dialog gift-template-dialog panel-studio" aria-labelledby="gift-template-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><span className="studio-eyebrow">GIFT TEMPLATE</span><h2 id="gift-template-title">{preview.name}</h2></div><button type="button" className="studio-icon-button" aria-label="テンプレートの確認を閉じる" disabled={busy} onClick={onClose}><i className="fa-solid fa-xmark" /></button></header>
    <p className="gift-command-intro">現在の{preview.currentCount}件を、このテンプレートの{preview.mappings.length}件に置き換えます。アカウント・接続設定・イベント設定は保持します。</p>
    <div className="gift-template-summary"><b>{preview.mappings.length}件のギフト</b>{preview.appVersion && <span>作成元 v{preview.appVersion}</span>}<span>適用前に自動バックアップ</span></div>
    {preview.missingCommands.length > 0 && <div className="studio-alert" role="alert">このアプリにないコマンドが含まれるため、適用できません。アプリのバージョンや配布元の必要コマンドを確認してください。<ul>{preview.missingCommands.map(file => <li key={file}>{file}</li>)}</ul></div>}
    <div className="gift-template-table-wrap"><table className="gift-template-table"><caption>読み込むギフトの割り当て</caption><thead><tr><th>ギフト</th><th>実行するコマンド</th><th>回数</th></tr></thead><tbody>{preview.mappings.map(row => <tr key={row.giftId} className={preview.missingCommands.includes(row.commandFile) ? 'is-missing' : ''}><td>{row.name}<small>ID: {row.giftId}</small></td><td>{row.title}<small>{row.commandFile}</small></td><td>×{row.repeat}</td></tr>)}</tbody></table></div>
    <p className="panel-hint">一覧にないギフトの既存割り当ては外れます。保存済みの配信画像は変更しません。適用だけではコマンドを実行しません。</p>
    {error && <p className="studio-alert" role="alert">{error}</p>}
    <footer><div><button className="studio-quiet" disabled={busy} onClick={onClose}>キャンセル</button><button className="studio-primary" disabled={busy || preview.missingCommands.length > 0} onClick={onApply}>{busy ? '適用中…' : 'この内容を適用'}</button></div></footer>
  </dialog>;
}

export default function GiftTemplateToolbar({ ready, count, onResetEditor, onApplied }: {
  ready: boolean; count: number; onResetEditor: () => void; onApplied: (mappings: GiftAssignment[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<GiftTemplatePreview | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const busyRef = useRef(false);
  const { confirmDiscard } = useUnsavedGuard();
  useUnsavedChanges(false, busy);
  const start = () => {
    if (busyRef.current || !confirmDiscard()) return false;
    onResetEditor(); busyRef.current = true; setBusy(true); setError(''); setNotice(''); return true;
  };
  const finish = () => { busyRef.current = false; setBusy(false); };
  const save = async () => {
    if (!start()) return;
    try {
      const result = await window.mygamepack.giftTemplateSave();
      if (result.canceled === false) setNotice(`「${result.name}」に${result.count}件を保存しました。このJSONファイルを配布できます。`);
    } catch (e) { setError('テンプレートを保存できませんでした: ' + String((e as Error)?.message || e)); }
    finally { finish(); }
  };
  const open = async () => {
    if (!start()) return;
    try {
      const result = await window.mygamepack.giftTemplateOpen();
      if (result.canceled === false) setPreview(result.preview);
    } catch (e) { setError('テンプレートを読み込めませんでした: ' + String((e as Error)?.message || e)); }
    finally { finish(); }
  };
  const close = () => {
    if (!preview || busyRef.current) return;
    void window.mygamepack.giftTemplateCancel(preview.token).catch(() => {});
    setPreview(null); setError('');
  };
  const apply = async () => {
    if (!preview || busyRef.current || preview.missingCommands.length) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await window.mygamepack.giftTemplateApply(preview.token);
      onApplied(result.mappings);
      setNotice(`「${preview.name}」の${result.mappings.length}件を適用しました。元の設定は運用センターのバックアップから復元できます。`);
      setPreview(null);
    } catch (e) { setError('適用できませんでした: ' + String((e as Error)?.message || e)); }
    finally { finish(); }
  };
  return <section className="gift-template-tools" aria-label="ギフト設定テンプレート">
    <div className="gift-template-toolbar"><div><b><i className="fa-regular fa-folder-open" />ギフト設定テンプレート</b><p>保存済みの割り当てを、ゲーム別に使い分け・配布できます。</p></div><div className="gift-template-actions"><button className="studio-quiet" disabled={!ready || busy || count === 0} onClick={() => void save()}><i className="fa-solid fa-download" />テンプレートを保存</button><button className="studio-primary" disabled={!ready || busy} onClick={() => void open()}><i className="fa-solid fa-folder-open" />テンプレートを読込</button></div></div>
    {count === 0 && <p className="panel-hint">ギフトとコマンドを登録すると、テンプレートとして保存できます。</p>}
    <p className="panel-hint">アカウントやパスワード、コマンドのファイル本体は保存しません。配布先にも同じコマンドが必要です。</p>
    {busy && !preview && <p role="status" className="panel-hint">ファイルの選択・保存中…</p>}
    {notice && <p className="studio-notice" role="status">{notice}</p>}
    {error && !preview && <p className="studio-alert" role="alert">{error}</p>}
    {preview && <TemplatePreviewDialog preview={preview} busy={busy} error={error} onClose={close} onApply={() => void apply()} />}
  </section>;
}
