const fs = require("node:fs");
const path = require("node:path");
const { FORGE_VERSION } = require("../electron/forge_version.cjs");
const { modJar } = require("./mod_jars.cjs");

// 実行済みサーバーを丸ごと配布しない。初回構築に必要な資材だけを許可する。
// obsJar：標準装備の OBSMOD（サーバーにだけ入れる。2026-10-25）。
function prepareServerTemplate(source, destination, modJar, displayJar, obsJar) {
  if (fs.existsSync(destination)) throw new Error("Server template output already exists; use a fresh build directory.");
  if (modJar && (!fs.existsSync(modJar) || !fs.statSync(modJar).isFile())) throw new Error(`Build the current BridgeMod first: ${modJar}`);
  if (displayJar && (!fs.existsSync(displayJar) || !fs.statSync(displayJar).isFile())) throw new Error(`Build the current DisplayMod first: ${displayJar}`);
  if (obsJar && (!fs.existsSync(obsJar) || !fs.statSync(obsJar).isFile())) throw new Error(`Build the current ObsMod first: ${obsJar}`);
  // GiftStream_Pack（古いデータパック）は配らない。サーバーフォルダーの直下では Minecraft に読まれず、中身もほかが受け持っている（2026-10-30 ユーザーの決定）。
  const directories = ["jdk-21.0.4+7", "libraries", "mods"];
  const files = [`forge-${FORGE_VERSION}-installer.jar`, "run.bat", "run.sh", "setup.bat", "user_jvm_args.txt"];
  for (const name of [...directories, ...files]) {
    const src = path.join(source, name);
    if (!fs.existsSync(src)) throw new Error(`Server build resource missing: ${name}`);
  }
  fs.mkdirSync(destination, { recursive: true });
  // 作業の道具（.omc・.claude）の記録のフォルダーも配らない。写すフォルダーの中で道具が動くとできる（2026-10-30。PR #168 レビュー 軽い2）。
  const shipped = src => !/\.(log|bak)$/i.test(src) && !path.relative(source, src).split(path.sep).some(part => /^\.(omc|claude)$/i.test(part));
  for (const name of [...directories, ...files]) {
    fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true, filter: shipped });
  }
  // A retained 47.3.x launcher must not silently start the old Forge after an upgrade.
  for (const name of ["run.bat", "run.sh", "setup.bat"]) {
    const file = path.join(destination, name);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/1\.20\.1-47\.\d+\.\d+/g, FORGE_VERSION));
  }
  if (modJar) {
    const mods = path.join(destination, "mods");
    // A fresh install includes the common MODs (BridgeMOD, DisplayMOD and the server-only OBSMOD). Game jars come from profiles.
    for (const name of fs.readdirSync(mods).filter(name => /\.jar$/i.test(name))) fs.unlinkSync(path.join(mods, name));
    fs.copyFileSync(modJar, path.join(mods, path.basename(modJar)));
    if (displayJar) fs.copyFileSync(displayJar, path.join(mods, path.basename(displayJar)));
    if (obsJar) fs.copyFileSync(obsJar, path.join(mods, path.basename(obsJar)));
  }
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  // The jar locations are decided in one place (scripts/mod_jars.cjs), shared with npm run release:win.
  prepareServerTemplate(path.join(root, "server", "Douma_Craft"), path.join(root, "build", "server-template"),
    modJar(root, "BridgeMod"), modJar(root, "DisplayMod"), modJar(root, "ObsMod"));
  console.log("Server template prepared (no worlds, player data, passwords or runtime settings).");
}
module.exports = { prepareServerTemplate };
