const fs = require("node:fs");
const path = require("node:path");

// 実行済みサーバーを丸ごと配布しない。初回構築に必要な資材だけを許可する。
function prepareServerTemplate(source, destination, modJar, displayJar) {
  if (fs.existsSync(destination)) throw new Error("Server template output already exists; use a fresh build directory.");
  if (modJar && (!fs.existsSync(modJar) || !fs.statSync(modJar).isFile())) throw new Error(`Build the current BridgeMod first: ${modJar}`);
  if (displayJar && (!fs.existsSync(displayJar) || !fs.statSync(displayJar).isFile())) throw new Error(`Build the current DisplayMod first: ${displayJar}`);
  const directories = ["jdk-21.0.4+7", "libraries", "mods", "GiftStream_Pack"];
  const files = ["forge-1.20.1-47.3.0-installer.jar", "run.bat", "run.sh", "setup.bat", "user_jvm_args.txt"];
  for (const name of [...directories, ...files]) {
    const src = path.join(source, name);
    if (!fs.existsSync(src)) throw new Error(`Server build resource missing: ${name}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const name of [...directories, ...files]) {
    fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, filter: src => !/\.(log|bak)$/i.test(src) });
  }
  if (modJar) {
    const mods = path.join(destination, "mods");
    // A fresh install includes the two independent common MODs. Game jars come from profiles.
    for (const name of fs.readdirSync(mods).filter(name => /\.jar$/i.test(name))) fs.unlinkSync(path.join(mods, name));
    fs.copyFileSync(modJar, path.join(mods, path.basename(modJar)));
    if (displayJar) fs.copyFileSync(displayJar, path.join(mods, path.basename(displayJar)));
  }
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const version = fs.readFileSync(path.join(root, "BridgeMod", "gradle.properties"), "utf8").match(/^mod_version=(.+)$/m)?.[1]?.trim();
  if (!version) throw new Error("BridgeMod version is missing");
  const displayVersion = fs.readFileSync(path.join(root, "DisplayMod", "gradle.properties"), "utf8").match(/^mod_version=(.+)$/m)?.[1]?.trim();
  if (!displayVersion) throw new Error("DisplayMod version is missing");
  prepareServerTemplate(path.join(root, "server", "Douma_Craft"), path.join(root, "build", "server-template"),
    path.join(root, "BridgeMod", "build", "libs", `bridgemod-${version}.jar`),
    path.join(root, "DisplayMod", "build", "libs", `displaymod-${displayVersion}.jar`));
  console.log("Server template prepared (no worlds, player data, passwords or runtime settings).");
}
module.exports = { prepareServerTemplate };
