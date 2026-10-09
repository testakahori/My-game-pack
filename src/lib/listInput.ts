// 「カンマ区切り」で複数の値を入れる欄（ミュートユーザー・TTS NGワード）の変換。

/** 入力欄の文字列を値の一覧にする。読点・全角カンマも区切りとして扱い、空の項目と重複を除く。 */
export function parseListInput(text: string): string[] {
  const seen = new Set<string>();
  return text.split(/[,、，]/).map(value => value.trim()).filter(value => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** 保存する値を入力欄に表示する文字列にする。 */
export function formatListInput(values: readonly string[]): string {
  return values.join(", ");
}

/** 入力中の文字列が、保存済みの値と同じ内容を表しているか（外から値が変わったときだけ入力欄を書き換えるため）。 */
export function sameList(text: string, values: readonly string[]): boolean {
  return JSON.stringify(parseListInput(text)) === JSON.stringify([...values]);
}
