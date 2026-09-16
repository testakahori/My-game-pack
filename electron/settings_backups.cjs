"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateBridgeConfig } = require("./config_schema.cjs");

const PREFS = ["autoBackupOnServerStart"];
const MAX_BYTES = 12 * 1024 * 1024;
const json = value => JSON.stringify(value, null, 2);
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const object = value => value && typeof value === "object" && !Array.isArray(value);
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validCommand = name => typeof name === "string" && name === path.basename(name) && !/[\\/:\x00-\x1f]/.test(name) && /\.txt$/i.test(name);

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, content); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

// All paths come from main, never from the renderer or a backup file.
function createSettingsBackups(deps) {
  function paths() { return deps.paths(); }
  function capture() {
    const p = paths();
    const config = read(p.config);
    const { rcon: _rcon, ...bridge } = config;
    bridge.options = { ...(bridge.options || {}) };
    for (const key of ["commandsDir", "doumaModHost", "doumaModPort", "commandTransport"]) delete bridge.options[key];
    const app = fs.existsSync(p.app) ? read(p.app) : {};
    const preferences = Object.fromEntries(PREFS.map(key => [key, app[key] !== false]));
    const commands = {};
    if (fs.existsSync(p.commands)) for (const entry of fs.readdirSync(p.commands, { withFileTypes: true })) {
      if (entry.isFile() && validCommand(entry.name)) commands[entry.name] = fs.readFileSync(path.join(p.commands, entry.name), "utf8");
    }
    return { bridge, tts: deps.readTts(), preferences, commands };
  }
  function validate(value) {
    if (!object(value) || value.schema !== 1 || !object(value.payload) || value.sha256 !== digest(value.payload)) throw new Error("バックアップが破損しているか、対応していない形式です。");
    if (value.scope !== path.resolve(paths().config)) throw new Error("別のサーバーのバックアップは復元できません。");
    const { bridge, tts, preferences, commands } = value.payload;
    if (!object(bridge) || !object(tts) || !object(preferences) || !object(commands) || !Array.isArray(bridge.mappings)) throw new Error("バックアップの設定項目が不足しています。");
    // An unfinished configuration is still worth backing up. Report semantic issues
    // in the preview; structural corruption and unsafe filenames remain rejected.
    if (!["voicevox", "aivis"].includes(tts.engine) || typeof tts.enabled !== "boolean") throw new Error("読み上げ設定が不正です。");
    if (Object.entries(commands).some(([name, body]) => !validCommand(name) || typeof body !== "string")) throw new Error("コマンドのバックアップが不正です。");
    return value;
  }
  function summary(value, id) {
    return { id, createdAt: value.createdAt, reason: value.reason, version: value.version,
      username: value.payload.bridge.tiktokUsername || "", mappings: value.payload.bridge.mappings?.length || 0,
      commands: Object.keys(value.payload.commands).length, ttsEnabled: value.payload.tts.enabled === true,
      issues: validateBridgeConfig(value.payload.bridge).errors.length };
  }
  function load(id) {
    if (typeof id !== "string" || !/^\d{13}-[a-f0-9-]{36}\.json$/.test(id)) throw new Error("バックアップIDが不正です。");
    const file = path.join(paths().backups, id);
    if (fs.statSync(file).size > MAX_BYTES) throw new Error("バックアップのサイズが大きすぎます。");
    return validate(read(file));
  }
  function list() {
    const dir = paths().backups;
    if (!fs.existsSync(dir)) return [];
    const result = [];
    for (const id of fs.readdirSync(dir).filter(name => name.endsWith(".json"))) {
      try { result.push(summary(load(id), id)); }
      catch { /* A corrupt/unrelated snapshot must not hide valid restore points. */ }
    }
    return result.sort((a, b) => b.id.localeCompare(a.id));
  }
  function create(reason = "manual") {
    const p = paths();
    const payload = capture();
    const value = { schema: 1, scope: path.resolve(p.config), version: deps.version(), createdAt: new Date().toISOString(), reason, payload, sha256: digest(payload) };
    // Initial, unconfigured installs have no useful restore point yet.
    if (reason === "automatic" && !String(payload.bridge.tiktokUsername || "").trim()) return null;
    validate(value);
    const content = json(value);
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("設定バックアップが12MBを超えています。");
    if (reason === "automatic") {
      const latest = list()[0];
      if (latest && load(latest.id).sha256 === value.sha256) return latest;
    }
    const id = `${Date.now()}-${crypto.randomUUID()}.json`;
    atomicWrite(path.join(p.backups, id), content);
    // Manual and pre-restore snapshots are retained; only automatic history is bounded.
    for (const row of list().filter(row => row.reason === "automatic").slice(30)) {
      try { fs.unlinkSync(path.join(p.backups, row.id)); } catch { /* Retention must not fail a save. */ }
    }
    return summary(value, id);
  }
  function restore(id) {
    if (deps.isRunning()) throw new Error("復元する前にBridgeを停止してください。");
    const snapshot = load(id);
    const p = paths();
    const current = read(p.config);
    const config = { ...snapshot.payload.bridge, rcon: current.rcon, options: { ...snapshot.payload.bridge.options } };
    for (const key of ["commandsDir", "doumaModHost", "doumaModPort", "commandTransport"]) {
      if (Object.hasOwn(current.options || {}, key)) config.options[key] = current.options[key];
    }
    const currentApp = fs.existsSync(p.app) ? read(p.app) : {};
    const prefs = Object.fromEntries(PREFS.map(key => [key, snapshot.payload.preferences[key] !== false]));
    const files = new Map([
      [p.config, json(config)], [p.tts, json(snapshot.payload.tts)], [p.bridgeTts, json(snapshot.payload.tts)],
      [p.app, json({ ...currentApp, ...prefs })],
      ...Object.entries(snapshot.payload.commands).map(([name, body]) => [path.join(p.commands, name), body]),
    ]);
    const before = new Map([...files.keys()].map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
    const safety = create("before-restore");
    const written = [];
    try {
      for (const [file, body] of files) { written.push(file); (deps.write || atomicWrite)(file, body); }
    } catch (error) {
      const failures = [];
      for (const file of written.reverse()) {
        try { const old = before.get(file); if (old === null) fs.unlinkSync(file); else atomicWrite(file, old); }
        catch { failures.push(path.basename(file)); }
      }
      throw new Error(failures.length ? `復元を中断しました。一部を戻せませんでした（${failures.join("、")}）。復元前バックアップ: ${safety.id}` : "復元に失敗したため、変更前の設定へ戻しました。");
    }
    return { ok: true, safetyBackup: safety.id, restored: summary(snapshot, id) };
  }
  return { list, create, restore };
}
module.exports = { createSettingsBackups, atomicWrite, validCommand };
