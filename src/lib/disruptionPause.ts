// 妨害の一時停止（BridgeMOD 1.8.0、2026-10-16 ユーザーの決定）。画面の判断だけを置き、React からも node:test からも使う。
import type { PauseOrigin } from "../types/electron";

export type PauseView = { online: boolean; paused: boolean; queued: { gift: number; like: number; other: number } };

const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** mod:status の結果から、帯とボタンに要るものだけを取り出す。古い BridgeMOD（paused なし）やつながっていないときは止めていない。 */
export function pauseView(mod: { online?: unknown; paused?: unknown; gift?: unknown; like?: unknown; other?: unknown } | null | undefined): PauseView {
  const online = mod?.online === true;
  return { online, paused: online && mod?.paused === true, queued: { gift: count(mod?.gift), like: count(mod?.like), other: count(mod?.other) } };
}

export function pauseBannerText(view: PauseView): string {
  const { gift, like, other } = view.queued;
  // サーバーを止める（MAP の読込・ゲームの切り替えも含む）と、BridgeMOD の待ちは消える（PR レビュー I-1）。
  return `妨害を一時停止中です。届いた分は預かっています（ギフト ${gift}・いいね ${like}・そのほか ${other}）。再開すると順に起きます。サーバーを止めると、BridgeMOD で預かっている分は消えます`;
}

type PauseResult = { ok: boolean; paused?: boolean; message?: string };
type PauseApi = { modPause?: (origin: PauseOrigin) => Promise<PauseResult>; modResume?: (origin: PauseOrigin) => Promise<PauseResult> };

/** 失敗したら理由を返す（止めたことにしない）。 */
export async function setDisruptionPause(api: PauseApi, pause: boolean, origin: PauseOrigin): Promise<PauseResult> {
  const call = pause ? api.modPause : api.modResume;
  if (!call) return { ok: false, message: "このアプリでは一時停止を使えません。" };
  try {
    return await call(origin);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
