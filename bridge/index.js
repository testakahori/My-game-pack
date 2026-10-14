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
const { TikTokLiveConnection } = require("tiktok-live-connector");
const { connectionOptions, redactSecrets, retryDelay } = require('./tiktok_connection.cjs');
const { Rcon } = require("rcon-client");
const { validateBridgeConfig } = require("./config_schema");
const { prepareRoulette, createRouletteRunner, rouletteSpins } = require("./roulette.cjs");
const { createModEventDelivery, createLikeBatcher, captureGameEvent } = require("./mod_event_delivery.cjs");
const { commandFileProblem } = require("./command_files.cjs");
const { bridgeModTokenPath, readBridgeModToken, withBridgeModToken } = require("./bridge_mod_token.cjs");
const { FeatureEngine, parseWeightedList, chooseWeighted, weightOf } = require("./feature_engine");
const { enabledCommand, matchingCommentRules, deathRouletteMatches, likeRuleProgress, commentExtras, isBridgeModTransport, giftTimes } = require("./event_rules.cjs");
const { normalizeTikTokEvent, getStableSender, getSenderIdentity, isPreConnectionEvent: beforeConnection, createLikeCounter, createMuteMatcher } = require("./tiktok_events.cjs");
let runtimeProtection = { enabled: false };
let bridgeModWebSocket = null;
let bridgeModWebSocketStopping = false;
// Mod からのプッシュ通知（death など）を main() 側で購読するためのフック
let onBridgeModWsMessage = null;
let bridgeGameSessions = {};

function updateRuntimeStatus(patch) {
  const statusPath = path.join(__dirname, "runtime-status.json");
  let current = {};
  try { current = JSON.parse(fs.readFileSync(statusPath, "utf8")); } catch {}
  try {
    fs.writeFileSync(statusPath, redactSecrets(JSON.stringify({ ...current, ...patch }, null, 2)), "utf8");
  } catch {}
}

// アプリは起動時に BRIDGE_MOD_TOKEN_FILE を渡す。単体起動（bat）では bridge フォルダーの1つ上をサーバーフォルダーとみなす。
function bridgeModTokenFile() {
  return process.env.BRIDGE_MOD_TOKEN_FILE || bridgeModTokenPath(path.resolve(__dirname, ".."));
}

function connectBridgeModWebSocket({ host, port }) {
  if (typeof WebSocket !== "function") return;
  const wsUrl = `ws://${host}:${Number(port) + 1}`;
  try {
    // 再接続のたびに読み直す（サーバーを再起動するとトークンが変わる）。ログには URL だけを出す。
    const socket = new WebSocket(`${wsUrl}/?token=${encodeURIComponent(readBridgeModToken(bridgeModTokenFile()))}`);
    bridgeModWebSocket = socket;
    socket.addEventListener("open", () => console.log(`[BridgeWS] Connected: ${wsUrl}`));
    socket.addEventListener("message", event => {
      try {
        const status = JSON.parse(String(event.data));
        if (status.type === "death") {
          try { onBridgeModWsMessage?.(status); } catch {}
          return;
        }
        if (status.type !== "ack") {
          if (status.gameSessions && typeof status.gameSessions === "object") bridgeGameSessions = status.gameSessions;
          updateRuntimeStatus({ at: new Date().toISOString(), ...status });
        }
      } catch {}
    });
    socket.addEventListener("close", () => {
      if (bridgeModWebSocket === socket) { bridgeModWebSocket = null; bridgeGameSessions = {}; }
      if (!bridgeModWebSocketStopping) setTimeout(() => connectBridgeModWebSocket({ host, port }), 2000);
    });
    socket.addEventListener("error", () => {});
  } catch {
    if (!bridgeModWebSocketStopping) setTimeout(() => connectBridgeModWebSocket({ host, port }), 2000);
  }
}

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

  const safeArgs = args => args.map(value => redactSecrets(typeof value === 'string' ? value : require('node:util').inspect(value)));
  console.log   = (...a) => { const safe = safeArgs(a); origLog(...safe);   writeLine("", safe); };
  console.error = (...a) => { const safe = safeArgs(a); origError(...safe); writeLine(" [ERROR]", safe); };
  console.warn  = (...a) => { const safe = safeArgs(a); origWarn(...safe);  writeLine(" [WARN]", safe); };

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

function ttsNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeTtsConfig(settings) {
  const value = { ...TTS_DEFAULTS, ...(settings && typeof settings === "object" ? settings : {}) };
  return {
    engine: value.engine === "aivis" ? "aivis" : "voicevox",
    speakerId: Math.trunc(ttsNumber(value.speakerId, 0, Number.MAX_SAFE_INTEGER, TTS_DEFAULTS.speakerId)),
    speedScale: ttsNumber(value.speedScale, 0.5, 2.0, TTS_DEFAULTS.speedScale),
    pitchScale: ttsNumber(value.pitchScale, -0.15, 0.15, TTS_DEFAULTS.pitchScale),
    intonationScale: ttsNumber(value.intonationScale, 0.0, 2.0, TTS_DEFAULTS.intonationScale),
    volume: ttsNumber(value.volume, 0.0, 2.0, TTS_DEFAULTS.volume),
    enabled: value.enabled !== false,
    commentEnabled: value.commentEnabled !== false,
    giftEnabled: value.giftEnabled !== false,
    giftTemplate: String(value.giftTemplate || TTS_DEFAULTS.giftTemplate).slice(0, 200),
  };
}

function loadTtsConfig() {
  const p = path.join(__dirname, "tts-settings.json");
  if (!fs.existsSync(p)) return normalizeTtsConfig(TTS_DEFAULTS);
  try {
    return normalizeTtsConfig(JSON.parse(fs.readFileSync(p, "utf-8")));
  } catch {
    return normalizeTtsConfig(TTS_DEFAULTS);
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

// エンジン未起動のときに読み上げが「無言で」失敗し続けるのを可視化する（60秒に1回まで）
let lastTtsWarnAt = 0;
function warnTtsEngineDown(engine, detail) {
  const now = Date.now();
  if (now - lastTtsWarnAt < 60000) return;
  lastTtsWarnAt = now;
  console.warn(`[TTS] 読み上げエンジン(${engine})に接続できません（${detail}）。読み上げ設定ページからエンジンを起動してください。エンジンが起動するまでコメント・ギフトは読み上げられません。`);
}

function playWavOnDefaultDevice(wavPath) {
  return new Promise((resolve, reject) => {
    const escapedPath = wavPath.replace(/'/g, "''");
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command",
        `$player = New-Object System.Media.SoundPlayer '${escapedPath}'; $player.Load(); $player.PlaySync()`],
      { windowsHide: true, timeout: 120000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message || error).trim();
          reject(new Error(detail || "Windows audio playback failed"));
          return;
        }
        resolve();
      }
    );
  });
}

