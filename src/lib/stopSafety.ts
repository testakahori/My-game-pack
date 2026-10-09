// 配信中に「止めたいときに止められる」「うっかり止めない」ための画面側の判定。

export type StopTarget = "all" | "bridge" | "server";
/** null は状態を取得できていない（不明）。動いているかもしれないものとして扱う。 */
export type RunningState = { bridgeRunning: boolean | null; serverRunning: boolean | null; tiktokConnected?: boolean };

type BridgeStatus = { running?: boolean; tiktok?: { state?: string } | null } | null | undefined;
type ServerStatus = { running?: boolean; managed?: boolean } | null | undefined;

/**
 * 停止ボタンから見た状態。サーバーはこのアプリから止められるもの（running かつ managed が false でない）だけを動いているとする。
 * アプリの外で起動したサーバー（managed=false）は server:stop が断るので、止める対象に数えない。
 * 状態を一度も取得できていない項目は null（不明）。
 */
export function stopState(bridge: BridgeStatus, server: ServerStatus): RunningState {
  const bridgeRunning = typeof bridge?.running === "boolean" ? bridge.running : null;
  return {
    bridgeRunning,
    serverRunning: typeof server?.running === "boolean" ? server.running && server.managed !== false : null,
    tiktokConnected: bridgeRunning === true && bridge?.tiktok?.state === "connected",
  };
}

/**
 * 状態の取得結果を反映する。取得に失敗した項目は前回の値を残し、一度も取れていなければ null（不明）にする。
 * previous の undefined は、まだ最初の確認が返ってきていない（確認中）。
 */
export function keepLastKnown<T>(previous: T | null | undefined, result: PromiseSettledResult<T | null | undefined>): T | null {
  return result.status === "fulfilled" && result.value != null ? result.value : previous ?? null;
}

/**
 * 停止パネルに出す状態の文言。undefined はまだ最初の確認が返ってきていない（確認中）、null は取得に失敗して前回の値もない（不明）。
 * 確認中を「不明」と出すと、tasklist の確認を待つ数秒の間、動いているかもしれないという注意まで出てしまう。
 */
export function runningLabel(running: boolean | null | undefined, on: string): string {
  if (running === undefined) return "確認中";
  return running === null ? "不明" : running ? on : "停止中";
}

/**
 * 停止の前に出す確認文。止める対象が止まっているとわかっているときは null（確認なしで実行してよい）。
 * 一括停止は一括起動の真横にあるので、動いているとき・状態が不明なときだけ確認を挟む。
 */
export function stopConfirmMessage(target: StopTarget, state: RunningState): string | null {
  const live = state.tiktokConnected ? "TikTok に接続中（配信中）です。\n" : "";
  const unknown = [
    target !== "server" && state.bridgeRunning === null ? "BRIDGE" : "",
    target !== "bridge" && state.serverRunning === null ? "サーバー" : "",
  ].filter(Boolean);
  const note = unknown.length ? `${unknown.join("と")}の状態を確認できていません（動いているかもしれません）。\n` : "";
  if (target === "bridge") {
    if (state.bridgeRunning === false) return null;
    return `${live}${note}BRIDGEを停止します。止めている間のギフト・いいね・コメントはゲームに届かず、あとから届くこともありません。\n停止しますか？`;
  }
  if (target === "server") {
    if (state.serverRunning === false) return null;
    return `${live}${note}Minecraftサーバーを停止します。ワールドを保存してから止め、接続中のMinecraftは切断されます。\n停止しますか？`;
  }
  if (state.bridgeRunning === false && state.serverRunning === false) return null;
  const what = state.serverRunning === false
    ? "BRIDGEを停止します。ギフト・いいねはゲームに届かなくなります。"
    : state.bridgeRunning === false
      ? "Minecraftサーバーを停止します。ワールドを保存してから止め、接続中のMinecraftは切断されます。"
      : "BRIDGEとMinecraftサーバーをまとめて停止します。ギフト・いいねはゲームに届かなくなり、Minecraftは切断されます。";
  return `${live}${note}${what}\n一括停止しますか？`;
}
