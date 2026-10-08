"use strict";

// BridgeMOD の WebSocket（HTTP ポート+1）の手動確認。
// 1.5.0 以降は送信専用（状態・死亡通知）で、サーバー起動ごとのトークンがないと接続できない。
// 使い方: BRIDGE_MOD_TOKEN_FILE=<サーバーフォルダー>/config/bridgemod-token.txt node bridge/test/ws_smoke.js
const fs = require("fs");
const tokenFile = process.env.BRIDGE_MOD_TOKEN_FILE;
if (!tokenFile) {
  console.error("BRIDGE_MOD_TOKEN_FILE にサーバーフォルダーの config/bridgemod-token.txt を指定してください");
  process.exit(1);
}
const token = fs.readFileSync(tokenFile, "utf8").trim();

const messages = [];
const ws = new WebSocket(`ws://127.0.0.1:25577/?token=${encodeURIComponent(token)}`);
const timeout = setTimeout(() => {
  console.error("WebSocket smoke test timed out", messages);
  process.exit(1);
}, 10000);

ws.addEventListener("message", event => {
  const value = JSON.parse(String(event.data));
  messages.push(value);
  if (messages.some(x => x.ok === true && Object.hasOwn(x, "tps"))) {
    clearTimeout(timeout);
    console.log(JSON.stringify(messages, null, 2));
    ws.close();
    process.exit(0);
  }
});
ws.addEventListener("error", error => {
  clearTimeout(timeout);
  console.error(error);
  process.exit(1);
});
