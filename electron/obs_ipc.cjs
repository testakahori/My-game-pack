"use strict";
// OBS 連携の窓口（obs:get・obs:set）。運用センターの「動作設定」の「OBS 連携」の欄が使う（2026-10-25）。
// 画面からアプリの設定を直接は書かせず、ここで確かめてから、アプリの設定とサーバーの obs-send.properties に書く。
// サーバーが動いている間に保存したときは、OBSMOD が読むのは次の起動なので、そう知らせる（serverRunning）。
const fs = require("node:fs");
const obs = require("./obs_send.cjs");

function createObsIpc({ readAppConfig, writeAppConfig, getServerRoot, isServerRunning }) {
  // サーバーが動いているかは知らせのための情報。確かめられない（ポートの確かめが失敗した）ときは null にし、読む・保存するは失敗させない
  // （PR3 の最後のレビュー 重要4）。
  const serverRunning = async () => { try { return Boolean(await isServerRunning()); } catch { return null; } };

  async function get() {
    const { enabled, endpoint } = obs.settingsFromConfig(readAppConfig());
    return { enabled, endpoint, defaultEndpoint: obs.DEFAULT_ENDPOINT, serverRunning: await serverRunning() };
  }

  async function set(_event, settings) {
    if (!settings || typeof settings.enabled !== "boolean") throw new Error("OBS ツールへ送るかどうか（オン・オフ）を選んでください");
    const next = { enabled: settings.enabled, endpoint: obs.normalizeEndpoint(settings.endpoint) };
    writeAppConfig({ obsSendEnabled: next.enabled, obsSendEndpoint: next.endpoint });
    // サーバーのフォルダーがまだ無い（初期セットアップの前など）ときは、アプリの設定だけ残す。サーバーの起動の直前にも書く（server_process.cjs）。
    const root = getServerRoot();
    const wroteServer = Boolean(root) && fs.existsSync(root);
    if (wroteServer) obs.writeObsSend(root, next);
    return { ok: true, serverRunning: await serverRunning(), wroteServer };
  }

  function register(ipcMain) {
    ipcMain.handle("obs:get", () => get());
    ipcMain.handle("obs:set", set);
  }

  return { register };
}

module.exports = { createObsIpc };
