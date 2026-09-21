"use strict";
const { TikTokLiveConnection, IsLiveRouteConfig } = require("tiktok-live-connector");
const { configureSystemCertificates } = require("./fetch_gifts.cjs");

async function fetchLiveStatus(username, createConnection = id => new TikTokLiveConnection(id, {})) {
  const connection = createConnection(username);
  // ライブの有無だけを読み取る。WebSocket接続やイベント実行は行わない。
  const live = await connection.fetchIsLive();
  if (typeof live !== "boolean") throw new Error("Invalid live status");
  return { live };
}

if (require.main === module) {
  configureSystemCertificates();
  IsLiveRouteConfig.skipFetchRoomIdFromEulerRoute = true;
  fetchLiveStatus(process.argv[2]).then(result => {
    console.log(JSON.stringify(result));
  }).catch(() => {
    console.error("TikTokの配信状態を確認できませんでした。しばらくしてから再試行してください。");
    process.exitCode = 1;
  });
}
module.exports = { fetchLiveStatus };
