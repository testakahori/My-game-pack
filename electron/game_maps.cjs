"use strict";
// ゲームの初期マップ（bridge/games.json の maps）の置き場と写し方（埋め立て PR3。設計書 docs/superpowers/specs/2026-10-26-umetate-game-design.md の 3.3）。
// 初期マップはサーバーの map_backup/<ゲームID>/<マップ名> に持ち、使う場所 haihu_world/<マップ名> へ写す。
// 写した中身は、MAP の保存・読込（map_saves.cjs）と同じく、ファイルごとの SHA-256 で照らす。
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { safePath, inventory, copyVerified } = require("./map_saves.cjs");
const { atomicWrite } = require("./settings_backups.cjs");
const { mergeProperties } = require("./server_properties.cjs");

// 切り替え・初期化の作業のフォルダー（<サーバー>/.mygamepack-map-switch/<処理ID>/next・previous）。MOD の .mygamepack-mod-switch と同じ形。
const MAP_SWITCH_DIR = ".mygamepack-map-switch";
const hasWorld = dir => { try { return fs.statSync(path.join(dir, "level.dat")).isFile(); } catch { return false; } };
// ワールドの場所の最後の名前（haihu_world/umetate_lab_map も umetate_lab_map も umetate_lab_map）。
const levelBaseName = level => String(level).split(/[\\/]/).filter(Boolean).pop() || "";

function mapPlaces(serverRoot, gameId, name) {
  return { backup: safePath(serverRoot, `map_backup/${gameId}/${name}`), use: safePath(serverRoot, `haihu_world/${name}`), level: `haihu_world/${name}` };
}

const removeTreeDefault = dir => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// ほかのアプリ（エクスプローラー・ウイルス対策など）がファイルをつかんでいるときのエラー。
const LOCKED = new Set(["EPERM", "EBUSY", "EACCES"]);

// フォルダーの名前を変える。一瞬つかまれていただけなら少し待って試し直し（3回まで）、だめなら何を閉じればよいかを日本語で出す（最後のレビュー 軽い4）。
function renameRetrying(from, to, { rename = fs.renameSync, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return rename(from, to); } catch (error) {
      if (!LOCKED.has(error.code)) throw error;
      if (attempt >= 3) throw new Error(`マップのフォルダーを、ほかのアプリが使っています。エクスプローラーなどで開いていたら閉じて、もう一度押してください（${from}。${error.code}）`);
      wait(100);
    }
  }
}

// server.properties の level-name だけを書く。その時点のファイルに重ねるので、ほかの行（ダッシュボードで変えた設定など）は消さない（最後のレビュー 軽い2）。
function writeLevelName(file, level) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  atomicWrite(file, mergeProperties(text, { "level-name": level }));
}

