"use strict";

// BridgeMOD が受け付けるコマンド名（.txt を除いた部分）。BridgeMod.java の BridgeEvent.fromJson と同じ規則。
// これ以外の文字（日本語・空白など）を含む名前は MOD が HTTP 400 で拒否するため、保存前と送信前に止める。
const BRIDGE_COMMAND_KEY = /^[A-Za-z0-9_.-]{1,200}$/;
const BRIDGE_MOD_TRANSPORTS = new Set(["bridge_mod", "douma_mod", "doumamod", "bridgemod", "mod", "http"]);

// RCON/Telnet はファイルを直接読むので名前の制限はない。制限が必要なのは BridgeMOD 経由のときだけ。
function usesBridgeModTransport(config) {
  const type = String(config?.target?.type || "minecraft").toLowerCase();
  return type === "minecraft" && BRIDGE_MOD_TRANSPORTS.has(String(config?.options?.commandTransport || "rcon").toLowerCase().trim());
}

function bridgeCommandKey(commandFile) {
  const name = String(commandFile ?? "").trim().replace(/\\/g, "/").split("/").pop();
  return /\.txt$/i.test(name) ? name.slice(0, -4) : name;
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
function commandFileRefs(config) {
  const refs = [];
  const add = (where, value, { honorsEnabled = false } = {}) => {
    if (honorsEnabled && value && typeof value === "object" && value.enabled === false) return;
    const commandFile = typeof value === "string" ? value : value?.commandFile;
    if (String(commandFile ?? "").trim()) refs.push({ where, commandFile: String(commandFile).trim() });
  };
  const list = value => (Array.isArray(value) ? value : []);
  for (const m of list(config?.mappings)) add(`ギフト割り当て（${m?.name || m?.giftId || "名前なし"}）`, m);
  for (const ev of list(config?.likeEvents)) add(`いいね（${ev?.threshold ?? "?"}いいねごと）`, ev, { honorsEnabled: true });
  for (const [key, label] of [["shareEvent", "シェア"], ["followEvent", "フォロー"], ["memberEvent", "訪問"], ["unmappedGiftEvent", "未設定ギフト"]]) {
    add(label, config?.[key], { honorsEnabled: true });
  }
  if (config?.roulette?.enabled === true) {
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

// 保存済みの設定にすでにあった参照かどうか（場所と名前の組で比べる）。
function refKey(ref) {
  return `${ref.where}\n${ref.commandFile}`;
}

module.exports = { BRIDGE_COMMAND_KEY, usesBridgeModTransport, bridgeCommandKey, isBridgeCommandFile, commandFileProblem, commandFileRefs, invalidCommandFileRefs, refKey };
