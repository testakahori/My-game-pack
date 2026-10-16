// テスト発火の結果を手順ごとにまとめる（PR #79 レビュー）。
// 1つの手順から結果が何行も出ることがある（ルーレットは当たりごとに1行）。手順 i と結果の i 行目を組にせず、結果の stepIndex で見る。
// 結果の文（受け付けた・送り直し中・送れなかった理由・取りやめ）は BRIDGE が決める（2026-10-16：テスト発火も本番と同じ送る列を通す）。
export type FiredRow = { stepIndex?: number; state?: 'delivered' | 'pending' | 'failed' | 'discarded'; message: string };
export type TestStep = { label: string; commandFile: string; count: number };

export function stepStatus(fired: FiredRow[] | undefined, index: number): string {
  const rows = (fired || []).filter(row => row.stepIndex === index);
  if (!rows.length) return '未送信';
  // 同じ結果はまとめ、回数を添える（ルーレットの当たりが3回受け付けられたら「…（3回）」）。
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.message, (counts.get(row.message) || 0) + 1);
  return Array.from(counts).map(([message, times]) => (times > 1 ? `${message}（${times}回）` : message)).join('・');
}

// 同じ内容（見出し・コマンド・回数・結果）の手順が続くときは1行にまとめる（ギフト100個で100行にしない）。
export function stepLines(steps: TestStep[] | undefined, fired: FiredRow[] | undefined): string[] {
  const lines: Array<{ text: string; times: number }> = [];
  (steps || []).forEach((step, index) => {
    const text = `${step.label} → ${step.commandFile} ×${step.count} / ${stepStatus(fired, index)}`;
    const last = lines[lines.length - 1];
    if (last && last.text === text) last.times++;
    else lines.push({ text, times: 1 });
  });
  return lines.map(line => (line.times > 1 ? `${line.text}（×${line.times}回）` : line.text));
}