async function speakText(text, cfg) {
  let tmpWav = null;
  try {
    const port = TTS_PORTS[cfg.engine] || TTS_PORTS.voicevox;
    const speakerId = cfg.speakerId ?? 2;

    console.log(`[TTS] 音声合成を開始 engine=${cfg.engine} speaker=${speakerId} chars=${text.length}`);

    const queryRes = await ttsHttpPost(
      port,
      `/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`,
      "", 10000
    );
    if (queryRes.status !== 200) {
      warnTtsEngineDown(cfg.engine, `audio_query HTTP ${queryRes.status}`);
      return;
    }

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
    if (synthRes.status !== 200) {
      warnTtsEngineDown(cfg.engine, `synthesis HTTP ${synthRes.status}`);
      return;
    }

    tmpWav = path.join(os.tmpdir(), `bridge_tts_${process.pid}_${Date.now()}.wav`);
    fs.writeFileSync(tmpWav, synthRes.body);
    console.log(`[TTS] 再生を開始 bytes=${synthRes.body.length}`);
    // 再生完了を待つことで、コメントが連続しても音声同士を重ねない。
    await playWavOnDefaultDevice(tmpWav);
    console.log("[TTS] 再生を完了しました");
  } catch (e) {
    console.error(`[TTS] 読み上げに失敗しました: ${e?.message || e}`);
    warnTtsEngineDown(cfg.engine, e?.message || e);
  } finally {
    if (tmpWav) {
      try { fs.unlinkSync(tmpWav); } catch {}
    }
  }
}

const MAX_TTS_QUEUE = 50;
const ttsQueue = [];
let ttsWorkerRunning = false;
let lastTtsQueueWarnAt = 0;

async function drainTtsQueue() {
  if (ttsWorkerRunning) return;
  ttsWorkerRunning = true;
  try {
    while (ttsQueue.length > 0) {
      const item = ttsQueue.shift();
      await speakText(item.text, item.cfg);
    }
  } finally {
    ttsWorkerRunning = false;
    // finally直前に追加された項目を取りこぼさない。
    if (ttsQueue.length > 0) void drainTtsQueue();
  }
}

