// TXT 作成（CommandSetManager）の保存の決め方（処理のコピー PR8）。同じ名前があれば上書きの前に聞き、書き、main の理由を出す。
// ダウンロードして手でフォルダーへ移させることはしない（main の確かめを素通りするため）。画面から取り出して、動きをテストで確かめる。
import { ipcErrorMessage } from "./ipcError";

/** main の確かめ（bridge:commands:check。bridge/command_rows.cjs の checkCommandDraft）の結果。 */
export type DraftCheck = { filename: string; commands: string[]; problems: string[]; exists: boolean };

export type DraftSaveResult =
  | { type: "ok"; text: string; check: DraftCheck }
  | { type: "error"; text: string }
  | { type: "canceled" };

export async function saveCommandDraft({ check, content, confirm, write }: {
  check: DraftCheck;
  content: string;
  confirm: (message: string) => boolean;
  write?: (request: { filename: string; content: string }) => Promise<unknown>;
}): Promise<DraftSaveResult> {
  if (!write) return { type: "error", text: "この画面では保存できません。アプリの中で開いてください" };
  if (check.exists && !confirm(`${check.filename} はもうあります。上書きしますか？`)) return { type: "canceled" };
  try {
    await write({ filename: check.filename, content });
  } catch (error) {
    // main の理由をそのまま出す（使えない名前・ゲームパックの名前・ゲームの切り替え中など）。
    return { type: "error", text: `保存できませんでした: ${ipcErrorMessage(error)}` };
  }
  // 書けたので、この名前はもうある（続けて押したら上書きを聞く。前は保存のあとも「ない」のままだった）。
  return { type: "ok", text: `保存しました: bridge/commands/minecraft/${check.filename}`, check: { ...check, exists: true } };
}
