"use strict";
// そうてんもんさんの MOD のイベントの一覧（events.master.json）から、ObsMod の写しと3つの Java を作る。
// 届いた道具（tools/sync_event_master.py）を、こちらの置き方（ObsMod/・UmetateMod/）に合わせて移した（2026-10-24 最後のレビュー 軽い2）。
// 決まり（一覧の確かめ・作る Java の形）は届いた道具と同じ。元は UmetateMod の写し（埋め立てのイベントが中心のため）。
// 使い方：node scripts/sync-event-master.cjs（作り直す）／--check（ずれがあれば終了コード 2）。テスト（electron/test/soutenmon-mods.test.cjs）もずれを止める。
const fs = require("node:fs");
const path = require("node:path");

const MASTER = "UmetateMod/src/main/resources/event-master/events.master.json";
const OBS_MASTER = "ObsMod/src/main/resources/event-master/events.master.json";
const SG_KEYS = "UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/EventMasterKeys.java";
const SG_CATALOG = "UmetateMod/src/main/java/jp/streamtorearn/stackinggame/integration/StackingEventCatalog.java";
const OBS_EVENTS = "ObsMod/src/main/java/jp/streamtorearn/obsmodule/catalog/EventMaster.java";
const TOOL = "scripts/sync-event-master.cjs";

const ALLOWED_CATEGORIES = new Set(["stackinggame", "mob", "buff", "debuff"]);
const ALLOWED_TARGET = new Set(["PLAYER", "ARENA"]);
const ALLOWED_BLOCK = new Set(["NONE", "TEMPORARY", "TERRAIN", "STACK_ONLY", "STACK_FALLING"]);
const ALLOWED_STATUS = new Set(["implemented", "candidate"]);
const REQUIRED_COMMON = ["id", "category", "displayName", "startKey", "encounterKey", "encounterEnabledByDefault", "tier", "source", "implementationStatus"];

const BS = String.fromCharCode(92), QUOTE = String.fromCharCode(34), NL = String.fromCharCode(10);
// Java の文字列の書き方（届いた道具の jstr と同じ。\ と " と改行だけを書き換える）。
const jstr = value => QUOTE + (value == null ? "" : String(value)).split(BS).join(BS + BS).split(QUOTE).join(BS + QUOTE).split(NL).join(BS + "n") + QUOTE;
const constName = key => key.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
const str = value => (value == null ? "" : String(value));

function validateMaster(data) {
  const errors = [];
  if (data.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!str(data.catalogVersion).trim()) errors.push("catalogVersion is required");
  let events = data.events;
  if (!Array.isArray(events) || !events.length) { errors.push("events must be a non-empty array"); events = []; }
  const ids = new Set(), starts = new Set(), encounters = new Set();
  events.forEach((e, i) => {
    const p = `events[${i}]`;
    if (!e || typeof e !== "object" || Array.isArray(e)) { errors.push(`${p} must be an object`); return; }
    const missing = REQUIRED_COMMON.filter(k => !(k in e)).sort();
    if (missing.length) errors.push(`${p} missing: ${missing.join(", ")}`);
    const id = str(e.id), sk = str(e.startKey), ek = str(e.encounterKey);
    if (!id) errors.push(`${p}.id is blank`); else if (ids.has(id)) errors.push(`duplicate id: ${id}`);
    ids.add(id);
    if (!sk) errors.push(`${p}.startKey is blank`); else if (starts.has(sk)) errors.push(`duplicate startKey: ${sk}`);
    starts.add(sk);
    if (ek) { if (encounters.has(ek)) errors.push(`duplicate encounterKey: ${ek}`); encounters.add(ek); }
    if (!ALLOWED_CATEGORIES.has(e.category)) errors.push(`${p}.category invalid: ${e.category}`);
    if (!ALLOWED_STATUS.has(e.implementationStatus)) errors.push(`${p}.implementationStatus invalid: ${e.implementationStatus}`);
    if (typeof e.encounterEnabledByDefault !== "boolean") errors.push(`${p}.encounterEnabledByDefault must be boolean`);
    if (e.category === "stackinggame") {
      if (!ALLOWED_TARGET.has(e.targetMode)) errors.push(`${p}.targetMode invalid: ${e.targetMode}`);
      if (!ALLOWED_BLOCK.has(e.blockInteractionMode)) errors.push(`${p}.blockInteractionMode invalid: ${e.blockInteractionMode}`);
      if (e.implementationStatus !== "implemented") errors.push(`${p}: stackinggame entries must be implemented`);
      if (!ek) errors.push(`${p}: stackinggame encounterKey is required`);
    } else if (e.category === "mob") {
      if (!str(e.entityId).trim()) errors.push(`${p}.entityId required for mob`);
      if (!str(e.attackKind).trim()) errors.push(`${p}.attackKind required for mob`);
    } else if (e.category === "buff" || e.category === "debuff") {
      if (!str(e.effectId).trim()) errors.push(`${p}.effectId required for ${e.category}`);
      if (ek) errors.push(`${p}: buff/debuff encounterKey should be blank`);
    }
  });
  if (errors.length) throw new Error(`Event Master validation failed:\n- ${errors.join("\n- ")}`);
  return data;
}

const lines = list => list.join("\n") + "\n";

function sgKeys(data) {
  const out = ["package jp.streamtorearn.stackinggame.integration;", "", `/** GENERATED from event-master/events.master.json by ${TOOL}. Do not edit. */`, "public final class EventMasterKeys {", "    private EventMasterKeys() {}", `    public static final String CATALOG_VERSION = ${jstr(data.catalogVersion)};`];
  for (const e of data.events.filter(e => e.category === "stackinggame")) {
    const c = constName(e.startKey);
    out.push(`    public static final String ${c} = ${jstr(e.startKey)};`);
    if (e.encounterKey) out.push(`    public static final String ${c}_ENCOUNTER = ${jstr(e.encounterKey)};`);
  }
  out.push("}");
  return lines(out);
}