function enqueueSpeech(text, cfg, ngWords = []) {
  let safe = String(text || "");
  for (const word of ngWords) {
    if (!word) continue;
    safe = safe.split(String(word)).join("＊".repeat(Math.min(8, String(word).length)));
  }
  safe = safe.trim().slice(0, 300);
  if (!safe) return;
  if (ttsQueue.length >= MAX_TTS_QUEUE) {
    ttsQueue.shift(); // 数分前の読み上げより、現在のコメントを優先する。
    if (Date.now() - lastTtsQueueWarnAt > 30000) {
      lastTtsQueueWarnAt = Date.now();
      console.warn(`[TTS] キュー上限(${MAX_TTS_QUEUE})のため古い読み上げを破棄しました`);
    }
  }
  ttsQueue.push({ text: safe, cfg: normalizeTtsConfig(cfg) });
  void drainTtsQueue();
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
  // 絵文字などのサロゲートペアを途中で切らないよう、文字（コードポイント）単位で数えて切る。
  const chars = Array.from(v);
  if (chars.length > maxLen) v = chars.slice(0, maxLen).join("");
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

  let out = String(command).split("{Count}").join("1"); // RCON already expands repetitions; Mod receives the aggregate count.

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

function dedupeKeyFromGift(data) {
  data = normalizeTikTokEvent(data, 'gift');
  const msgId =
    data.msgId ||
    data.messageId ||
    data.eventId ||
    data.id ||
    data.gift?.msgId ||
    data.gift?.messageId ||
    "";

  const giftId = String(data.giftId ?? "");
  const user = getSenderIdentity(data);
  const repeatCount = String(data.repeatCount ?? "");
  const repeatEnd = String(data.repeatEnd ?? "");

  if (msgId) {
    // 連打ギフトの場合は repeatCount を含めて重複排除キーを一意にする
    return `msg:${String(msgId)}|rc:${repeatCount}`;
  }

  return `g:${giftId}|u:${user}|rc:${repeatCount}|re:${repeatEnd}`;
}

// streakは「増えた分(delta)」だけ反応する。streakMapを直接更新しつつdeltaを返す純関数として
// 切り出す（本番の gift ハンドラとテストの両方から同じロジックを呼べるようにするため）。
// 【修正2026-07-08 C】ベースライン残留でギフトが無視される問題を解消：
//  - streakMap は { count, at } を保持し、ttlMs で失効させる
//  - 前回値より小さい repeatCount（＝新しいstreak開始）や失効時は baseline を捨てて delta=1
//  - 受信済みの同じ個数の終了通知は追加分0（終了時だけ余計に1回発火させない）
//  - repeatEnd は truthy 判定（ライブラリが 1/true どちらを返しても終了扱い）
function computeStreakDelta(streakMap, key, rcNum, repeatEnd, now, ttlMs) {
  const prevEntry = streakMap.get(key);
  const isFresh = prevEntry && (now - prevEntry.at) < ttlMs;
  const delta = isFresh && repeatEnd && rcNum === prevEntry.count ? 0 : isFresh && rcNum > prevEntry.count
    ? rcNum - prevEntry.count // 正常な連打の増分
    : 1; // 新しいstreak開始 / baseline消失 / 巻き戻り → 最低1回は必ず発火

  streakMap.set(key, { count: rcNum, at: now });
  if (repeatEnd) streakMap.delete(key);

  return delta;
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
  if (!commands || commands.length === 0) return true;

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

function commandFileToBridgeKey(commandFile) {
  const file = ensureTxt(commandFile);
  return path.basename(file, ".txt");
}

function sendBridgeModEvent({ host, port, type, commandFile, count, listenerName, announce, requestId, eventId, gameMod, gameSessionId, args }) {
  const payload = JSON.stringify({
    type,
    ...((requestId || eventId) ? { requestId: requestId || eventId, eventId: requestId || eventId } : {}),
    key: commandFileToBridgeKey(commandFile),
    count: count ?? 1,
    ...(gameMod || gameSessionId ? { gameSessionId: gameSessionId || "", args: args || {} } : args ? { args } : {}),
    listenerName: String(listenerName || "viewer"),
    announce: announce !== false,
    protectionEnabled: false,
    protectX1: Number(runtimeProtection.x1 || 0),
    protectX2: Number(runtimeProtection.x2 || 0),
    protectZ1: Number(runtimeProtection.z1 || 0),
    protectZ2: Number(runtimeProtection.z2 || 0),
  });

  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path: "/bridge/event",
      method: "POST",
      timeout: 1500,
      headers: withBridgeModToken(bridgeModTokenFile(), {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      }),
    }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          // The status decides whether the delivery queue retries (429/5xx) or reports and skips (400 etc.).
          reject(Object.assign(new Error(`BridgeMod HTTP ${res.statusCode}: ${body}`), { status: res.statusCode }));
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("BridgeMod HTTP timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// BridgeMOD の待ち列への指示（/bridge/control、BridgeMOD 1.7.5 から）。今は「いいねの待ちを捨てる」だけ。捨てた件数を返す。
function sendBridgeModControl({ host, port }, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host, port, path: "/bridge/control", method: "POST", timeout: 1500,
      headers: withBridgeModToken(bridgeModTokenFile(), { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }),
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(Object.assign(new Error(`BridgeMod HTTP ${res.statusCode}: ${text}`), { status: res.statusCode }));
        try { resolve(Number(JSON.parse(text).discarded) || 0); } catch { resolve(0); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("BridgeMod HTTP timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Minecraft の ID 系文字列（サウンド・パーティクル）を安全化。コマンド差し込み対策。
function sanitizeMcId(value, fallback) {
  const v = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.:\-]/g, "");
  return v || fallback;
}

// 生コマンド配列を Mod の /bridge/exec へ送る（ルーレット演出フレームなど、
// Bridge 側で setTimeout によるタイミング制御をしたいとき用。Mod v1.2.0 以降）。
// 注意: Mod 側パーサーの都合で commands はペイロードの末尾に置くこと。
function sendBridgeExec({ host, port }, commands, listenerName = "system") {
  const payload = JSON.stringify({ listenerName, commands });
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path: "/bridge/exec",
      method: "POST",
      timeout: 1500,
      headers: withBridgeModToken(bridgeModTokenFile(), {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      }),
    }, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else reject(Object.assign(new Error(`BridgeMod exec HTTP ${res.statusCode}`), { status: res.statusCode }));
      });
    });
    req.on("timeout", () => req.destroy(new Error("BridgeMod exec timeout")));
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// operations-history.json は bridge（このプロセス）と electron（main）の両方が書き込む。
// 従来の「全体読み込み→unshift→全体書き込み」は同時書き込みで履歴が巻き戻る事故があったため、
// 追記のみ（JSONL: 1行1イベント・古い順）に変更した。旧フォーマット（JSON配列）は初回書き込み時に
// その場で変換する。electron/main.cjs 側にも同じ変換ロジックがある（どちらが先に書いても安全）。
function migrateOperationsHistoryToJsonlIfNeeded(historyPath) {
  let raw = "";
  try { raw = fs.readFileSync(historyPath, "utf8"); } catch { return; }
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[")) return; // 既にJSONL、または空
  let rows;
  try { rows = JSON.parse(trimmed); } catch { return; }
  if (!Array.isArray(rows)) return;
  const oldestFirst = [...rows].reverse();
  const lines = oldestFirst.map((row) => JSON.stringify(row)).join("\n");
  fs.writeFileSync(historyPath, lines ? lines + "\n" : "", "utf8");
}

function appendOperationsHistoryLine(historyPath, row) {
  try {
    migrateOperationsHistoryToJsonlIfNeeded(historyPath);
    fs.appendFileSync(historyPath, JSON.stringify(row) + "\n", "utf8");
  } catch { /* ignore */ }
}

function deliveryFailureReason(error) {
  const status = Number(error?.status);
  if (status === 400) return "BridgeMODが受け付けませんでした（HTTP 400）。コマンドファイル名か内容を確認してください";
  if (status === 404 || status === 405) return `BridgeMODの受付先が見つかりません（HTTP ${status}）。BridgeMODのポート設定を確認してください`;
  if (status === 413) return "イベントが大きすぎるためBridgeMODが受け付けませんでした（HTTP 413）";
  if (status === 415) return "BridgeMODがJSON以外の送信を受け付けませんでした（HTTP 415）";
  return String(error?.message || error || "不明なエラー");
}

// 再送しても届かないイベントの件数と直近の理由。runtime-status.json 経由で画面に出す。
// authFailed：BridgeMOD が 403（認証失敗）を返していて、ギフトが再送待ちのまま止まっている間だけ入る。
const deliveryRejections = { rejected: 0, last: null, authFailed: null };
function markBridgeModAuth(failed) {
  // 毎回の再送で書き込まないよう、状態が変わったときだけ更新する。
  if (Boolean(deliveryRejections.authFailed) === Boolean(failed)) return;
  deliveryRejections.authFailed = failed ? { at: new Date().toISOString(), tokenFile: bridgeModTokenFile() } : null;
  if (failed) console.error(`[BridgeMod] 認証に失敗しています。ギフト・いいねは再送を続けています（トークンファイル: ${bridgeModTokenFile()}）。Minecraftサーバーを起動し直すと直ります`);
  else console.log("[BridgeMod] 認証に成功しました。送信を再開します");
  updateRuntimeStatus({ delivery: { ...deliveryRejections } });
}
function recordDeliveryRejection(event, error) {
  // 例外の受け皿から呼ばれるので、記録そのものの失敗で後続の処理を止めない。
  try {
    const reason = deliveryFailureReason(error);
    const commandFile = ensureTxt(event?.commandFile);
    deliveryRejections.rejected++;
    deliveryRejections.last = { at: new Date().toISOString(), type: event?.historyType || event?.type || "other", commandFile, reason };
    console.error(`[BridgeMod] 送れなかったイベント（再送しません）: type=${event?.type || "other"} file=${commandFile} count=${event?.count ?? 1} 理由: ${reason}`);
    appendOperationsHistoryLine(path.join(__dirname, "operations-history.json"), {
      at: deliveryRejections.last.at, type: deliveryRejections.last.type,
      sender: event?.listenerName || "viewer", commandFile, count: event?.count || 1, ok: false, message: reason,
    });
    updateRuntimeStatus({ delivery: { ...deliveryRejections } });
  } catch (recordError) {
    console.error("[BridgeMod] 送れなかったイベントを記録できませんでした:", recordError?.message || recordError);
  }
}

function bridgeEventDelivery(bridgeMod, opts = {}) {
  const prepare = opts.prepare || (event => event);
  return createModEventDelivery({
    send: event => sendBridgeModEvent({ ...bridgeMod, ...event }),
    // MOD は日本語などを含む名前を 400 で拒否する。送る前に止めて理由を残す。
    prepare: event => {
      const problem = commandFileProblem(event.commandFile);
      if (problem) throw Object.assign(new Error(problem), { permanent: true });
      return prepare(event);
    },
    rejected: (event, error) => {
      // 403 以外の応答が返ったなら、トークンは通っている（認証の失敗の表示を残さない）。
      if (Number.isInteger(error?.status) && error.status !== 403) markBridgeModAuth(false);
      recordDeliveryRejection(event, error);
    },
    maxRetries: opts.retries ?? Infinity,
    delivered: event => {
      markBridgeModAuth(false);
      appendOperationsHistoryLine(path.join(__dirname, "operations-history.json"), {
        at: new Date().toISOString(), type: event.historyType || event.type || "other",
        sender: event.listenerName || "viewer", commandFile: ensureTxt(event.commandFile),
        count: event.count || 1, ok: true,
        // ダイヤ集計用（giftのみ）。diamond は1個あたりの単価、合計は diamond×count。
        ...(event.giftId ? { giftId: String(event.giftId) } : {}),
        ...(Number(event.diamond) > 0 ? { diamond: Number(event.diamond) } : {}),
      });
    },
    // state は同じ要求の再送のあいだ共有される。失敗の種類が変わったら数え直す。
    retry: (event, error, attempt, state = {}) => {
      // 403 はトークン違い。サーバーを再起動した直後なら、次の再送で新しいトークンを読み直して通る。
      // トークンの書き換えと読み込みがすれ違うと正常でも1回だけ 403 になるので、同じ要求で2回続いたら認証の失敗として出す。
      const forbidden = Number(error?.status) === 403;
      const kind = forbidden ? "forbidden" : "other";
      state.streak = state.kind === kind ? (state.streak || 0) + 1 : 1;
      state.kind = kind;
      if (forbidden && state.streak < 2) return;
      if (forbidden) markBridgeModAuth(true);
      const detail = forbidden
        ? `BridgeMODの認証に失敗しました（トークンファイル: ${bridgeModTokenFile()}）。サーバーを起動し直すと作り直されます`
        : error?.message || error;
      // ログは、直前にログへ出した種類と違う失敗のとき（403 は2回続いたとき）と、20回ごとに出す。
      // 403 と接続エラーが交互に来ても、再送のたびにログが出ないようにする。
      const changed = state.logged !== kind;
      state.logged = kind;
      if (changed || attempt % 20 === 0) console.warn(
        "[BridgeMod] Waiting to retry", event.type, event.commandFile, "attempt=" + attempt, detail);
    },
  });
}

async function enqueueBridgeModEvent(bridgeMod, event, opts = {}) {
  return bridgeEventDelivery(bridgeMod, opts).enqueue(event);
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
    let commandsSent = false;
    let buffer = "";

    const finish = (ok = commandsSent) => {
      if (ended) return;
      ended = true;
      try {
        socket?.end();
      } catch {}
      resolve(ok);
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
          commandsSent = true;

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
        finish(false);
      });

      socket.on("error", (err) => {
        console.error(`[TELNET] Error (${contextLabel}):`, err?.message || err);
        finish(false);
      });

      socket.on("end", () => finish());
      socket.on("close", () => finish());
    } catch (e) {
      console.error(`[TELNET] Fatal (${contextLabel}):`, e?.message || e);
      finish(false);
    }
  });
}

