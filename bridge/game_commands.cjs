"use strict";

// ゲームの一覧と、ゲーム専用のコマンド・チャットの名前・ゲーム MOD の ID・パックの key の決まり
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 6。処理のコピー PR6）。
// 一覧は games.json（画面も import して読む）。BridgeMOD（CommandRouting.java・api/GameEvents.java）とは、
// bridge/test/fixtures の game-commands.json・game-mod-ids.json を scripts/test-bridge-contracts.cjs で両方に通して合わせる。
const { isTxtName, isBridgeCommandFile } = require("./command_files.cjs");

const deepFreeze = value => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const GAMES = deepFreeze(require("./games.json"));
const GAME_IDS = Object.freeze(GAMES.map(game => game.id));
// common は共通（BridgeMOD だけ）。ゲームパックのゲームは残り。
const PACK_GAME_IDS = Object.freeze(GAME_IDS.filter(id => id !== "common"));
// ゲーム MOD の ID に使えない名前（アプリの MOD と、前の名前）。
const RESERVED_MOD_IDS = Object.freeze(["bridgemod", "displaymod", "doumacmd"]);

const GAME_PREFIX = new RegExp(`^game_(${PACK_GAME_IDS.join("|")})_`, "i");

// ゲーム専用のコマンドなら、そのゲームの ID（小文字）。game_<一覧にあるゲーム>_ で始まる名前だけで、大文字小文字を区別しない
// （Windows のファイル名と BridgeMOD は区別しない）。game_mode_on.txt・game_unknown_x.txt などは共通のコマンド（null）。
function gameOfCommand(name) {
  if (typeof name !== "string") return null;
  const match = GAME_PREFIX.exec(name);
  return match ? match[1].toLowerCase() : null;
}

// ゲームパックが置くコマンドのファイル名か（.txt・BridgeMOD が受け付ける名前・ゲーム専用の頭のすべて）。
function isGameCommandFile(name) {
  return typeof name === "string" && isTxtName(name) && isBridgeCommandFile(name) && /^[^\\/]+$/.test(name) && gameOfCommand(name) !== null;
}

// チャットの名前（/bridge <名前>）。.txt とゲーム専用の頭を除く。BridgeMOD の CommandRouting.publicKey と同じ結果。
function publicCommandKey(name) {
  return String(name ?? "").replace(/\.txt$/i, "").replace(GAME_PREFIX, "");
}

function isGameModId(id) {
  return typeof id === "string" && /^[a-z][a-z0-9_]{1,63}$/.test(id) && !RESERVED_MOD_IDS.includes(id);
}

function isGamePackKey(key) {
  return typeof key === "string" && /^[a-z][a-z0-9_]{0,49}$/.test(key);
}

module.exports = { GAMES, GAME_IDS, PACK_GAME_IDS, RESERVED_MOD_IDS, gameOfCommand, isGameCommandFile, publicCommandKey, isGameModId, isGamePackKey };
