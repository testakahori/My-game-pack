// 配信中に「止めたいときに止められる」「うっかり止めない」ための画面側の判定。

export type StopTarget = "all" | "bridge" | "server";
export type RunningState = { bridgeRunning: boolean; serverRunning: boolean; tiktokConnected?: boolean };

/**
 * 停止の前に出す確認文。止める対象が動いていないときは null（確認なしで実行してよい）。
 * 一括停止は一括起動の真横にあるので、動いているときだけ確認を挟む。
 */
export function stopConfirmMessage(target: StopTarget, state: RunningState): string | null {
  const live = state.tiktokConnected ? "TikTok に接続中（配信中）です。\n" : "";
  if (target === "bridge") {
    if (!state.bridgeRunning) return null;
    return `${live}BRIDGEを停止します。止めている間のギフト・いいね・コメントはゲームに届かず、あとから届くこともありません。\n停止しますか？`;
  }
  if (target === "server") {
    if (!state.serverRunning) return null;
    return `${live}Minecraftサーバーを停止します。ワールドを保存してから止め、接続中のMinecraftは切断されます。\n停止しますか？`;
  }
  if (!state.bridgeRunning && !state.serverRunning) return null;
  return `${live}BRIDGEとMinecraftサーバーをまとめて停止します。ギフト・いいねはゲームに届かなくなり、Minecraftは切断されます。\n一括停止しますか？`;
}
