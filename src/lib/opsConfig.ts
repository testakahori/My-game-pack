// 運用センターの「変更を保存」で書く BRIDGE の設定（2026-10-30 ユーザーの決定で「詳細設定」のタブを消した）。
// 保存のときに読んだ最新の設定に、このページの options を重ねる。
// 演出・ゲーム性設定は仕掛けごとなくした（2026-10-30）。古い設定に残った分も外さずにそのまま書く（BRIDGE は読まない）。
// 画面の判断だけを置き、React からも node:test からも使う。
type BridgeConfig = { options?: Record<string, unknown> } & Record<string, unknown>;

export function opsConfigToSave(latest: BridgeConfig, pageOptions: Record<string, unknown> | undefined): BridgeConfig {
  return { ...latest, options: { ...(latest.options || {}), ...(pageOptions || {}) } };
}
