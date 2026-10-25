"use strict";
// OBS 連携：標準装備の OBSMOD が OBS ツールへ送るか（2026-10-25 ユーザーの決定。HANDOFF04 の PR3）。
// 決めた内容はアプリの設定（app-config.json の obsSendEnabled・obsSendEndpoint）に残し、サーバーの
// config/minecraft_obs_bridge/obs-send.properties に書く。OBSMOD 2.4.8 の ObsSendSettings が、サーバーの起動のときに読む。
// 書く形の決まり（PR2 の最後のレビュー 軽い2）：UTF-8・BOM なしの2行。送り先は、OBSMOD がそのまま使える URL だけにする
// （http・https、ユーザー名・パスワードなし、空白・\・改行・ASCII でない文字なし）。照らし合わせは scripts/test-soutenmon-contracts.cjs。
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_ENDPOINT = "http://127.0.0.1:3000/event";
const MAX_ENDPOINT_LENGTH = 2000;
// URL に書ける文字（RFC 3986 の英数字と記号、% の書き方）。これ以外（空白・\・改行・ASCII でない文字など）は、
// properties の読み方（\ が消える）や Java の URI と食い違うので受け付けない。
const URL_CHARACTERS = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;

const obsSendFile = serverRoot => path.join(serverRoot, "config", "minecraft_obs_bridge", "obs-send.properties");

// 送り先を確かめる。空なら ""（既定の送り先を使う）。おかしければ理由を投げる。
function normalizeEndpoint(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length > MAX_ENDPOINT_LENGTH) throw new Error(`送り先が長すぎます（${MAX_ENDPOINT_LENGTH}文字まで）`);
  if (!URL_CHARACTERS.test(text)) throw new Error("送り先に使えない文字があります（空白・\\・改行・日本語などは使えません）");
  let url;
  try { url = new URL(text); } catch { throw new Error("送り先は http:// か https:// で始まる URL にしてください"); }
  if (!/^https?:$/.test(url.protocol) || !url.hostname) throw new Error("送り先は http:// か https:// で始まる URL にしてください");
  if (url.username || url.password) throw new Error("送り先にユーザー名・パスワードは入れられません");
  return text;
}

const settingsFromConfig = config => ({ enabled: config?.obsSendEnabled === true, endpoint: typeof config?.obsSendEndpoint === "string" ? config.obsSendEndpoint : "" });

const propertiesText = ({ enabled, endpoint }) => `enabled=${enabled ? "true" : "false"}\nendpoint=${endpoint || DEFAULT_ENDPOINT}\n`;

// サーバーのフォルダーに書く。書きかけを残さないよう、一時ファイルに書いてから置き換える。
function writeObsSend(serverRoot, settings) {
  const file = obsSendFile(serverRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, propertiesText(settings), "utf8");
  fs.renameSync(temp, file);
  return file;
}

module.exports = { DEFAULT_ENDPOINT, obsSendFile, normalizeEndpoint, settingsFromConfig, propertiesText, writeObsSend };
