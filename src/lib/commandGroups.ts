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
    const group = groups.get(category);
    if (group) group.push(file); else groups.set(category, [file]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b, "ja"));
}

/** 検索の文字で絞る（タイトル・名前・説明。大文字小文字を問わない）。見出しは残し、当たらない分類は空にする。
 * 見出しの（件数）と、ギフト設定の「分類で絞る欄」の（件数）は、どちらもこの絞ったあとの数（PR #174 レビュー 軽い7）。 */
export function searchCommandGroups<T extends { name: string; title: string; description?: string }>(groups: Array<[string, T[]]>, query: string): Array<[string, T[]]> {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups.map(([category, files]) => [category, files.filter(file => `${file.title} ${file.name} ${file.description || ""}`.toLowerCase().includes(q))]);
}
