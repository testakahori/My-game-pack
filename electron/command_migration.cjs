const fs = require("node:fs");
const path = require("node:path");
const { atomicWrite } = require("./settings_backups.cjs");

function migrateCommandReferences(config) {
  function visit(value, inArray = false) {
    if (Array.isArray(value)) return value.map(item => visit(item, true)).filter(item => item !== undefined);
    if (!value || typeof value !== "object") return value;
    const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    const file = path.posix.basename(String(value.commandFile || "").replace(/\\/g, "/")).toLowerCase().replace(/\.txt$/, "");
    if (file === "seichi_donut") next.commandFile = "fall_sand.txt";
    if (file === "tornado") {
      if (inArray) return undefined;
      next.commandFile = "";
      next.enabled = false;
    }
    return next;
  }
  return visit(config);
}

function migrateRetiredCommands(bridgeDir) {
  const configPath = path.join(bridgeDir, "config.minecraft.json");
  if (!fs.existsSync(configPath)) return;
  const raw = fs.readFileSync(configPath, "utf8");
  const before = JSON.parse(raw);
  const after = migrateCommandReferences(before);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const backup = path.join(bridgeDir, "retired-command-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, "config.minecraft.json"), raw, { flag: "wx" });
  for (const file of ["seichi_donut.txt", "tornado.txt"]) {
    const source = path.join(bridgeDir, "commands", "minecraft", file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backup, file));
  }
  atomicWrite(configPath, JSON.stringify(after, null, 2));
}
module.exports = { migrateCommandReferences, migrateRetiredCommands };
