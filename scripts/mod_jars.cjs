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
    // 標準装備の OBSMOD（そうてんもんさんの minecraft_obs_bridge）。サーバーにだけ入れる（Minecraft 本体には入れない。2026-10-25 ユーザーの決定）。
    { name: "OBSMOD", dir: "ObsMod", jar: propertyJar(root, "ObsMod"), serverOnly: true },
  ];
}

const modJar = (root, dir) => modJars(root).find(mod => mod.dir === dir).jar;

function modProperty(root, dir, key) {
  const value = fs.readFileSync(path.join(root, dir, "gradle.properties"), "utf8").match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
  if (!value) throw new Error(`${dir}/gradle.properties に ${key} がありません`);
  return value;
}

// jar の名前が <mod_id>-<mod_version>.jar の MOD（build.gradle の archivesName = mod_id。そうてんもんさんの MOD）。
const propertyJar = (root, dir) => path.join(root, dir, "build", "libs", `${modProperty(root, dir, "mod_id")}-${modVersion(root, dir)}.jar`);

// 作るが、まだ同梱しない MOD（そうてんもんさんの埋め立ての MOD。2026-10-24 取り込み）。CI の印の照らし合わせ（check-jar-inputs.cjs）だけが見る。同梱するときは modJars へ移す。
function buildOnlyModJars(root) {
  return [
    { name: "埋め立てMOD", dir: "UmetateMod", jar: propertyJar(root, "UmetateMod"), uses: { name: "BridgeMOD", dir: "BridgeMod" } },
  ];
}

module.exports = { modJars, modJar, modVersion, buildOnlyModJars };
