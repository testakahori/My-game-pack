// コマンド候補の表示。BridgeMOD が拒否するファイル名（日本語・空白など）は、選ぶ前に分かるようにする。

export type CommandLabelSource = { name: string; title?: string; invalidName?: boolean };

/** ファイル名を直すように促す文。コマンド一覧のカードにも出す。 */
export const INVALID_COMMAND_NAME_HINT = "ファイル名を半角英数字に変えると使えます";

/**
 * コマンド候補の表示名。使えない名前には印を付ける。
 * title そのものはルーレット名やギフト画像に使われるので変えず、表示のときだけ付ける。
 */
export function commandOptionLabel(file: CommandLabelSource): string {
  const label = file.title || file.name;
  return file.invalidName ? `⚠ ${label}（${INVALID_COMMAND_NAME_HINT}）` : label;
}
