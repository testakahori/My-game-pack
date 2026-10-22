"use strict";

// BridgeMOD が受け付けるコマンド名（.txt を除いた部分）。BridgeMod.java の BridgeEvent.fromJson と同じ規則。
// これ以外の文字（日本語・空白など）を含む名前は MOD が HTTP 400 で拒否するため、保存前と送信前に止める。
const BRIDGE_COMMAND_KEY = /^[A-Za-z0-9_.-]{1,200}$/;
const BRIDGE_MOD_TRANSPORTS = new Set(["bridge_mod", "douma_mod", "doumamod", "bridgemod", "mod", "http"]);

// BridgeMOD（HTTP）で送る送り方か。空なら RCON。Bridge・アプリ（設定の確認・テスト発火）で、この1か所の判定を使う。
function isBridgeModTransport(transport) {
  return BRIDGE_MOD_TRANSPORTS.has(String(transport || "rcon").toLowerCase().trim());
}

// 知っている送り方の名前か（空は RCON）。知らない名前（"bridge-mod" のような書き間違い）は、設定の確かめで警告して RCON として扱う
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7）。
function isKnownTransport(transport) {
  if (transport == null) return true;
  if (typeof transport !== "string") return false;
  const name = transport.toLowerCase().trim();
  return name === "" || name === "rcon" || BRIDGE_MOD_TRANSPORTS.has(name);
}

// RCON/Telnet はファイルを直接読むので名前の制限はない。制限が必要なのは BridgeMOD 経由のときだけ。
function usesBridgeModTransport(config) {
  const type = String(config?.target?.type || "minecraft").toLowerCase();
  return type === "minecraft" && isBridgeModTransport(config?.options?.commandTransport);
}

// .txt の付け外しはこの1組だけで行う。大文字の .TXT も同じに扱う（Windows のファイル名は大文字小文字を区別せず、BridgeMOD も区別しない。
// 2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 4）。
function isTxtName(name) {
  return /\.txt$/i.test(String(name ?? ""));
}

function ensureTxt(name) {
  if (!name) return ""; // 前の BRIDGE と同じく、空・0・false・null は「名前なし」。
  const value = String(name).trim();
  if (!value) return "";
  return isTxtName(value) ? value : `${value}.txt`;
}

function bridgeCommandKey(commandFile) {
  const name = String(commandFile ?? "").trim().replace(/\\/g, "/").split("/").pop();
  return isTxtName(name) ? name.slice(0, -4) : name;
}

function isBridgeCommandFile(commandFile) {
  return BRIDGE_COMMAND_KEY.test(bridgeCommandKey(commandFile));
}

function commandFileProblem(commandFile) {
  if (isBridgeCommandFile(commandFile)) return "";
  return `コマンドファイル名「${String(commandFile ?? "").trim()}」は使えません。半角英数字と _ . - だけの名前にしてください（例: neko.txt）`;
}

// 設定の中で、Bridge が実際に発火しうるコマンドファイルの参照を、画面に出す名前付きで列挙する。
// 無効にしてある設定は Bridge も実行しないので数えない。どれが enabled を見るかは bridge/index.js・
// event_rules.cjs・feature_engine.js・roulette.cjs と同じにする（見ないものは enabled:false でも数える）。
// 参照の数え方はこの1つ（設定の確かめ・配信前チェック・ゲームの候補の確かめ・ゲームの切り替え。処理のコピー PR5）。
function commandFileRefs(config) {
  const refs = [];
  const add = (where, value, { honorsEnabled = false } = {}) => {
    if (honorsEnabled && value && typeof value === "object" && value.enabled === false) return;
    const commandFile = typeof value === "string" ? value : value?.commandFile;
    if (String(commandFile ?? "").trim()) refs.push({ where, commandFile: String(commandFile).trim() });
  };
  const list = value => (Array.isArray(value) ? value : []);
  // 無効のギフト割り当ては BRIDGE も動かさない（数えるのはゲームの数え方だけ。2026-10-22 ユーザーの決定）。
  for (const m of list(config?.mappings)) add(`ギフト割り当て（${m?.name || m?.giftId || "名前なし"}）`, m, { honorsEnabled: true });
  for (const ev of list(config?.likeEvents)) add(`いいね（${ev?.threshold ?? "?"}いいねごと）`, ev, { honorsEnabled: true });
  for (const [key, label] of [["shareEvent", "シェア"], ["followEvent", "フォロー"], ["memberEvent", "訪問"], ["unmappedGiftEvent", "未設定ギフト"]]) {
    add(label, config?.[key], { honorsEnabled: true });
  }
  // ルーレットは BRIDGE が真の値なら回す（index.js の rouletteCfg?.enabled。デスルーレット・コメントギフトは === true）。
  if (config?.roulette?.enabled) {
    for (const item of list(config.roulette.items)) add(`ルーレット項目（${item?.label || item?.commandFile}）`, item);
  }
  if (config?.deathRoulette?.enabled === true) {
    for (const item of list(config.deathRoulette.items)) add(`デスルーレット項目（${item?.label || item?.commandFile}）`, item);
  }
  if (config?.commentGifts?.enabled === true) {
    for (const rule of list(config.commentGifts.rules)) add(`コメントギフト（「${rule?.match ?? ""}」）`, rule, { honorsEnabled: true });
  }
  // コンボ・マイルストーン・コメントコマンドは有効フラグを見ずに発火する（FeatureEngine）。投票だけは enabled を見る。
  const gameplay = config?.options?.gameplay || {};
  for (const level of list(gameplay.combo?.levels)) add(`コンボ（${level?.count ?? "?"}連）`, level);
  for (const m of list(gameplay.likeMilestones)) add(`いいねマイルストーン（${m?.threshold ?? "?"}）`, m);
  for (const m of list(gameplay.followMilestones)) add(`フォローマイルストーン（${m?.threshold ?? "?"}）`, m);
  for (const [text, command] of Object.entries(gameplay.commentCommands || {})) add(`コメントコマンド（「${text}」）`, command);
  if (gameplay.poll?.enabled) {
    for (const [key, option] of Object.entries(gameplay.poll.options || {})) add(`コメント投票（!${key}）`, option);
  }
  return refs;
}

function invalidCommandFileRefs(config) {
  return commandFileRefs(config).filter(ref => !isBridgeCommandFile(ref.commandFile))
    .map(ref => ({ ...ref, message: `${ref.where}: ${commandFileProblem(ref.commandFile)}` }));
}

module.exports = { BRIDGE_COMMAND_KEY, isBridgeModTransport, isKnownTransport, usesBridgeModTransport, isTxtName, ensureTxt, bridgeCommandKey, isBridgeCommandFile, commandFileProblem, commandFileRefs, invalidCommandFileRefs };
