// 配信ホームのゲームの欄の選択肢（2026-10-29 ユーザーの決定）。サバイバル（common）は選択肢に出さない（games.json の selectable: false）。
// 中では「まだゲームを選んでいない状態」として残す（ゲームの切り替え・ギフト設定の決まりはそのまま）。画面の判断だけを置き、React からも node:test からも使う。
type Game = { id: string; selectable?: boolean };

const selectable = (game: Game | undefined) => Boolean(game) && game!.selectable !== false;

/** 選択肢に出すゲーム（games.json の順）。 */
export function gameChoices<T extends Game>(games: T[]): T[] {
  return games.filter(selectable);
}

/** 選ぶ欄に出す名前。準備中のゲーム（games.json の preparing。今は RUN）は「（準備中）」、ゲームパックを入れていないゲームは「（未導入）」を付ける（2026-10-30 ユーザーの決定）。 */
export function gameOptionLabel(game: { name: string; preparing?: boolean; installed?: boolean }): string {
  if (game.preparing) return `${game.name}（準備中）`;
  return game.installed === false ? `${game.name}（未導入）` : game.name;
}

/** 選ぶ欄で選べないか。準備中のゲームは、ゲームパックを入れていても選べない（RUN ができたら games.json の preparing を外す）。 */
export function gameOptionDisabled(game: { preparing?: boolean }): boolean {
  return game.preparing === true;
}

/** 欄で選んでおくゲーム。今のゲームが選択肢に無い（サバイバルのまま。新しく入れた人）ときは、何も選ばない（''。「選んでください」を出す）。
 * ゲームを選ばないと遊べない（2026-10-29 ユーザーの決定）。 */
export function shownGame(status: { active: string; games: Game[] }): string {
  return selectable(status.games.find(game => game.id === status.active)) ? status.active : '';
}

/** 保存済みに見せるか：保存していて、今のゲームが選択肢にあるとき。サバイバルを保存していたときは「未保存」に見せる。 */
export function savedGame(status: { active: string; applied: boolean; games: Game[] }): boolean {
  return status.applied && selectable(status.games.find(game => game.id === status.active));
}

/** 未保存の変更か（ゲームの欄の帯と、ページを移るときの確かめ）。まだ読み込んでいない・選んだゲームが決まっていない（null）ときは変更にしない。 */
export function gameDirty(status: { active: string; games: Game[] } | null, selected: string | null): boolean {
  return Boolean(status) && selected !== null && selected !== shownGame(status!);
}

/** 遊べるか（一括起動・BRIDGE の起動・ギフト設定など）：選択肢のゲームを保存していて、切り替えの復旧が要らないとき。 */
export function gameReadyOf(status: { active: string; applied: boolean; recoveryRequired: boolean; games: Game[] } | null): boolean {
  return Boolean(status) && savedGame(status!) && !status!.recoveryRequired;
}
