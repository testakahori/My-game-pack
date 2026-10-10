import React, { useCallback, useEffect, useRef, useState } from "react";
import { keepLastKnown, runningLabel, runStop, stopConfirmMessage, stopState, type StopNotice, type StopTarget } from "../lib/stopSafety";

type Notice = StopNotice;
// 最後に取得できた状態。undefined はまだ最初の確認が返ってきていない（確認中）、null は取得に失敗して前回の値もない（不明）。
type Snapshot = {
  bridge?: { running?: boolean; tiktok?: { state?: string } | null } | null;
  server?: { running?: boolean; managed?: boolean } | null;
  minecraft?: { running?: boolean } | null;
};

// 停止中の処理。画面を離れて戻るとパネルが作り直されるので、ここに置いて作り直したパネルでも「停止中」を出し続ける。
let stopping: Promise<Notice> | null = null;

/**
 * ゲームが未保存・復旧待ち・取得失敗で配信ホームの操作盤を出せないときの停止ボタン。
 * ゲームの保存と復旧はサーバー・BRIDGE の停止中に行うので、ここで止められないと行き止まりになる。
 * 状態の取得に失敗してもパネルは消さず、わからない項目は「不明」として停止ボタンを使えるままにする。
 */
export default function StopPanel() {
  const api = window.mygamepack;
  const [snapshot, setSnapshot] = useState<Snapshot>({});
  const [busy, setBusy] = useState(() => stopping !== null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const mounted = useRef(true);
  const poll = useRef({ seq: 0, inFlight: 0 });

  const refresh = useCallback(async (force = false) => {
    // tasklist やポート確認は 3 秒を超えることがあるので、前回の確認が終わるまで次を重ねない（停止直後の確認だけは割り込む）。
    if (!force && poll.current.inFlight > 0) return;
    const seq = ++poll.current.seq;
    poll.current.inFlight += 1;
    // 返ってきた項目から反映する（Minecraft の確認は tasklist を待つので数秒かかり、その間ほかの項目まで「確認中」にしない）。
    const apply = <K extends keyof Snapshot>(key: K, request: Promise<Snapshot[K]>) =>
      Promise.allSettled([request]).then(([result]) => {
        // 後から始めた確認があれば、古い結果で上書きしない（停止直後に「稼働中」へ戻るのを防ぐ）。
        if (seq !== poll.current.seq || !mounted.current) return;
        setSnapshot(previous => ({ ...previous, [key]: keepLastKnown(previous[key], result) }));
      });
    try {
      await Promise.all([
        apply("bridge", api.bridgeProcessStatus()),
        apply("server", api.serverProcessStatus()),
        apply("minecraft", api.minecraftStatus ? api.minecraftStatus() : Promise.resolve(null)),
      ]);
    } finally {
      poll.current.inFlight -= 1;
    }
  }, [api]);

  const follow = useCallback((pending: Promise<Notice>) => {
    setBusy(true);
    void pending.then(result => {
      if (!mounted.current) return;
      setNotice(result);
      setBusy(false);
      void refresh(true);
    });
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    // 前のパネルで始めた停止がまだ終わっていなければ、その完了を待って結果を出す。
    // 描画してからここまでの間に終わっていたら「停止しています」を外す（外さないと停止ボタンが押せないままになる）。
    if (stopping) follow(stopping);
    else setBusy(false);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [refresh, follow]);

  const state = stopState(snapshot.bridge, snapshot.server);

  const stop = (target: StopTarget) => {
    if (busy || stopping) return;
    // 状態が不明なときは動いているかもしれないものとして確認を出す。
    const message = stopConfirmMessage(target, state);
    if (message && !window.confirm(message)) return;
    setNotice(null);
    const pending = runStop(api, target, state.serverRunning).finally(() => { stopping = null; });
    stopping = pending;
    follow(pending);
  };

  // 表示だけは、最初の確認が返ってくるまで「確認中」（undefined）にする。停止前の確認では、確認中も不明と同じく動いているかもしれないものとして扱う。
  const bridgeRunning = snapshot.bridge === undefined ? undefined : state.bridgeRunning;
  const serverRunning = snapshot.server === undefined ? undefined : state.serverRunning;
  const externalServer = snapshot.server?.running === true && snapshot.server.managed === false;
  const minecraftRunning = snapshot.minecraft === undefined ? undefined : snapshot.minecraft ? snapshot.minecraft.running === true : null;
  return (
    <div className="stop-panel" aria-label="停止操作">
      <p>
        BRIDGE：<b>{runningLabel(bridgeRunning, "稼働中")}</b>
        {" ／ "}サーバー：<b>{externalServer ? "稼働中（アプリ外で起動）" : runningLabel(serverRunning, "稼働中")}</b>
        {" ／ "}Minecraft：<b>{runningLabel(minecraftRunning, "起動中")}</b>
      </p>
      <div className="stop-panel-actions">
        <button type="button" disabled={busy || (state.bridgeRunning === false && state.serverRunning === false)} onClick={() => stop("all")}>■ 一括停止</button>
        <button type="button" disabled={busy || state.bridgeRunning === false} onClick={() => stop("bridge")}>■ BRIDGE停止</button>
        <button type="button" disabled={busy || state.serverRunning === false} onClick={() => stop("server")}>■ サーバー停止</button>
      </div>
      {(bridgeRunning === null || serverRunning === null) && <p>状態を確認できない項目（不明）があります。動いているかもしれないので、停止ボタンはそのまま使えます。</p>}
      {externalServer && <p>このサーバーはアプリの外で起動しています。起動した画面で stop を実行してください。</p>}
      {minecraftRunning && <p>Minecraft（ゲーム画面）は、ゲームを保存・復旧する前に手で閉じてください。</p>}
      {busy && <p role="status">停止しています。ワールドの保存完了までお待ちください。</p>}
      {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`stop-panel-notice stop-panel-notice--${notice.type}`}>{notice.text}</p>}
    </div>
  );
}
