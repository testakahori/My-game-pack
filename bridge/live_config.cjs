"use strict";

// 配信中に保存した設定を BRIDGE の再起動なしで効かせる（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 8）。
// BRIDGE は起動のときと設定の再読込のときの両方で liveOptions を使う（前は起動のときに1回だけ作っていた）。
// 範囲の丸めは今の BRIDGE のまま。既定値は config_defaults.json の1か所（処理のコピー PR4）。
const { boundedInt } = require("./event_rules.cjs");
const { isBridgeModTransport } = require("./command_files.cjs");
const { normalizeTikTokId } = require("./tiktok_id.cjs");
const { CONFIG_DEFAULTS, bridgeCommandsDir, bridgeModEndpoint } = require("./config_defaults.cjs");

// つなぎ方以外の options 全部。保存したらすぐ効く。
function liveOptions(options) {
  const o = options && typeof options === "object" ? options : {};
  const d = CONFIG_DEFAULTS.options;
  return {
    giftCooldownMs: Number(o.giftCooldownMs ?? d.giftCooldownMs),
    maxCommandsPerGift: Number(o.maxCommandsPerGift ?? d.maxCommandsPerGift),
    maxLikeCatchUpPerEvent: boundedInt(o.maxLikeCatchUpPerEvent ?? d.maxLikeCatchUpPerEvent, 1, 100, d.maxLikeCatchUpPerEvent),
    rconQueueWarnSize: boundedInt(o.rconQueueWarnSize ?? d.rconQueueWarnSize, 1, 10000, d.rconQueueWarnSize),
    likeBatchWindowMs: boundedInt(o.likeBatchWindowMs ?? d.likeBatchWindowMs, 100, 10000, d.likeBatchWindowMs),
    streakTtlMs: boundedInt(o.streakTtlMs ?? d.streakTtlMs, 5000, 600000, d.streakTtlMs),
    // 書いていなければ出す（アプリの雛形・配信ホームと同じ。前は BRIDGE だけ出さなかった）。
    logUnknownGifts: !!(o.logUnknownGifts ?? d.logUnknownGifts),
    mutedUsers: Array.isArray(o.mutedUsers) ? o.mutedUsers : [],
    ttsNgWords: (Array.isArray(o.ttsNgWords) ? o.ttsNgWords : []).map(value => String(value).trim()).filter(Boolean),
    // 古い設定ファイルの形のために残す。BRIDGE は読まない（タイトルの出し方は bridge/index.js の頭のコメント。PR #169）。
    announceFunction: String(o.announceFunction || d.announceFunction).trim(),
    announceStorage: String(o.announceStorage || d.announceStorage).trim(),
    announceEveryRepeat: (o.announceEveryRepeat ?? d.announceEveryRepeat) !== false,
    announceEnabled: (o.announceEnabled ?? d.announceEnabled) !== false,
    protection: o.protection || { enabled: false },
  };
}

// 再起動が要る「つなぎ方」を、BRIDGE が実際に使う値で読む（bridge/index.js の起動のときと同じ既定値）。
// 書き方の違い（キーの並び・"25575" と 25575・前後の空白・同じフォルダーの相対と絶対）や、使っていない接続先の変更では
// 再起動を促さない（PR2 の最終レビュー）。RCON のパスワードは BRIDGE が環境変数・rcon_password.txt を先に使うので比べない。
function connection(config, baseDir) {
  const options = config?.options || {};
  const target = config?.target || { type: "minecraft", rcon: config?.rcon };
  const type = String(target.type || "minecraft").toLowerCase();
  const viaMod = type === "minecraft" && isBridgeModTransport(options.commandTransport);
  const rcon = target.rcon || config?.rcon || {};
  const telnet = target.telnet || {};
  const dir = bridgeCommandsDir(baseDir || ".", options);
  const mod = bridgeModEndpoint(options);
  const remote = (value, fallback) => `${String(value.host || fallback.host).trim()}:${Number(value.port || fallback.port)}`;
  return {
    type, viaMod,
    // BRIDGE が接続する形で比べる（@ や大文字だけの違いでは再起動を促さない）。
    tiktok: normalizeTikTokId(config?.tiktokUsername),
    modHost: mod.host,
    modPort: mod.port,
    remote: type === "minecraft" ? remote(rcon, CONFIG_DEFAULTS.rcon) : remote(telnet, CONFIG_DEFAULTS.telnet),
    // Windows のフォルダー名は大文字小文字を区別しない。
    dir: process.platform === "win32" ? dir.toLowerCase() : dir,
  };
}

// 起動したときの設定と比べて、値が違うつなぎ方の名前を決まった順で返す。名前は画面とログにそのまま出す。
// baseDir は相対のコマンドの場所を解く基準（BRIDGE のフォルダー）。
function restartRequired(started, next, baseDir) {
  const a = connection(started, baseDir), b = connection(next, baseDir);
  const sameTransport = a.type === b.type && a.viaMod === b.viaMod;
  const names = [];
  if (a.tiktok !== b.tiktok) names.push("TikTok ID");
  if (!sameTransport) names.push("送り方");
  // 接続先は、送り方が同じで、どちらもそれを使っているときだけ比べる（送り方が変われば「送り方」だけを出す）。
  if (sameTransport && a.viaMod && a.modHost !== b.modHost) names.push("BridgeMOD のホスト");
  if (sameTransport && a.viaMod && !Object.is(a.modPort, b.modPort)) names.push("BridgeMOD のポート");
  if (sameTransport && !a.viaMod && a.remote !== b.remote) names.push("RCON・Telnet の接続先");
  if (a.dir !== b.dir) names.push("コマンドの場所");
  return names;
}

module.exports = { liveOptions, restartRequired };
