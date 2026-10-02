// Minecraft 1.20.1 / Forge recommended release used by setup and distribution.
const FORGE_VERSION = "1.20.1-47.4.10";
const FORGE_CLIENT_ID = "1.20.1-forge-47.4.10";
const FORGE_DIR = `libraries/net/minecraftforge/forge/${FORGE_VERSION}`;
function detectServerForgeVersion(root) {
  const fs = require("node:fs");
  const path = require("node:path");
  try {
    const script = fs.readFileSync(path.join(root, "run.bat"), "utf8");
    const activeLines = script.split(/\r?\n/).filter(line => !/^\s*(?:rem\b|::)/i.test(line)).join("\n");
    const match = activeLines.match(/libraries[\\/]net[\\/]minecraftforge[\\/]forge[\\/](1\.20\.1-47\.\d+\.\d+)[\\/]win_args\.txt/i);
    if (!match || !fs.existsSync(path.join(root, "libraries/net/minecraftforge/forge", match[1], "win_args.txt"))) return "";
    return match[1];
  } catch { return ""; }
}
module.exports = { FORGE_VERSION, FORGE_CLIENT_ID, FORGE_DIR, detectServerForgeVersion };
