"use strict";

// 設定（config.minecraft.json）の既定値・新しい設定の雛形・コマンドの場所・BridgeMOD の接続先の決め方
// （2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 7。処理のコピー PR4）。
// 既定値の表は config_defaults.json（画面も import して読む）。BRIDGE・アプリ・配布の準備（scripts/prepare-bridge-runtime.cjs）はここを使う。
const path = require("node:path");
const { CONFIG_VERSION } = require("./config_migration.cjs");

const deepFreeze = value => {
  if (value && typeof value === "object") for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const CONFIG_DEFAULTS = deepFreeze(require("./config_defaults.json"));

// 新しい設定の雛形。呼ぶたびに新しいもの。今の決まりに合っているので、版の番号も付ける（次の起動の直しで書き直さない）。
// 送り方は、設定に無ければ RCON（BridgeMOD より前の設定のため）だが、新しい設定には bridge_mod を書く。
function newBridgeConfig() {
  const o = CONFIG_DEFAULTS.options;
  const event = () => ({ commandFile: "", repeat: 1, enabled: false });
  return {
    tiktokUsername: "",
    rcon: { host: CONFIG_DEFAULTS.rcon.host, port: CONFIG_DEFAULTS.rcon.port, password: "" },
    mappings: [],
    likeEvents: [],
    unmappedGiftEvent: event(),
    shareEvent: event(),
    followEvent: event(),
    memberEvent: event(),
    options: {
      giftCooldownMs: o.giftCooldownMs,
      maxCommandsPerGift: o.maxCommandsPerGift,
      commandTransport: "bridge_mod",
      bridgeModHost: o.bridgeModHost,
      bridgeModPort: o.bridgeModPort,
      maxLikeCatchUpPerEvent: o.maxLikeCatchUpPerEvent,
      logUnknownGifts: o.logUnknownGifts,
    },
    configVersion: CONFIG_VERSION,
  };
}

// 設定に書いたコマンドの場所（前後の空白を除く）。書いていない・空なら commands/minecraft。BRIDGE のログの表示にも使う。
function commandsDirSetting(options) {
  const value = options?.commandsDir;
  return (typeof value === "string" && value.trim()) || CONFIG_DEFAULTS.options.commandsDir;
}

// コマンドの場所の絶対パス。相対なら BRIDGE のフォルダー（bridgeDir）から、絶対ならそのまま。
// BRIDGE・再起動が要るかの比べ方・ルーレット・アプリが、この1つで決める。アプリは options を渡さず、既定の場所を使う。
function bridgeCommandsDir(bridgeDir, options) {
  return path.resolve(bridgeDir, commandsDirSetting(options));
}

// BridgeMOD の接続先。ホストは bridgeModHost・旧い doumaModHost の順に、前後の空白を除いて空でない最初の文字列
// （手で書いた false・0 などの文字列でない値は、書いていないものとする）。ポートは bridgeModPort・doumaModPort・既定の順（範囲は設定の確かめが見る）。
function bridgeModEndpoint(options) {
  const o = options || {};
  const host = [o.bridgeModHost, o.doumaModHost].map(value => (typeof value === "string" ? value.trim() : "")).find(Boolean) || CONFIG_DEFAULTS.options.bridgeModHost;
  return { host, port: Number(o.bridgeModPort || o.doumaModPort || CONFIG_DEFAULTS.options.bridgeModPort) };
}

module.exports = { CONFIG_DEFAULTS, newBridgeConfig, commandsDirSetting, bridgeCommandsDir, bridgeModEndpoint };
