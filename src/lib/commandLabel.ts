// コマンド候補の表示。BridgeMOD が拒否するファイル名（日本語・空白・.txt が2つなど）は、選ぶ前に分かるようにする。
// 使えないかと直し方の文（invalidReason）は main が付ける（bridge/command_rows.cjs の commandListRow。処理のコピー PR8）。

export type CommandLabelSource = { name: string; title?: string; invalidName?: boolean; invalidReason?: string };

/**
 * コマンド候補の表示名。使えない名前には短い印を付ける（直し方の全文はコマンド一覧のカードに出す）。
 * title そのものはルーレット名やギフト画像に使われるので変えず、表示のときだけ付ける。
 */
export function commandOptionLabel(file: CommandLabelSource): string {
  const label = file.title || file.name;
  return file.invalidName ? `⚠ ${label}（名前を直すまで動きません）` : label;
}

/** コマンド一覧のカードに出す、使えない名前の印と直し方の文。 */
export function invalidCommandMessage(file: CommandLabelSource): string {
  return `⚠ この名前は BridgeMOD で実行できません。${file.invalidReason || "コマンド一覧で名前を確かめてください"}`;
}
