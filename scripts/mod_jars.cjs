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

function modJars(root) {
  const libs = dir => path.join(root, dir, "build", "libs");
  // ゲームパックで同梱するゲームの MOD（bridge/games.json の modDir があるもの：埋め立て・採掘。埋め立ては 2026-10-29 埋め立て PR2）。
  // jar の名前は game-packs/<id>/game.json の serverJar。
  const packMods = GAMES.filter(game => game.modDir).map(game => ({
    name: `${game.name}MOD`, dir: game.modDir,
    jar: path.join(libs(game.modDir), JSON.parse(fs.readFileSync(path.join(root, "game-packs", game.id, "game.json"), "utf8")).serverJar),
  }));
  return withUses(root, [
    { name: "BridgeMOD", dir: "BridgeMod", jar: path.join(libs("BridgeMod"), `bridgemod-${modVersion(root, "BridgeMod")}.jar`) },
    { name: "DisplayMOD", dir: "DisplayMod", jar: path.join(libs("DisplayMod"), `displaymod-${modVersion(root, "DisplayMod")}.jar`) },
    ...packMods,
    // 標準装備の OBSMOD（そうてんもんさんの minecraft_obs_bridge）。サーバーにだけ入れる（Minecraft 本体には入れない。2026-10-25 ユーザーの決定）。
    // serverOnly は目印。サーバーにだけ入れる決まりは、electron/game_profiles.cjs（本体の側に入れない）・electron/bridge_sync.cjs・scripts/prepare-server-template.cjs にある。
    { name: "OBSMOD", dir: "ObsMod", jar: propertyJar(root, "ObsMod"), serverOnly: true },
  ]);
}

// uses：その MOD を作るときに使う別の MOD（採掘MOD・埋め立てMOD は BridgeMOD のクラスを使う。build.gradle の compileOnly）。
// <MOD>/build.gradle の ext.jarInputsAlso（scripts/jar_inputs.gradle が jar の印に一緒に入れる MOD）から読み、ここに写しを持たない（埋め立て PR2 の最後のレビュー 軽い6）。
// 確かめる側（release-windows.cjs・check-jar-inputs.cjs）は1つだけを見るので、2つ以上と、同梱しない MOD は止める。
function withUses(root, mods) {
  return mods.map(mod => {
    const file = path.join(root, mod.dir, "build.gradle");
    const list = fs.existsSync(file) ? fs.readFileSync(file, "utf8").match(/^\s*ext\.jarInputsAlso\s*=\s*\[([^\]]*)\]/m)?.[1] : undefined;
    const dirs = list ? [...list.matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]) : [];
    if (!dirs.length) return mod;
    const uses = mods.find(other => other.dir === dirs[0]);
    if (dirs.length > 1 || !uses) throw new Error(`${mod.dir}/build.gradle の jarInputsAlso は、同梱する MOD を1つだけにしてください（${dirs.join("、")}）`);
    return { ...mod, uses: { name: uses.name, dir: uses.dir } };
  });
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
