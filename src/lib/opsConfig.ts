// 運用センターの「変更を保存」で書く BRIDGE の設定（2026-10-30 ユーザーの決定で「詳細設定」のタブを消した）。
// 演出・ゲーム性設定（options.gameplay：コンボ・いいねやフォローの節目・コメントコマンド・時限モード）は、もう画面で直さない。
// 読み込んだときの写しで上書きせず、保存のときに読んだ最新の設定のものを残す。画面の判断だけを置き、React からも node:test からも使う。
type BridgeConfig = { options?: Record<string, unknown> } & Record<string, unknown>;

export function opsConfigToSave(latest: BridgeConfig, pageOptions: Record<string, unknown> | undefined): BridgeConfig {
  const { gameplay: _stale, ...options } = pageOptions || {};
  return { ...latest, options: { ...(latest.options || {}), ...options } };
}
