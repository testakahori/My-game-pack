// 画面が覚えておく TikTok ユーザー名（配信ホームの欄）。名前は前の版と同じにする（覚えていた値を見つけられるように）。
// 新しい保存先を作ったとき（bridge:extractTo の freshConfig）だけ消す。開発版と同じ %APPDATA% に残っていた前の名前が、入れたばかりのアプリに出ていた
// （2026-10-30 ユーザーの決定「新しい保存先では空にする」）。マイクラID と API キーは main が消す（electron/bridge_sync.cjs）。
export const TIKTOK_USER_STORAGE_KEY = "mc_tiktok_username_unified_v1";

/** 消したら true。印が無い・消せない（保存領域が無い・使えない）ときは何もしない。保存領域はふだん画面の localStorage。 */
export function forgetRememberedTikTokUser(result: { freshConfig?: boolean } | null | undefined, storage: Pick<Storage, "removeItem"> | undefined = globalThis.localStorage): boolean {
  if (!result?.freshConfig) return false;
  try {
    storage!.removeItem(TIKTOK_USER_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
