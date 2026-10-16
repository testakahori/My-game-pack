import React from 'react';

export default function SaveBar({ dirty, saving, onSave, message }: {
  dirty: boolean; saving: boolean; onSave: () => void;
  message?: { type: 'ok' | 'error'; text: string } | null;
}) {
  const feedback = dirty && message?.type === 'ok' ? null : message;
  return <div className="settings-save-bar" data-dirty={dirty} aria-label="設定の保存">
    <div>
      <strong role="status">{saving ? '設定を保存しています…' : dirty ? '未保存の変更があります' : '変更はありません'}</strong>
      {feedback && <p role={feedback.type === 'error' ? 'alert' : 'status'} className={`save-feedback is-${feedback.type}`}>{feedback.text}</p>}
      {!feedback && <small>保存すると、稼働中のBRIDGEに数秒で反映されます。</small>}
    </div>
    <button type="button" disabled={!dirty || saving} onClick={onSave}>{saving ? '保存中…' : '変更を保存'}</button>
  </div>;
}