// map_backup の初期マップを、配った物（bundled）と同じ中身にする。違えば（アプリの更新でマップが変わった・壊れた）配った物から写し直す。
// 配った物が無い（開発版でまだ作っていない）ときは、map_backup にあるものを使う。返すのは中身の一覧（inventory）。
// hint は初期マップが無いときの案内に足す文（開発版だけ npm run dev:refresh。最後のレビュー 軽い6）。
async function ensureMapBackup({ serverRoot, gameId, name, bundled, remove = removeTreeDefault, hint = "" }) {
  const { backup } = mapPlaces(serverRoot, gameId, name);
  const parent = path.dirname(backup);
  // 前に残った写しかけ（.staging-*）と、消せなかった古い方（.old-*）を消す。消せなければ次の機会に消す。
  if (fs.existsSync(parent)) for (const entry of fs.readdirSync(parent)) if (/^\.(staging|old)-/.test(entry)) { try { remove(path.join(parent, entry)); } catch { /* 次の機会に消す */ } }
  if (!bundled || !hasWorld(bundled)) {
    if (hasWorld(backup)) return inventory(backup);
    throw new Error(`${name} の初期マップがありません。アプリを入れ直してください${hint}`);
  }
  const files = await inventory(bundled);
  const current = hasWorld(backup) ? await inventory(backup).catch(() => null) : null;
  if (JSON.stringify(current) === JSON.stringify(files)) return files;
  const staging = safePath(serverRoot, `map_backup/${gameId}/.staging-${crypto.randomUUID()}`);
  await copyVerified(bundled, staging, files);
  // 今の map_backup を先によけてから入れ替え、古い方は最後に消す。途中で止まっても map_backup が半分にならない（最後のレビュー 軽い3）。
  const old = fs.existsSync(backup) ? safePath(serverRoot, `map_backup/${gameId}/.old-${crypto.randomUUID()}`) : null;
  if (old) renameRetrying(backup, old);
  try { renameRetrying(staging, backup); } catch (error) { if (old) fs.renameSync(old, backup); throw error; }
  if (old) { try { remove(old); } catch (error) { console.warn(`[games] 古い map_backup を消せませんでした（次の機会に消します）: ${error.message}`); } }
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

// 途中の記録（pending-switch.json）に入れるマップの分。server.properties は丸ごとではなく、前の level-name だけを残す。
const journalMap = step => ({ slot: step.slot, use: step.use, fresh: step.fresh, hadUse: step.hadUse, propertiesFile: step.propertiesFile, hadProperties: step.hadProperties, levelBefore: step.levelBefore });

// 写したマップを使う場所に入れ、server.properties の level-name を書き換える。使っていたマップは作業のフォルダーの previous へよける。
// beforeStep('map') は、テストが途中の失敗を起こすための所。rename・wait はテストがつかまれたときを起こすための所。
function applyMapSwap(step, beforeStep = () => {}, { rename, wait } = {}) {
  if (step.fresh) {
    fs.mkdirSync(path.dirname(step.use), { recursive: true });
    if (fs.existsSync(step.use)) renameRetrying(step.use, path.join(step.slot, "previous"), { rename, wait });
    renameRetrying(path.join(step.slot, "next"), step.use, { rename, wait });
  }
  beforeStep("map");
  writeLevelName(step.propertiesFile, step.levelAfter);
}

// 途中の記録から、使う場所のマップと server.properties の level-name を切り替えの前に戻す。途中で入れた新しいマップは消さずに interrupted-<uuid> へよける。
// 記録の場所は、この処理の作業のフォルダー（.mygamepack-map-switch/<処理ID>）・games.json のマップの使う場所・このサーバーの server.properties のどれかでなければ動かさない（最後のレビュー 軽い5）。
function restoreMapSwap(serverRoot, m, { id, mapNames = [] }) {
  const root = path.resolve(serverRoot);
  const same = (a, b) => typeof a === "string" && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const okSlot = m.slot === null || same(m.slot, path.join(root, MAP_SWITCH_DIR, String(id)));
  const okUse = m.use === null || mapNames.some(name => same(m.use, path.join(root, "haihu_world", name)));
  const okProperties = same(m.propertiesFile, path.join(root, "server.properties")) && typeof m.hadProperties === "boolean" && typeof m.levelBefore === "string";
  if (!okSlot || !okUse || !okProperties) throw new Error("切替記録のマップの場所が不正です");
  // 途中にリンクがあれば動かさない（map_saves.cjs の safePath）。
  for (const p of [m.slot, m.use]) if (p) safePath(root, path.relative(root, p));
  if (m.slot && m.use) {
    const previous = path.join(m.slot, "previous"), aside = () => path.join(m.slot, "interrupted-" + crypto.randomUUID());
    if (fs.existsSync(previous)) {
      if (fs.existsSync(m.use)) fs.renameSync(m.use, aside());
      fs.renameSync(previous, m.use);
    } else if (m.fresh && !m.hadUse && fs.existsSync(m.use)) fs.renameSync(m.use, aside());
  }
  if (m.hadProperties) writeLevelName(m.propertiesFile, m.levelBefore);
  else fs.rmSync(m.propertiesFile, { force: true });
}

module.exports = { MAP_SWITCH_DIR, hasWorld, levelBaseName, mapPlaces, ensureMapBackup, stageMap, planMapChange, journalMap, applyMapSwap, restoreMapSwap };
