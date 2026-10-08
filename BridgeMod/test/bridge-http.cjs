const fs = require('node:fs');
const path = require('node:path');

// BridgeMOD 1.5.0 以降は、サーバー起動ごとに config/bridgemod-token.txt へ書くトークンがない要求を 403 で拒否する。
// 検証サーバー（GIFT_QA_SERVER）のトークンを毎回読み、Bridge と同じヘッダーで送る。
function bridgeFetch(url, init = {}) {
  const token = fs.readFileSync(path.join(process.env.GIFT_QA_SERVER, 'config', 'bridgemod-token.txt'), 'utf8').trim();
  return fetch(url, { ...init, headers: { ...(init.headers || {}), 'X-Bridge-Token': token } });
}

module.exports = { bridgeFetch };
