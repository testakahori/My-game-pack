// 配信中に「止めたいときに止められる」「うっかり止めない」ための画面側の判定。
import type { StopOrigin } from "../types/electron";

export type StopTarget = "all" | "bridge" | "server";
/**
 * null は状態を取得できていない（不明）。動いているかもしれないものとして扱う。
 * disruptionPaused は妨害を一時停止中か（2026-10-16）。サーバーを止めると、BridgeMOD で預かっている分は消える。
 * pendingDeliveries・pendingGifts は BRIDGE の送信待ち（BridgeMOD にまだ受け付けられていない分）の件数と、そのうちのギフト。
 * BRIDGE を止める・再起動すると消える（送り直さず、操作履歴に「BRIDGE停止で未送信」と残る。2026-11-07 品質レビュー）。
 */
export type RunningState = { bridgeRunning: boolean | null; serverRunning: boolean | null; tiktokConnected?: boolean; disruptionPaused?: boolean;
  pendingDeliveries?: number; pendingGifts?: number };

/** BRIDGE が runtime-status.json に書く送信待ち（bridge:processStatus の sendQueue）。 */
export type SendQueue = { pending?: number; gifts?: number; oldestAt?: string | null } | null | undefined;
type BridgeStatus = { running?: boolean; tiktok?: { state?: string } | null; sendQueue?: SendQueue } | null | undefined;
type ServerStatus = { running?: boolean; managed?: boolean } | null | undefined;

// 件数として使える値だけを数える（無い・壊れた値は 0）。
const countOf = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0);

/**
 * 停止ボタンから見た状態。サーバーはこのアプリから止められるもの（running かつ managed が false でない）だけを動いているとする。
 * アプリの外で起動したサーバー（managed=false）は server:stop が断るので、止める対象に数えない。
 * 状態を一度も取得できていない項目は null（不明）。
 */
export function stopState(bridge: BridgeStatus, server: ServerStatus): RunningState {
  const bridgeRunning = typeof bridge?.running === "boolean" ? bridge.running : null;
  const queue = bridgeRunning === true ? bridge?.sendQueue : null;
  return {
    bridgeRunning,
    serverRunning: typeof server?.running === "boolean" ? server.running && server.managed !== false : null,
    tiktokConnected: bridgeRunning === true && bridge?.tiktok?.state === "connected",
    pendingDeliveries: countOf(queue?.pending),
    pendingGifts: countOf(queue?.gifts),
  };
}

/**
 * BRIDGE を止める・再起動すると消える送信待ちの文（無ければ空の文字）。確認文の頭に足す（2026-11-07 品質レビュー）。
 */
export function unsentNote(state: RunningState): string {
  const total = countOf(state.pendingDeliveries);
  const gifts = Math.min(countOf(state.pendingGifts), total);
  const others = total - gifts;
  const text = (gifts > 0 ? `未送信のギフト ${gifts}件は消えます。` : "")
    + (others > 0 ? `未送信のいいね・コメントなど ${others}件${gifts > 0 ? "も" : "は"}消えます。` : "");
  return text ? `${text}\n` : "";
}

/**
 * BRIDGE を再起動する前の確認文。送信待ちが無ければ null（今までどおり確認なしで再起動する。2026-11-07 品質レビュー）。
 */
export function restartConfirmMessage(state: RunningState): string | null {
  const unsent = unsentNote(state);
  return unsent ? `${unsent}BRIDGEを再起動しますか？` : null;
}

/**
 * 配信ホームに出す送信待ちの文。0件なら null（2026-11-07 品質レビュー）。
 * いちばん古いものが3秒より新しいあいだは出さない（ふつうに送れている分やルーレットの演出中に、出たり消えたりしないように。2026-11-08 PR #196 レビュー）。
 */
export const SEND_QUEUE_NOTICE_AFTER_MS = 3000;
export function sendQueueNotice(queue: SendQueue, now = Date.now()): string | null {
  const pending = countOf(queue?.pending);
  if (!pending) return null;
  const since = Date.parse(String(queue?.oldestAt || ""));
  if (Number.isFinite(since) && now - since < SEND_QUEUE_NOTICE_AFTER_MS) return null;
  const age = Number.isFinite(since) ? `（いちばん古いものは ${Math.max(0, Math.round((now - since) / 1000))}秒前から）` : "";
  return `送信待ち ${pending}件${age}。BridgeMODへ送れるまでBRIDGEが預かっています。BRIDGEを止める・再起動すると消えます。`;
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
  // BRIDGE の送信待ちは、BRIDGE を止めると消える。サーバーだけを止めるときは BRIDGE が持ったまま再送を続ける（2026-11-07 品質レビュー）。
  const note = unknownNote + pausedNote + (target !== "server" ? unsentNote(state) : "");
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
