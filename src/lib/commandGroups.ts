// コマンドを選ぶ欄を、分類（txt の # CATEGORY:）の見出しごとに並べる決め方の1か所。
// ギフト設定・いいね・フォロー・ルーレット・コメントで同じにする（2026-10-30 ユーザーの決定「ギフト設定と同じ分類」）。
// 画面の判断だけを置き、React からも node:test からも使う。

/** 見出しの名前。「お助け」「妨害」は「〜系」にそろえ、「|」の後ろは見ない。分類の無いコマンドは「その他」。 */
export function commandCategory(raw: string | undefined = ""): string {
  const key = String(raw ?? "").split("|")[0].trim();
  return key === "お助け" ? "お助け系" : key === "妨害" ? "妨害系" : key || "その他";
}

/** 選ぶ欄の見出しの文字。項目と見分けやすいよう【分類】（件数）の形にする（2026-10-30 ユーザーの決定「色と【】で目立たせる」。色は index.css の .command-optgroup）。 */
export function commandGroupLabel(category: string, count: number): string {
  return `【${category}】（${count}）`;
}

/** 分類ごとにまとめる。見出しは日本語の並び順、見出しの中はもとの並び。 */
export function groupCommandsByCategory<T extends { category?: string }>(files: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const file of files) {
    const category = commandCategory(file.category);
    groups.set(category, [...(groups.get(category) || []), file]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "ja"));
}
