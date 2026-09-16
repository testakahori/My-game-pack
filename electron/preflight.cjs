"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { validateBridgeConfig } = require("./config_schema.cjs");
const { validCommand } = require("./settings_backups.cjs");

function bounded(action, timeoutMs = 6000) {
  let timer;
  return Promise.race([Promise.resolve().then(action), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); })]).finally(() => clearTimeout(timer));
}

async function runPreflight(deps) {
  const checks = [];
  const add = (id, title, status, detail, page) => checks.push({ id, title, status, detail, page });
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(deps.configPath, "utf8"));
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("Invalid configuration");
  }
  catch { return { checkedAt: new Date().toISOString(), checks: [{ id: "config", title: "設定ファイル", status: "error", detail: "設定を読み込めません。初期セットアップと設定バックアップを確認してください。", page: "operations" }] }; }
  const username = String(cfg.tiktokUsername || "").trim().replace(/^@/, "");
  add("account", "TikTokアカウント", /^[\w.]{1,24}$/.test(username) ? "ok" : "error", username ? `@${username}` : "ダッシュボードでIDを入力して承認してください。", "dashboard");
  const validation = validateBridgeConfig(cfg);
  const messages = [...validation.errors, ...validation.warnings].map(message => message.replace(/mappings\[(\d+)\]\.commandFile が空です/, (_match, index) => `ギフト「${cfg.mappings[index]?.name || cfg.mappings[index]?.giftId || Number(index) + 1}」のコマンドが未設定です。`));
  add("config", "設定の整合性", validation.ok ? validation.warnings.length ? "warn" : "ok" : "error", messages.join(" / ") || "設定形式に問題はありません。", "gifts");
  const has = name => fs.existsSync(path.join(deps.serverRoot, name));
  add("server", "サーバーの準備", has("server.properties") && (has("run.bat") || has("libraries")) ? "ok" : "error", has("server.properties") ? "サーバーの設定と起動ファイルを確認します。" : "サーバー設定がありません。初期セットアップを確認してください。", "setup");
  let props = {};
  try { for (const line of fs.readFileSync(path.join(deps.serverRoot, "server.properties"), "utf8").split(/\r?\n/)) if (!line.startsWith("#") && line.includes("=")) { const i = line.indexOf("="); props[line.slice(0, i).trim()] = line.slice(i + 1).trim(); } } catch {}
  const world = props["level-name"];
  add("world", "配信ワールド", world && has(path.join(world, "level.dat")) ? "ok" : "warn", world && has(path.join(world, "level.dat")) ? world : "既存ワールドを確認できません。選択を確認してください（初回起動で生成する場合を除く）。", "dashboard");
  const usesRcon = cfg.options?.commandTransport !== "douma_mod";
  const rconOk = props["enable-rcon"] === "true" && Boolean(props["rcon.password"]) && props["rcon.password"] === cfg.rcon?.password && Number(props["rcon.port"] || 25575) === Number(cfg.rcon?.port || 25575);
  add("rcon", "RCON設定", rconOk ? "ok" : usesRcon ? "error" : "warn", rconOk ? "サーバーとBridgeの設定が一致しています。" : "RCONの有効化・ポート・パスワードの一致を確認してください。", "setup");
  const refs = new Set();
  function collect(value) {
    if (!value || typeof value !== "object" || value.enabled === false) return;
    if (typeof value.commandFile === "string" && value.commandFile.trim()) refs.add(value.commandFile.trim());
    for (const [key, child] of Object.entries(value)) if (key !== "rcon") collect(child);
  }
  collect(cfg);
  const missing = [...refs].filter(name => !validCommand(name.toLowerCase().endsWith(".txt") ? name : `${name}.txt`) || !fs.existsSync(path.join(deps.commandsDir, name.toLowerCase().endsWith(".txt") ? name : `${name}.txt`)));
  add("commands", "ギフト・イベントのコマンド", missing.length ? "error" : refs.size ? "ok" : "warn", missing.length ? `見つからないファイル: ${missing.slice(0, 8).join("、")}${missing.length > 8 ? " ほか" : ""}` : `${cfg.mappings?.length || 0}件のギフト設定 / ${refs.size}種類の参照コマンドを確認しました。`, "gifts");
  try {
    const meta = JSON.parse(fs.readFileSync(deps.giftsMetaPath, "utf8"));
    const gifts = JSON.parse(fs.readFileSync(deps.giftsPath, "utf8"));
    const age = Date.now() - Date.parse(meta.generatedAt);
    const same = String(meta.username || "").replace(/^@/, "").toLowerCase() === username.toLowerCase();
    const fresh = same && Number.isFinite(age) && age >= -60000 && age < 86400000 && Array.isArray(gifts) && gifts.length > 0;
    add("gifts", "ギフト一覧の更新", fresh ? "ok" : "warn", fresh ? `${new Set(gifts.map(g=>String(g.id))).size}種類 / 24時間以内に更新済み` : same ? "ギフト一覧が古いか空です。更新してください。" : "別アカウントの一覧です。現在のIDで更新してください。", "gifts_viewer");
  } catch { add("gifts", "ギフト一覧の更新", "warn", "ギフト一覧を取得してください。", "gifts_viewer"); }
  const [mod, tts] = await Promise.allSettled([bounded(deps.modStatus), bounded(deps.ttsStatus)]);
  const status = mod.status === "fulfilled" ? mod.value : null;
  add("mod", "Minecraftサーバー・Modの応答", status?.online ? "ok" : "warn", status?.online ? "サーバーとModが応答しています。" : "サーバー起動後に、もう一度チェックしてください。", "dashboard");
  if (status?.online) add("player", "プレイヤーの参加", status.player?.online ? "ok" : "warn", status.player?.online ? "プレイヤーの参加を確認しました。" : "Minecraftからサーバーに参加してください。", "dashboard");
  const bridge = deps.bridgeStatus();
  const connected = bridge.running && bridge.tiktok?.state === "connected" && String(bridge.tiktok.username || "").toLowerCase() === username.toLowerCase();
  add("bridge", "Bridge・TikTok LIVE接続", connected ? "ok" : "warn", connected ? `@${username} のLIVEへ接続しています。` : !bridge.running ? "Bridgeを起動し、TikTok LIVE接続後に再チェックしてください。" : bridge.tiktok?.state === "connected" ? "接続先アカウントを確認してください。" : "TikTok LIVEへの接続待ちです。", "dashboard");
  const voice = tts.status === "fulfilled" ? tts.value : null;
  add("tts", "読み上げエンジン", voice?.enabled === false ? "skip" : voice?.online ? "ok" : "warn", voice?.enabled === false ? "読み上げは無効です。" : voice?.online ? `${voice.engine === "aivis" ? "AivisSpeech" : "VOICEVOX"}が応答しています。` : "読み上げ設定からエンジンを起動してください。", "tts");
  return { checkedAt: new Date().toISOString(), checks };
}
module.exports = { runPreflight };
