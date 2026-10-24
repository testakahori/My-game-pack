"use strict";
// 同梱する MOD の jar の場所の決まり（この1か所）。scripts/prepare-server-template.cjs・prepare-game-packs.cjs・
// release-windows.cjs・check-jar-inputs.cjs が使う。前は3か所に写しがあり、ずれると確かめる jar と同梱する jar が別になった（2026-10-24 最後のレビュー 軽い1）。
const fs = require("node:fs");
const path = require("node:path");

function modVersion(root, dir) {
  const version = fs.readFileSync(path.join(root, dir, "gradle.properties"), "utf8").match(/^mod_version=(.+)$/m)?.[1]?.trim();
  if (!version) throw new Error(`${dir}/gradle.properties に mod_version がありません`);
  return version;
}

// uses：その MOD を作るときに使う別の MOD（採掘MOD は BridgeMOD のクラスを使う。SaikutuMod/build.gradle の compileOnly）。
function modJars(root) {
  const saikutu = JSON.parse(fs.readFileSync(path.join(root, "game-packs/saikutu/game.json"), "utf8"));
  const libs = dir => path.join(root, dir, "build", "libs");
  return [
    { name: "BridgeMOD", dir: "BridgeMod", jar: path.join(libs("BridgeMod"), `bridgemod-${modVersion(root, "BridgeMod")}.jar`) },
    { name: "DisplayMOD", dir: "DisplayMod", jar: path.join(libs("DisplayMod"), `displaymod-${modVersion(root, "DisplayMod")}.jar`) },
    { name: "採掘MOD", dir: "SaikutuMod", jar: path.join(libs("SaikutuMod"), saikutu.serverJar), uses: { name: "BridgeMOD", dir: "BridgeMod" } },
  ];
}

const modJar = (root, dir) => modJars(root).find(mod => mod.dir === dir).jar;

module.exports = { modJars, modJar, modVersion };
