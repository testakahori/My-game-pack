import { useEffect, useId, useRef, useState } from "react";
import { useUnsavedChanges } from "../UnsavedChanges";
import { ipcErrorMessage } from "../lib/ipcError";
import type { ObsSendStatus } from "../types/electron";

// 運用センターの「動作設定」の「OBS 連携」の欄の中身（枠と見出しは OperationsPage）。標準装備の OBSMOD が、サーバーで起きたこと
// （ゲームのイベントの始まり・終わりなど）を OBS 用のツールへ送るかを決める。はじめはオフ（2026-10-25 ユーザーの決定）。
// 保存はアプリの設定とサーバーの obs-send.properties（electron/obs_ipc.cjs）。OBSMOD はサーバーの起動のときに読むので、
// サーバーが動いている間に保存したら、次の起動で効くと知らせる。
export default function ObsIntegrationSettings() {
  const [saved, setSaved] = useState<ObsSendStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const endpointId = useId();
  const dirty = saved !== null && (enabled !== saved.enabled || endpoint.trim() !== saved.endpoint);
  useUnsavedChanges(dirty, busy);

  const show = (status: ObsSendStatus) => { setSaved(status); setEnabled(status.enabled); setEndpoint(status.endpoint); };

  useEffect(() => {
    let alive = true;
    const api = window.mygamepack;
    void api.obsGet().then(status => { if (alive) show(status); }).catch(() => { if (alive) setError("OBS 連携の設定を読めませんでした。"); });
    return () => { alive = false; };
  }, []);

  async function save() {
    if (locked.current || saved === null) return;
    const api = window.mygamepack;
    locked.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.obsSet({ enabled, endpoint });
      show(await api.obsGet());
      setMessage(result.serverRunning ? "保存しました。サーバーが動いているので、次にサーバーを起動したときに効きます。" : "保存しました。次にサーバーを起動したときから効きます。");
    } catch (caught) {
      setError(ipcErrorMessage(caught));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  const defaultEndpoint = saved?.defaultEndpoint ?? "http://127.0.0.1:3000/event";
  return (
    <div className="ops-stability-fields">
      <label className="flex items-center gap-2 text-xs text-slate-200">
        <input type="checkbox" checked={enabled} disabled={busy || saved === null} onChange={event => setEnabled(event.target.checked)} />
        OBS ツールへイベントを送る
      </label>
      <label className="ops-field" htmlFor={endpointId}>
        <span>送り先（空のときは {defaultEndpoint}）</span>
        <input id={endpointId} type="text" value={endpoint} disabled={busy || saved === null} spellCheck={false} autoComplete="off" placeholder={defaultEndpoint} onChange={event => setEndpoint(event.target.value)} />
      </label>
      <small className="mt-1 block text-[11px] leading-relaxed text-slate-400">
        OBSMOD が、サーバーで起きたこと（ゲームのイベントの始まり・終わりなど）を OBS 用のツールへ送ります。OBS 用のツールを使わないときは、オフのままにしてください。
        設定はサーバーの起動のときに読まれます。
      </small>
      <button type="button" className="ops-primary-button ops-primary-button--violet" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "保存中…" : "OBS 連携を保存"}</button>
      {error && <small role="alert" className="mt-1.5 block text-[11px] leading-relaxed text-amber-300">{error}</small>}
      {message && <small role="status" className="mt-1.5 block text-[11px] leading-relaxed text-slate-300">{message}</small>}
    </div>
  );
}
