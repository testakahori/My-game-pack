const fs = require("node:fs");
const path = require("node:path");

// 実行済みサーバーを丸ごと配布しない。初回構築に必要な資材だけを許可する。
function prepareServerTemplate(source, destination) {
  if (fs.existsSync(destination)) throw new Error("Server template output already exists; use a fresh build directory.");
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
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  prepareServerTemplate(path.join(root, "server", "Douma_Craft"), path.join(root, "build", "server-template"));
  console.log("Server template prepared (no worlds, player data, passwords or runtime settings).");
}
module.exports = { prepareServerTemplate };
