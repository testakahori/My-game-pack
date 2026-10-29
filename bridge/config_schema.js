"use strict";

// 設定（config.minecraft.json）の確かめはこの1つ。BRIDGE の起動・再読込と、アプリ（保存・config:validate・プリセットの読込・
// 配信前チェック・バックアップの一覧）が同じものを使う（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7・9）。
const { usesBridgeModTransport, isKnownTransport, commandFileRefs, invalidCommandFileRefs } = require("./command_files.cjs");
const { repeatTargets, thresholdTargets } = require("./config_migration.cjs");
const { normalizeTikTokId, tiktokIdProblem } = require("./tiktok_id.cjs");

const isInteger = (value, min, max = Infinity) => Number.isInteger(value) && value >= min && value <= max;

// previous: 保存済みの設定（配列。読めなかった設定は null）。アプリの保存・プリセットの読込が渡す。
//   渡さないとき（BRIDGE・配信前チェック・バックアップの一覧）は、BridgeMOD が受け付けない名前をすべて保存済みとみなして警告に留める。
//   渡したときは、保存済みの設定に同じコマンドの名前があれば警告、なければ新しく足した名前としてエラーにする。
function validateBridgeConfig(config, { previous } = {}) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["設定全体がJSONオブジェクトではありません"], warnings };
  }
  // 空かは整えた形で見る（「@」だけ・文字列でない値も未承認）。
  if (!normalizeTikTokId(config.tiktokUsername)) {
    errors.push("TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。配信ホームでIDを入力して承認してください");
  } else if (tiktokIdProblem(config.tiktokUsername)) {
    // 文は bridge/tiktok_id.cjs の1か所（ギフト一覧の更新・画面も同じ文。処理のコピー PR9）。
    errors.push(tiktokIdProblem(config.tiktokUsername));
  }
  const options = config.options || {};
  for (const [name, value, min, max] of [
    ["options.giftCooldownMs", options.giftCooldownMs, 0, 60000],
    ["options.maxCommandsPerGift", options.maxCommandsPerGift, 1, 10000],
    ["options.maxLikeCatchUpPerEvent", options.maxLikeCatchUpPerEvent, 1, 100],
    ["options.likeBatchWindowMs", options.likeBatchWindowMs, 100, 10000],
    ["options.bridgeModPort", options.bridgeModPort, 1, 65535],
    ["options.doumaModPort", options.doumaModPort, 1, 65535],
  ]) {
    if (value != null && (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max)) {
      errors.push(`${name} は ${min}～${max} の数値で指定してください`);
    }
  }
  if (!isKnownTransport(options.commandTransport)) {
    warnings.push(`options.commandTransport「${options.commandTransport}」は知らない送り方です。RCON として扱います（BridgeMOD で送るなら bridge_mod）`);
  }
  if (config.mappings != null && !Array.isArray(config.mappings)) errors.push("mappings は配列で指定してください");
  const ids = new Set();
  for (const [index, mapping] of (Array.isArray(config.mappings) ? config.mappings : []).entries()) {
    const id = String(mapping?.giftId ?? "").trim();
    if (!id) errors.push(`mappings[${index}].giftId が空です`);
    if (!String(mapping?.commandFile || "").trim()) errors.push(`mappings[${index}].commandFile が空です`);
    if (id && ids.has(id)) warnings.push(`ギフトID ${id} が重複しています（後の設定が優先）`);
    ids.add(id);
  }
  // 回数・閾値は、無効の項目も確かめる（あとで有効にされるため）。古い版の値は更新のときに1回だけ直してある（config_migration.cjs）。
  for (const { where, item } of repeatTargets(config)) {
    if (item.repeat !== undefined && !isInteger(item.repeat, 1, 100)) errors.push(`${where}の回数は 1〜100 の整数で指定してください（今は ${JSON.stringify(item.repeat)}）`);
  }
  for (const { where, item } of thresholdTargets(config)) {
    if (item.threshold !== undefined && !isInteger(item.threshold, 1)) errors.push(`${where}の閾値は 1 以上の整数で指定してください（今は ${JSON.stringify(item.threshold)}）`);
  }
  for (const key of ["mutedUsers", "ttsNgWords"]) {
    if (options[key] != null && !Array.isArray(options[key])) errors.push(`options.${key} は配列で指定してください`);
  }
  // BridgeMOD が受け付けない名前は、配信中にそのイベントが一度も実行されない。BRIDGE はその1件を記録して飛ばし、後ろのギフトは届く。
  // 前から保存されていた名前は警告に留め、古い設定のままでも一括起動・ID承認・ほかの保存は止めない。新しく足した名前は保存で止める。
  if (usesBridgeModTransport(config)) {
    const known = previous === undefined ? null
      : new Set([].concat(previous).filter(Boolean).flatMap(saved => commandFileRefs(saved).map(ref => ref.commandFile)));
    for (const ref of invalidCommandFileRefs(config)) {
      if (!known || known.has(ref.commandFile)) warnings.push(`${ref.message}（このイベントは実行されません）`);
      else errors.push(ref.message);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBridgeConfig };
