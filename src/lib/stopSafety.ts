// 配信中に「止めたいときに止められる」「うっかり止めない」ための画面側の判定。
import type { StopOrigin } from "../types/electron";

export type StopTarget = "all" | "bridge" | "server";
/**
 * null は状態を取得できていない（不明）。動いているかもしれないものとして扱う。
 * disruptionPaused は妨害を一時停止中か（2026-10-16）。サーバーを止めると、BridgeMOD で預かっている分は消える。
 */
export type RunningState = { bridgeRunning: boolean | null; serverRunning: boolean | null; tiktokConnected?: boolean; disruptionPaused?: boolean };

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
  const unknownNote = unknown.length ? `${unknown.join("と")}の状態を確認できていません（動いているかもしれません）。\n` : "";
  // サーバーを止めると一時停止は解け、BridgeMOD の待ちは消える（PR レビュー I-1）。BRIDGE停止はサーバーに触れない。
  const pausedNote = target !== "bridge" && state.disruptionPaused ? "妨害を一時停止中です。サーバーを止めると一時停止は解け、BridgeMOD で預かっている分は消えます。\n" : "";
  const note = unknownNote + pausedNote;
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

export type StopNotice = { type: "ok" | "error"; text: string };
type StopApi = { bridgeStop: (origin: StopOrigin) => Promise<unknown>; serverStop: (origin: StopOrigin) => Promise<unknown> };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 停止パネルのボタンの処理。serverRunning は stopState の値（null は不明）。
 * 押したボタンを出どころとして main に渡し、ログ欄と logs/stop-requests.log に残す。
 */
export async function runStop(api: StopApi, target: StopTarget, serverRunning: boolean | null): Promise<StopNotice> {
  const errors: string[] = [];
  const origin: StopOrigin = `stop-panel:${target}`;
  // 一括停止は配信ホームと同じく BRIDGE → サーバーの順（先にギフトの受付を止め、そのあとワールドを保存して止める）。
  if (target !== "server") {
    try { await api.bridgeStop(origin); } catch (error) { errors.push(`BRIDGE停止: ${errorText(error)}`); }
  }
  // BRIDGE停止ではサーバーに触れない。アプリの外で起動したサーバーは server:stop が断るので呼ばない（止まっているとわかっているときも呼ばない）。
  if (target !== "bridge" && serverRunning !== false) {
    try { await api.serverStop(origin); } catch (error) { errors.push(`サーバー停止: ${errorText(error)}`); }
  }
  return errors.length ? { type: "error", text: `停止が完了していません。${errors.join(" ")}` } : { type: "ok", text: "停止しました。" };
}
