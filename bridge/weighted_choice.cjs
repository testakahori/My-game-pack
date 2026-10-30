"use strict";

// RANDOM の割り当て（# RANDOM: と # WEIGHT:）の重みの読み方と抽選。BRIDGE（bridge/index.js）とアプリのコマンドの一覧（command_rows.cjs）が使う。
// 前は bridge/feature_engine.js の先頭にあった。演出・ゲーム性設定（FeatureEngine）を消したので、この3つだけを移した（2026-10-30）。

// txt に書かれた重みは有限の数だけ採用し、1未満・数値以外は 1 として扱う（NaN で抽選が壊れないように）。
function weightOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

function parseWeightedList(raw) {
  return String(raw || "").split(",").map(part => {
    const [file, weightRaw] = part.trim().split(/[=*]/);
    return { commandFile: file?.trim(), weight: weightOf(weightRaw ?? 1),
      explicitWeight: weightRaw != null };
  }).filter(x => x.commandFile);
}

function chooseWeighted(items, random = Math.random) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (!items.length) return null;
  if (!Number.isFinite(total) || total <= 0) return items[0];
  let cursor = random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return items[items.length - 1] || null;
}

module.exports = { parseWeightedList, chooseWeighted, weightOf };
