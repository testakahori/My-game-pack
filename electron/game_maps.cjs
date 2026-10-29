"use strict";
// ゲームの初期マップ（bridge/games.json の maps）の置き場と写し方（埋め立て PR3。設計書 docs/superpowers/specs/2026-10-26-umetate-game-design.md の 3.3）。
// 初期マップはサーバーの map_backup/<ゲームID>/<マップ名> に持ち、使う場所 haihu_world/<マップ名> へ写す。
// 写した中身は、MAP の保存・読込（map_saves.cjs）と同じく、ファイルごとの SHA-256 で照らす。
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { safePath, inventory, copyVerified } = require("./map_saves.cjs");
const { atomicWrite } = require("./settings_backups.cjs");

// 切り替え・初期化の作業のフォルダー（<サーバー>/.mygamepack-map-switch/<処理ID>/next・previous）。MOD の .mygamepack-mod-switch と同じ形。
const MAP_SWITCH_DIR = ".mygamepack-map-switch";
const hasWorld = dir => { try { return fs.statSync(path.join(dir, "level.dat")).isFile(); } catch { return false; } };
// ワールドの場所の最後の名前（haihu_world/umetate_lab_map も umetate_lab_map も umetate_lab_map）。
const levelBaseName = level => String(level).split(/[\\/]/).filter(Boolean).pop() || "";

function mapPlaces(serverRoot, gameId, name) {
  return { backup: safePath(serverRoot, `map_backup/${gameId}/${name}`), use: safePath(serverRoot, `haihu_world/${name}`), level: `haihu_world/${name}` };
}

// map_backup の初期マップを、配った物（bundled）と同じ中身にする。違えば（アプリの更新でマップが変わった・壊れた）配った物から写し直す。
// 配った物が無い（開発版でまだ作っていない）ときは、map_backup にあるものを使う。返すのは中身の一覧（inventory）。
async function ensureMapBackup({ serverRoot, gameId, name, bundled }) {
  const { backup } = mapPlaces(serverRoot, gameId, name);
  const parent = path.dirname(backup);
  if (fs.existsSync(parent)) for (const entry of fs.readdirSync(parent)) if (entry.startsWith(".staging-")) await fsp.rm(path.join(parent, entry), { recursive: true, force: true });
  if (!bundled || !hasWorld(bundled)) {
    if (hasWorld(backup)) return inventory(backup);
    throw new Error(`${name} の初期マップがありません。アプリを入れ直してください（開発版では npm run dev:refresh を動かしてください）`);
  }
  const files = await inventory(bundled);
  const current = hasWorld(backup) ? await inventory(backup).catch(() => null) : null;
  if (JSON.stringify(current) === JSON.stringify(files)) return files;
  const staging = safePath(serverRoot, `map_backup/${gameId}/.staging-${crypto.randomUUID()}`);
  await copyVerified(bundled, staging, files);
  await fsp.rm(backup, { recursive: true, force: true });
  await fsp.rename(staging, backup);
  return files;
}

// map_backup の初期マップを、作業のフォルダーの next へ写して照らす（まだ使う場所には触らない）。
async function stageMap({ serverRoot, gameId, name, files, operation }) {
  const { backup } = mapPlaces(serverRoot, gameId, name);
  const next = safePath(serverRoot, `${MAP_SWITCH_DIR}/${operation}/next`);
  await copyVerified(backup, next, files);
  return next;
}

// ファイルに触らない決め方。target・previous は games.json の項目（切り替え先と今のゲーム）。
// - 入る（target にマップがある）：fresh なら初期マップを写す。そうでなければ level-name だけを使う場所に合わせる（もう合っていれば何もしない）。
//   fresh は、初期化のボタン・切り替えたときに初期に戻すゲーム（resetMapOnSwitch）へほかのゲームから来た・使う場所にマップが無い、のどれか。
// - 出る（target にマップが無く、今のワールドが前のゲームのマップの名前）：level-name を前のワールドへ戻す。
//   別のワールドを選んでいたら触らない。マップの無いゲームどうしでは、手で入れたマップにも触らない。
function planMapChange({ target, previous, switching, currentLevel, useReady, reset = false }) {
  const name = target?.maps?.[0];
  if (name) {
    const level = `haihu_world/${name}`;
    const fresh = reset || (switching && target.resetMapOnSwitch === true) || !useReady;
    if (!fresh && String(currentLevel).replace(/\\/g, "/") === level) return null;
    return { kind: "enter", name, level, fresh };
  }
  if (previous?.maps?.includes(levelBaseName(currentLevel))) return { kind: "leave" };
  return null;
}

// 途中の記録（pending-switch.json）に入れるマップの分。
const journalMap = step => ({ slot: step.slot, use: step.use, fresh: step.fresh, hadUse: step.hadUse, propertiesFile: step.propertiesFile, propertiesBefore: step.propertiesBefore });

// 写したマップを使う場所に入れ、server.properties の level-name を書き換える。使っていたマップは作業のフォルダーの previous へよける。
// beforeStep('map') は、テストが途中の失敗を起こすための所。
function applyMapSwap(step, beforeStep = () => {}) {
  if (step.fresh) {
    fs.mkdirSync(path.dirname(step.use), { recursive: true });
    if (fs.existsSync(step.use)) fs.renameSync(step.use, path.join(step.slot, "previous"));
    fs.renameSync(path.join(step.slot, "next"), step.use);
  }
  beforeStep("map");
  atomicWrite(step.propertiesFile, step.propertiesAfter);
}

// 途中の記録から、使う場所のマップと server.properties を切り替えの前に戻す。途中で入れた新しいマップは消さずに interrupted-<uuid> へよける。
function restoreMapSwap(serverRoot, m) {
  const root = path.resolve(serverRoot).toLowerCase() + path.sep;
  const inside = p => typeof p === "string" && path.resolve(p).toLowerCase().startsWith(root);
  if (path.resolve(m.propertiesFile || "").toLowerCase() !== path.join(path.resolve(serverRoot), "server.properties").toLowerCase()
    || (m.slot !== null && !inside(m.slot)) || (m.use !== null && !inside(m.use))) throw new Error("切替記録のマップの場所が不正です");
  if (m.slot && m.use) {
    const previous = path.join(m.slot, "previous"), aside = () => path.join(m.slot, "interrupted-" + crypto.randomUUID());
    if (fs.existsSync(previous)) {
      if (fs.existsSync(m.use)) fs.renameSync(m.use, aside());
      fs.renameSync(previous, m.use);
    } else if (m.fresh && !m.hadUse && fs.existsSync(m.use)) fs.renameSync(m.use, aside());
  }
  if (typeof m.propertiesBefore === "string") atomicWrite(m.propertiesFile, m.propertiesBefore);
  else fs.rmSync(m.propertiesFile, { force: true });
}

module.exports = { MAP_SWITCH_DIR, hasWorld, levelBaseName, mapPlaces, ensureMapBackup, stageMap, planMapChange, journalMap, applyMapSwap, restoreMapSwap };
