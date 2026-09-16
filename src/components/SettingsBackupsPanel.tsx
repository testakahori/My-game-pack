import React, { useCallback, useEffect, useState } from "react";
import type { SettingsBackup } from "../types/electron";
import { useUnsavedChanges, useUnsavedGuard } from "../UnsavedChanges";

const reasonLabel = (reason: string) => reason === "manual" ? "手動保存" : reason === "before-restore" ? "復元前の自動保存" : "設定変更前の自動保存";
export default function SettingsBackupsPanel({ onRestored }: { onRestored: () => void }) {
  const [rows, setRows] = useState<SettingsBackup[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const { hasChanges, confirmDiscard } = useUnsavedGuard();
  useUnsavedChanges(false, busy);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const list = await window.mygamepack.settingsBackupsList(); setRows(list); setSelected(previous => list.some(row => row.id === previous) ? previous : list[0]?.id || ""); }
    catch { setError("バックアップ一覧を読み込めませんでした。"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const selectedRow = rows.find(row => row.id === selected);
  const create = async () => {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { const row = await window.mygamepack.settingsBackupCreate(); await refresh(); setSelected(row.id); setNotice("現在の保存済み設定をバックアップしました。"); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "バックアップに失敗しました。"); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!selectedRow || busy || !confirmDiscard()) return;
    if (!window.confirm(`${new Date(selectedRow.createdAt).toLocaleString("ja-JP")} の設定に戻します。\n@${selectedRow.username || "未設定"} / ギフト設定 ${selectedRow.mappings}件 / コマンド ${selectedRow.commands}件\n${selectedRow.issues ? `未完成の設定を${selectedRow.issues}項目含みます。復元後に一括チェックで確認してください。\n` : ""}\n現在の設定も復元前に自動保存します。復元しますか？`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await window.mygamepack.settingsBackupRestore(selectedRow.id); onRestored(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "復元に失敗しました。"); await refresh(); }
    finally { setBusy(false); }
  };
  return <section className="safety-panel" aria-labelledby="backups-title">
    <div className="safety-panel-heading"><div><h2 id="backups-title">設定のバックアップと復元</h2><p>ギフト・イベント・読み上げ・運用設定とコマンドを、このPCに保存します。</p></div>
      <button type="button" className="safety-primary" onClick={create} disabled={busy || loading}>{busy ? "処理中…" : "現在の設定を保存"}</button></div>
    <p className="safety-footnote">設定変更前の自動保存は直近30件を保持。手動保存・復元前の保存は残ります。ワールド、接続先、ログイン情報は復元対象に含まれません。後から追加したコマンドは残ります。</p>
    {hasChanges && !busy && <p className="safety-warning">未保存の編集はバックアップに含まれません。残す場合は先に設定を保存してください。</p>}
    <div className="backup-controls">
      <label>復元するバックアップ<select value={selected} disabled={busy || loading || !rows.length} onChange={e => setSelected(e.target.value)}>
        {!rows.length && <option value="">{loading ? "読み込み中…" : "バックアップはまだありません"}</option>}
        {rows.map(row => <option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString("ja-JP")} · {reasonLabel(row.reason)} · ギフト{row.mappings}件</option>)}
      </select></label>
      <button type="button" onClick={refresh} disabled={busy || loading}>一覧を更新</button>
      <button type="button" className="safety-restore" onClick={restore} disabled={busy || loading || !selectedRow}>この設定に戻す</button>
    </div>
    {selectedRow && <p className="safety-footnote">@{selectedRow.username} / ギフト{selectedRow.mappings}件 / コマンド{selectedRow.commands}件 / 読み上げ{selectedRow.ttsEnabled ? "有効" : "無効"} / v{selectedRow.version} — 復元前にBridgeを停止してください。</p>}
    {selectedRow && selectedRow.issues > 0 && <p className="safety-warning">未完成の設定を{selectedRow.issues}項目含みます。復元後に配信前チェックで確認できます。</p>}
    <div aria-live="polite">{notice && <p className="safety-success">{notice}</p>}{error && <p className="safety-error" role="alert">{error}</p>}</div>
  </section>;
}
