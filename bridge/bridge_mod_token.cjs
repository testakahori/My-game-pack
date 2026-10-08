"use strict";

const fs = require("fs");
const path = require("path");

// BridgeMOD はサーバー起動ごとに乱数トークンを作り、<サーバーフォルダー>/config/bridgemod-token.txt に書く。
// HTTP は X-Bridge-Token ヘッダー、WebSocket は ?token= で送らないと 403 で拒否される（BridgeAuth.java）。
const TOKEN_HEADER = "X-Bridge-Token";

function bridgeModTokenPath(serverRoot) {
  return path.join(serverRoot, "config", "bridgemod-token.txt");
}

// サーバーを再起動するとトークンが変わるので、キャッシュせず毎回読む（数十バイトのファイル）。
function readBridgeModToken(file) {
  try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; }
}

function withBridgeModToken(file, headers = {}) {
  const token = readBridgeModToken(file);
  return token ? { ...headers, [TOKEN_HEADER]: token } : headers;
}

module.exports = { TOKEN_HEADER, bridgeModTokenPath, readBridgeModToken, withBridgeModToken };
