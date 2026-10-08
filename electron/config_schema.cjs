"use strict";

const { usesBridgeModTransport, commandFileRefs, invalidCommandFileRefs, refKey } = require("../bridge/command_files.cjs");

// previous: 保存済みの設定（複数可）。そこに同じ場所・同じ名前ですでにあった参照は警告に留める。
function validateBridgeConfig(config, { previous = [] } = {}) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["設定全体がJSONオブジェクトではありません"], warnings };
  }
  if (!String(config.tiktokUsername || "").trim()) {
    errors.push("TikTok IDが未承認です（「IDを承認する」ボタンが押されていません）。ダッシュボードでIDを入力して承認してください");
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
  if (config.mappings != null && !Array.isArray(config.mappings)) errors.push("mappings は配列で指定してください");
  const ids = new Set();
  for (const [index, mapping] of (Array.isArray(config.mappings) ? config.mappings : []).entries()) {
    const id = String(mapping?.giftId ?? "").trim();
    if (!id) errors.push(`mappings[${index}].giftId が空です`);
    if (!String(mapping?.commandFile || "").trim()) errors.push(`mappings[${index}].commandFile が空です`);
    if (id && ids.has(id)) warnings.push(`ギフトID ${id} が重複しています（後の設定が優先）`);
    ids.add(id);
  }
  for (const key of ["mutedUsers", "ttsNgWords"]) {
    if (options[key] != null && !Array.isArray(options[key])) errors.push(`options.${key} は配列で指定してください`);
  }
  // BridgeMOD が拒否する名前を新しく割り当てると、そのイベントは配信中に一度も実行されない。保存の時点で止める。
  // 前から保存されていた割り当ては警告に留める。古い設定のままでも一括起動・ID承認・ほかの保存は止めない
  // （Bridge はその1件を記録して飛ばし、後ろのギフトは届く）。
  if (usesBridgeModTransport(config)) {
    const known = new Set([].concat(previous).filter(Boolean).flatMap(saved => commandFileRefs(saved).map(refKey)));
    for (const ref of invalidCommandFileRefs(config)) {
      if (known.has(refKey(ref))) warnings.push(`${ref.message}（このイベントは実行されません）`);
      else errors.push(ref.message);
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBridgeConfig };
