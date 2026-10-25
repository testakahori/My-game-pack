"use strict";
// OBS 連携の窓口（obs:get・obs:set）。運用センターの「動作設定」の「OBS 連携」の欄が使う（2026-10-25）。
// 画面からアプリの設定を直接は書かせず、ここで確かめてから、アプリの設定とサーバーの obs-send.properties に書く。
// サーバーが動いている間に保存したときは、OBSMOD が読むのは次の起動なので、そう知らせる（serverRunning）。
const fs = require("node:fs");
const path = require("node:path");
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
    if (!settings || typeof settings !== "object" || Array.isArray(settings) || typeof settings.enabled !== "boolean") throw new Error("OBS ツールへ送るかどうか（オン・オフ）を選んでください");
    if (settings.endpoint !== undefined && typeof settings.endpoint !== "string") throw new Error("送り先は文字で入れてください");
    const next = { enabled: settings.enabled, endpoint: obs.normalizeEndpoint(settings.endpoint) };
    writeAppConfig({ obsSendEnabled: next.enabled, obsSendEndpoint: next.endpoint });
    // サーバーのフォルダーがまだ無い（初期セットアップの前など。run.bat が無い）ときは、アプリの設定だけ残す。サーバーの起動の直前にも書く（server_process.cjs）。
    // サーバーのファイルが書けなくても、アプリの設定には残り、次にアプリからサーバーを起動するときに書き直すので、失敗とせずに知らせる（PR3 の最後のレビュー 軽い2）。
    const root = getServerRoot();
    let wroteServer = false, serverWriteError;
    if (root && fs.existsSync(path.join(root, "run.bat"))) {
      try { obs.writeObsSend(root, next); wroteServer = true; }
      catch (error) { serverWriteError = `サーバーのファイルを書けませんでした（${error.code || error.message}）`; }
    }
    return { ok: true, serverRunning: await serverRunning(), wroteServer, ...(serverWriteError ? { serverWriteError } : {}) };
  }

  function register(ipcMain) {
    ipcMain.handle("obs:get", () => get());
    ipcMain.handle("obs:set", set);
  }

  return { register };
}

module.exports = { createObsIpc };
