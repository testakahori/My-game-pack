// 画面のコマンドの探し方（処理のコピー PR8）。.txt の有無・大文字小文字・前後の空白を問わない（Windows のファイル名も BridgeMOD も区別しない）。
// 画面（TypeScript）からは bridge の CJS を読まないので、bridge/command_files.cjs の ensureTxt・bridgeCommandStem・sameCommandFile の写しになる。
// electron/test/ui-command-files.test.cjs が同じ例で同じ結果になることを見張る。ルーレットか・使えない名前かは main が一覧の行に付ける印を見る。

const TXT = /\.txt$/i;

/** .txt を付ける。空・0・false・null は「名前なし」（bridge の ensureTxt と同じ）。 */
export function ensureTxt(name: unknown): string {
  if (!name) return "";
  const value = String(name).trim();
  if (!value) return "";
  return TXT.test(value) ? value : `${value}.txt`;
}

/** .txt を1つ除いた名前（題名がないときに出す名前）。bridge の bridgeCommandStem と同じく、フォルダーは除かない。 */
export function commandFileStem(name: unknown): string {
  const value = String(name ?? "").trim();
  return TXT.test(value) ? value.slice(0, -4) : value;
}

/** 同じコマンドファイルか。どちらかが空なら false。 */
export function sameCommandFile(a: unknown, b: unknown): boolean {
  const left = ensureTxt(a);
  return Boolean(left) && left.toLowerCase() === ensureTxt(b).toLowerCase();
}

/** 一覧から同じコマンドファイルの行を探す。 */
export function findCommandFile<T extends { name: string }>(list: readonly T[], commandFile: unknown): T | undefined {
  return list.find((row) => sameCommandFile(row.name, commandFile));
}
