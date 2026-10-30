"use strict";

// 回数（repeat）といいねの閾値（threshold）の置き場所と、保存済みの設定を更新のときに1回だけ直す式
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7）。
// 設定の確かめ（config_schema.js）も同じ置き場所の一覧を使う。場所の名前は command_files.cjs の commandFileRefs と同じ。
const CONFIG_VERSION = 2;

const list = value => (Array.isArray(value) ? value : []);
const isItem = value => !!value && typeof value === "object" && !Array.isArray(value);

// 回数を書ける所すべて。あとで有効にされるので、enabled は見ない。
// 演出・ゲーム性設定（options.gameplay）は仕掛けごとなくしたので並べない。古い設定に残っていても直さず消さない（2026-10-30）。
function repeatTargets(config) {
  const targets = [];
  const add = (where, item) => { if (isItem(item)) targets.push({ where, item }); };
  for (const m of list(config?.mappings)) add(`ギフト割り当て（${m?.name || m?.giftId || "名前なし"}）`, m);
  for (const ev of list(config?.likeEvents)) add(`いいね（${ev?.threshold ?? "?"}いいねごと）`, ev);
  for (const [key, label] of [["shareEvent", "シェア"], ["followEvent", "フォロー"], ["memberEvent", "訪問"], ["unmappedGiftEvent", "未設定ギフト"]]) add(label, config?.[key]);
  for (const item of list(config?.roulette?.items)) add(`ルーレット項目（${item?.label || item?.commandFile}）`, item);
  for (const item of list(config?.deathRoulette?.items)) add(`デスルーレット項目（${item?.label || item?.commandFile}）`, item);
  for (const rule of list(config?.commentGifts?.rules)) add(`コメントギフト（「${rule?.match ?? ""}」）`, rule);
  return targets;
}

// いいねの閾値を書ける所。
function thresholdTargets(config) {
  const targets = [];
  const add = (where, item) => { if (isItem(item)) targets.push({ where, item }); };
  for (const ev of list(config?.likeEvents)) add(`いいね（${ev?.threshold ?? "?"}いいねごと）`, ev);
  return targets;
}

// 回数は四捨五入して 1〜100、数にならなければ 1。閾値は四捨五入して 1 以上、数にならなければ 1。
function fixRepeat(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 1;
}
function fixThreshold(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

// 直した写しと、直したもの（場所・前の値・あとの値）を返す。元の設定は変えない。書いていない値は足さない。
// オブジェクトでないもの（壊れたプリセットなど）はそのまま返し、確かめに「設定全体がJSONオブジェクトではありません」を出させる。
function migrateBridgeConfig(config) {
  if (!isItem(config)) return { config, changes: [] };
  const copy = structuredClone(config);
  const changes = [];
  // 場所の名前は直す前の値で決める（「いいね（0いいねごと）の閾値 0 → 1」）。
  const repeats = repeatTargets(copy);
  const thresholds = thresholdTargets(copy);
  const fix = (targets, key, label, fixer) => {
    for (const { where, item } of targets) {
      if (item[key] === undefined) continue;
      const next = fixer(item[key]);
      if (Object.is(next, item[key])) continue;
      changes.push(`${where}の${label} ${JSON.stringify(item[key])} → ${next}`);
      item[key] = next;
    }
  };
  fix(thresholds, "threshold", "閾値", fixThreshold);
  fix(repeats, "repeat", "回数", fixRepeat);
  copy.configVersion = CONFIG_VERSION;
  return { config: copy, changes };
}

module.exports = { CONFIG_VERSION, repeatTargets, thresholdTargets, migrateBridgeConfig };
