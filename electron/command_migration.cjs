const fs = require("node:fs");
const path = require("node:path");
// 書く前の中身を前の正しい状態の写しにする（設定ファイルの PR3）。
const { writeWithLastGood, peekJsonFile } = require("../bridge/safe_json_file.cjs");
const { bridgeCommandKey } = require("../bridge/command_files.cjs");
const { bridgeCommandsDir } = require("../bridge/config_defaults.cjs");

function migrateCommandReferences(config) {
  function visit(value, inArray = false) {
    if (Array.isArray(value)) return value.map(item => visit(item, true)).filter(item => item !== undefined);
    if (!value || typeof value !== "object") return value;
    const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    // .txt を除いた名前（大文字の .TXT も除く）は command_files.cjs の1か所で作る（2026-10-18）。
    const file = bridgeCommandKey(value.commandFile || "").toLowerCase();
    if (file === "seichi_donut") next.commandFile = "fall_sand.txt";
    if (file === "husk01") next.commandFile = "husk.txt";
    if (["tornado", "hukitobasu", "hurricane", "give_blindness", "petsummon"].includes(file)) {
      if (inArray) return undefined;
      next.commandFile = "";
      next.enabled = false;
    }
    return next;
  }
  const next = visit(config);
  // 演出・ゲーム性設定（options.gameplay）は仕掛けごとなくした。古い設定に残った分は読まずに放っておく（書き換えない。2026-10-30）。
  if (Object.hasOwn(config?.options || {}, "gameplay")) next.options.gameplay = config.options.gameplay;
  return next;
}

function migrateRetiredCommands(bridgeDir) {
  const configPath = path.join(bridgeDir, "config.minecraft.json");
  if (!fs.existsSync(configPath)) return;
  // ギフト設定が読めなければ何もしない（初期セットアップのやり直し・アップデートのあとの BRIDGE の更新を止めない。設定ファイルの PR3）。
  const before = peekJsonFile(configPath);
  if (!before) return;
  const raw = fs.readFileSync(configPath, "utf8");
  const after = migrateCommandReferences(before);
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const backup = path.join(bridgeDir, "retired-command-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(backup, { recursive: true });
  fs.writeFileSync(path.join(backup, "config.minecraft.json"), raw, { flag: "wx" });
  for (const file of ["seichi_donut.txt", "tornado.txt", "hukitobasu.txt", "hurricane.txt", "husk01.txt", "give_blindness.txt", "petsummon.txt"]) {
    const source = path.join(bridgeCommandsDir(bridgeDir), file);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(backup, file));
  }
  writeWithLastGood(configPath, JSON.stringify(after, null, 2));
}
module.exports = { migrateCommandReferences, migrateRetiredCommands };
