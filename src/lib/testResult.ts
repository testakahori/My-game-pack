// テスト発火の結果を手順ごとにまとめる（PR #79 レビュー）。
// 1つの手順から記録が何行も出ることがある：ルーレットは当選ごとに1行、付け足しの演出が失敗したら1行足す。
// そのため、手順 i と記録の i 行目を組にせず、記録の stepIndex で手順ごとに見る。
export type FiredRow = { ok: boolean; message: string; stepIndex?: number };

export function stepStatus(fired: FiredRow[] | undefined, index: number): string {
  const rows = (fired || []).filter(row => row.stepIndex === index);
  if (!rows.length) return '未送信';
  const failed = rows.find(row => !row.ok);
  if (failed) return failed.message;
  return rows.length > 1 ? `送信済み（${rows.length}回）` : '送信済み';
}