function sgCatalog(data) {
  const out = ["package jp.streamtorearn.stackinggame.integration;", "", "import jp.streamtorearn.stackinggame.event.BlockInteractionMode;", "import jp.streamtorearn.stackinggame.event.EventTargetMode;", "", "import java.util.LinkedHashMap;", "import java.util.Map;", "", `/** GENERATED metadata from event-master/events.master.json by ${TOOL}. */`, "public final class StackingEventCatalog {", "    public record Meta(String eventKey, String encounterKey, String displayName, String tier, EventTargetMode targetMode, BlockInteractionMode blockMode, String encounterKind, String attackKind, int attackPriority) {}", "    private static final Map<String, Meta> BY_KEY = new LinkedHashMap<>();", "    static {"];
  for (const e of data.events.filter(e => e.category === "stackinggame")) {
    const c = constName(e.startKey);
    out.push(`        add(new Meta(EventMasterKeys.${c}, EventMasterKeys.${c}_ENCOUNTER, ${jstr(e.displayName)}, ${jstr(e.tier)}, EventTargetMode.${e.targetMode}, BlockInteractionMode.${e.blockInteractionMode}, ${jstr(e.encounterKind ?? "")}, ${jstr(e.attackKind ?? "")}, ${parseInt(e.attackPriority ?? 0, 10)}));`);
  }
  out.push("    }", "    private static void add(Meta meta) { BY_KEY.put(meta.eventKey(), meta); }", '    public static Meta get(String key) { Meta m=BY_KEY.get(key); if(m==null) throw new IllegalArgumentException("unknown eventKey: "+key); return m; }', "    public static Map<String, Meta> all() { return java.util.Collections.unmodifiableMap(BY_KEY); }", "    private StackingEventCatalog() {}", "}");
  return lines(out);
}

function obsEvents(data) {
  const out = ["package jp.streamtorearn.obsmodule.catalog;", "", "import java.util.LinkedHashMap;", "import java.util.Map;", "", `/** GENERATED from event-master/events.master.json by ${TOOL}. */`, "public final class EventMaster {", `    public static final String CATALOG_VERSION = ${jstr(data.catalogVersion)};`, "    public record Start(String key, String displayName, String tier, String encounterKey, boolean encounterEnabledByDefault) {}", "    public record Encounter(String key, String displayName, String entityId, String attackKind, int priority, String tier, String parentStartKey) {}", "    public record Gift(String key, String displayName, String encounterKey, String tier, String category, String status) {}", "    public static final Map<String,Start> STACKING_STARTS = new LinkedHashMap<>();", "    public static final Map<String,Encounter> ENCOUNTERS = new LinkedHashMap<>();", "    public static final Map<String,Gift> SIMPLE_GIFTS = new LinkedHashMap<>();", "    static {"];
  for (const e of data.events) {
    const cat = e.category, sk = e.startKey, ek = e.encounterKey ?? "", tier = e.tier, name = e.displayName;
    if (cat === "stackinggame") out.push(`        STACKING_STARTS.put(${jstr(sk)}, new Start(${jstr(sk)}, ${jstr(name)}, ${jstr(tier)}, ${jstr(ek)}, ${String(Boolean(e.encounterEnabledByDefault))}));`);
    else out.push(`        SIMPLE_GIFTS.put(${jstr(sk)}, new Gift(${jstr(sk)}, ${jstr(name)}, ${jstr(ek)}, ${jstr(tier)}, ${jstr(cat)}, ${jstr(e.implementationStatus)}));`);
    if (ek) {
      const suffix = cat === "stackinggame" ? "：遭遇" : "：攻撃";
      out.push(`        ENCOUNTERS.put(${jstr(ek)}, new Encounter(${jstr(ek)}, ${jstr(name + suffix)}, ${jstr(e.entityId ?? "")}, ${jstr(e.attackKind ?? "game_event")}, ${parseInt(e.attackPriority ?? 0, 10)}, ${jstr(tier)}, ${jstr(sk)}));`);
    }
  }
  out.push("    }", "    private EventMaster() {}", "}");
  return lines(out);
}

// 作るファイルと中身（リポジトリの直下からの場所 → 中身。改行は LF）。
function outputs(root) {
  const data = validateMaster(JSON.parse(fs.readFileSync(path.join(root, MASTER), "utf8")));
  const masterText = JSON.stringify(data, null, 2) + "\n";
  return { [MASTER]: masterText, [OBS_MASTER]: masterText, [SG_KEYS]: sgKeys(data), [SG_CATALOG]: sgCatalog(data), [OBS_EVENTS]: obsEvents(data) };
}

// Windows で取り出すと改行が CRLF になるので、そろえて比べる。
const readLf = file => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\r\n").join("\n") : null);

function driftedFiles(root) {
  return Object.entries(outputs(root)).filter(([name, text]) => readLf(path.join(root, name)) !== text).map(([name]) => name);
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const drift = driftedFiles(root);
  if (process.argv.includes("--check")) {
    if (drift.length) { console.error(`Event Master drift detected:\n${drift.map(n => ` - ${n}`).join("\n")}`); process.exit(2); }
    console.log("Event Master outputs are already synchronized.");
  } else {
    const files = outputs(root);
    for (const name of drift) fs.writeFileSync(path.join(root, name), files[name]);
    console.log(drift.length ? `Synchronized Event Master outputs:\n${drift.map(n => ` - ${n}`).join("\n")}` : "Event Master outputs are already synchronized.");
  }
}

module.exports = { validateMaster, outputs, driftedFiles };
