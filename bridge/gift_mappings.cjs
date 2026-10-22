"use strict";

// ギフト割り当ての「使う形」（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10。処理のコピー PR5）。
// BRIDGE の起動と再読込、ギフトのテンプレートがこの1か所を使う。保存する形（画面が送る名前など）は変えない。
const { ensureTxt } = require("./command_files.cjs");
const { boundedInt } = require("./event_rules.cjs");

// giftId は前後の空白を除いた文字列（空なら null）。名前は前後の空白を除き、空なら gift:<giftId>。
// コマンドは .txt を付ける。回数は 1〜100（既定 1）。enabled は false のときだけ無効（そのコマンドを動かさない）。
function giftMappingOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  const giftId = String(raw.giftId ?? "").trim();
  if (!giftId) return null;
  return {
    giftId,
    name: String(raw.name ?? "").trim() || `gift:${giftId}`,
    commandFile: ensureTxt(String(raw.commandFile ?? "").trim()),
    repeat: boundedInt(raw.repeat ?? 1, 1, 100, 1),
    enabled: raw.enabled !== false,
  };
}

// giftId ごとの割り当て。同じ giftId は後のものを使う（前の BRIDGE と同じ）。配列でなければ空。
function giftMappingsById(list) {
  const byId = new Map();
  for (const raw of Array.isArray(list) ? list : []) {
    const mapping = giftMappingOf(raw);
    if (mapping) byId.set(mapping.giftId, mapping);
  }
  return byId;
}

module.exports = { giftMappingOf, giftMappingsById };
