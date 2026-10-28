"use strict";
// 同梱する MOD の jar の場所の決まり（この1か所）。scripts/prepare-server-template.cjs・prepare-game-packs.cjs・
// release-windows.cjs・check-jar-inputs.cjs が使う。前は3か所に写しがあり、ずれると確かめる jar と同梱する jar が別になった（2026-10-24 最後のレビュー 軽い1）。
const fs = require("node:fs");
const path = require("node:path");
const { GAMES } = require("../bridge/game_commands.cjs");

function modVersion(root, dir) {
  const version = fs.readFileSync(path.join(root, dir, "gradle.properties"), "utf8").match(/^mod_version=(.+)$/m)?.[1]?.trim();
  if (!version) throw new Error(`${dir}/gradle.properties に mod_version がありません`);
  return version;
}

// uses：その MOD を作るときに使う別の MOD（採掘MOD は BridgeMOD のクラスを使う。SaikutuMod/build.gradle の compileOnly）。
function modJars(root) {
  const libs = dir => path.join(root, dir, "build", "libs");
  // ゲームパックで同梱するゲームの MOD（bridge/games.json の modDir があるもの：埋め立て・採掘。埋め立ては 2026-10-29 埋め立て PR2）。
  // jar の名前は game-packs/<id>/game.json の serverJar。どちらも BridgeMOD のクラスを使って作る（build.gradle の compileOnly）。
  const packMods = GAMES.filter(game => game.modDir).map(game => ({
    name: `${game.name}MOD`, dir: game.modDir,
    jar: path.join(libs(game.modDir), JSON.parse(fs.readFileSync(path.join(root, "game-packs", game.id, "game.json"), "utf8")).serverJar),
    uses: { name: "BridgeMOD", dir: "BridgeMod" },
  }));
  return [
    { name: "BridgeMOD", dir: "BridgeMod", jar: path.join(libs("BridgeMod"), `bridgemod-${modVersion(root, "BridgeMod")}.jar`) },
    { name: "DisplayMOD", dir: "DisplayMod", jar: path.join(libs("DisplayMod"), `displaymod-${modVersion(root, "DisplayMod")}.jar`) },
    ...packMods,
    // 標準装備の OBSMOD（そうてんもんさんの minecraft_obs_bridge）。サーバーにだけ入れる（Minecraft 本体には入れない。2026-10-25 ユーザーの決定）。
    // serverOnly は目印。サーバーにだけ入れる決まりは、electron/game_profiles.cjs（本体の側に入れない）・electron/bridge_sync.cjs・scripts/prepare-server-template.cjs にある。
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

module.exports = { modJars, modJar, modVersion };
