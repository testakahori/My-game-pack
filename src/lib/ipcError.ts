// ipc のエラーを画面に出す文にする。Electron が前に付ける「Error invoking remote method '<窓口>': Error: 」を除き、main の理由だけにする。
// 配信ホーム・初期セットアップ・TXT 作成がこの1つを使う（処理のコピー PR8）。
export function ipcErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return String(message ?? error).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
