"use strict";

// TikTok ID の整え方と確かめ（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 9）。
// 設定の確かめ・配信前チェック・LIVE の確かめ・BRIDGE の接続が、この1か所を使う。保存する形は変えず、使う所で整える。
const TIKTOK_ID = /^[a-z0-9_.]{1,24}$/;

// 前後の空白と先頭の @ を除き、小文字にする。文字列でなければ空。
function normalizeTikTokId(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^@/, "").toLowerCase();
}

function isValidTikTokId(value) {
  return TIKTOK_ID.test(normalizeTikTokId(value));
}

module.exports = { normalizeTikTokId, isValidTikTokId };
