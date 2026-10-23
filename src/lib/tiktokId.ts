// 画面の TikTok ID の整え方（処理のコピー PR9）。前後の空白と先頭の @ を除き、小文字にして [a-z0-9_.]{1,24} に合うか。
// 画面（TypeScript）からは bridge の CJS を読まないので、bridge/tiktok_id.cjs の写しになる。
// electron/test/ui-tiktok-id.test.cjs が同じ例で同じ結果になることを見張る。保存する形は入力したまま（PR3）で、比べる・出す所で整える。

const TIKTOK_ID = /^[a-z0-9_.]{1,24}$/;

/** 前後の空白と先頭の @ を除き、小文字にする。文字列でなければ空。 */
export function normalizeTikTokId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function isValidTikTokId(value: unknown): boolean {
  return TIKTOK_ID.test(normalizeTikTokId(value));
}

/** 形が正しくないときの文（設定の確かめと同じ）。正しければ空。空の値も空（空のときの文は場所ごとに決める）。 */
export function tiktokIdProblem(value: unknown): string {
  if (!normalizeTikTokId(value) || isValidTikTokId(value)) return "";
  return `TikTok ID「${String(value).trim()}」の形が正しくありません。半角英数字・_・. の24文字以内で入力してください`;
}

/** 同じ TikTok ID か（整えた形で比べる。BRIDGE も同じ ID として扱う）。どちらかが空なら false。 */
export function sameTikTokId(a: unknown, b: unknown): boolean {
  const left = normalizeTikTokId(a);
  return Boolean(left) && left === normalizeTikTokId(b);
}
