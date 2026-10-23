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

// 形が正しくないときの文（設定の確かめ・ギフト一覧の更新・画面が同じ文を出す。処理のコピー PR9）。正しければ空。
// 空の値も空を返す（空のときの文は場所ごとに違うので、呼ぶ側が決める）。
function tiktokIdProblem(value) {
  if (!normalizeTikTokId(value) || isValidTikTokId(value)) return "";
  return `TikTok ID「${String(value).trim()}」の形が正しくありません。半角英数字・_・. の24文字以内で入力してください`;
}

module.exports = { normalizeTikTokId, isValidTikTokId, tiktokIdProblem };
