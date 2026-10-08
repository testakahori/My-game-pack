"use strict";

const { usesBridgeModTransport, invalidCommandFileRefs } = require("../bridge/command_files.cjs");

function validateBridgeConfig(config) {
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
  // BridgeMOD が拒否する名前を割り当てると、そのイベントは配信中に一度も実行されない。保存の時点で止める。
  if (usesBridgeModTransport(config)) errors.push(...invalidCommandFileRefs(config));
  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateBridgeConfig };
