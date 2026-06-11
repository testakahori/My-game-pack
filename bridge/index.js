// bridge/index.js
// TikTok Live -> (Minecraft RCON / 7DTD Telnet) Bridge (commandFile mode)
//
// - config は { tiktokUsername, target, options, mappings } を想定
// - mappings: { giftId, name, commandFile, repeat }
// - commandFile: commandsDir 配下の txt（1行=1コマンド）
// - 連打ギフト(streak)は repeatCount の「増えた分(delta)」だけ毎回反応（1→2→3…で毎回+1発動）
// - dedupe(二重発火)で「1回投げたのに2回発動」を止める
// - txt 内の {ListenerName} を投げた人の表示名に置換（ゲーム別に安全化）
// - 7DTD の txt 内は {PlayerId} も置換可能（config.target.telnet.playerId）
//
// [ADD] 全ギフト共通タイトル表示（datapack）
// - txt 先頭のメタ: "# TITLE: 猫ちゃん登場" を読み取る
// - ギフト発火時、実コマンドの前に必ず以下を前置き（Minecraftのみ）
//   data modify storage giftstream:bridge listener set value "<投げ主名>"
//   data modify storage giftstream:bridge title    set value "<TITLE>"
//   function giftstream:_announce
//
// 連打ギフトで毎回タイトルを出すと煩い場合：下の options.announceEveryRepeat を false に。

"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const os = require("os");
const { execFile } = require("child_process");
const { WebcastPushConnection } = require("tiktok-live-connector");
const { Rcon } = require("rcon-client");

// --------------------
// Minecraft RCON キープアライブ接続管理
// --------------------
let activeRcon = null;
let rconTimeoutTimer = null;
const RCON_KEEP_ALIVE_MS = 10000; // 10秒間アイドルで自動切断

async function getMinecraftRcon(host, port, password) {
  if (activeRcon && activeRcon.socket && !activeRcon.socket.destroyed) {
    if (rconTimeoutTimer) {
      clearTimeout(rconTimeoutTimer);
      rconTimeoutTimer = null;
    }
    return activeRcon;
  }

  if (activeRcon) {
    try { activeRcon.end(); } catch (_) {}
    activeRcon = null;
  }

  console.log("[RCON] Connecting to Minecraft...");
  activeRcon = await Rcon.connect({ host, port, password });
  console.log("[RCON] Connected (New Connection established).");
  return activeRcon;
}

function scheduleRconDisconnect() {
  if (rconTimeoutTimer) clearTimeout(rconTimeoutTimer);
  rconTimeoutTimer = setTimeout(() => {
    if (activeRcon) {
      console.log("[RCON] Disconnecting due to inactivity (keep-alive)...");
      try { activeRcon.end(); } catch (_) {}
      activeRcon = null;
    }
    rconTimeoutTimer = null;
  }, RCON_KEEP_ALIVE_MS);
}

// --------------------
// ファイルログ（起動ごとにタイムスタンプ付きログを自動保存）
// --------------------
(function setupFileLogging() {
  const logsDir = path.join(__dirname, "logs");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  // 古いログを整理（最新 50 件だけ残す）
  try {
    const files = fs.readdirSync(logsDir)
      .filter(f => f.startsWith("bridge-") && f.endsWith(".log"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    files.slice(50).forEach(f => fs.unlinkSync(path.join(logsDir, f.name)));
  } catch (_) {}

  const stamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "");
  const logPath = path.join(logsDir, `bridge-${stamp}.log`);
  const stream = fs.createWriteStream(logPath, { flags: "a", encoding: "utf8" });

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  const writeLine = (prefix, args) => {
    const text = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    stream.write(`[${new Date().toISOString()}]${prefix} ${text}\n`);
  };

  console.log   = (...a) => { origLog(...a);   writeLine("",        a); };
  console.error = (...a) => { origError(...a); writeLine(" [ERROR]", a); };
  console.warn  = (...a) => { origWarn(...a);  writeLine(" [WARN]",  a); };

  process.on("exit", () => {
    stream.write(`=== Bridge Log Ended: ${new Date().toISOString()} ===\n`);
    stream.end();
  });

  origLog(`[Bridge] ログファイル: ${logPath}`);
  stream.write(`=== Bridge Log Started: ${new Date().toISOString()} ===\n`);
})();

// --------------------
// TTS (読み上げ)
// --------------------
const TTS_DEFAULTS = {
  engine: "voicevox",
  speakerId: 2,
  speedScale: 1.2,
  pitchScale: 0.0,
  intonationScale: 1.0,
  volume: 1.0,
  enabled: true,
  commentEnabled: true,
  giftEnabled: true,
  giftTemplate: "{sender}さんから{gift}が来たよ！",
};

const TTS_PORTS = { voicevox: 50021, aivis: 10101 };

function loadTtsConfig() {
  const p = path.join(__dirname, "tts-settings.json");
  if (!fs.existsSync(p)) return { ...TTS_DEFAULTS };
  try {
    return { ...TTS_DEFAULTS, ...JSON.parse(fs.readFileSync(p, "utf-8")) };
  } catch {
    return { ...TTS_DEFAULTS };
  }
}

function ttsHttpPost(port, reqPath, body, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const bodyBuf = typeof body === "string" ? Buffer.from(body) : body;
    const req = http.request(
      { hostname: "127.0.0.1", port, path: reqPath, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bodyBuf.length } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

async function speakText(text, cfg) {
  try {
    const port = TTS_PORTS[cfg.engine] || TTS_PORTS.voicevox;
    const speakerId = cfg.speakerId ?? 2;

    const queryRes = await ttsHttpPost(
      port,
      `/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`,
      "", 10000
    );
    if (queryRes.status !== 200) return;

    const query = JSON.parse(queryRes.body.toString());
    query.speedScale = cfg.speedScale ?? 1.2;
    query.pitchScale = cfg.pitchScale ?? 0.0;
    query.intonationScale = cfg.intonationScale ?? 1.0;
    query.volumeScale = cfg.volume ?? 1.0;

    const synthRes = await ttsHttpPost(
      port,
      `/synthesis?speaker=${speakerId}`,
      JSON.stringify(query),
      15000
    );
    if (synthRes.status !== 200) return;

    const tmpWav = path.join(os.tmpdir(), `bridge_tts_${Date.now()}.wav`);
    fs.writeFileSync(tmpWav, synthRes.body);

    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-c",
        `(New-Object Media.SoundPlayer '${tmpWav.replace(/'/g, "''")}').PlaySync()`],
      () => { try { fs.unlinkSync(tmpWav); } catch {} }
    );
  } catch (e) {
    console.warn("[TTS] speakText error:", e?.message || e);
  }
}

// ------------------------
// Utils
// ------------------------
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString()}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureTxt(name) {
  if (!name) return "";
  const v = String(name).trim();
  if (!v) return "";
  return v.toLowerCase().endsWith(".txt") ? v : `${v}.txt`;
}

function clampInt(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

// CLI: --config <path>
function getConfigPathFromArgs() {
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === "--config" || a === "-c");
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return null;
}

// ---- RCON password loader ----
// 優先順位：ENV > rcon_password.txt > config
function loadRconPassword() {
  // 1) env があれば最優先（起動batから渡す保険）
  const env = process.env.RCON_PASSWORD;
  if (env && env.trim()) return env.trim();

  // 2) rcon_password.txt を探す（実行位置が変わっても耐える）
  const candidates = [
    path.resolve(process.cwd(), "rcon_password.txt"),
    path.resolve(process.cwd(), "server", "forge-1.20.1", "rcon_password.txt"),
    path.resolve(__dirname, "..", "server", "forge-1.20.1", "rcon_password.txt"),
    path.resolve(__dirname, "..", "..", "server", "forge-1.20.1", "rcon_password.txt"),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const pw = fs.readFileSync(p, "utf8").trim();
        if (pw) return pw;
      }
    } catch {}
  }

  return "";
}

// Minecraft JSON文字列に安全に入れるための最低限エスケープ
function mcJsonStringEscape(s, maxLen = 40) {
  let v = String(s ?? "");
  v = v.replace(/[\r\n\t]/g, " ");
  v = v.replace(/[\u0000-\u001F\u007F]/g, "");
  if (v.length > maxLen) v = v.slice(0, maxLen);
  return JSON.stringify(v).slice(1, -1);
}

// storage set value "..." 用（SNBT文字列）のエスケープ
function snbtString(s, maxLen = 60) {
  let v = String(s ?? "");
  v = v.replace(/[\r\n\t]/g, " ");
  v = v.replace(/[\u0000-\u001F\u007F]/g, "");
  if (v.length > maxLen) v = v.slice(0, maxLen);
  v = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${v}"`;
}

// 7DTD Telnet に安全に差し込む（改行/制御文字を排除、長さ制限）
function telnetSafeText(s, maxLen = 60) {
  let v = String(s ?? "");
  v = v.replace(/[\r\n\t]/g, " ");
  v = v.replace(/[\u0000-\u001F\u007F]/g, ""); // 制御文字除去
  if (v.length > maxLen) v = v.slice(0, maxLen);
  return v;
}

// コマンドtxt：メタ(# KEY: value) + コマンド行を分離
function parseCommandFile(text) {
  const meta = {};
  const commands = [];

  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let raw of lines) {
    const line = String(raw).trim();
    if (!line) continue;

    // メタ行: # TITLE: xxx
    if (line.startsWith("#")) {
      const m = line.match(/^#\s*([A-Z_]+)\s*:\s*(.+)\s*$/i);
      if (m) {
        const key = String(m[1]).toUpperCase();
        const val = String(m[2]).trim();
        meta[key] = val;
      }
      continue; // # 行はコマンドとしては実行しない
    }

    // // コメントも無視
    if (line.startsWith("//")) continue;

    commands.push(line);
  }

  return { meta, commands };
}

// placeholder 置換（ゲーム別に安全化）
// - {ListenerName}
// - {PlayerId}（7DTDのみ）
function applyPlaceholders(command, ctx) {
  const game = String(ctx.gameType || "minecraft");
  const listenerRaw = String(ctx.listenerName ?? "unknown");

  let out = String(command);

  if (game === "7dtd") {
    const safeListener = telnetSafeText(listenerRaw, 60);
    out = out.split("{ListenerName}").join(safeListener);

    const pid = Number(ctx.playerId);
    if (Number.isFinite(pid) && pid > 0) {
      out = out.split("{PlayerId}").join(String(pid));
    }
    return out;
  }

  // default: minecraft
  const safeListener = mcJsonStringEscape(listenerRaw, 40);
  out = out.split("{ListenerName}").join(safeListener);
  return out;
}

// ------------------------
// Command file cache
// ------------------------
const commandCache = new Map();
/**
 * cacheKey = absoluteFilePath
 * value = { mtimeMs, parsed:{meta,commands} }
 */
function loadCommandsFromFile(absPath) {
  const st = fs.statSync(absPath);
  const cached = commandCache.get(absPath);
  if (cached && cached.mtimeMs === st.mtimeMs) return cached.parsed;

  const txt = fs.readFileSync(absPath, "utf8");
  const parsed = parseCommandFile(txt); // { meta, commands }

  commandCache.set(absPath, { mtimeMs: st.mtimeMs, parsed });
  return parsed;
}

// ------------------------
// Dedupe (double gift events protection)
// ------------------------
const recentEvents = new Map(); // key -> timestamp(ms)
const DEDUPE_WINDOW_MS = 2500; // 2.5秒以内の同一イベントは捨てる（msgId ベースのキー用）
const DEDUPE_FALLBACK_WINDOW_MS = 200; // msgId なしのフォールバックキー用（短めにして誤判定を抑制）
const DEDUPE_CLEANUP_MS = 15000;

function getStableSender(data) {
  return (
    String(data.nickname ?? "").trim() ||
    String(data.uniqueId ?? "").trim() ||
    String(data.userId ?? "").trim() ||
    "unknown"
  );
}

function dedupeKeyFromGift(data) {
  const msgId =
    data.msgId ||
    data.messageId ||
    data.eventId ||
    data.id ||
    data.gift?.msgId ||
    data.gift?.messageId ||
    "";

  const giftId = String(data.giftId ?? "");
  const user = getStableSender(data);
  const repeatCount = String(data.repeatCount ?? "");
  const repeatEnd = String(data.repeatEnd ?? "");

  if (msgId) {
    // 連打ギフトの場合は repeatCount を含めて重複排除キーを一意にする
    return `msg:${String(msgId)}|rc:${repeatCount}`;
  }

  return `g:${giftId}|u:${user}|rc:${repeatCount}|re:${repeatEnd}`;
}

function isDuplicateEvent(key) {
  // msgId ベースのキーは 2.5 秒で重複除去、フォールバックキーは 100ms に短縮
  // （フォールバックキーは同一ユーザー/匿名ユーザーの誤判定を防ぐため）
  const windowMs = key.startsWith("msg:") ? DEDUPE_WINDOW_MS : DEDUPE_FALLBACK_WINDOW_MS;
  const now = Date.now();
  const last = recentEvents.get(key) || 0;
  if (now - last < windowMs) return true;
  recentEvents.set(key, now);

  for (const [k, t] of recentEvents) {
    if (now - t > DEDUPE_CLEANUP_MS) recentEvents.delete(k);
  }
  return false;
}

// ------------------------
// Target executors
// ------------------------
async function execCommandsToMinecraftRcon({
  commands,
  contextLabel,
  rconHost,
  rconPort,
  rconPassword,
  maxCommandsPerGift,
}) {
  if (!commands || commands.length === 0) return;

  const trimmed = commands.slice(0, maxCommandsPerGift);

  let rcon;
  try {
    rcon = await getMinecraftRcon(rconHost, rconPort, rconPassword);

    // Fix 3: プレイヤーが0人ならスキップ（ログアウト後の後追い実行防止）
    try {
      const listResp = await rcon.send("list");
      const m = listResp.match(/There are (\d+) of/);
      if (m && parseInt(m[1], 10) === 0) {
        console.log(`[RCON] No players online, skipping (${contextLabel})`);
        scheduleRconDisconnect();
        return;
      }
    } catch {
      // list check failed, proceed anyway
    }

    for (let i = 0; i < trimmed.length; i++) {
      const cmd = trimmed[i];
      try {
        await rcon.send(cmd);
        console.log(`  [CMD ${i + 1}/${trimmed.length}] OK: ${cmd}`);
      } catch (e) {
        console.log(`  [CMD ${i + 1}/${trimmed.length}] NG: ${cmd}`);
        console.log(`       -> ${e?.message || e}`);
      }
    }

    if (commands.length > trimmed.length) {
      console.log(
        `[RCON] Truncated: ${commands.length} -> ${trimmed.length} (maxCommandsPerGift)`
      );
    }
  } catch (e) {
    console.error(`[RCON] Error (${contextLabel}):`, e?.message || e);
    // 接続エラー時はアクティブ接続を破棄する
    if (activeRcon) {
      try { activeRcon.end(); } catch (_) {}
      activeRcon = null;
    }
  } finally {
    // 毎回切断せず、キープアライブタイマーを開始する
    scheduleRconDisconnect();
  }
}

function commandFileToDoumaKey(commandFile) {
  const file = ensureTxt(commandFile);
  return path.basename(file, ".txt");
}

function sendDoumaModEvent({ host, port, type, commandFile, count, listenerName, announce }) {
  const payload = JSON.stringify({
    type,
    key: commandFileToDoumaKey(commandFile),
    count: clampInt(count, 1, 100, 1),
    listenerName: String(listenerName || "viewer"),
    announce: announce !== false,
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path: "/douma/event",
      method: "POST",
      timeout: 1500,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`DoumaMod HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("DoumaMod HTTP timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function enqueueDoumaModEvent(doumaMod, event) {
  try {
    await sendDoumaModEvent({ ...doumaMod, ...event });
  } catch (e) {
    console.error(`[DoumaMod] Send failed (${event.type}:${event.commandFile}):`, e?.message || e);
  }
}

// 7DTD Telnet: 1回の接続でまとめて送る（高速・安定）
// - password は「要求されたときだけ送る」設計（要求が無いと 9797 が unknown command になるため）
// - ただし sendPasswordAlways=true なら必ず先に送る
async function execCommandsTo7dtdTelnet({
  commands,
  contextLabel,
  host,
  port,
  password,
  sendPasswordAlways,
  maxCommandsPerGift,
}) {
  if (!commands || commands.length === 0) return;

  const trimmed = commands.slice(0, maxCommandsPerGift);

  const CRLF = "\r\n";
  const writeLine = (socket, line) => socket.write(line + CRLF);

  // パスワード要求っぽい文言（環境により揺れるのでゆるく判定）
  const looksLikePasswordPrompt = (s) => {
    const t = String(s).toLowerCase();
    return (
      t.includes("password") ||
      t.includes("enter password") ||
      t.includes("please enter") ||
      t.includes("login") ||
      t.includes("auth")
    );
  };

  return await new Promise((resolve) => {
    let socket;
    let ended = false;
    let sentPassword = false;
    let buffer = "";

    const finish = () => {
      if (ended) return;
      ended = true;
      try {
        socket?.end();
      } catch {}
      resolve();
    };

    try {
      socket = net.createConnection({ host, port }, () => {
        console.log(`[TELNET] Connected: ${host}:${port}`);

        // すぐ送る設定なら即
        if (sendPasswordAlways && password) {
          writeLine(socket, String(password));
          sentPassword = true;
        }

        // 少し待ってからコマンド送信（初期メッセージ受信を待つ）
        setTimeout(() => {
          for (let i = 0; i < trimmed.length; i++) {
            const cmd = trimmed[i];
            writeLine(socket, cmd);
            console.log(`  [CMD ${i + 1}/${trimmed.length}] SENT: ${cmd}`);
          }

          if (commands.length > trimmed.length) {
            console.log(
              `[TELNET] Truncated: ${commands.length} -> ${trimmed.length} (maxCommandsPerGift)`
            );
          }

          // 送ったら少し待って終了（ログ反映待ち）
          setTimeout(() => finish(), 600);
        }, 250);
      });

      socket.setTimeout(5000);

      socket.on("data", (buf) => {
        const text = buf.toString("utf8");
        process.stdout.write(text);

        // 初期の数回だけ判定
        buffer += text;
        if (buffer.length > 4000) buffer = buffer.slice(-4000);

        if (!sentPassword && password && looksLikePasswordPrompt(buffer)) {
          writeLine(socket, String(password));
          sentPassword = true;
          console.log("[TELNET] Password prompt detected -> sent password");
        }
      });

      socket.on("timeout", () => {
        console.error(`[TELNET] Timeout (${contextLabel})`);
        finish();
      });

      socket.on("error", (err) => {
        console.error(`[TELNET] Error (${contextLabel}):`, err?.message || err);
        finish();
      });

      socket.on("end", () => finish());
      socket.on("close", () => finish());
    } catch (e) {
      console.error(`[TELNET] Fatal (${contextLabel}):`, e?.message || e);
      finish();
    }
  });
}

// ------------------------
// Main
// ------------------------
async function main() {
  console.log("=======================================");
  console.log("[Bridge] TikTok → Command Bridge");
  console.log("        target: Minecraft(RCON) / 7DTD(Telnet)");
  console.log("=======================================");
  console.log(`[Bridge] Started: ${nowStr()}`);

  const argConfig = getConfigPathFromArgs();
  const defaultConfigPath = path.join(__dirname, "config.json");
  const configPath = argConfig ? path.resolve(process.cwd(), argConfig) : defaultConfigPath;

  if (!fs.existsSync(configPath)) {
    console.error(`[ERROR] config not found: ${configPath}`);
    console.error(
      `        例: .\\node\\node.exe .\\bridge\\index.js --config .\\bridge\\config.minecraft.json`
    );
    process.exit(1);
  }

  const config = safeReadJson(configPath);

  const tiktokUsername = String(config.tiktokUsername || "").trim();
  const target = config.target || { type: "minecraft", rcon: config.rcon }; // 互換
  const targetType = String(target.type || "minecraft").toLowerCase();

  const options = config.options || {};
  const giftCooldownMs = Number(options.giftCooldownMs ?? 300);
  const maxCommandsPerGift = Number(options.maxCommandsPerGift ?? 50);
  const maxLikeCatchUpPerEvent = clampInt(options.maxLikeCatchUpPerEvent ?? 5, 1, 100, 5);
  const rconQueueWarnSize = clampInt(options.rconQueueWarnSize ?? 20, 1, 10000, 20);
  const commandTransport = String(options.commandTransport || "rcon").toLowerCase().trim();
  const useDoumaModTransport = targetType === "minecraft" && (
    commandTransport === "douma_mod" ||
    commandTransport === "doumamod" ||
    commandTransport === "mod" ||
    commandTransport === "http"
  );
  const doumaModHost = String(options.doumaModHost || "127.0.0.1").trim();
  const doumaModPort = Number(options.doumaModPort || 25576);
  const logUnknownGifts = !!options.logUnknownGifts;

  // [ADD] announce settings
  const ANNOUNCE_FUNCTION = String(options.announceFunction || "gift_stream:_announce").trim();
const ANNOUNCE_STORAGE = String(options.announceStorage || "gift_stream:bridge").trim();
  const announceEveryRepeat = options.announceEveryRepeat !== false; // default true
  const announceEnabled = options.announceEnabled !== false; // default true

  const commandsDirName = String(options.commandsDir || "commands");
  const commandsDirAbs = path.resolve(__dirname, commandsDirName);

  const mappings = Array.isArray(config.mappings) ? config.mappings : [];
  let likeEvents       = Array.isArray(config.likeEvents) ? config.likeEvents : [];
  let shareEvent       = config.shareEvent       ?? null;
  let followEvent      = config.followEvent      ?? null;
  let memberEvent      = config.memberEvent      ?? null;
  let unmappedGiftEvent = config.unmappedGiftEvent ?? null;

  if (!tiktokUsername) {
    console.error("[ERROR] tiktokUsername is empty in config");
    process.exit(1);
  }
  if (!fs.existsSync(commandsDirAbs)) {
    console.error(`[ERROR] commands folder not found: ${commandsDirAbs}`);
    console.error(`        bridge/${commandsDirName} を作って、txtを入れてください。`);
    process.exit(1);
  }

  // Target validate
  let mc = null;
  let doumaMod = null;
  let dtd = null;

  if (targetType === "minecraft") {
    if (useDoumaModTransport) {
      if (!Number.isFinite(doumaModPort) || doumaModPort <= 0) {
        console.error("[ERROR] options.doumaModPort is invalid.");
        process.exit(1);
      }
      doumaMod = { host: doumaModHost, port: doumaModPort };
    } else {
      // 互換: config.rcon が直下でもOK
      const r = target.rcon || config.rcon || {};
      const rconHost = String(process.env.RCON_HOST || r.host || "127.0.0.1").trim();
      const rconPort = Number(process.env.RCON_PORT || r.port || 25575);

      // 優先順位：ENV > rcon_password.txt > config
      const pwFromEnvOrFile = loadRconPassword();
      const rconPassword = pwFromEnvOrFile || String(r.password || "").trim();

      if (!rconPassword) {
        console.error("[ERROR] RCON password is empty.");
        console.error(
          "        対処：server/forge-1.20.1/rcon_password.txt を作る（setup_rcon.bat実行）"
        );
        console.error("        または環境変数 RCON_PASSWORD を設定する");
        process.exit(1);
      }

      mc = { rconHost, rconPort, rconPassword };

      console.log(`[Bridge] RCON password source: ${pwFromEnvOrFile ? "env/file" : "config"}`);
    }

    if (!mc && !doumaMod) {
      console.error("[ERROR] Minecraft command transport is not configured.");
      process.exit(1);
    }
  } else if (targetType === "7dtd" || targetType === "7days" || targetType === "7dtdtelnet") {
    const t = target.telnet || {};
    const host = String(t.host || "127.0.0.1").trim();
    const port = Number(t.port || 8081);
    const password = String(t.password || "").trim(); // ローカルだと不要な場合あり
    const playerId = Number(t.playerId || 0);
    const sendPasswordAlways = !!t.sendPasswordAlways;

    if (!Number.isFinite(port) || port <= 0) {
      console.error("[ERROR] target.telnet.port is invalid (7dtd)");
      process.exit(1);
    }
    if (!Number.isFinite(playerId) || playerId <= 0) {
      console.error("[ERROR] target.telnet.playerId is invalid (7dtd) 例: 171");
      process.exit(1);
    }

    dtd = { host, port, password, playerId, sendPasswordAlways };
  } else {
    console.error(`[ERROR] unknown target.type: ${targetType}`);
    console.error(`        use "minecraft" or "7dtd"`);
    process.exit(1);
  }

  // giftId -> mapping
  const mappingById = new Map();
  for (const m of mappings) {
    const giftId = String(m.giftId ?? "").trim();
    if (!giftId) continue;

    mappingById.set(giftId, {
      giftId,
      name: String(m.name ?? "").trim() || `gift:${giftId}`,
      commandFile: ensureTxt(String(m.commandFile ?? "").trim()),
      repeat: clampInt(m.repeat ?? 1, 1, 100, 1),
    });
  }

  // --- コンフィグ ホットリロード ---
  function reloadDynamicConfig() {
    try {
      const newCfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      likeEvents        = Array.isArray(newCfg.likeEvents) ? newCfg.likeEvents : [];
      shareEvent        = newCfg.shareEvent        ?? null;
      followEvent       = newCfg.followEvent       ?? null;
      memberEvent       = newCfg.memberEvent       ?? null;
      unmappedGiftEvent = newCfg.unmappedGiftEvent ?? null;
      // mappings も再構築
      const newMappings = Array.isArray(newCfg.mappings) ? newCfg.mappings : [];
      mappingById.clear();
      for (const m of newMappings) {
        const gid = String(m.giftId ?? "").trim();
        if (!gid) continue;
        mappingById.set(gid, {
          giftId: gid,
          name: String(m.name ?? "").trim() || `gift:${gid}`,
          commandFile: ensureTxt(String(m.commandFile ?? "").trim()),
          repeat: clampInt(m.repeat ?? 1, 1, 100, 1),
        });
      }
      console.log(`[Bridge] Config reloaded — likeEvents:${likeEvents.length} mappings:${mappingById.size}`);
    } catch (e) {
      console.log("[Bridge] Config reload error:", e?.message);
    }
  }
  let _reloadTimer = null;
  try {
    fs.watch(configPath, () => {
      clearTimeout(_reloadTimer);
      _reloadTimer = setTimeout(reloadDynamicConfig, 500);
    });
  } catch {}

  console.log(`[Bridge] Config: ${configPath}`);
  console.log(`[Bridge] TikTok Username: @${tiktokUsername}`);
  console.log(`[Bridge] Target: ${targetType}`);
  if (mc) console.log(`[Bridge] RCON: ${mc.rconHost}:${mc.rconPort}`);
  if (doumaMod) console.log(`[Bridge] DoumaMod HTTP: ${doumaMod.host}:${doumaMod.port}`);
  if (dtd) console.log(`[Bridge] Telnet: ${dtd.host}:${dtd.port} playerId=${dtd.playerId}`);
  console.log(`[Bridge] Mappings: ${mappingById.size} items`);
  console.log(`[Bridge] CommandsDir: ${commandsDirName}/`);
  console.log(`[Bridge] Cooldown: ${giftCooldownMs}ms`);
  console.log(`[Bridge] maxCommandsPerGift: ${maxCommandsPerGift}`);

  if (targetType === "minecraft") {
    console.log(`[Bridge] Announce: ${announceEnabled ? "ON" : "OFF"} func=${ANNOUNCE_FUNCTION}`);
    console.log(
      `[Bridge] AnnounceEveryRepeat: ${announceEveryRepeat ? "true" : "false"} storage=${ANNOUNCE_STORAGE}`
    );
  }

  const activelikeEvents = likeEvents.filter((e) => e.enabled !== false && e.commandFile && e.threshold);
  console.log(`[Bridge] LikeEvents: ${activelikeEvents.length} active`);
  if (shareEvent?.enabled !== false && shareEvent?.commandFile)
    console.log(`[Bridge] ShareEvent: ${shareEvent.commandFile}`);
  if (followEvent?.enabled !== false && followEvent?.commandFile)
    console.log(`[Bridge] FollowEvent: ${followEvent.commandFile}`);
  if (memberEvent?.enabled !== false && memberEvent?.commandFile)
    console.log(`[Bridge] MemberEvent: ${memberEvent.commandFile}`);
  if (unmappedGiftEvent?.enabled !== false && unmappedGiftEvent?.commandFile)
    console.log(`[Bridge] UnmappedGiftEvent: ${unmappedGiftEvent.commandFile}`);
  console.log("---------------------------------------");

  function resolveCommands(mapping) {
    const file = mapping.commandFile;
    if (!file) return { ok: false, commands: [], meta: {}, reason: "commandFile is empty" };

    const abs = path.resolve(commandsDirAbs, file);

    const base = (commandsDirAbs.endsWith(path.sep) ? commandsDirAbs : commandsDirAbs + path.sep)
      .toLowerCase();
    const absLower = abs.toLowerCase();

    if (!absLower.startsWith(base)) {
      return { ok: false, commands: [], meta: {}, reason: "invalid commandFile path" };
    }

    if (!fs.existsSync(abs)) {
      return {
        ok: false,
        commands: [],
        meta: {},
        reason: `file not found: ${commandsDirName}/${file}`,
      };
    }

    try {
      const parsed = loadCommandsFromFile(abs); // { meta, commands }
      return { ok: true, commands: parsed.commands, meta: parsed.meta, reason: "" };
    } catch (e) {
      return { ok: false, commands: [], meta: {}, reason: e?.message || String(e) };
    }
  }

  const tiktok = new WebcastPushConnection(tiktokUsername, {});
  const lastExecAt = new Map(); // cooldown (giftId+sender)
  const streakLastCount = new Map(); // key: giftId:sender -> lastRepeatCount

  // RCON/Telnet 実行を直列化しつつ、ギフトをいいねの backlog より優先する。
  // 並列接続による gift_stream:bridge ストレージの上書きを防ぐため、実行自体は常に1本。
  const rconQueue = [];
  let rconQueueRunning = false;
  let rconQueueSeq = 0;

  function enqueueRcon(label, fn, opts = {}) {
    const priority = Number(opts.priority ?? 0);
    rconQueue.push({ label, fn, priority, seq: ++rconQueueSeq });
    rconQueue.sort((a, b) => (b.priority - a.priority) || (a.seq - b.seq));

    if (rconQueue.length === rconQueueWarnSize) {
      console.warn(`[Queue] Backlog reached ${rconQueue.length}. Gifts will be prioritized over likes.`);
    }

    drainRconQueue().catch((e) => {
      console.error("[Queue] Drain error:", e?.message || e);
    });
  }

  async function drainRconQueue() {
    if (rconQueueRunning) return;
    rconQueueRunning = true;
    try {
      while (rconQueue.length > 0) {
        const job = rconQueue.shift();
        try {
          await job.fn();
        } catch (e) {
          console.error(`[Queue] Error in ${job.label}:`, e?.message || e);
        }
      }
    } finally {
      rconQueueRunning = false;
      if (rconQueue.length > 0) {
        drainRconQueue().catch((e) => {
          console.error("[Queue] Drain error:", e?.message || e);
        });
      }
    }
  }

  async function connectTikTokWithRetry() {
    while (true) {
      try {
        const state = await tiktok.connect();
        console.log(`[TikTok] Connected. roomId=${state.roomId}`);
        return;
      } catch (e) {
        console.error("[TikTok] Connect failed:", e?.message || e);
        console.log("[TikTok] Retry in 5 seconds...");
        await sleep(5000);
      }
    }
  }

  await connectTikTokWithRetry();

  // 接続後のイベントだけを処理するための基準時刻
  const connectedAt = Date.now();
  console.log(`[Bridge] connectedAt: ${connectedAt}`);

  // イベントの createTime（秒）が接続前なら無視する
  function isPreConnectionEvent(data) {
    const t = Number(data.createTime ?? 0);
    if (t <= 0) return false; // タイムスタンプ無しは通す
    return t * 1000 < connectedAt;
  }

  console.log("[Bridge] Listening for gifts...");
  console.log("[Bridge] Press Ctrl+C to stop.");

  tiktok.on("gift", async (data) => {
    // [診断ログ] TikTok ライブラリが受信した全ギフトイベントを記録
    const _rawGiftId = String(data.giftId ?? "");
    const _rawName = String(data.giftName ?? data.extendedGiftInfo?.name ?? "");
    const _rawMsgId = data.msgId || data.messageId || data.eventId || data.id || data.gift?.msgId || data.gift?.messageId || "";
    const _rawCreateTime = Number(data.createTime ?? 0);
    const _rawSender = getStableSender(data);
    console.log(`[Gift:RAW] id=${_rawGiftId} name="${_rawName}" from=${_rawSender} msgId=${_rawMsgId || "(none)"} createTime=${_rawCreateTime} rc=${data.repeatCount ?? ""} re=${data.repeatEnd ?? ""}`);

    if (isPreConnectionEvent(data)) {
      console.log(`[Gift:SKIP:pre-connection] id=${_rawGiftId} name="${_rawName}" createTime=${_rawCreateTime} connectedAt=${connectedAt} diff=${_rawCreateTime * 1000 - connectedAt}ms`);
      return;
    }

    const giftId = String(data.giftId ?? "");
    const giftName = String(data.giftName ?? data.extendedGiftInfo?.name ?? "");
    const sender = getStableSender(data);
    const repeatText = data.repeatCount ? ` x${data.repeatCount}` : "";

    // dedupe（二重発火防止）
    const dkey = dedupeKeyFromGift(data);
    if (isDuplicateEvent(dkey)) {
      console.log(`[Gift:SKIP:dedupe] id=${giftId} name="${giftName}" from=${sender} key=${dkey}`);
      return;
    }

    const mapping = mappingById.get(giftId);
    if (!mapping) {
      if (logUnknownGifts) {
        console.log(
          `[Gift] (unmapped) id=${giftId} name="${giftName}" from=${sender}${repeatText}`
        );
      }
      // unmappedGiftEvent が有効なら実行
      if (unmappedGiftEvent?.enabled !== false && unmappedGiftEvent?.commandFile) {
        const unmappedMap = { commandFile: ensureTxt(unmappedGiftEvent.commandFile), name: `unmapped:${giftId}` };
        if (doumaMod) {
          const unmappedRepeat = clampInt(unmappedGiftEvent.repeat ?? 1, 1, 100, 1);
          console.log(`[Gift] (unmapped) -> DoumaMod file=${unmappedGiftEvent.commandFile} repeat=${unmappedRepeat}`);
          enqueueRcon(`unmapped:${giftId}`, () => enqueueDoumaModEvent(doumaMod, {
            type: "gift",
            commandFile: unmappedGiftEvent.commandFile,
            count: unmappedRepeat,
            listenerName: sender,
            announce: announceEnabled,
          }), { priority: 10 });
          return;
        }
        const resolved = resolveCommands(unmappedMap);
        if (resolved.ok) {
          const unmappedRepeat = clampInt(unmappedGiftEvent.repeat ?? 1, 1, 100, 1);
          const ctx = {
            gameType: targetType === "minecraft" ? "minecraft" : "7dtd",
            listenerName: sender,
            playerId: dtd ? dtd.playerId : 0,
          };
          const baseUnmappedCmds = resolved.commands.map((cmd) => applyPlaceholders(cmd, ctx));

          // タイトル表示プリロード（Minecraftのみ）
          let commands = [];
          if (targetType === "minecraft" && announceEnabled) {
            const titleText = String(resolved.meta?.TITLE || giftName || "ギフト発動").trim();
            commands.push(
              `title @a times 10 70 10`,
              `title @a title {"text":"${mcJsonStringEscape(titleText, 60)}","color":"yellow","bold":true}`,
              `title @a subtitle {"text":"${mcJsonStringEscape(sender, 40)}","color":"green"}`
            );
          }
          for (let r = 0; r < unmappedRepeat; r++) commands.push(...baseUnmappedCmds);

          console.log(`[Gift] (unmapped) -> file=${unmappedGiftEvent.commandFile} repeat=${unmappedRepeat} total=${commands.length}`);
          if (mc) {
            enqueueRcon(`unmapped:${giftId}`, () => execCommandsToMinecraftRcon({
              commands,
              contextLabel: `unmapped:${giftId}`,
              rconHost: mc.rconHost,
              rconPort: mc.rconPort,
              rconPassword: mc.rconPassword,
              maxCommandsPerGift,
            }), { priority: 10 });
          } else if (dtd) {
            enqueueRcon(`unmapped:${giftId}`, () => execCommandsTo7dtdTelnet({
              commands,
              contextLabel: `unmapped:${giftId}`,
              host: dtd.host,
              port: dtd.port,
              password: dtd.password,
              sendPasswordAlways: dtd.sendPasswordAlways,
              maxCommandsPerGift,
            }), { priority: 10 });
          }
        }
      }
      return;
    }

    const now = Date.now();

    // streak判定
    const rcNum = Number(data.repeatCount);
    const isStreak = Number.isFinite(rcNum) && rcNum > 0;

    // cooldown（streak中は落とさない）
    if (!isStreak) {
      const cooldownKey = `${giftId}:${sender}`;
      const last = lastExecAt.get(cooldownKey) || 0;
      if (now - last < giftCooldownMs) return;
      lastExecAt.set(cooldownKey, now);
    }

    const baseRepeat = clampInt(mapping.repeat ?? 1, 1, 100, 1);

    // streakは「増えた分(delta)」だけ反応
    let delta = 1;
    if (isStreak) {
      const skey = `${giftId}:${sender}`;
      const prev = streakLastCount.get(skey) || 0;
      delta = rcNum - prev;
      if (delta <= 0) return;

      streakLastCount.set(skey, rcNum);

      if (typeof data.repeatEnd === "boolean" && data.repeatEnd === true) {
        streakLastCount.delete(skey);
      }
    }

    const times = delta * baseRepeat;

    if (doumaMod) {
      console.log(
        `[Gift] id=${giftId} name="${mapping.name}" from=${sender}${repeatText} -> DoumaMod file=${mapping.commandFile} count=${times}`
      );
      enqueueRcon(`gift:${giftId}`, () => enqueueDoumaModEvent(doumaMod, {
        type: "gift",
        commandFile: mapping.commandFile,
        count: times,
        listenerName: sender,
        announce: announceEnabled,
      }), { priority: 10 });
    } else {
    const resolved = resolveCommands(mapping);
    if (!resolved.ok) {
      console.log(
        `[Gift] id=${giftId} name="${mapping.name}" from=${sender}${repeatText} -> ERROR: ${resolved.reason}`
      );
      return;
    }

    // --- タイトル表示（Minecraftのみ）黄色太字タイトル＋黄緑サブタイトル（送り主名）---
    let prelude = [];
    if (targetType === "minecraft" && announceEnabled) {
      const titleText    = String(resolved.meta?.TITLE || mapping.name || "ギフト発動").trim();
      const listenerText = sender;

      prelude = [
        `title @a times 10 70 10`,
        `title @a title {"text":"${mcJsonStringEscape(titleText, 60)}","color":"yellow","bold":true}`,
        `title @a subtitle {"text":"${mcJsonStringEscape(listenerText, 40)}","color":"green"}`,
      ];
    }

    // repeat回数分だけコマンド配列を展開
    const expanded = [];
    for (let i = 0; i < times; i++) {
      // 連打で毎回タイトルを出すかどうか
      if (prelude.length > 0) {
        if (announceEveryRepeat || i === 0) expanded.push(...prelude);
      }
      expanded.push(...resolved.commands);
    }

    // placeholder差し込み
    const ctx = {
      gameType: targetType === "minecraft" ? "minecraft" : "7dtd",
      listenerName: sender,
      playerId: dtd ? dtd.playerId : 0,
    };
    const replaced = expanded.map((cmd) => applyPlaceholders(cmd, ctx));

    console.log(
      `[Gift] id=${giftId} name="${mapping.name}" from=${sender}${repeatText} -> file=${mapping.commandFile} base=${resolved.commands.length} delta=${delta} repeat=${baseRepeat} total=${replaced.length}`
    );

    // 実行（Fix 1: キューで直列化）
    if (mc) {
      enqueueRcon(`gift:${giftId}`, () => execCommandsToMinecraftRcon({
        commands: replaced,
        contextLabel: `gift:${giftId}`,
        rconHost: mc.rconHost,
        rconPort: mc.rconPort,
        rconPassword: mc.rconPassword,
        maxCommandsPerGift,
      }), { priority: 10 });
    } else if (dtd) {
      enqueueRcon(`gift:${giftId}`, () => execCommandsTo7dtdTelnet({
        commands: replaced,
        contextLabel: `gift:${giftId}`,
        host: dtd.host,
        port: dtd.port,
        password: dtd.password,
        sendPasswordAlways: dtd.sendPasswordAlways,
        maxCommandsPerGift,
      }), { priority: 10 });
    }
    }

    // TTS 読み上げ（ギフト）
    const ttsCfg = loadTtsConfig();
    if (ttsCfg.enabled && ttsCfg.giftEnabled) {
      const ttsText = (ttsCfg.giftTemplate || TTS_DEFAULTS.giftTemplate)
        .replace(/\{sender\}/g, sender)
        .replace(/\{gift\}/g, giftName);
      speakText(ttsText, ttsCfg).catch(() => {});
    }
  });

  // --------------------
  // コメント読み上げ（TTS）
  // --------------------
  tiktok.on("chat", async (data) => {
    if (isPreConnectionEvent(data)) return;
    const ttsCfg = loadTtsConfig();
    if (!ttsCfg.enabled || !ttsCfg.commentEnabled) return;

    const sender = getStableSender(data);
    const text = String(data.comment || "").trim();
    if (!text) return;

    const readText = sender ? `${sender}、${text}` : text;
    speakText(readText, ttsCfg).catch(() => {});
  });

  // --------------------
  // Like イベント（X いいねごとにコマンド発火）
  // --------------------
  const likeTriggeredAt = new Map(); // threshold -> lastTriggeredMultiple

  tiktok.on("like", async (data) => {
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    const total = Number(data.totalLikeCount ?? 0);
    for (const ev of likeEvents) {
      if (ev.enabled === false || !ev.commandFile || !ev.threshold) continue;
      const thresh = clampInt(ev.threshold, 1, 1000000, 10);
      const currentMultiple = Math.floor(total / thresh);
      if (!likeTriggeredAt.has(thresh)) {
        // 初回イベントは現在の累積いいね数をベースラインとして記録するだけで発火しない
        likeTriggeredAt.set(thresh, currentMultiple);
        continue;
      }
      const lastMultiple = likeTriggeredAt.get(thresh);
      const newTriggers = currentMultiple - lastMultiple;
      if (newTriggers <= 0) continue;
      likeTriggeredAt.set(thresh, currentMultiple);

      const mapping = { commandFile: ensureTxt(ev.commandFile), name: ev.label || `${thresh}いいね` };
      const sender = getStableSender(data);
      const evRepeat = clampInt(ev.repeat ?? 1, 1, 100, 1);
      const triggersToRun = Math.min(newTriggers, maxLikeCatchUpPerEvent);
      const skippedTriggers = newTriggers - triggersToRun;

      if (doumaMod) {
        const count = triggersToRun * evRepeat;
        console.log(
          `[Like] total=${total} threshold=${thresh} newTriggers=${newTriggers} run=${triggersToRun} skipped=${skippedTriggers} repeat=${evRepeat} -> DoumaMod file=${ev.commandFile} count=${count}`
        );
        if (count > 0) {
          enqueueRcon(`like:${thresh}`, () => enqueueDoumaModEvent(doumaMod, {
            type: "like",
            commandFile: ev.commandFile,
            count,
            listenerName: sender,
            announce: announceEnabled && thresh >= 100,
          }), { priority: 0 });
        }
        continue;
      }

      const resolved = resolveCommands(mapping);
      if (!resolved.ok) {
        console.log(`[Like] threshold=${thresh} ERROR: ${resolved.reason}`);
        continue;
      }

      const ctx = { gameType: targetType, listenerName: sender, playerId: dtd ? dtd.playerId : 0 };
      const baseCommands = resolved.commands.map((cmd) => applyPlaceholders(cmd, ctx));

      // Title only when thresh >= 100
      const likeTitleCmds = (targetType === "minecraft" && announceEnabled && thresh >= 100) ? [
        `title @a times 10 70 10`,
        `title @a title {"text":"いいねサンキュ","color":"yellow","bold":true}`,
        `title @a subtitle {"text":"${mcJsonStringEscape(sender, 40)}","color":"green"}`,
      ] : [];

      const triggerCommands = [];
      for (let i = 0; i < triggersToRun; i++) {
        triggerCommands.push(...likeTitleCmds);
        for (let r = 0; r < evRepeat; r++) triggerCommands.push(...baseCommands);
      }

      console.log(
        `[Like] total=${total} threshold=${thresh} newTriggers=${newTriggers} run=${triggersToRun} skipped=${skippedTriggers} repeat=${evRepeat} file=${ev.commandFile}`
      );

      if (mc && triggerCommands.length > 0) {
        enqueueRcon(`like:${thresh}`, () => execCommandsToMinecraftRcon({
          commands: triggerCommands,
          contextLabel: `like:${thresh}`,
          rconHost: mc.rconHost,
          rconPort: mc.rconPort,
          rconPassword: mc.rconPassword,
          maxCommandsPerGift,
        }), { priority: 0 });
      }
    }
  });

  // --------------------
  // Share イベント
  // --------------------
  tiktok.on("share", async (data) => {
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (!shareEvent || shareEvent.enabled === false || !shareEvent.commandFile) return;

    const mapping = { commandFile: ensureTxt(shareEvent.commandFile), name: "シェア" };
    const sender = getStableSender(data);
    const shareRepeat = clampInt(shareEvent.repeat ?? 1, 1, 100, 1);
    if (doumaMod) {
      console.log(`[Share] from=${sender} -> DoumaMod repeat=${shareRepeat} file=${shareEvent.commandFile}`);
      enqueueRcon("share", () => enqueueDoumaModEvent(doumaMod, {
        type: "other",
        commandFile: shareEvent.commandFile,
        count: shareRepeat,
        listenerName: sender,
        announce: announceEnabled,
      }), { priority: 5 });
      return;
    }

    const resolved = resolveCommands(mapping);
    if (!resolved.ok) { console.log(`[Share] ERROR: ${resolved.reason}`); return; }

    let prelude = [];
    if (targetType === "minecraft" && announceEnabled) {
      prelude = [
        `title @a times 10 70 10`,
        `title @a title {"text":"シェアサンキュ","color":"yellow","bold":true}`,
        `title @a subtitle {"text":"${mcJsonStringEscape(sender, 40)}","color":"green"}`,
      ];
    }

    const ctx = { gameType: targetType, listenerName: sender, playerId: dtd ? dtd.playerId : 0 };
    const baseShareCmds = resolved.commands.map((cmd) => applyPlaceholders(cmd, ctx));
    const shareExpanded = [...prelude];
    for (let r = 0; r < shareRepeat; r++) shareExpanded.push(...baseShareCmds);

    console.log(`[Share] from=${sender} repeat=${shareRepeat} file=${shareEvent.commandFile}`);
    if (mc) {
      enqueueRcon("share", () => execCommandsToMinecraftRcon({
        commands: shareExpanded,
        contextLabel: "share",
        rconHost: mc.rconHost,
        rconPort: mc.rconPort,
        rconPassword: mc.rconPassword,
        maxCommandsPerGift,
      }), { priority: 5 });
    }
  });

  // --------------------
  // Follow（フォロー）イベント
  // --------------------
  tiktok.on("follow", async (data) => {
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (!followEvent || followEvent.enabled === false || !followEvent.commandFile) return;

    const mapping = { commandFile: ensureTxt(followEvent.commandFile), name: "フォロー" };
    const sender = getStableSender(data);
    const followRepeat = clampInt(followEvent.repeat ?? 1, 1, 100, 1);
    if (doumaMod) {
      console.log(`[Follow] from=${sender} -> DoumaMod repeat=${followRepeat} file=${followEvent.commandFile}`);
      enqueueRcon("follow", () => enqueueDoumaModEvent(doumaMod, {
        type: "other",
        commandFile: followEvent.commandFile,
        count: followRepeat,
        listenerName: sender,
        announce: announceEnabled,
      }), { priority: 5 });
      return;
    }

    const resolved = resolveCommands(mapping);
    if (!resolved.ok) { console.log(`[Follow] ERROR: ${resolved.reason}`); return; }

    let prelude = [];
    if (targetType === "minecraft" && announceEnabled) {
      prelude = [
        `title @a times 10 70 10`,
        `title @a title {"text":"フォローサンキュ","color":"yellow","bold":true}`,
        `title @a subtitle {"text":"${mcJsonStringEscape(sender, 40)}","color":"green"}`,
      ];
    }

    const ctx = { gameType: targetType, listenerName: sender, playerId: dtd ? dtd.playerId : 0 };
    const baseFollowCmds = resolved.commands.map((cmd) => applyPlaceholders(cmd, ctx));
    const followExpanded = [...prelude];
    for (let r = 0; r < followRepeat; r++) followExpanded.push(...baseFollowCmds);

    console.log(`[Follow] from=${sender} repeat=${followRepeat} file=${followEvent.commandFile}`);
    if (mc) {
      enqueueRcon("follow", () => execCommandsToMinecraftRcon({
        commands: followExpanded,
        contextLabel: "follow",
        rconHost: mc.rconHost,
        rconPort: mc.rconPort,
        rconPassword: mc.rconPassword,
        maxCommandsPerGift,
      }), { priority: 5 });
    }
  });

  // --------------------
  // Member（訪問）イベント
  // --------------------
  tiktok.on("member", async (data) => {
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (!memberEvent || memberEvent.enabled === false || !memberEvent.commandFile) return;

    const mapping = { commandFile: ensureTxt(memberEvent.commandFile), name: "訪問" };
    const sender = getStableSender(data);
    const memberRepeat = clampInt(memberEvent.repeat ?? 1, 1, 100, 1);
    if (doumaMod) {
      console.log(`[Member] join=${sender} -> DoumaMod repeat=${memberRepeat} file=${memberEvent.commandFile}`);
      enqueueRcon("member", () => enqueueDoumaModEvent(doumaMod, {
        type: "other",
        commandFile: memberEvent.commandFile,
        count: memberRepeat,
        listenerName: sender,
        announce: false,
      }), { priority: 3 });
      return;
    }

    const resolved = resolveCommands(mapping);
    if (!resolved.ok) { console.log(`[Member] ERROR: ${resolved.reason}`); return; }

    const ctx = { gameType: targetType, listenerName: sender, playerId: dtd ? dtd.playerId : 0 };
    const baseMemberCmds = resolved.commands.map((cmd) => applyPlaceholders(cmd, ctx));
    const memberExpanded = [];
    for (let r = 0; r < memberRepeat; r++) memberExpanded.push(...baseMemberCmds);

    console.log(`[Member] join=${sender} repeat=${memberRepeat} file=${memberEvent.commandFile}`);
    if (mc) {
      enqueueRcon("member", () => execCommandsToMinecraftRcon({
        commands: memberExpanded,
        contextLabel: "member",
        rconHost: mc.rconHost,
        rconPort: mc.rconPort,
        rconPassword: mc.rconPassword,
        maxCommandsPerGift,
      }), { priority: 3 });
    }
  });

  process.on("SIGINT", () => {
    console.log("\n[Bridge] Stopping...");
    try {
      tiktok.disconnect();
    } catch {}
    process.exit(0);
  });
}

main().catch((e) => {
  console.error("[FATAL]", e?.message || e);
  process.exit(1);
});
