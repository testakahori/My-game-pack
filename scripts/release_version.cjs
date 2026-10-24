"use strict";
// 配るインストーラーの版の決まり：正式な版は 1.2.3 の形、試し用の版（-local.）はそれを含む。
// scripts/release-windows.cjs（ビルドの前に確かめる）と scripts/package-windows.cjs（作る直前に確かめる）が使う。
function assertReleaseVersion(version, local) {
  const text = String(version || "");
  if (local ? !text.includes("-local.") : !/^\d+\.\d+\.\d+$/.test(text)) {
    throw new Error(local ? "Use a -local. version for a local package" : "Use a stable version for a release package");
  }
}

module.exports = { assertReleaseVersion };
