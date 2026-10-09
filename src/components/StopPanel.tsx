import React, { useCallback, useEffect, useState } from "react";
import { stopConfirmMessage, type RunningState, type StopTarget } from "../lib/stopSafety";

type Status = RunningState & { serverManaged: boolean; minecraftRunning: boolean };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * ゲームが未保存・復旧待ち・取得失敗で配信ホームの操作盤を出せないときの停止ボタン。
 * ゲームの保存と復旧はサーバー・BRIDGE の停止中に行うので、ここで止められないと行き止まりになる。
 */
export default function StopPanel() {
  const api = window.mygamepack;
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [bridge, server, minecraft] = await Promise.all([
        api.bridgeProcessStatus(),
        api.serverProcessStatus(),
        api.minecraftStatus?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      const bridgeRunning = bridge?.running === true;
      setStatus({
        bridgeRunning,
        serverRunning: server?.running === true,
        serverManaged: server?.managed !== false,
        tiktokConnected: bridgeRunning && bridge?.tiktok?.state === "connected",
        minecraftRunning: minecraft?.running === true,
      });
    } catch {
      setStatus(null);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const stop = async (target: StopTarget) => {
    if (busy || !status) return;
    const message = stopConfirmMessage(target, status);
    if (message && !window.confirm(message)) return;
    setBusy(true); setNotice(null);
    const errors: string[] = [];
    // 一括停止は配信ホームと同じく BRIDGE → サーバーの順（先にギフトの受付を止め、そのあとワールドを保存して止める）。
    if (target !== "server") {
      try { await api.bridgeStop(); } catch (error) { errors.push(`BRIDGE停止: ${errorText(error)}`); }
    }
    if (target !== "bridge") {
      try { await api.serverStop(); } catch (error) { errors.push(`サーバー停止: ${errorText(error)}`); }
    }
    setNotice(errors.length ? { type: "error", text: `停止が完了していません。${errors.join(" ")}` } : { type: "ok", text: "停止しました。" });
    setBusy(false);
    void refresh();
  };

  if (!status) return null;
  const serverStoppable = status.serverRunning && status.serverManaged;
  return (
    <div className="stop-panel" aria-label="停止操作">
      <p>
        BRIDGE：<b>{status.bridgeRunning ? "稼働中" : "停止中"}</b>
        {" ／ "}サーバー：<b>{status.serverRunning ? (status.serverManaged ? "稼働中" : "稼働中（アプリ外で起動）") : "停止中"}</b>
        {" ／ "}Minecraft：<b>{status.minecraftRunning ? "起動中" : "停止中"}</b>
      </p>
      <div className="stop-panel-actions">
        <button type="button" disabled={busy || !(status.bridgeRunning || serverStoppable)} onClick={() => void stop("all")}>■ 一括停止</button>
        <button type="button" disabled={busy || !status.bridgeRunning} onClick={() => void stop("bridge")}>■ BRIDGE停止</button>
        <button type="button" disabled={busy || !serverStoppable} onClick={() => void stop("server")}>■ サーバー停止</button>
      </div>
      {status.serverRunning && !status.serverManaged && <p>このサーバーはアプリの外で起動しています。起動した画面で stop を実行してください。</p>}
      {status.minecraftRunning && <p>Minecraft（ゲーム画面）は、ゲームを保存・復旧する前に手で閉じてください。</p>}
      {busy && <p role="status">停止しています。ワールドの保存完了までお待ちください。</p>}
      {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`stop-panel-notice stop-panel-notice--${notice.type}`}>{notice.text}</p>}
    </div>
  );
}
