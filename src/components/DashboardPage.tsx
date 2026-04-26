// src/components/DashboardPage.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { GiftMapping } from "../types";

type RunState = "stopped" | "starting" | "running" | "error";
type LogType  = "info" | "ok" | "error" | "warn";
type StepStatus = "pending" | "active" | "done" | "error" | "optional";

interface LogEntry {
  id: number;
  time: string;
  text: string;
  type: LogType;
}

const LS_TIKTOK_USER = "mc_tiktok_username_unified_v1";
const LS_MAPPINGS    = "mc_tiktok_mappings_unified_v1";
const WORLD_PREFIX   = "haihu_world";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function nowStr(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

let logIdCounter = 0;

// ── Neon / Glass スタイル定数 ─────────────────────────────
const S = {
  // カード共通（水色内側グロー）
  glassCard: {
    boxShadow: "0 0 20px rgba(6,182,212,0.12), 0 0 40px rgba(139,92,246,0.08), inset 0 0 30px rgba(186,230,255,0.04), 0 8px 32px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // 配布ワールドカード（紫 + 白内側グロー）
  glassWorldCard: {
    boxShadow: "0 0 20px rgba(139,92,246,0.2), 0 0 40px rgba(139,92,246,0.1), inset 0 0 30px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // ステータスカード（水色＋紫ネオン枠＋白内側）
  statusCard: {
    boxShadow: "0 0 10px rgba(6,182,212,0.4), 0 0 20px rgba(139,92,246,0.25), inset 0 0 20px rgba(255,255,255,0.05), 0 4px 16px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // All Start ボタン
  allStart: {
    boxShadow: "0 0 16px rgba(124,58,237,0.7), 0 0 32px rgba(59,130,246,0.4), 0 0 48px rgba(124,58,237,0.2), inset 0 1px 0 rgba(255,255,255,0.2), 0 8px 20px rgba(0,0,0,0.6)",
  } as React.CSSProperties,

  // Forge起動ボタン（緑ネオン）
  forgeStart: {
    boxShadow: "0 0 8px rgba(16,185,129,0.6), 0 0 18px rgba(16,185,129,0.3), inset 0 0 14px rgba(16,185,129,0.1), inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 10px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // BRIDGE起動ボタン（青ネオン）
  bridgeStart: {
    boxShadow: "0 0 8px rgba(6,182,212,0.6), 0 0 18px rgba(6,182,212,0.3), inset 0 0 14px rgba(6,182,212,0.1), inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 10px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // 停止ボタン（赤ネオン）
  stopBtn: {
    boxShadow: "0 0 8px rgba(239,68,68,0.6), 0 0 18px rgba(239,68,68,0.3), inset 0 0 14px rgba(239,68,68,0.1), inset 0 1px 0 rgba(255,255,255,0.1), 0 4px 10px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // Minecraft起動（紫ネオン）
  minecraftBtn: {
    boxShadow: "0 0 8px rgba(139,92,246,0.6), 0 0 18px rgba(139,92,246,0.3), inset 0 0 14px rgba(139,92,246,0.12), inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 10px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // 全停止（赤ネオン）
  allStopBtn: {
    boxShadow: "0 0 8px rgba(239,68,68,0.5), 0 0 18px rgba(239,68,68,0.25), inset 0 0 14px rgba(239,68,68,0.1), inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 10px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // 水色＋紫ネオンボタン（Apply / Save）
  cyanPurpleBtn: {
    boxShadow: "0 0 10px rgba(6,182,212,0.5), 0 0 20px rgba(139,92,246,0.35), inset 0 0 16px rgba(186,230,255,0.06), inset 0 1px 0 rgba(255,255,255,0.18), 0 6px 14px rgba(0,0,0,0.5)",
  } as React.CSSProperties,

  // 保存ボタン（ガラス風白 + 水色ネオン枠 + 立体）
  saveBtn: {
    background: "linear-gradient(160deg, rgba(255,255,255,0.22) 0%, rgba(200,240,255,0.10) 50%, rgba(255,255,255,0.06) 100%)",
    boxShadow: "0 0 0 1.5px rgba(6,182,212,0.95), 0 0 12px rgba(6,182,212,0.70), 0 0 28px rgba(6,182,212,0.35), inset 0 1.5px 0 rgba(255,255,255,0.55), inset 0 -1px 0 rgba(6,182,212,0.25), 0 6px 18px rgba(0,0,0,0.55)",
  } as React.CSSProperties,
};

// ── ステータスカード ──────────────────────────────────────
const stateDot: Record<RunState | "unknown", string> = {
  stopped:  "bg-red-500",
  starting: "bg-amber-400 animate-pulse",
  running:  "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]",
  error:    "bg-red-400 shadow-[0_0_8px_rgba(239,68,68,0.9)]",
  unknown:  "bg-gray-600",
};

const stateLabel: Record<RunState | "unknown", { text: string; color: string }> = {
  stopped:  { text: "停止中",   color: "text-red-400" },
  starting: { text: "処理中…", color: "text-amber-400" },
  running:  { text: "起動中",   color: "text-emerald-400" },
  error:    { text: "エラー",   color: "text-red-400" },
  unknown:  { text: "不明",     color: "text-gray-500" },
};

interface StatusCardProps {
  label: string;
  value: string;
  state: RunState | "unknown";
  icon: string;
}

const StatusCard: React.FC<StatusCardProps> = ({ label, value, state, icon }) => {
  const sl = stateLabel[state];
  return (
    <div
      className="backdrop-blur-sm bg-white/[0.04] border border-cyan-500/30 rounded-2xl p-4 flex flex-col gap-2.5 min-w-0 transition-all"
      style={S.statusCard}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${stateDot[state]}`} />
        <span className="text-[10px] text-white uppercase tracking-wider font-bold truncate">{label}</span>
      </div>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-xl shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className={`text-sm font-bold truncate ${sl.color}`}>{sl.text}</div>
          <div className="text-[11px] text-gray-400 truncate">{value}</div>
        </div>
      </div>
    </div>
  );
};

// ── 起動フロー ────────────────────────────────────────────
const stepStyle: Record<StepStatus, { num: string; label: string }> = {
  pending:  { num: "bg-gray-800/80 text-gray-500",   label: "text-white" },
  active:   { num: "bg-cyan-600 text-white",          label: "text-cyan-300" },
  done:     { num: "bg-emerald-700 text-white",       label: "text-emerald-300" },
  error:    { num: "bg-red-700 text-white",           label: "text-red-300" },
  optional: { num: "bg-gray-800/60 text-gray-500",    label: "text-white" },
};

const LaunchStep: React.FC<{ step: number; label: string; desc: string; status: StepStatus }> = ({ step, label, desc, status }) => {
  const s = stepStyle[status];
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border border-gray-500/30 bg-white/[0.05] transition-all">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5 ${s.num}`}>
        {status === "done" ? "✓" : step}
      </span>
      <div className="min-w-0">
        <div className={`text-sm font-bold leading-tight ${s.label}`}>{label}</div>
        <div className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
};

// ── メインコンポーネント ──────────────────────────────────
const DashboardPage: React.FC = () => {
  const api = (window as any).mygamepack;

  const [forgeState,  setForgeState]  = useState<RunState>("stopped");
  const [bridgeState, setBridgeState] = useState<RunState>("stopped");

  const [username,  setUsername]  = useState<string>(() => localStorage.getItem(LS_TIKTOK_USER) || "");
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg,  setApplyMsg]  = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [levelName,    setLevelName]    = useState("");
  const [draft,        setDraft]        = useState("");
  const [worldFolders, setWorldFolders] = useState<string[]>([]);
  const [worldLoading, setWorldLoading] = useState(true);
  const [worldSaving,  setWorldSaving]  = useState(false);
  const [worldMsg,     setWorldMsg]     = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((text: string, type: LogType = "info") => {
    setLog(prev => [...prev.slice(-99), { id: ++logIdCounter, time: nowStr(), text, type }]);
  }, []);

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [log]);
  useEffect(() => { localStorage.setItem(LS_TIKTOK_USER, username); }, [username]);

  useEffect(() => {
    (async () => {
      setWorldLoading(true);
      try {
        const [props, worlds] = await Promise.all([
          api.serverPropsRead() as Promise<Record<string, string>>,
          api.serverWorldsList().catch(() => [] as string[]),
        ]);
        setWorldFolders(worlds);
        const v = props["level-name"] || "";
        setLevelName(v);
        setDraft(v);
      } catch { /* silent */ }
      finally { setWorldLoading(false); }
    })();
  }, []);

  const subfolder = draft.startsWith(`${WORLD_PREFIX}/`) ? draft.slice(WORLD_PREFIX.length + 1) : draft;
  const setSubfolder = (v: string) => { setDraft(`${WORLD_PREFIX}/${v}`); setWorldMsg(null); };
  const isWorldDirty = draft !== levelName;

  // ── ハンドラー ──
  const handleServerStart = async () => {
    setForgeState("starting"); addLog("Forgeサーバーを起動中…");
    try {
      await api.serverStart(); setForgeState("running");
      addLog("Forgeサーバーを起動しました。", "ok");
    } catch (e: any) {
      setForgeState("error"); addLog(`サーバー起動エラー: ${e?.message ?? String(e)}`, "error");
    }
  };

  const handleServerStop = async () => {
    setForgeState("starting"); addLog("Forgeサーバーを停止中…");
    try {
      await api.serverStop(); setForgeState("stopped");
      addLog("Forgeサーバーを停止しました。", "ok");
    } catch (e: any) {
      setForgeState("error"); addLog(`サーバー停止エラー: ${e?.message ?? String(e)}`, "error");
    }
  };

  const handleBridgeStart = async () => {
    setBridgeState("starting"); addLog("BRIDGEを起動中…");
    try {
      await api.bridgeLaunch(); setBridgeState("running");
      addLog("BRIDGEを起動しました。", "ok");
      try { await api.serverGamerulesApply(); addLog("ゲームルール（常昼・晴れ・keepInventory）を適用しました。", "ok"); }
      catch { addLog("ゲームルール適用: サーバー未起動のためスキップ", "warn"); }
    } catch (e: any) {
      setBridgeState("error"); addLog(`BRIDGE起動エラー: ${e?.message ?? String(e)}`, "error");
    }
  };

  const handleBridgeStop = async () => {
    setBridgeState("starting"); addLog("BRIDGEを停止中…");
    try {
      await api.bridgeStop(); setBridgeState("stopped");
      addLog("BRIDGEを停止しました。", "ok");
    } catch (e: any) {
      setBridgeState("error"); addLog(`BRIDGE停止エラー: ${e?.message ?? String(e)}`, "error");
    }
  };

  const handleMinecraftLaunch = async () => {
    addLog("Minecraftランチャーを起動中…");
    try { await api.minecraftLaunch(); addLog("Minecraftランチャーを起動しました。", "ok"); }
    catch (e: any) { addLog(`Minecraft起動エラー: ${e?.message ?? String(e)}`, "error"); }
  };

  const handleAllStart = async () => {
    addLog("すべて起動を開始します…");
    await handleServerStart();
    await handleBridgeStart();
  };

  const handleAllStop = async () => {
    addLog("すべて停止を開始します…");
    await handleBridgeStop();
    await handleServerStop();
  };

  const handleWorldSave = async () => {
    setWorldSaving(true); setWorldMsg(null);
    try {
      await api.serverPropsWrite({ "level-name": draft });
      setLevelName(draft);
      try { await api.serverDatapackDeployNightVision(); } catch { /* ignore */ }
      setWorldMsg({ type: "ok", text: "保存しました。次回サーバー起動時に反映されます。" });
      addLog(`配布ワールドを変更しました: ${draft}`, "ok");
    } catch (e: any) {
      setWorldMsg({ type: "error", text: `保存エラー: ${e?.message ?? String(e)}` });
      addLog(`ワールド保存エラー: ${e?.message ?? String(e)}`, "error");
    } finally { setWorldSaving(false); }
  };

  const handleApplyBridge = async () => {
    setApplyBusy(true); setApplyMsg(null);
    try {
      const u = username.trim().replace(/^@/, "");
      if (!u) throw new Error("TikTok ユーザー名を入力してください");
      const mappings = safeParse<GiftMapping[]>(localStorage.getItem(LS_MAPPINGS), []);
      const normalized = mappings.map((m) => ({
        giftId: String(m.giftId),
        name: m.name,
        commandFile: (m.commandFile || "").trim(),
        repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
      }));
      const existingCfg = await api.configRead();

      // RCON パスワードを RCON_password.txt から自動同期
      const rconResult = await api.serverRconPasswordRead().catch(() => ({ found: false, password: "" }));
      const rconPassword = rconResult.found ? rconResult.password : (existingCfg?.rcon?.password || "");
      const rcon = {
        host: existingCfg?.rcon?.host || "127.0.0.1",
        port: existingCfg?.rcon?.port || 25575,
        password: rconPassword,
      };

      await api.configWrite({
        ...existingCfg,
        tiktokUsername: u,
        rcon,
        options: { giftCooldownMs: 300, maxCommandsPerGift: 200, commandsDir: "commands/minecraft", logUnknownGifts: true },
        mappings: normalized,
      });
      setApplyMsg({ type: "ok", text: `適用しました（${normalized.length}件）` });
      addLog(`TikTok設定をBRIDGEに適用しました (@${u}, ${normalized.length}件)`, "ok");
    } catch (e: any) {
      setApplyMsg({ type: "error", text: e?.message ?? String(e) });
      addLog(`Bridge設定適用エラー: ${e?.message ?? String(e)}`, "error");
    } finally { setApplyBusy(false); }
  };

  const tiktokConfigured = username.trim().length > 0;
  const worldDisplay = levelName ? levelName.replace(`${WORLD_PREFIX}/`, "") : "未設定";
  const step1: StepStatus = forgeState  === "running" ? "done" : forgeState  === "error" ? "error" : forgeState  === "starting" ? "active" : "pending";
  const step2: StepStatus = bridgeState === "running" ? "done" : bridgeState === "error" ? "error" : bridgeState === "starting" ? "active" : "pending";
  const step3: StepStatus = "optional";
  const isBusy = forgeState === "starting" || bridgeState === "starting";

  const logTypeStyle: Record<LogType, string> = {
    info:  "text-gray-500",
    ok:    "text-emerald-400",
    error: "text-red-400",
    warn:  "text-amber-400",
  };

  return (
    <div className="space-y-4 max-w-6xl">

      {/* ── ステータスサマリー ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatusCard label="Forgeサーバー" value="Forge 1.20.1" state={forgeState} icon="🖥️" />
        <StatusCard label="BRIDGE" value="TikTok → Minecraft" state={bridgeState} icon="🔗" />
        <StatusCard
          label="TikTok設定"
          value={tiktokConfigured ? `@${username.trim().replace(/^@/, "")}` : "未設定"}
          state={tiktokConfigured ? "running" : "stopped"}
          icon="📡"
        />
        <StatusCard
          label="配布ワールド"
          value={worldDisplay}
          state={levelName ? "running" : "unknown"}
          icon="🌍"
        />
      </div>

      {/* ── クイックアクション + 起動フロー ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* クイックアクション（3/5） */}
        <div
          className="lg:col-span-3 backdrop-blur-sm bg-white/[0.03] border border-cyan-500/20 rounded-2xl p-6 space-y-5"
          style={S.glassCard}
        >
          <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-bold">クイックアクション</div>

          {/* All Start */}
          <button
            type="button"
            onClick={handleAllStart}
            disabled={isBusy}
            className="w-full py-5 rounded-xl font-black text-lg text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] active:translate-y-0.5 relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #7c3aed 0%, #3b82f6 50%, #7c3aed 100%)",
              backgroundSize: "200% 100%",
              ...S.allStart,
            }}
          >
            <span className="relative z-10 tracking-widest">▶▶ Forgeサーバー+BRIDGE起動</span>
          </button>

          {/* 個別ボタン */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2.5">
              <div className="text-[11px] text-cyan-300 font-bold tracking-wide">Forgeサーバー</div>
              <button
                type="button"
                onClick={handleServerStart}
                disabled={isBusy}
                className="w-full py-3 rounded-xl text-sm font-bold text-emerald-400 backdrop-blur-sm bg-white/[0.04] border border-emerald-500/50 disabled:opacity-40 transition active:scale-[0.97] active:translate-y-px"
                style={S.forgeStart}
              >
                ▶ 起動
              </button>
              <button
                type="button"
                onClick={handleServerStop}
                disabled={isBusy}
                className="w-full py-3 rounded-xl text-sm font-bold text-red-300 backdrop-blur-sm bg-white/[0.04] border border-red-500/50 disabled:opacity-40 transition active:scale-[0.97] active:translate-y-px"
                style={S.stopBtn}
              >
                ■ 停止
              </button>
            </div>
            <div className="space-y-2.5">
              <div className="text-[11px] text-cyan-300 font-bold tracking-wide">BRIDGE</div>
              <button
                type="button"
                onClick={handleBridgeStart}
                disabled={isBusy}
                className="w-full py-3 rounded-xl text-sm font-bold text-blue-400 backdrop-blur-sm bg-white/[0.04] border border-cyan-500/50 disabled:opacity-40 transition active:scale-[0.97] active:translate-y-px"
                style={S.bridgeStart}
              >
                ▶ 起動
              </button>
              <button
                type="button"
                onClick={handleBridgeStop}
                disabled={isBusy}
                className="w-full py-3 rounded-xl text-sm font-bold text-red-300 backdrop-blur-sm bg-white/[0.04] border border-red-500/50 disabled:opacity-40 transition active:scale-[0.97] active:translate-y-px"
                style={S.stopBtn}
              >
                ■ 停止
              </button>
            </div>
          </div>

          {/* Minecraft + 全停止 */}
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={handleMinecraftLaunch}
              className="w-full py-3 rounded-xl text-sm font-bold text-white backdrop-blur-sm bg-violet-500/10 border border-violet-500/50 transition active:scale-[0.97] active:translate-y-px"
              style={S.minecraftBtn}
            >
              🎮 Minecraft 起動
            </button>
            <button
              type="button"
              onClick={handleAllStop}
              disabled={isBusy}
              className="w-full py-3 rounded-xl text-sm font-bold text-red-300 backdrop-blur-sm bg-red-500/10 border border-red-500/50 disabled:opacity-40 transition active:scale-[0.97] active:translate-y-px"
              style={S.allStopBtn}
            >
              ■ すべて停止
            </button>
          </div>
        </div>

        {/* 起動フロー（2/5） */}
        <div
          className="lg:col-span-2 backdrop-blur-sm bg-white/[0.03] border border-cyan-500/20 rounded-2xl p-6 flex flex-col gap-3"
          style={S.glassCard}
        >
          <div className="text-[10px] text-white uppercase tracking-wider font-bold">起動フロー</div>
          <LaunchStep step={1} label="Forgeサーバー起動" desc="Forge 1.20.1 が起動するまで待つ" status={step1} />
          <LaunchStep step={2} label="BRIDGE 起動" desc="TikTok → RCON 接続 + ゲームルール自動適用" status={step2} />
          <LaunchStep step={3} label="Minecraft 起動" desc="ランチャーを開いてサーバーに接続（任意）" status={step3} />
          <div className="mt-auto pt-3 text-[10px] text-white/50 leading-relaxed border-t border-white/10">
            初回は「初期セットアップ」でフォルダーを設定してください。
          </div>
        </div>
      </div>

      {/* ── 設定カード群 ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* TikTok接続 */}
        <div
          className="backdrop-blur-sm bg-white/[0.03] border border-cyan-500/20 rounded-2xl p-5 space-y-3"
          style={S.glassCard}
        >
          <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-bold">TikTok 接続設定</div>
          <div className="flex items-center gap-1.5">
            <span className="text-gray-400 text-sm shrink-0">@</span>
            <input
              value={username}
              onChange={(e) => { setUsername(e.target.value); setApplyMsg(null); }}
              placeholder="ユーザー名"
              className="flex-1 min-w-0 bg-white/10 border border-gray-500/40 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 transition backdrop-blur-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleApplyBridge}
            disabled={applyBusy}
            className="w-full py-3 rounded-xl text-sm font-bold text-white backdrop-blur-sm bg-white/[0.04] border border-cyan-400/40 disabled:opacity-40 transition active:scale-[0.97] active:translate-y-px"
            style={S.cyanPurpleBtn}
          >
            {applyBusy ? "適用中…" : "✅ BRIDGE に適用"}
          </button>
          {applyMsg && (
            <div className={`text-xs px-3 py-2 rounded-xl ${applyMsg.type === "ok" ? "bg-emerald-900/50 border border-emerald-800/40 text-emerald-300" : "bg-red-900/50 border border-red-800/40 text-red-300"}`}>
              {applyMsg.text}
            </div>
          )}
        </div>

        {/* 配布ワールド */}
        <div
          className="backdrop-blur-sm bg-violet-900/20 border border-violet-500/30 rounded-2xl p-5 space-y-3"
          style={S.glassWorldCard}
        >
          <div className="text-[10px] text-violet-300 uppercase tracking-wider font-bold">配布ワールド</div>
          {worldLoading ? (
            <div className="text-xs text-gray-400">読み込み中…</div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-white shrink-0 font-mono">{WORLD_PREFIX}/</span>
                {worldFolders.length > 0 ? (
                  <select
                    value={subfolder}
                    onChange={(e) => setSubfolder(e.target.value)}
                    className="flex-1 min-w-0 bg-white/10 border border-gray-500/40 rounded-xl px-2 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition backdrop-blur-sm"
                  >
                    {!worldFolders.includes(subfolder) && subfolder && (
                      <option value={subfolder}>{subfolder}</option>
                    )}
                    {worldFolders.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                ) : (
                  <input
                    value={subfolder}
                    onChange={(e) => setSubfolder(e.target.value)}
                    placeholder="newworld"
                    className="flex-1 min-w-0 bg-white/10 border border-gray-500/40 rounded-xl px-2 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40 transition backdrop-blur-sm"
                  />
                )}
              </div>
              <button
                type="button"
                onClick={handleWorldSave}
                disabled={worldSaving || !isWorldDirty}
                className={`w-full py-3 rounded-xl text-sm transition active:scale-[0.97] active:translate-y-px backdrop-blur-sm ${
                  isWorldDirty && !worldSaving
                    ? "text-white font-black bg-white/[0.12] border border-white/20"
                    : "text-gray-600 font-bold bg-white/[0.02] border border-gray-700/30 cursor-not-allowed"
                }`}
                style={isWorldDirty && !worldSaving ? S.saveBtn : {}}
              >
                {worldSaving ? "保存中…" : "💾 保存"}
              </button>
              {worldMsg && (
                <div className={`text-xs px-3 py-2 rounded-xl ${worldMsg.type === "ok" ? "bg-emerald-900/50 border border-emerald-800/40 text-emerald-300" : "bg-red-900/50 border border-red-800/40 text-red-300"}`}>
                  {worldMsg.text}
                </div>
              )}
            </>
          )}
        </div>

        {/* ライブ配信手順 */}
        <div
          className="backdrop-blur-sm bg-white/[0.03] border border-cyan-500/20 rounded-2xl p-5 flex flex-col gap-2.5"
          style={S.glassCard}
        >
          <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-bold">ライブ配信の手順</div>
          <ol className="space-y-1.5">
            {([
              "イベント設定の保存を押す",
              "ギフト設定をする",
              "TikTok ID を設定する",
              "BRIDGEに適用を押す",
              "TIKTOK Live Studio でライブ配信",
              "Forgeサーバー+BRIDGE起動",
              "Minecraft起動",
            ] as const).map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] text-gray-200">
                <span className="text-cyan-400 font-black shrink-0">{["①","②","③","④","⑤","⑥","⑦"][i]}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* ── アクティビティログ ── */}
      <div
        className="backdrop-blur-sm bg-white/[0.03] border border-cyan-500/20 rounded-2xl p-5"
        style={S.glassCard}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] text-cyan-300 uppercase tracking-wider font-bold">アクティビティログ</div>
          <button
            type="button"
            onClick={() => setLog([])}
            className="text-[11px] text-gray-500 hover:text-gray-300 transition px-2 py-0.5 rounded border border-transparent hover:border-gray-700"
          >
            クリア
          </button>
        </div>
        <div className="h-36 overflow-y-auto space-y-0.5 font-mono bg-black/30 rounded-xl p-3 border border-white/5">
          {log.length === 0 ? (
            <div className="text-xs text-gray-700 py-8 text-center">操作ログがここに表示されます</div>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-xs leading-5">
                <span className="text-gray-600 shrink-0 tabular-nums">{entry.time}</span>
                <span className={logTypeStyle[entry.type]}>{entry.text}</span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

    </div>
  );
};

export default DashboardPage;