async function execCommandsTo7dtdTelnetWithRetry(args, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ok = await execCommandsTo7dtdTelnet(args);
    if (ok) {
      if (attempt > 0) console.log(`[TELNET] Recovered after retry x${attempt} (${args.contextLabel})`);
      return true;
    }
    if (attempt < retries) await sleep(Math.min(3000, 300 * Math.pow(2, attempt)));
  }
  console.error(`[TELNET] Failed after ${retries + 1} attempts (${args.contextLabel})`);
  return false;
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
  // 取りこぼした Promise の失敗でプロセスを終了させない（Node 15 以降の既定は終了）。記録して動作を続ける。
  process.on("unhandledRejection", reason => {
    console.error("[Bridge] 処理されなかったエラー（Bridge は動作を続けます）:", reason?.stack || reason?.message || reason);
  });

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
  const configValidation = validateBridgeConfig(config);
  for (const warning of configValidation.warnings) console.warn(`[Config] ${warning}`);
  if (!configValidation.ok) {
    for (const error of configValidation.errors) console.error(`[Config] ${error}`);
    throw new Error("config.minecraft.json の設定が不正です");
  }
  // 前回起動分の「送れなかったイベント」を画面に残さない。
  updateRuntimeStatus({ delivery: { ...deliveryRejections } });

  const tiktokUsername = String(config.tiktokUsername || "").trim();
  const target = config.target || { type: "minecraft", rcon: config.rcon }; // 互換
  const targetType = String(target.type || "minecraft").toLowerCase();

  const options = config.options || {};
  runtimeProtection = options.protection || { enabled: false };
  const giftCooldownMs = Number(options.giftCooldownMs ?? 300);
  // 既定値はアプリの初期設定（electron/main.cjs）・運用センターの表示と同じ 200。
  const maxCommandsPerGift = Number(options.maxCommandsPerGift ?? 200);
  const maxLikeCatchUpPerEvent = clampInt(options.maxLikeCatchUpPerEvent ?? 5, 1, 100, 5);
  const rconQueueWarnSize = clampInt(options.rconQueueWarnSize ?? 20, 1, 10000, 20);
  const commandTransport = String(options.commandTransport || "rcon").toLowerCase().trim();
  const useBridgeModTransport = targetType === "minecraft" && isBridgeModTransport(commandTransport);
  const bridgeModHost = String(options.bridgeModHost || options.doumaModHost || "127.0.0.1").trim();
  const bridgeModPort = Number(options.bridgeModPort || options.doumaModPort || 25576);
  const logUnknownGifts = !!options.logUnknownGifts;
  const isMutedUser = createMuteMatcher(options.mutedUsers);
  const ttsNgWords = (Array.isArray(options.ttsNgWords) ? options.ttsNgWords : [])
    .map(v => String(v).trim()).filter(Boolean);
  const isMuted = (data) => {
    // 表示名は整えた形（' → ’ など）になるので、生の uniqueId・名前も候補に入れる（設定は生の名前でも整えた名前でもよい）。
    const event = normalizeTikTokEvent(data), sender = getStableSender(event);
    const blocked = isMutedUser([event.uniqueId, event.nickname, event.userId, sender]);
    if (blocked) console.log(`[Safety] muted user event ignored: ${sender}`);
    return blocked;
  };

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
  // イベント設定②（ルーレット / デスルーレット / コメントギフト）
  let rouletteCfg      = config.roulette      ?? null;
  let deathRouletteCfg = config.deathRoulette ?? null;
  let commentGiftsCfg  = config.commentGifts  ?? null;

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
  let bridgeMod = null;
  let dtd = null;

  if (targetType === "minecraft") {
    if (useBridgeModTransport) {
      if (!Number.isFinite(bridgeModPort) || bridgeModPort <= 0) {
        console.error("[ERROR] options.bridgeModPort is invalid.");
        process.exit(1);
      }
      bridgeMod = { host: bridgeModHost, port: bridgeModPort };
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

    if (!mc && !bridgeMod) {
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
      // 起動時と同じ検証を通す。壊れた設定では切り替えず、今の設定で動かし続ける。
      const validation = validateBridgeConfig(newCfg);
      for (const warning of validation.warnings) console.warn(`[Config] ${warning}`);
      if (!validation.ok) {
        for (const error of validation.errors) console.error(`[Config] ${error}`);
        console.error("[Bridge] Config reload skipped: 設定にエラーがあるため、直前の設定のまま動作します");
        return;
      }
      likeEvents        = Array.isArray(newCfg.likeEvents) ? newCfg.likeEvents : [];
      shareEvent        = newCfg.shareEvent        ?? null;
      followEvent       = newCfg.followEvent       ?? null;
      memberEvent       = newCfg.memberEvent       ?? null;
      unmappedGiftEvent = newCfg.unmappedGiftEvent ?? null;
      rouletteCfg       = newCfg.roulette          ?? null;
      deathRouletteCfg  = newCfg.deathRoulette     ?? null;
      commentGiftsCfg   = newCfg.commentGifts      ?? null;
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
    // Atomic saves replace the file. Watching the directory keeps later saves observable.
    const configWatcher = fs.watch(path.dirname(configPath), (_event, filename) => {
      if (filename && String(filename).toLowerCase() !== path.basename(configPath).toLowerCase()) return;
      clearTimeout(_reloadTimer);
      _reloadTimer = setTimeout(reloadDynamicConfig, 500);
    });
    // 監視のエラー（フォルダーの削除・権限など）は自動再読込が止まるだけ。Bridge は落とさない。
    configWatcher.on("error", error => {
      console.error("[Bridge] 設定ファイルの監視でエラー（自動再読込は止まります。設定を変えたら BRIDGE を再起動してください）:", error?.message || error);
    });
  } catch {}

  console.log(`[Bridge] Config: ${configPath}`);
  console.log(`[Bridge] TikTok Username: @${tiktokUsername}`);
  console.log(`[Bridge] Target: ${targetType}`);
  if (mc) console.log(`[Bridge] RCON: ${mc.rconHost}:${mc.rconPort}`);
  if (bridgeMod) {
    console.log(`[Bridge] BridgeMod HTTP: ${bridgeMod.host}:${bridgeMod.port}`);
    // トークンの値は出さず、読む場所だけ出す（単体起動で場所が合わないときに気づけるように）。
    const tokenFile = bridgeModTokenFile();
    console.log(`[Bridge] BridgeMod token file: ${tokenFile}${fs.existsSync(tokenFile) ? "" : "（まだありません。Minecraftサーバーの起動時に作られます）"}`);
  }
  if (dtd) console.log(`[Bridge] Telnet: ${dtd.host}:${dtd.port} playerId=${dtd.playerId}`);
  console.log(`[Bridge] Mappings: ${mappingById.size} items`);
  console.log(`[Bridge] CommandsDir: ${commandsDirName}/`);
  console.log(`[Bridge] Cooldown: ${giftCooldownMs}ms`);
  console.log(`[Bridge] maxCommandsPerGift: ${maxCommandsPerGift}${useBridgeModTransport ? "（BridgeMOD 経由では使わない）" : ""}`);

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

  function resolveRandomizedMapping(mapping) {
    const resolved = resolveCommands(mapping);
    const choices = parseWeightedList(resolved.meta?.RANDOM).map(choice => {
      if (choice.explicitWeight) return choice;
      const candidate = resolveCommands({ commandFile: ensureTxt(choice.commandFile) });
      return { ...choice, weight: weightOf(candidate.meta?.WEIGHT ?? 1) };
    });
    if (!resolved.ok || choices.length === 0) return { mapping, meta: resolved.meta || {} };
    const chosen = chooseWeighted(choices);
    if (!chosen) return { mapping, meta: resolved.meta || {} };
    const commandFile = ensureTxt(chosen.commandFile);
    console.log(`[Random] ${mapping.commandFile} -> ${commandFile} (weight=${chosen.weight})`);
    return { mapping: { ...mapping, commandFile }, meta: resolved.meta || {} };
  }

  // 初回接続・再接続時の過去コメント再送を止め、ライブ中に届いたイベントだけ処理する。
  const tiktok = new TikTokLiveConnection(tiktokUsername, connectionOptions(process.env));
  // 1件のイベント処理で例外が出ても Bridge 全体を落とさない（落ちると送信待ちのギフトがすべて消える）。
  const onTikTok = (type, handler) => tiktok.on(type, async (...args) => {
    try { await handler(...args); }
    catch (error) { console.error(`[Bridge] ${type} イベントの処理でエラー（このイベントだけ飛ばして続行します）:`, error?.stack || error?.message || error); }
  });
  const likeCounter = createLikeCounter();
  // 配信が終わってから次につながるまでは、いいねを使わない（配信のあとに妨害を起こさない。2026-10-14）。
  let likesClosed = false;
  // 前につないだ配信の番号。別の配信につないだかを見分ける。
  let lastRoomId = null;
  let connectedAt = 0;
  let tiktokConnectLoop = null;
  let tiktokReconnectTimer = null;
  const lastExecAt = new Map(); // cooldown (giftId+sender)
  const streakLastCount = new Map(); // key: giftId:sender -> { count, at }
  const STREAK_TTL_MS = clampInt(options.streakTtlMs ?? 60000, 5000, 600000, 60000);

  // 長時間配信でMapが無限に膨らむのを防ぐ定期クリーンアップ（5分より古い痕跡を掃除）
  const stateCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [k, v] of lastExecAt) if (v < cutoff) lastExecAt.delete(k);
    for (const [k, v] of streakLastCount) if ((v?.at ?? 0) < cutoff) streakLastCount.delete(k);
  }, 60000);
  if (typeof stateCleanupTimer.unref === "function") stateCleanupTimer.unref();

  // Independent FIFO senders: retrying likes cannot block gift delivery.
  const prepareGameEvent = event => captureGameEvent(event,
    resolveCommands({ commandFile: ensureTxt(event.commandFile) }).meta?.GAME_MOD, bridgeGameSessions);
  // Minecraft（BridgeMOD 経路）では「個別最大コマンド数」を掛けない。送られた数どおりに出す（2026-10-11 ユーザーの決定）。
  const modDelivery = bridgeMod ? bridgeEventDelivery(bridgeMod, { prepare: prepareGameEvent }) : null;
  // 失敗は recordDeliveryRejection がログ・履歴・画面用の状態へ記録済み。
  const enqueueMod = event => modDelivery.enqueue(event).catch(() => {});

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

  // --------------------
  // ルーレット（イベント設定②）
  // --------------------
  const animateRoulette = createRouletteRunner({
    sendFrame: (commands, listenerName) => sendBridgeExec(bridgeMod, commands, listenerName),
    // 演出を送れなくても当選は再送のあるレーンへ流す。理由だけ残す。
    // 認証の失敗かどうかは、当選を送るレーンが「同じ要求で 403 が2回続いたか」で判定する（演出の1回の 403 では決めない）。
    onFrameError: error => {
      console.warn("[Roulette] 演出を送れなかったため、演出を省いて当選を発火します:", error?.message || error);
    },
  });
  // 送られた回数（count）だけ回す（2026-10-11 ユーザーの決定）。回すたびに演出して当たりを決める。
  // 別の人のルーレットとは来た順にまとめて回す：前のルーレットを全部回し終えてから次（デスルーレットも並ぶ。2026-10-12 ユーザーの決定）。
  // 当たりは回す直前に、その時の設定（getConfig）で決める。N 回分を先に全部決めると、大きな N で Bridge が止まり、
  // 途中で設定を変えても古い当たりが出る（PR #79 レビュー）。途中で無効にしたら、その依頼の残りは取りやめる。
  const rouletteRequests = [];
  let rouletteBusy = false;
  function runRoulette(getConfig, triggerName, historyType, count = 1) {
    if (!bridgeMod) return false;
    rouletteRequests.push({ getConfig, triggerName, historyType, spins: rouletteSpins(count), done: 0 });
    if (!rouletteBusy) nextRouletteSpin();
    // 無効な項目を旧 roulette.txt へ流して成功扱いにしない。
    return true;
  }
  function nextRouletteSpin() {
    const request = rouletteRequests[0];
    if (!request) { rouletteBusy = false; return; }
    rouletteBusy = true;
    // 依頼を終えて次へ。取りやめが続いても呼び出しを深く重ねない。
    const finish = () => { rouletteRequests.shift(); Promise.resolve().then(nextRouletteSpin); };
    const rl = request.getConfig();
    if (!rl?.enabled) {
      if (request.done > 0) console.warn(`[Roulette] ルーレットが無効になったため、残り${request.spins - request.done}回を取りやめました`);
      return finish();
    }
    let round;
    try {
      round = prepareRoulette(rl, commandsDirAbs);
    } catch (error) {
      const left = request.spins - request.done;
      console.error("[Roulette]", error.message + (left > 1 ? `（残り${left}回を取りやめました）` : ""));
      return finish();
    }
    animateRoulette(round, request.triggerName, winner => {
      enqueueMod({
        type: "other", historyType: request.historyType || "roulette",
        commandFile: winner.commandFile, count: winner.repeat,
        listenerName: request.triggerName || "roulette", announce: false,
      });
    }).catch(error => console.error("[Roulette] 演出・発火に失敗:", error.message))
      .then(() => {
        request.done++;
        if (request.done < request.spins) nextRouletteSpin(); else finish();
      });
  }

  // Mod への発火を一元化：commandFile が roulette（仮想コマンド）ならルーレットに差し替える
  function dispatchBridgeEvent(label, event, opts = {}) {
    if (
      rouletteCfg?.enabled &&
      commandFileToBridgeKey(event.commandFile) === "roulette" &&
      runRoulette(() => rouletteCfg, event.listenerName, event.historyType || "roulette", event.count)
    ) {
      return;
    }
    enqueueMod(event);
  }

  // デスルーレット：Mod からの death 通知（WS）で発動
  onBridgeModWsMessage = (status) => {
    if (status?.type !== "death") return;
    const rl = deathRouletteCfg;
    if (!rl || rl.enabled !== true) return;
    const deaths = Number(status.deaths || 0);
    const every = clampInt(rl.everyDeaths ?? 1, 1, 1000, 1);
    if (deathRouletteMatches(rl, deaths)) {
      console.log(`[DeathRoulette] deaths=${deaths}（${every}回ごと）→ ルーレット始動`);
      runRoulette(() => rl, String(status.player || "player"), "death_roulette");
    }
  };

  const featureEngine = new FeatureEngine(options.gameplay || {}, feature => {
    if (!feature?.commandFile) return;
    if (!bridgeMod) {
      console.warn(`[Feature] ${feature.type} skipped: BridgeMod transport is required`);
      return;
    }
    const listenerName = feature.type === "combo"
      ? (featureEngine.topGifter() || feature.sender) : feature.sender;
    dispatchBridgeEvent(`feature:${feature.type}`, {
      type: "other", historyType: feature.type || "other", commandFile: feature.commandFile,
      count: clampInt(feature.count, 1, 100, 1),
      listenerName: listenerName || "viewer", announce: true,
    }, { priority: 8 });
  });

  const { createAutomaticRecorder } = require('./stream_sessions.cjs');
  const { createAudienceRecorder } = require('./audience_stats.cjs');
  const audience = createAudienceRecorder(() => path.join(__dirname, 'stream-audience.json'));
  const automaticRecording = createAutomaticRecorder(() => path.join(__dirname, 'stream-sessions.json'));
  function recordStream(action, ...args) {
    if (action === 'heartbeat' && !automaticRecording.activeId()) return;
    try {
      const session = automaticRecording[action](...args);
      if (action === 'connect' && automaticRecording.activeId()) audience.connect(session);
      else if (action === 'end') audience.end();
      else {
        if (automaticRecording.activeId() && !audience.active()) throw new Error('受信統計を開始できませんでした。統計ファイルを確認してBridgeを再起動してください。');
        audience.flush();
      }
      updateRuntimeStatus({ recording: { state: automaticRecording.activeId() ? 'recording' : 'waiting', error: '' } }); }
    catch (error) { console.error('[Stream recording]', error.message); updateRuntimeStatus({ recording: { state: 'error', error: error.message } }); }
  }
  // Record received activity before command eligibility/mute checks; test fire bypasses TikTok.
  for (const type of ['gift', 'like', 'chat', 'share', 'follow', 'member', 'roomUser']) {
    onTikTok(type, data => {
      if (isPreConnectionEvent(data)) return;
      try { audience.receive(type, data); }
      catch (error) { updateRuntimeStatus({ recording: { state: 'error', error: error.message } }); console.error('[Audience recording]', error.message); }
    });
  }
  const audienceTimer = setInterval(() => {
    try { audience.flush(); } catch (error) { updateRuntimeStatus({ recording: { state: 'error', error: error.message } }); console.error('[Audience recording]', error.message); }
  }, 1000);
  audienceTimer.unref();
  const recordingTimer = setInterval(() => recordStream('heartbeat'), 15000);
  recordingTimer.unref();
  tiktok.on('streamEnd', () => recordStream('end', 'live-ended'));

  async function connectTikTokWithRetry() {
    let failureCount = 0;
    updateRuntimeStatus({
      tiktok: { state: "connecting", username: tiktokUsername, at: new Date().toISOString() },
    });
    while (true) {
      try {
        const state = await tiktok.connect();
        connectedAt = Date.now();
        likeCounter.reset();
        likesClosed = false;
        // 別の配信につないだら、フォローのマイルストーンを0から数え直す（同じ配信へのつなぎ直しでは続きから）。
        const roomId = String(state.roomId || "");
        if (roomId !== lastRoomId) featureEngine.startStream();
        lastRoomId = roomId;
        recordStream('connect', tiktokUsername, state.roomId);
        console.log(`[TikTok] Connected. roomId=${state.roomId}`);
        console.log(`[Bridge] connectedAt: ${connectedAt}`);
        updateRuntimeStatus({
          tiktok: { state: "connected", username: tiktokUsername, roomId: String(state.roomId || ""), at: new Date().toISOString() },
        });
        return;
      } catch (e) {
        const message = redactSecrets(e?.message || e);
        console.error("[TikTok] Connect failed:", message);
        updateRuntimeStatus({
          tiktok: { state: "retrying", username: tiktokUsername, error: message, at: new Date().toISOString() },
        });
        // オフライン配信を5秒ごとに叩くとTikTok側のレート制限を招きやすい。
        // その他の一時障害も指数バックオフし、最大60秒で再試行する。
        failureCount += 1;
        const retryMs = retryDelay(e, failureCount);
        console.log(`[TikTok] Retry in ${Math.round(retryMs / 1000)} seconds...`);
        await sleep(retryMs);
      }
    }
  }

  function ensureTikTokConnected() {
    if (tiktokConnectLoop) return tiktokConnectLoop;
    tiktokConnectLoop = connectTikTokWithRetry().finally(() => { tiktokConnectLoop = null; });
    return tiktokConnectLoop;
  }

  tiktok.on("error", (data) => {
    const detail = data?.info || data?.exception?.message || data?.message || String(data || "unknown error");
    console.error(`[TikTok] Connection error: ${detail}`);
    updateRuntimeStatus({
      tiktok: { state: "retrying", username: tiktokUsername, error: detail, at: new Date().toISOString() },
    });
  });

  tiktok.on("disconnected", (data = {}) => {
    const reason = String(data?.reason || `code=${data?.code ?? "unknown"}`);
    console.warn(`[TikTok] Disconnected: ${reason}`);
    recordStream('end', 'connection-lost');
    updateRuntimeStatus({
      tiktok: { state: "retrying", username: tiktokUsername, error: reason, at: new Date().toISOString() },
    });
    if (bridgeModWebSocketStopping || tiktokReconnectTimer) return;
    tiktokReconnectTimer = setTimeout(() => {
      tiktokReconnectTimer = null;
      if (!bridgeModWebSocketStopping) void ensureTikTokConnected();
    }, 5000);
  });

  if (bridgeMod) connectBridgeModWebSocket(bridgeMod);
  // 接続待ちの間にも全イベントリスナーと終了処理を先に登録する。
  // 接続成功直後のコメントを取りこぼさず、配信前でもSIGINTで正常終了できる。
  void ensureTikTokConnected();
  featureEngine.startPoll();

  // イベントの createTime（秒）が接続前なら無視する
  function isPreConnectionEvent(data) {
    return beforeConnection(data, connectedAt);
  }

  console.log("[Bridge] Listening for gifts...");
  console.log("[Bridge] Press Ctrl+C to stop.");

  onTikTok("gift", async (data) => {
    data = normalizeTikTokEvent(data, 'gift');
    if (isMuted(data)) return;
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

    let mapping = mappingById.get(giftId);
    if (!mapping) {
      if (logUnknownGifts) {
        console.log(
          `[Gift] (unmapped) id=${giftId} name="${giftName}" from=${sender}${repeatText}`
        );
      }
      // unmappedGiftEvent が有効なら実行
      if (enabledCommand(unmappedGiftEvent)) {
        const rc = Number(data.repeatCount);
        const delta = Number.isFinite(rc) && rc > 0
          ? computeStreakDelta(streakLastCount, 'unmapped:' + giftId + ':' + getSenderIdentity(data), rc, data.repeatEnd, Date.now(), STREAK_TTL_MS)
          : 1;
        if (delta <= 0) return;
        const unmappedRepeat = delta * clampInt(unmappedGiftEvent.repeat ?? 1, 1, 100, 1);
        const unmappedMap = { commandFile: ensureTxt(unmappedGiftEvent.commandFile), name: `unmapped:${giftId}` };
        if (bridgeMod) {
          console.log(`[Gift] (unmapped) -> BridgeMod file=${unmappedGiftEvent.commandFile} repeat=${unmappedRepeat}`);
          dispatchBridgeEvent(`unmapped:${giftId}`, {
            type: "gift",
            commandFile: unmappedGiftEvent.commandFile,
            count: unmappedRepeat,
            listenerName: sender,
            announce: announceEnabled,
            giftId,
            diamond: Number(data.diamondCount ?? data.extendedGiftInfo?.diamond_count ?? 0) || 0,
          }, { priority: 10 });
          return;
        }
        const resolved = resolveCommands(unmappedMap);
        if (resolved.ok) {
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
            enqueueRcon(`unmapped:${giftId}`, () => execCommandsTo7dtdTelnetWithRetry({
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

    const randomized = resolveRandomizedMapping(mapping);
    mapping = randomized.mapping;
    const now = Date.now();

    // streak判定
    const rcNum = Number(data.repeatCount);
    const isStreak = Number.isFinite(rcNum) && rcNum > 0;

    // cooldown（streak中は落とさない）
    if (!isStreak) {
      const cooldownKey = `${giftId}:${sender}`;
      const last = lastExecAt.get(cooldownKey) || 0;
      const fileCooldown = clampInt(randomized.meta?.COOLDOWN ?? giftCooldownMs, 0, 60000, giftCooldownMs);
      if (now - last < fileCooldown) return;
      lastExecAt.set(cooldownKey, now);
    }

    const baseRepeat = clampInt(mapping.repeat ?? 1, 1, 100, 1);

    // streakは「増えた分(delta)」だけ反応（詳細は computeStreakDelta のコメント参照）
    const delta = isStreak
      ? computeStreakDelta(streakLastCount, `${giftId}:${getSenderIdentity(data)}`, rcNum, data.repeatEnd, now, STREAK_TTL_MS)
      : 1;

    let times = delta * baseRepeat;
    if (times <= 0) return; // 連打終了通知は追加ギフトではない（送信時の最小1への丸めも避ける）。
    // 時限倍率（例：1.5倍）で小数になったら四捨五入する。BridgeMOD は小数の回数を拒否し、ギフトが丸ごと消えていた。
    times = giftTimes(featureEngine.recordGift({ giftId, sender, commandFile: mapping.commandFile, count: times }));

    if (bridgeMod) {
      console.log(
        `[Gift] id=${giftId} name="${mapping.name}" from=${sender}${repeatText} -> BridgeMod file=${mapping.commandFile} count=${times}`
      );
      dispatchBridgeEvent(`gift:${giftId}`, {
        type: "gift",
        commandFile: mapping.commandFile,
        count: times,
        listenerName: sender,
        announce: announceEnabled,
        giftId,
        diamond: Number(data.diamondCount ?? data.extendedGiftInfo?.diamond_count ?? 0) || 0,
      }, { priority: 10 });
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
      enqueueRcon(`gift:${giftId}`, () => execCommandsTo7dtdTelnetWithRetry({
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
      enqueueSpeech(ttsText, ttsCfg, ttsNgWords);
    }
  });

  // --------------------
  // コメント読み上げ（TTS）
  // --------------------
  const commentGiftLastAt = new Map(); // rule毎の連投クールダウン

  onTikTok("chat", async (data) => {
    data = normalizeTikTokEvent(data, 'chat');
    if (isPreConnectionEvent(data)) return;
    if (isMuted(data)) return;

    const sender = getStableSender(data);
    const text = String(data.comment || "").trim();
    if (!text) return;
    featureEngine.recordComment(text, sender);

    // コメントギフト（イベント設定②）：設定した文字列を含むコメントでコマンド発動。
    // TTS の有効/無効とは独立して動く。
    if (commentGiftsCfg?.enabled && bridgeMod) {
      for (const rule of matchingCommentRules(commentGiftsCfg, text)) {
        const match = String(rule.match || "").trim();
        if (!match || !rule.commandFile || !text.includes(match)) continue;

        const ruleKey = `${match}|${rule.commandFile}`;
        const lastAt = commentGiftLastAt.get(ruleKey) || 0;
        if (Date.now() - lastAt < 3000) continue; // 3秒クールダウン（連投スパム対策）
        commentGiftLastAt.set(ruleKey, Date.now());

        const repeat = clampInt(rule.repeat ?? 1, 1, 100, 1);
        console.log(`[CommentGift] "${match}" from=${sender} -> ${rule.commandFile} x${repeat}`);
        dispatchBridgeEvent(`comment:${rule.commandFile}`, {
          type: "other",
          historyType: "comment",
          commandFile: rule.commandFile,
          count: repeat,
          listenerName: sender,
          announce: announceEnabled,
        }, { priority: 6 });

        if (rule.sound || rule.particle) {
          const extras = commentExtras(rule);
          sendBridgeExec(bridgeMod, extras, sender).catch(() => {});
        }
      }
    }

    const ttsCfg = loadTtsConfig();
    if (!ttsCfg.enabled || !ttsCfg.commentEnabled) return;
    const readText = sender ? `${sender}、${text}` : text;
    console.log(`[TTS] コメントをキューへ追加 from=${sender || "viewer"} chars=${text.length}`);
    enqueueSpeech(readText, ttsCfg, ttsNgWords);
  });

  // --------------------
  // 視聴者数メトリクス（配信統計の同接表示用）
  // --------------------
  // roomUser イベントの viewerCount を60秒ごとに JSONL 追記。30日より古い行は起動時に削除。
  const metricsPath = path.join(__dirname, "stream-metrics.jsonl");
  try {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const kept = fs.readFileSync(metricsPath, "utf8").split("\n").filter(Boolean)
      .filter((line) => {
        try { return (Date.parse(JSON.parse(line).at) || 0) >= cutoff; } catch { return false; }
      });
    fs.writeFileSync(metricsPath, kept.length ? kept.join("\n") + "\n" : "", "utf8");
  } catch { /* ファイルが無ければ何もしない */ }

  let currentViewers = 0;
  onTikTok("roomUser", (data) => {
    data = normalizeTikTokEvent(data, 'roomUser');
    const v = Number(data?.viewerCount ?? 0);
    if (Number.isFinite(v) && v >= 0) currentViewers = v;
  });
  const viewerMetricsTimer = setInterval(() => {
    if (!automaticRecording.activeId() || currentViewers <= 0) return;
    try {
      fs.appendFileSync(metricsPath, JSON.stringify({ at: new Date().toISOString(), viewers: currentViewers }) + "\n", "utf8");
    } catch { /* 記録失敗は無視 */ }
  }, 60000);
  if (typeof viewerMetricsTimer.unref === "function") viewerMetricsTimer.unref();

  // --------------------
  // Like イベント（X いいねごとにコマンド発火）
  // --------------------
  // 全ルールが同じ前回/今回の累計を使う。ルールを配信中に変更しても過去分を発火しない。

  // BridgeModモードのいいねはミニバッチ化：短時間の連続発火を1イベントに圧縮して
  // HTTP送信とMod側キューの消費を抑える（ギフトを圧迫させない）
  const LIKE_BATCH_MS = clampInt(options.likeBatchWindowMs ?? 1200, 100, 10000, 1200);
  const queueLikeEventBatched = createLikeBatcher({
    windowMs: LIKE_BATCH_MS, schedule: setTimeout, prepare: prepareGameEvent,
    dispatch: event => dispatchBridgeEvent("like:" + event.commandFile, event),
    failed: recordDeliveryRejection,
  });

  // 配信が終わったら、まだ実行していないいいね分を捨てる（2026-10-14 ユーザーの決定。配信のあとも妨害が続かないように）。
  // 捨てるのは、まとめ送りの待ち・送信の待ち（再送の待ちを含む）・BridgeMOD の待ちの3か所。配信中のいいね・ギフト・テスト発火は変えない。
  onTikTok("streamEnd", async () => {
    if (!bridgeMod) return;
    // 配信終了のあとに届いたいいね（同じ通知のまとまりに残っていた分など）も、次につながるまで使わない（PR #94 レビュー）。
    likesClosed = true;
    const inBridge = queueLikeEventBatched.discard() + modDelivery.discard("like");
    const discardInMod = async () => {
      try { return await sendBridgeModControl(bridgeMod, { action: "discard", type: "like" }); }
      catch (error) {
        console.warn(`[Like] BridgeMOD のいいねの待ちを捨てられませんでした（${error?.status === 404 ? "BridgeMOD 1.7.5 より前は捨てられません" : "BridgeMOD が止まっているか、応答がありません"}）: ${error?.message || error}`);
        return 0;
      }
    };
    const inMod = await discardInMod();
    console.log(`[Like] 配信が終わったので、まだ実行していないいいね分を捨てました（BRIDGE ${inBridge}回分・BridgeMOD の待ち ${inMod}件）`);
    // 送信中だった分が、捨てたあとに BridgeMOD へ着くことがある（HTTP の時間切れは1.5秒）。少しあとにもう一度捨てさせる。
    // そのあいだに次の配信へつながっていたら、新しい配信のいいねを捨てないよう、捨て直さない。
    setTimeout(() => {
      if (!likesClosed) return;
      discardInMod().then(late => { if (late > 0) console.log(`[Like] 配信終了のあとに BridgeMOD へ着いたいいね ${late}件も捨てました`); });
    }, 2000);
  });

  onTikTok("like", async (data) => {
    data = normalizeTikTokEvent(data, 'like');
    if (likesClosed) return;
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (isMuted(data)) return;
    const progress = likeCounter.next(data);
    if (!progress) return;
    const { total, previousTotal } = progress;
    if (previousTotal === 0 || likeEvents.some(ev => enabledCommand(ev) && Math.floor(total / Number(ev.threshold)) > Math.floor(previousTotal / Number(ev.threshold)))) {
      console.log(`[Like:RAW] total=${total} previous=${previousTotal} count=${data.likeCount ?? '(none)'} from=${getStableSender(data)}`);
    }
    featureEngine.recordLikes(total, getStableSender(data), previousTotal);
    for (const ev of likeEvents) {
      if (ev.enabled === false || !ev.commandFile || !ev.threshold) continue;
      const thresh = clampInt(ev.threshold, 1, 1000000, 10);
      const lastMultiple = Math.floor(previousTotal / thresh);
      const ruleProgress = likeRuleProgress(ev, total, lastMultiple, maxLikeCatchUpPerEvent);
      const { newTriggers } = ruleProgress;
      const triggersToRun = bridgeMod ? newTriggers : ruleProgress.triggersToRun;
      const skippedTriggers = newTriggers - triggersToRun;
      if (newTriggers <= 0) continue;

      const mapping = { commandFile: ensureTxt(ev.commandFile), name: ev.label || `${thresh}いいね` };
      const sender = getStableSender(data);
      const evRepeat = clampInt(ev.repeat ?? 1, 1, 100, 1);

      if (bridgeMod) {
        const count = triggersToRun * evRepeat;
        console.log(
          `[Like] total=${total} threshold=${thresh} newTriggers=${newTriggers} run=${triggersToRun} skipped=${skippedTriggers} repeat=${evRepeat} -> BridgeMod file=${ev.commandFile} count=${count}`
        );
        if (count > 0) {
          // 1つのルールの不備（GAME_MOD の書き間違いなど）で、残りのいいねルールまで止めない。
          try { queueLikeEventBatched(ev.commandFile, count, sender, announceEnabled && thresh >= 100, triggersToRun); }
          catch (error) { recordDeliveryRejection({ type: "like", commandFile: ev.commandFile, count, listenerName: sender }, error); }
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
  onTikTok("share", async (data) => {
    data = normalizeTikTokEvent(data, 'share');
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (isMuted(data)) return;
    if (!enabledCommand(shareEvent)) return;

    const mapping = { commandFile: ensureTxt(shareEvent.commandFile), name: "シェア" };
    const sender = getStableSender(data);
    const shareRepeat = clampInt(shareEvent.repeat ?? 1, 1, 100, 1);
    if (bridgeMod) {
      console.log(`[Share] from=${sender} -> BridgeMod repeat=${shareRepeat} file=${shareEvent.commandFile}`);
      dispatchBridgeEvent("share", {
        type: "other",
        historyType: "share",
        commandFile: shareEvent.commandFile,
        count: shareRepeat,
        listenerName: sender,
        announce: announceEnabled,
      }, { priority: 5 });
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
  onTikTok("follow", async (data) => {
    data = normalizeTikTokEvent(data, 'follow');
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (isMuted(data)) return;
    const sender = getStableSender(data);
    featureEngine.recordFollow(sender);
    if (!enabledCommand(followEvent)) return;
    const mapping = { commandFile: ensureTxt(followEvent.commandFile), name: "フォロー" };
    const followRepeat = clampInt(followEvent.repeat ?? 1, 1, 100, 1);
    if (bridgeMod) {
      console.log(`[Follow] from=${sender} -> BridgeMod repeat=${followRepeat} file=${followEvent.commandFile}`);
      dispatchBridgeEvent("follow", {
        type: "other",
        historyType: "follow",
        commandFile: followEvent.commandFile,
        count: followRepeat,
        listenerName: sender,
        announce: announceEnabled,
      }, { priority: 5 });
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
  onTikTok("member", async (data) => {
    data = normalizeTikTokEvent(data, 'member');
    if (isPreConnectionEvent(data)) return; // 接続前のバックログをスキップ
    if (isMuted(data)) return;
    if (!enabledCommand(memberEvent)) return;

    const mapping = { commandFile: ensureTxt(memberEvent.commandFile), name: "訪問" };
    const sender = getStableSender(data);
    const memberRepeat = clampInt(memberEvent.repeat ?? 1, 1, 100, 1);
    if (bridgeMod) {
      console.log(`[Member] join=${sender} -> BridgeMod repeat=${memberRepeat} file=${memberEvent.commandFile}`);
      dispatchBridgeEvent("member", {
        type: "other",
        historyType: "member",
        commandFile: memberEvent.commandFile,
        count: memberRepeat,
        listenerName: sender,
        announce: false,
      }, { priority: 3 });
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

  function shutdownBridge() {
    recordStream('end', 'monitoring-stopped');
    clearInterval(audienceTimer);
    clearInterval(recordingTimer);
    console.log("\n[Bridge] Stopping...");
    bridgeModWebSocketStopping = true;
    if (tiktokReconnectTimer) clearTimeout(tiktokReconnectTimer);
    try { bridgeModWebSocket?.close(); } catch {}
    try {
      tiktok.disconnect();
    } catch {}
    process.exit(0);
  }
  process.on('SIGINT', shutdownBridge);
  process.on('SIGTERM', shutdownBridge);
  process.on('disconnect', shutdownBridge);
  process.on('message', message => { if (message?.type === 'shutdown') shutdownBridge(); });
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[FATAL]", e?.message || e);
    process.exit(1);
  });
}

// テスト用エクスポート（本番動作には影響しない）
module.exports = {
  parseCommandFile,
  applyPlaceholders,
  dedupeKeyFromGift,
  isDuplicateEvent,
  clampInt,
  sendBridgeModEvent,
  enqueueBridgeModEvent,
  commandFileToBridgeKey,
  computeStreakDelta,
  normalizeTtsConfig,
};
