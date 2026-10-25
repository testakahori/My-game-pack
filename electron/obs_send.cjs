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

// 送り先の形。JS の URL は寛容に直して読む（http:/x・127.1・my_host なども通す）が、OBSMOD（Java の URI）はそのまま読み、
// ホストが無い・構文の誤りなら既定の送り先に置き換える。そこで、Java の URI がそのまま使える形だけを受け付ける
// （PR3 の最後のレビュー 重要1。scripts/test-soutenmon-contracts.cjs の ObsSendParity が、本物の Java で照らす）。
const ENDPOINT = /^(https?):\/\/([^/?#]*)(.*)$/i;
const IPV4 = /^(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])){3}$/;
const IPV6 = /^\[[0-9A-Fa-f:.]+\]$/;
const HOST_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;
// ホスト名：区切りは英数字と -（先頭と末尾は英数字）。最後の区切りは英字で始まる（Java の URI の決まり。末尾の . は1つまでよい）。
function isHostName(host) {
  const labels = (host.endsWith(".") ? host.slice(0, -1) : host).split(".");
  return labels.every(label => HOST_LABEL.test(label)) && /^[A-Za-z]/.test(labels[labels.length - 1]);
}

// 送り先を確かめる。空なら ""（既定の送り先を使う）。おかしければ理由を投げる。
function normalizeEndpoint(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length > MAX_ENDPOINT_LENGTH) throw new Error(`送り先が長すぎます（${MAX_ENDPOINT_LENGTH}文字まで）`);
  if (!URL_CHARACTERS.test(text)) throw new Error("送り先に使えない文字があります（空白・\\・改行・日本語などは使えません）");
  const match = ENDPOINT.exec(text);
  if (!match || !match[2]) throw new Error("送り先は http:// か https:// で始まる URL にしてください");
  const [, , authority, rest] = match;
  if (authority.includes("@")) throw new Error("送り先にユーザー名・パスワードは入れられません");
  const bracket = authority.startsWith("[") ? authority.indexOf("]") : -1;
  const host = authority.startsWith("[") ? authority.slice(0, bracket + 1) : authority.split(":")[0];
  const portPart = authority.slice(host.length);
  if (!host || !/^(:[0-9]*)?$/.test(portPart) || !(IPV4.test(host) || IPV6.test(host) || isHostName(host))) {
    throw new Error("送り先のホスト名・IP アドレスを確かめてください");
  }
  if (portPart.length > 1 && Number(portPart.slice(1)) > 65535) throw new Error("送り先のポートは 0〜65535 にしてください");
  if (/%(?![0-9A-Fa-f]{2})/.test(text) || /[[\]]/.test(rest) || (rest.match(/#/g) || []).length > 1) {
    throw new Error("送り先に使えない書き方があります（% のあとは16進数2桁。[ ] と2つ目の # は使えません）");
  }
  try { new URL(text); } catch { throw new Error("送り先を URL として読めません（ホスト名・ポートを確かめてください）"); }
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
