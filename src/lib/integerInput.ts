// 回数と閾値の入力欄は整数だけを受け付ける（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7）。
// 式は保存済みの設定を更新のときに直す bridge/config_migration.cjs と同じ（electron/test/integer-input.test.cjs が食い違いを見張る）。

/** 回数：四捨五入して 1〜100。数にならなければ 1。 */
export function toRepeat(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 1;
}

/** ルーレットの項目の重み：数なら 1 以上（上限なし・小数のまま）。数にならなければ 1。BRIDGE の weightOf と同じ（処理のコピー PR9）。 */
export function toWeight(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/** デスルーレットの「何回死ぬごと」：切り捨てて 1〜1000。数にならなければ既定。BRIDGE の deathRouletteEvery と同じ（処理のコピー PR9）。 */
export function toEveryDeaths(value: unknown, fallback: number): number {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.max(1, Math.min(1000, Math.floor(n))) : fallback;
}

/** いいね・フォローの閾値：四捨五入して 1 以上。数にならなければ 1。 */
export function toThreshold(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}
