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

  const alive = useRef(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const show = (status: ObsSendStatus) => { setSaved(status); setEnabled(status.enabled); setEndpoint(status.endpoint); };

  // 読めなかったときは「もう一度読む」でやり直せる。開いた時点でサーバーが動いていれば、保存しても次の起動で効くと先に知らせる（PR3 の最後のレビュー 軽い5）。
  function load() {
    setLoadFailed(false); setError(""); setMessage("");
    void window.mygamepack.obsGet().then(status => {
      if (!alive.current) return;
      show(status);
      if (status.serverRunning) setMessage("サーバーが動いています。ここで保存した設定は、次にサーバーを起動したときに効きます。");
    }).catch(() => { if (alive.current) { setError("OBS 連携の設定を読めませんでした。"); setLoadFailed(true); } });
  }

  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, []);

  async function save() {
    if (locked.current || saved === null) return;
    const api = window.mygamepack;
    locked.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api.obsSet({ enabled, endpoint });
      show(await api.obsGet());
      // サーバーのファイルを書けなかった・サーバーのフォルダーがまだ無いときも、アプリの設定には残り、アプリからサーバーを起動するときに書く（electron/server_process.cjs）。
      const when = result.serverRunning === null
        ? "サーバーが動いているかは確かめられませんでした。動いているなら、次にサーバーを起動したときに効きます。"
        : result.serverRunning ? "サーバーが動いているので、次にサーバーを起動したときに効きます。" : "次にサーバーを起動したときから効きます。";
      setMessage(result.serverWriteError
        ? `保存しました。ただし、${result.serverWriteError}。次にサーバーを起動したときに書き直します。`
        : result.wroteServer ? `保存しました。${when}`
        : "保存しました。サーバーのフォルダーがまだ無いので、アプリの設定に残しました。初期セットアップのあと、サーバーを起動したときに書きます。");
    } catch (caught) {
      setError(ipcErrorMessage(caught));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  // 既定の送り先は窓口（electron/obs_send.cjs）の値だけを使う（画面に書くと、変えたときに食い違う。軽い6）。
  const defaultEndpoint = saved?.defaultEndpoint ?? "";
  return (
    // 見出しの下は「安定運用・荒らし対策」と同じだけ空ける。チェックボックスは ops-check-row で小さく描く
    // （運用センターの CSS は input を横いっぱいにするため。PR3 の最後のレビュー 重要3）。
    <div className="ops-stability-fields mt-3.5">
      <label className="ops-check-row">
        <input type="checkbox" checked={enabled} disabled={busy || saved === null} onChange={event => setEnabled(event.target.checked)} />
        OBS ツールへイベントを送る
      </label>
      <label className="ops-field" htmlFor={endpointId}>
        <span>{defaultEndpoint ? `送り先（空のときは ${defaultEndpoint}）` : "送り先"}</span>
        <input id={endpointId} type="text" value={endpoint} disabled={busy || saved === null} spellCheck={false} autoComplete="off" placeholder={defaultEndpoint} onChange={event => setEndpoint(event.target.value)} />
      </label>
      <small className="mt-1 block text-[11px] leading-relaxed text-slate-400">
        OBSMOD が、サーバーで起きたこと（ゲームのイベントの始まり・終わりなど）を OBS 用のツールへ送ります。OBS 用のツールを使わないときは、オフのままにしてください。
        設定はサーバーの起動のときに読まれます。
      </small>
      <button type="button" className="ops-primary-button ops-primary-button--violet" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "保存中…" : "OBS 連携を保存"}</button>
      {error && <small role="alert" className="mt-1.5 block text-[11px] leading-relaxed text-amber-300">{error}</small>}
      {loadFailed && <button type="button" className="ops-ghost-button" onClick={load}>もう一度読む</button>}
      {message && <small role="status" className="mt-1.5 block text-[11px] leading-relaxed text-slate-300">{message}</small>}
    </div>
  );
}
