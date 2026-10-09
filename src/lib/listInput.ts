// 「カンマ区切り」で複数の値を入れる欄（ミュートユーザー・TTS NGワード）の変換。

/** 既定の区切り文字（半角カンマ・読点・全角カンマ。1文字ずつが区切り）。TTS NGワードで使う。 */
export const LIST_SEPARATORS = ",、，";
/** 半角カンマだけで区切る。ミュートユーザーはニックネームでも照合し、ニックネームには読点が入ることがある。 */
export const COMMA_ONLY = ",";

/** 入力欄の文字列を値の一覧にする。separators の各文字で区切り、空の項目と重複を除く。 */
export function parseListInput(text: string, separators: string = LIST_SEPARATORS): string[] {
  let parts = [text];
  for (const separator of separators) parts = parts.flatMap(part => part.split(separator));
  const seen = new Set<string>();
  return parts.map(value => value.trim()).filter(value => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * 読点・全角カンマが入っているか。半角カンマだけで区切る欄（ミュートユーザー）で注意を出すのに使う。
 * 日本語入力のままカンマキーを押すと「、」になり、2つの名前が気づかないうちに1件になる。
 */
export function hasJapaneseComma(values: readonly string[]): boolean {
  return values.some(value => /[、，]/.test(value));
}

/** 保存する値を入力欄に表示する文字列にする。 */
export function formatListInput(values: readonly string[]): string {
  return values.join(", ");
}

/** 入力中の文字列が、保存済みの値と同じ内容を表しているか（外から値が変わったときだけ入力欄を書き換えるため）。 */
export function sameList(text: string, values: readonly string[], separators: string = LIST_SEPARATORS): boolean {
  return JSON.stringify(parseListInput(text, separators)) === JSON.stringify([...values]);
}

/**
 * 入力欄から離れたときの表示と、親へ渡し直す値（保存する値と同じなら null）。
 * 「暴言、URL、宣伝」を1件として保存した古い設定などは、表示だけ区切り直すと保存値と食い違うので、値も渡し直す。
 */
export function listInputOnBlur(text: string, values: readonly string[], separators: string = LIST_SEPARATORS): { text: string; values: string[] | null } {
  const parsed = parseListInput(text, separators);
  return { text: formatListInput(parsed), values: sameList(text, values, separators) ? null : parsed };
}
