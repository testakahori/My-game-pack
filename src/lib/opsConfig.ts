// 運用センターの「変更を保存」で書く BRIDGE の設定（2026-10-30 ユーザーの決定で「詳細設定」のタブを消した）。
// 演出・ゲーム性設定（options.gameplay：コンボ・いいねやフォローの節目・コメントコマンド・時限モード）は、もう画面で直さない。
// gameplay だけは、読み込んだときの写しで上書きせず、保存のときに読んだ最新の設定のものを残す（ほかの options は今までどおり、このページの値を書く）。
// 画面の判断だけを置き、React からも node:test からも使う。
type BridgeConfig = { options?: Record<string, unknown> } & Record<string, unknown>;

/** このページが書く options（gameplay を外したもの）。保存と、未保存かどうかの比べの両方で使う。 */
export function withoutGameplay(options: Record<string, unknown> | undefined): Record<string, unknown> {
  const { gameplay: _stale, ...rest } = options || {};
  return rest;
}

export function opsConfigToSave(latest: BridgeConfig, pageOptions: Record<string, unknown> | undefined): BridgeConfig {
  return { ...latest, options: { ...(latest.options || {}), ...withoutGameplay(pageOptions) } };
}
