"use strict";

// 配信中に保存した設定を BRIDGE の再起動なしで効かせる（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 8）。
// BRIDGE は起動のときと設定の再読込のときの両方で liveOptions を使う（前は起動のときに1回だけ作っていた）。
// 式は今の BRIDGE のまま（既定値・範囲の丸めを変えない。厳しい確かめは設定の確かめの PR で行う）。
const { boundedInt } = require("./event_rules.cjs");

// つなぎ方以外の options 全部。保存したらすぐ効く。
function liveOptions(options) {
  const o = options && typeof options === "object" ? options : {};
  return {
    giftCooldownMs: Number(o.giftCooldownMs ?? 300),
    maxCommandsPerGift: Number(o.maxCommandsPerGift ?? 200),
    maxLikeCatchUpPerEvent: boundedInt(o.maxLikeCatchUpPerEvent ?? 5, 1, 100, 5),
    rconQueueWarnSize: boundedInt(o.rconQueueWarnSize ?? 20, 1, 10000, 20),
    likeBatchWindowMs: boundedInt(o.likeBatchWindowMs ?? 1200, 100, 10000, 1200),
    logUnknownGifts: !!o.logUnknownGifts,
    mutedUsers: Array.isArray(o.mutedUsers) ? o.mutedUsers : [],
    ttsNgWords: (Array.isArray(o.ttsNgWords) ? o.ttsNgWords : []).map(value => String(value).trim()).filter(Boolean),
    announceFunction: String(o.announceFunction || "gift_stream:_announce").trim(),
    announceStorage: String(o.announceStorage || "gift_stream:bridge").trim(),
    announceEveryRepeat: o.announceEveryRepeat !== false,
    announceEnabled: o.announceEnabled !== false,
    protection: o.protection || { enabled: false },
    gameplay: o.gameplay || {},
  };
}

// 再起動が要る「つなぎ方」。BRIDGE は起動したときの値のまま動き続ける。名前は画面とログにそのまま出す。
const CONNECTION = [
  ["TikTok ID", config => String(config?.tiktokUsername || "").trim()],
  ["送り方", config => String(config?.options?.commandTransport || "rcon").toLowerCase().trim() || "rcon"],
  ["BridgeMOD のホスト", config => String(config?.options?.bridgeModHost || config?.options?.doumaModHost || "127.0.0.1").trim()],
  ["BridgeMOD のポート", config => Number(config?.options?.bridgeModPort || config?.options?.doumaModPort || 25576)],
  ["RCON・Telnet の接続先", config => JSON.stringify({ target: config?.target, rcon: config?.rcon })],
  ["コマンドの場所", config => String(config?.options?.commandsDir || "commands")],
];

// 起動したときの設定と比べて、値が違うつなぎ方の名前を決まった順で返す。
function restartRequired(started, next) {
  return CONNECTION.filter(([, read]) => !Object.is(read(started), read(next))).map(([name]) => name);
}

module.exports = { liveOptions, restartRequired };
