"use strict";

// 音・粒子の ID（Minecraft のリソースの名前）の決まり（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 10。処理のコピー PR7）。
// 受け取る側の DisplayMOD（DisplayRequest.resource）と同じ。bridge/test/fixtures/minecraft-ids.json を
// scripts/test-bridge-contracts.cjs で JavaScript と DisplayMOD の両方に通して合わせる。
// 空でなく、200 文字以内で、「名前空間:」（無くてよい）と、英小文字・数字・_ . - / の名前。a:b:c・:x・x: は断る。
const RESOURCE_ID = /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/;

function isResourceId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && RESOURCE_ID.test(value);
}

module.exports = { isResourceId };
