import React, { useState } from "react";
import type { PreflightResult } from "../types/electron";
import { AppPage } from "../types";
import { useUnsavedGuard } from "../UnsavedChanges";

const LABEL = { ok: "確認済み", warn: "要確認", error: "要修正", skip: "対象外" };
export default function PreflightPanel({ onNavigate }: { onNavigate: (page: AppPage) => void }) {
  const [result, setResult] = useState<PreflightResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { hasChanges } = useUnsavedGuard();
  const run = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { setResult(await window.mygamepack.preflightRun()); }
    catch { setError("チェックを完了できませんでした。もう一度実行してください。"); }
    finally { setBusy(false); }
  };
  const issues = result?.checks.filter(row => row.status === "warn" || row.status === "error").length || 0;
  return <section className="safety-panel" aria-labelledby="preflight-title">
    <div className="safety-panel-heading">
      <div><h2 id="preflight-title">配信前の一括チェック</h2><p>アカウント・設定・コマンド・サーバー・音声の準備を確認します。</p></div>
      <button type="button" className="safety-primary" disabled={busy} onClick={run}>{busy ? "確認中…" : result ? "もう一度チェック" : "チェックを開始"}</button>
    </div>
    {hasChanges && <p className="safety-warning">未保存の変更があります。チェックは保存済みの設定を対象にします。</p>}
    <div aria-live="polite">
      {error && <p role="alert" className="safety-error">{error}</p>}
      {result && <>
        <p className="safety-summary">{issues ? `${issues}項目を確認してください` : "確認項目に問題はありません"}<small>{new Date(result.checkedAt).toLocaleString("ja-JP")} 時点</small></p>
        <div className="preflight-grid">{result.checks.map(row => <article key={row.id} className={`preflight-item is-${row.status}`}>
          <div><span className="safety-status">{LABEL[row.status]}</span><b>{row.title}</b></div><p>{row.detail}</p>
          {(row.status === "warn" || row.status === "error") && row.page !== AppPage.DASHBOARD && <button type="button" onClick={() => onNavigate(row.page as AppPage)}>設定を開く →</button>}
        </article>)}</div>
        <p className="safety-footnote">実際のギフト発動は、配信接続後にテストして確認してください。</p>
      </>}
    </div>
  </section>;
}
