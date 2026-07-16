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

type BridgeProcessStatus = {
  running?: boolean;
  state?: string;
  pid?: number | null;
  cpuPercent?: number | null;
  memMb?: number | null;
  restartCount?: number;
};

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

const TikTokMark: React.FC = () => (
  <svg className="tiktok-mark" viewBox="0 0 32 32" aria-label="TikTok">
    <path className="tiktok-mark__cyan" d="M18 4v15.2a6.3 6.3 0 1 1-5-6.1v4.2a2.4 2.4 0 1 0 1.1 2V4h3.9Zm0 2c1.1 4 3.6 6 7 6.6v4.2c-3.1-.4-5.4-1.6-7-3.4Z" />
    <path className="tiktok-mark__pink" d="M18 4v15.2a6.3 6.3 0 1 1-5-6.1v4.2a2.4 2.4 0 1 0 1.1 2V4h3.9Zm0 2c1.1 4 3.6 6 7 6.6v4.2c-3.1-.4-5.4-1.6-7-3.4Z" />
    <path className="tiktok-mark__core" d="M18 4v15.2a6.3 6.3 0 1 1-5-6.1v4.2a2.4 2.4 0 1 0 1.1 2V4h3.9Zm0 2c1.1 4 3.6 6 7 6.6v4.2c-3.1-.4-5.4-1.6-7-3.4Z" />
  </svg>
);

const GrassBlockIcon: React.FC = () => (
  <svg className="grass-block-icon" viewBox="0 0 48 48" aria-hidden="true">
    <polygon points="24,4 43,14 24,24 5,14" fill="#55c94e" />
    <polygon points="5,14 24,24 24,44 5,34" fill="#79502e" />
    <polygon points="43,14 24,24 24,44 43,34" fill="#5c3c27" />
    <path d="M5 14 24 24 43 14M24 24v20M12 18v6m9-3v5m14-8v7M9 29l6 3m5-2 4 2m7-5 7-4m-8 12 5-3" stroke="#9a6b40" strokeWidth="2" opacity=".8" />
    <path d="m5 14 6 3 4-4 5 4 4-5 6 4 5-5 8 3" stroke="#8be763" strokeWidth="2" fill="none" />
  </svg>
);

const WorldDiorama: React.FC = () => (
  <svg className="cockpit-world-scene" viewBox="0 0 360 150" role="img" aria-label="木とネザーポータルのあるMinecraftワールド">
    <defs>
      <linearGradient id="waterTop" x1="0" x2="1"><stop stopColor="#11d9ff" /><stop offset="1" stopColor="#245cff" /></linearGradient>
      <linearGradient id="grassTop" x1="0" x2="1"><stop stopColor="#56c94d" /><stop offset="1" stopColor="#2a8f42" /></linearGradient>
      <filter id="worldGlow"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
    </defs>

    <polygon points="34,92 176,31 328,89 184,142" fill="#062a4c" stroke="#18d8ff" strokeWidth="2" filter="url(#worldGlow)" />
    <polygon points="34,92 184,142 184,148 34,99" fill="#064d75" />
    <polygon points="328,89 184,142 184,148 328,96" fill="#07345f" />
    <path d="M55 91 179 40l126 48-122 45Z" fill="url(#waterTop)" opacity=".7" />

    <polygon points="79,84 171,45 276,83 181,119" fill="url(#grassTop)" />
    <polygon points="79,84 181,119 181,133 79,98" fill="#704a2c" />
    <polygon points="276,83 181,119 181,133 276,97" fill="#573720" />

    <g className="world-pixels" opacity=".55">
      <path d="m90 84 92 33 84-31M112 74l91 34M140 62l91 34M104 91l81-34M136 102l81-34M168 113l81-34" />
    </g>

    <g transform="translate(112 35)">
      <polygon points="0,29 17,22 34,29 17,36" fill="#3b9f3f" />
      <polygon points="0,29 17,36 17,47 0,40" fill="#674229" />
      <polygon points="34,29 17,36 17,47 34,40" fill="#53351f" />
      <rect x="14" y="7" width="6" height="23" fill="#76502d" />
      <polygon points="17,0 34,9 17,18 0,9" fill="#42b94e" />
      <polygon points="0,9 17,18 17,28 0,19" fill="#2f873d" />
      <polygon points="34,9 17,18 17,28 34,19" fill="#246f35" />
    </g>

    <g transform="translate(211 47)">
      <rect x="0" y="0" width="34" height="49" rx="2" fill="#502a83" stroke="#7e53ff" strokeWidth="5" />
      <rect x="8" y="8" width="18" height="33" fill="#843eff" />
      <path d="M11 12c9 5 2 10 11 15-8 4-4 8-11 11" fill="none" stroke="#e866ff" strokeWidth="2" />
    </g>

    <g transform="translate(69 69)">
      <polygon points="0,9 14,2 28,9 14,16" fill="#69d45d" />
      <polygon points="0,9 14,16 14,27 0,20" fill="#77502c" />
      <polygon points="28,9 14,16 14,27 28,20" fill="#5d3b25" />
    </g>
    <g transform="translate(258 67)">
      <polygon points="0,8 12,2 24,8 12,14" fill="#57c654" />
      <polygon points="0,8 12,14 12,24 0,18" fill="#70482b" />
      <polygon points="24,8 12,14 12,24 24,18" fill="#563620" />
    </g>
  </svg>
);

// ── メインコンポーネント ──────────────────────────────────
const DashboardPage: React.FC = () => {
  const api = (window as any).mygamepack;

  const [forgeState,  setForgeState]  = useState<RunState>("stopped");
  const [bridgeState, setBridgeState] = useState<RunState>("stopped");
  const [allStartBusy, setAllStartBusy] = useState(false);

  const [username,  setUsername]  = useState<string>("");
  const usernameLoadedRef = useRef(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg,  setApplyMsg]  = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [appliedUsername, setAppliedUsername] = useState<string | null>(null);

  const [levelName,    setLevelName]    = useState("");
  const [draft,        setDraft]        = useState("");
  const [worldFolders, setWorldFolders] = useState<string[]>([]);
  const [worldLoading, setWorldLoading] = useState(true);
  const [worldSaving,  setWorldSaving]  = useState(false);
  const [worldMsg,     setWorldMsg]     = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const [log, setLog] = useState<LogEntry[]>([]);
  const [bridgeProcess, setBridgeProcess] = useState<BridgeProcessStatus>({});
  const [bridgeLogs, setBridgeLogs] = useState<string[]>([]);
  const [serverLogs, setServerLogs] = useState<string[]>([]);
  const [consoleCmd, setConsoleCmd] = useState("");
  const [serverProc, setServerProc] = useState<{ running?: boolean; pid?: number | null }>({});
  const [gameRunning, setGameRunning] = useState(false);
  const [launcherPath, setLauncherPath] = useState<string>("");
  const [allStopBusy, setAllStopBusy] = useState(false);
  const [mcId, setMcId] = useState("");
  const [mcIdBusy, setMcIdBusy] = useState(false);
  const [mcIdMsg, setMcIdMsg] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);
  const [safety, setSafety] = useState<{ protection: boolean; autoBackup: boolean }>({ protection: false, autoBackup: true });
  const logEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((text: string, type: LogType = "info") => {
    setLog(prev => [...prev.slice(-99), { id: ++logIdCounter, time: nowStr(), text, type }]);
  }, []);

  useEffect(() => {
    if (log.length > 0) logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log]);

  // username は config.minecraft.json を優先して初期化する（ハードコード既定値で実アカウントを潰さない）
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api.configRead();
        const fromCfg = String(cfg?.tiktokUsername ?? cfg?.tiktok?.username ?? cfg?.tiktok?.user ?? "").trim().replace(/^@/, "");
        const fromLs = (localStorage.getItem(LS_TIKTOK_USER) || "").trim().replace(/^@/, "");
        const initial = fromCfg || fromLs;
        if (initial) setUsername(initial);
        // config に保存済みの ID ＝ 承認済み。再起動しても承認状態を復元する。
        if (fromCfg) setAppliedUsername(fromCfg);
      } catch {
        const fromLs = (localStorage.getItem(LS_TIKTOK_USER) || "").trim().replace(/^@/, "");
        if (fromLs) setUsername(fromLs);
      } finally {
        usernameLoadedRef.current = true;
      }
    })();
  }, [api]);

  useEffect(() => {
    if (!usernameLoadedRef.current) return; // 初期ロード前の空文字で localStorage を潰さない
    localStorage.setItem(LS_TIKTOK_USER, username);
  }, [username]);

  // 保護＆バックアップカードの実状態（拠点保護・起動時バックアップ）を読み込む
  useEffect(() => {
    (async () => {
      try {
        const [appCfg, cfg] = await Promise.all([
          api.appConfigRead?.() ?? Promise.resolve({}),
          api.configRead?.() ?? Promise.resolve({}),
        ]);
        setSafety({
          protection: cfg?.options?.protection?.enabled === true,
          autoBackup: appCfg?.autoBackupOnServerStart !== false,
        });
        if (typeof appCfg?.minecraftLauncherPath === "string") setLauncherPath(appCfg.minecraftLauncherPath);
        if (typeof appCfg?.minecraftPlayerName === "string") setMcId(appCfg.minecraftPlayerName);
      } catch { /* 表示は既定値のまま */ }
    })();
  }, [api]);

  useEffect(() => {
    let disposed = false;
    const refreshBridgeRuntime = async () => {
      try {
        const status = await api.bridgeProcessStatus?.();
        if (!disposed && status) {
          setBridgeProcess(status);
          if (status.running && bridgeState !== "starting") setBridgeState("running");
          if (!status.running && bridgeState === "running") setBridgeState("stopped");
        }
      } catch {
        /* status polling is optional */
      }
      try {
        const result = await api.bridgeLogs?.();
        if (!disposed && Array.isArray(result?.lines)) setBridgeLogs(result.lines);
      } catch {
        /* log polling is optional */
      }
      // Forgeサーバー：プロセス実態と同期（×やクラッシュで消えたら「停止中」へ戻す）
      try {
        const sp = await api.serverProcessStatus?.();
        if (!disposed && sp) {
          setServerProc(sp);
          setForgeState((prev) => {
            if (sp.running) return prev === "starting" ? prev : "running";
            return prev === "running" ? "stopped" : prev;
          });
        }
      } catch { /* optional */ }
      try {
        const sl = await api.serverLogs?.();
        if (!disposed && Array.isArray(sl?.lines)) setServerLogs(sl.lines);
      } catch { /* optional */ }
      // Minecraftランチャー/ゲーム本体の稼働検知（Gameノード表示用）
      try {
        const mc = await api.minecraftStatus?.();
        if (!disposed && mc) setGameRunning(mc.running === true);
      } catch { /* optional */ }
    };
    void refreshBridgeRuntime();
    const timer = window.setInterval(refreshBridgeRuntime, 2500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [api, bridgeState]);

  useEffect(() => {
    (async () => {
      setWorldLoading(true);
      try {
        const [props, worlds] = await Promise.all([
          (api.serverPropsRead() as Promise<Record<string, string>>).catch(() => ({} as Record<string, string>)),
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
  const logBackupResult = (backup?: { ok: boolean; message: string } | null) => {
    if (!backup) return;
    if (backup.ok) addLog(`起動前バックアップ: ${backup.message}`, "ok");
    else addLog(`起動前バックアップに失敗しました（サーバー起動は続行）: ${backup.message}`, "warn");
  };

  const handleServerStart = async () => {
    setForgeState("starting"); addLog("Forgeサーバーを起動中…");
    try {
      // 暗視は初期設定：どのワールドでも常時付与されるよう、起動前に毎回データパックを配置する
      try { await api.serverDatapackDeployNightVision(); } catch { /* optional */ }
      const started = await api.serverStart(); setForgeState("running");
      logBackupResult(started?.backup);
      addLog("Forgeサーバーを起動しました。", "ok");
    } catch (e: any) {
      setForgeState("error"); addLog(`サーバー起動エラー: ${e?.message ?? String(e)}`, "error");
    }
  };

  const handleSendServerCommand = async () => {
    const cmd = consoleCmd.trim();
    if (!cmd) return;
    try {
      await api.serverCommand?.(cmd);
      setConsoleCmd("");
    } catch (e: any) {
      addLog(`コマンド送信エラー: ${e?.message ?? String(e)}`, "error");
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
      try { await api.serverGamerulesApply(); addLog("ゲームルール（常昼・晴れ・keepInventory・暗視）を適用しました。", "ok"); }
      catch (ge: any) { addLog(`ゲームルール適用をスキップ: ${ge?.message ?? String(ge)}`, "warn"); }
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

  const handleBridgeRestart = async () => {
    setBridgeState("starting"); addLog("BRIDGEを再起動中…");
    try {
      // main側で「停止完了→起動」を直列実行する専用IPCを使う（stop→launch連打の空振りを防ぐ）
      if (api.bridgeRestart) {
        await api.bridgeRestart();
      } else {
        await api.bridgeStop();
        await api.bridgeLaunch();
      }
      setBridgeState("running");
      addLog("BRIDGEを再起動しました。", "ok");
      try { await api.serverGamerulesApply(); addLog("ゲームルールを再適用しました。", "ok"); }
      catch (ge: any) { addLog(`ゲームルール再適用をスキップ: ${ge?.message ?? String(ge)}`, "warn"); }
    } catch (e: any) {
      setBridgeState("error"); addLog(`BRIDGE再起動エラー: ${e?.message ?? String(e)}`, "error");
    }
  };

  const handleMinecraftLaunch = async () => {
    addLog("Minecraftランチャーを起動中…");
    try { await api.minecraftLaunch(); addLog("Minecraftランチャーを起動しました。", "ok"); }
    catch (e: any) { addLog(`Minecraft起動エラー: ${e?.message ?? String(e)}`, "error"); }
  };

  const applyBridgeConfig = useCallback(async () => {
    const existingCfg = await api.configRead();

    // mappings は config.minecraft.json を唯一の正とする。
    // UI(localStorage)に有効な割当があるときだけ更新し、空のときは既存 config の mappings を維持する。
    // （リデザイン・キャッシュ消失・新規プロファイルで全ギフト割当が消える事故を防ぐ）
    const uiMappings = safeParse<GiftMapping[]>(localStorage.getItem(LS_MAPPINGS), [])
      .filter((m) => String(m.giftId ?? "").trim() && String(m.commandFile ?? "").trim())
      .map((m) => ({
        giftId: String(m.giftId),
        name: m.name || String(m.giftId),
        commandFile: (m.commandFile || "").trim(),
        repeat: Math.min(100, Math.max(1, Number(m.repeat ?? 1))),
      }));
    const existingMappings = Array.isArray(existingCfg?.mappings) ? existingCfg.mappings : [];
    const mappings = uiMappings.length > 0 ? uiMappings : existingMappings;

    // username は「UIで明示入力があればそれ、無ければ config の既存値」。ハードコード既定値は使わない。
    const existingUsername = String(
      existingCfg?.tiktokUsername ?? existingCfg?.tiktok?.username ?? existingCfg?.tiktok?.user ?? ""
    ).trim().replace(/^@/, "");
    const typedUsername = username.trim().replace(/^@/, "");
    const u = typedUsername || existingUsername;
    if (!u) {
      throw new Error("TikTok IDが入力されていません。アカウント欄にIDを入力してから「IDを承認する」を押してください。");
    }

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
      options: {
        ...(existingCfg?.options || {}),
        giftCooldownMs: existingCfg?.options?.giftCooldownMs ?? 300,
        maxCommandsPerGift: existingCfg?.options?.maxCommandsPerGift ?? 200,
        commandsDir: existingCfg?.options?.commandsDir || "commands/minecraft",
        logUnknownGifts: existingCfg?.options?.logUnknownGifts ?? true,
      },
      mappings,
    });

    return { username: u, mappingCount: mappings.length };
  }, [api, username]);

  const handleAllStart = async () => {
    if (allStartBusy) return;

    // OP権限の事前チェック：マイクラID未設定だと起動後の自動OP付与ができず、
    // ゲームモード切替（F3+F4）等が「権限がありません」になるため先に警告する。
    try {
      const appCfg = await api.appConfigRead?.();
      const opName = String(appCfg?.minecraftPlayerName || "").trim();
      if (!opName) {
        addLog("警告: マイクラIDが未設定のため、OP権限は付与されません。", "warn");
        const proceed = window.confirm(
          "OP権限がまだ付与されていません。\n\n"
          + "マイクラIDが未設定のため、起動後の自動OP付与ができません。\n"
          + "OPが無いとゲームモード切替（F3+F4）やコマンドが使えません。\n\n"
          + "ダッシュボードの「マイクラID」欄にプレイヤー名を保存してから\n"
          + "一括起動することをおすすめします。\n\n"
          + "このまま一括起動を続行しますか？"
        );
        if (!proceed) {
          addLog("一括起動をキャンセルしました。マイクラIDを保存してから再度お試しください。", "info");
          return;
        }
      }
    } catch { /* チェック不能でも起動は妨げない */ }

    setAllStartBusy(true);
    setApplyMsg(null);
    setWorldMsg(null);
    addLog("一括起動を開始します…", "info");
    let stage: "config" | "forge" | "minecraft" | "bridge" | "done" = "config";

    // 読み上げ（TTS）が有効ならエンジンを裏で自動起動する。
    // エンジン未起動だと読み上げが無言のまま失敗し続けるため（今回の読み上げ不発の真因）。
    void (async () => {
      try {
        const tts = await api.ttsSettingsRead?.();
        if (!tts?.enabled) return;
        addLog(`読み上げエンジン（${tts.engine}）を確認・起動しています…`, "info");
        const launched = await api.ttsLaunchEngine?.(tts.engine);
        if (launched?.ok) {
          addLog(`読み上げエンジン: ${launched.alreadyRunning ? "起動済みです" : "起動しました"}。コメント・ギフトを読み上げます。`, "ok");
        } else {
          addLog(`読み上げエンジンを起動できませんでした: ${launched?.message || "不明"}（読み上げ設定ページから手動起動してください）`, "warn");
        }
      } catch { /* 読み上げは配信継続に必須ではない */ }
    })();

    try {
      if (isWorldDirty) {
        setWorldSaving(true);
        addLog(`配布ワールド設定を保存中: ${draft}`, "info");
        await api.serverPropsWrite({ "level-name": draft });
        try { await api.serverDatapackDeployNightVision(); } catch { /* optional */ }
        setLevelName(draft);
        setWorldMsg({ type: "ok", text: "一括起動前にワールド設定を保存しました。" });
        addLog("配布ワールド設定を保存しました。", "ok");
      }

      try {
        const applied = await applyBridgeConfig();
        setApplyMsg({ type: "ok", text: `適用しました（${applied.mappingCount}件）` });
        setAppliedUsername(applied.username);
        addLog(`TikTok設定をBRIDGEに適用しました (@${applied.username}, ${applied.mappingCount}件)`, "ok");
      } catch (e: any) {
        setApplyMsg({ type: "error", text: e?.message ?? String(e) });
        addLog(`Bridge設定適用エラー: ${e?.message ?? String(e)}`, "error");
        throw e;
      }

      setForgeState("starting");
      stage = "forge";
      addLog("Forgeサーバーを起動中…", "info");
      // 暗視は初期設定：ワールド変更の有無にかかわらず毎回データパックを配置する
      try { await api.serverDatapackDeployNightVision(); } catch { /* optional */ }
      const started = await api.serverStart();
      setForgeState("running");
      logBackupResult(started?.backup);
      addLog("Forgeサーバーを起動しました。", "ok");

      stage = "minecraft";
      addLog("Minecraftランチャーを起動中…", "info");
      // Minecraft起動失敗は致命にしない（配信はサーバー＋Bridgeで成立する。ランチャーは手動でも可）
      try {
        await api.minecraftLaunch();
        addLog("Minecraftランチャーを起動しました。サーバーへ接続してください。", "ok");
      } catch (mcErr: any) {
        addLog(`Minecraftランチャーの自動起動に失敗（手動で起動してください）: ${mcErr?.message ?? String(mcErr)}`, "warn");
      }

      addLog("TikTok LIVE Studio でライブ接続を開始してください（ここは手動手順です）。", "warn");

      setBridgeState("starting");
      stage = "bridge";
      addLog("BRIDGEを起動中…", "info");
      await api.bridgeLaunch();
      setBridgeState("running");
      addLog("BRIDGEを起動しました。", "ok");

      try {
        await api.serverGamerulesApply();
        addLog("ゲームルール（常昼・晴れ・keepInventory・暗視）を適用しました。", "ok");
      } catch (ge: any) {
        addLog(`ゲームルール適用をスキップ: ${ge?.message ?? String(ge)}`, "warn");
      }

      // マイクラIDが設定済みならOP権限を自動付与
      try {
        const appCfg = await api.appConfigRead?.();
        if (appCfg?.minecraftPlayerName) {
          const granted = await api.minecraftGrantOp?.();
          addLog(granted?.message || `マイクラID「${appCfg.minecraftPlayerName}」にOP権限を付与しました。`, "ok");
        } else {
          addLog("警告: マイクラID未設定のためOP権限を付与できませんでした。ダッシュボードでマイクラIDを保存してください。", "warn");
        }
      } catch (opErr: any) {
        addLog(`警告: OP権限を付与できませんでした（${opErr?.message ?? String(opErr)}）。ゲームモード切替やコマンドが使えない場合は、マイクラIDを保存し直してください。`, "warn");
      }

      stage = "done";
      addLog("一括起動が完了しました。", "ok");
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (stage === "forge") setForgeState("error");
      if (stage === "minecraft") addLog("Minecraft起動段階で止まりました。ランチャーのインストール場所を確認してください。", "error");
      if (stage === "bridge") setBridgeState("error");
      addLog(`一括起動エラー: ${msg}`, "error");
    } finally {
      setWorldSaving(false);
      setAllStartBusy(false);
    }
  };

  const handleAllStop = async () => {
    if (allStopBusy) return;
    setAllStopBusy(true);
    addLog("一括停止を開始します…", "info");
    try {
      await api.bridgeStop();
      setBridgeState("stopped");
      addLog("BRIDGEを停止しました。", "ok");
    } catch (e: any) {
      addLog(`BRIDGE停止: ${e?.message ?? String(e)}`, "warn");
    }
    try {
      setForgeState("starting");
      addLog("Forgeサーバーを停止中…（ワールド保存を待っています）", "info");
      await api.serverStop();
      setForgeState("stopped");
      addLog("Forgeサーバーを停止しました。", "ok");
    } catch (e: any) {
      setForgeState("stopped");
      addLog(`Forgeサーバー停止: ${e?.message ?? String(e)}`, "warn");
    }
    addLog("一括停止が完了しました。", "ok");
    setAllStopBusy(false);
  };

  const handleSaveMcId = async () => {
    const name = mcId.trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setMcIdMsg({ type: "error", text: "英数字と _ で3〜16文字のマイクラIDを入力してください。" });
      return;
    }
    setMcIdBusy(true); setMcIdMsg(null);
    try {
      await api.appConfigWrite({ minecraftPlayerName: name });
      addLog(`マイクラIDを保存しました: ${name}`, "ok");
      // サーバー稼働中はMod経由で即付与。停止中でもログイン履歴があれば ops.json へ直接登録される。
      // サーバー起動直後はMod HTTP開通待ちで最大2〜3分かかるため、先に進捗を表示しておく。
      setMcIdMsg({ type: "info", text: "OP権限を付与しています…（サーバー起動直後は最大2〜3分かかることがあります）" });
      const granted = await api.minecraftGrantOp?.();
      const text = granted?.message || `${name} にOP権限を付与しました。`;
      setMcIdMsg({ type: "ok", text });
      addLog(text, "ok");
    } catch (e: any) {
      setMcIdMsg({ type: "error", text: `OP付与エラー: ${e?.message ?? String(e)}` });
      addLog(`OP付与エラー: ${e?.message ?? String(e)}`, "error");
    } finally { setMcIdBusy(false); }
  };

  const handlePickLauncher = async () => {
    try {
      const res = await api.dialogPickFile?.({
        title: "Minecraftランチャーの実行ファイルを選択",
        filters: [{ name: "実行ファイル", extensions: ["exe"] }],
      });
      if (!res || res.canceled || !res.path) return;
      await api.appConfigWrite({ minecraftLauncherPath: res.path });
      setLauncherPath(res.path);
      addLog(`Minecraftランチャーの場所を設定しました: ${res.path}`, "ok");
    } catch (e: any) {
      addLog(`ランチャーの場所設定エラー: ${e?.message ?? String(e)}`, "error");
    }
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
      const applied = await applyBridgeConfig();
      setApplyMsg({ type: "ok", text: `適用しました（${applied.mappingCount}件）` });
      setAppliedUsername(applied.username);
      addLog(`TikTok設定をBRIDGEに適用しました (@${applied.username}, ${applied.mappingCount}件)`, "ok");
    } catch (e: any) {
      setApplyMsg({ type: "error", text: e?.message ?? String(e) });
      addLog(`Bridge設定適用エラー: ${e?.message ?? String(e)}`, "error");
    } finally { setApplyBusy(false); }
  };

  const tiktokConfigured = username.trim().length > 0;
  const typedUsername = username.trim().replace(/^@/, "");
  const idApproved = typedUsername.length > 0 && appliedUsername === typedUsername;
  const worldDisplay = levelName ? levelName.replace(`${WORLD_PREFIX}/`, "") : "未設定";
  const step1: StepStatus = forgeState  === "running" ? "done" : forgeState  === "error" ? "error" : forgeState  === "starting" ? "active" : "pending";
  const stepBridge: StepStatus = bridgeState === "running" ? "done" : bridgeState === "error" ? "error" : bridgeState === "starting" ? "active" : "pending";
  const stepTikTok: StepStatus = tiktokConfigured ? "done" : "pending";
  const isBusy = allStartBusy || forgeState === "starting" || bridgeState === "starting";

  const logTypeStyle: Record<LogType, string> = {
    info:  "text-gray-500",
    ok:    "text-emerald-400",
    error: "text-red-400",
    warn:  "text-amber-400",
  };

  const pipeline = [
    { label: "TikTok", value: tiktokConfigured ? `@${typedUsername}` : "未設定", icon: "tiktok", state: tiktokConfigured ? (bridgeState === "running" ? "running" : "stopped") : "stopped", tone: "green", runningText: "接続中" },
    { label: "Forge Server", value: "Forge 1.20.1", icon: "▣", state: forgeState, tone: "red", runningText: "接続中" },
    { label: "Game", value: gameRunning ? "Minecraft 検知中" : worldDisplay, icon: "world", state: gameRunning ? "running" : "stopped", tone: "green", runningText: "起動中" },
    { label: "Bridge", value: "TikTok → Minecraft", icon: "⛓", state: bridgeState, tone: "red", runningText: "接続中" },
  ] as const;

  const launchFlow = [
    ["forge server起動", "Forge 1.20.1 が起動するまで待つ", step1],
    ["Minecraft起動", "ランチャーを開いてサーバーに接続", "pending"],
    ["TIKTOK LIVE STUDIO でライブ接続", "ライブ接続は手動で開始します", stepTikTok],
    ["BRIDGE起動", "TikTok → RCON 接続・ルール自動適用", stepBridge],
    ["配布ワールド選択", `${draft || "haihu_world/sakura"} を適用`, levelName ? "done" : "pending"],
    ["保護・安全設定", "監視・テスト・バックアップ確認", "done"],
    ["TIKTOK LIVE 配信開始", "配信開始ボタンはLive Studio側で押します", "pending"],
  ] as const;

  return (
    <div className="dashboard-page cockpit-page page-surface">
      <div className="cockpit-layout">
        <section className="cockpit-main">
          <div className="cockpit-panel-title">
            <span>›</span>
            <div><h1>配信準備コックピット</h1><p>ForgeからTikTok経由でMinecraftをつなぎます</p></div>
          </div>

          <div className="cockpit-pipeline">
            {pipeline.map((item, index) => (
              <React.Fragment key={item.label}>
                <div className={`cockpit-node cockpit-node--${item.tone}`}>
                  <b>{item.label}</b>
                  <div className="cockpit-node-ring">
                    <span>{item.icon === "tiktok" ? <TikTokMark /> : item.icon === "world" ? <GrassBlockIcon /> : item.icon}</span>
                  </div>
                  <em className={item.state === "running" ? "is-running" : "is-stopped"}>
                    ● {item.state === "running" ? item.runningText : item.state === "starting" ? "処理中" : "停止中"}
                  </em>
                  <small>{item.value}</small>
                </div>
                {index < pipeline.length - 1 ? <div className="cockpit-link"><i /><span>›</span></div> : null}
              </React.Fragment>
            ))}
          </div>

          <div className="cockpit-launch-actions">
            <div className="cockpit-main-actions">
              <button type="button" onClick={handleAllStart} disabled={isBusy || allStopBusy} className="cockpit-all-start">
                <span>▶</span> 一括起動
              </button>
              <button type="button" onClick={handleAllStop} disabled={allStartBusy || allStopBusy} className="cockpit-all-start cockpit-all-stop">
                <span>■</span> 一括停止
              </button>
            </div>
            <div className="cockpit-bridge-actions" aria-label="BRIDGE単体操作">
              <button type="button" onClick={handleBridgeStop} disabled={isBusy} className="cockpit-bridge-action cockpit-bridge-action--stop">
                ■ BRIDGE停止
              </button>
              <button type="button" onClick={handleBridgeRestart} disabled={isBusy} className="cockpit-bridge-action cockpit-bridge-action--restart">
                ↻ BRIDGE再起動
              </button>
            </div>
          </div>
          <p className="cockpit-all-start-note">一括起動＝順番に起動 ／ 一括停止＝ゲーム終了後にBRIDGEとサーバーをまとめて停止</p>
          <div className="cockpit-launcher-config">
            <button type="button" onClick={handlePickLauncher}>🎮 ランチャーの場所を指定</button>
            <span title={launcherPath || undefined}>
              {launcherPath || "未設定（標準のインストール場所を自動検索します）"}
            </span>
          </div>
        </section>

        <aside className="cockpit-flow-panel">
          <h2>ライブ手順 <small>（起動フロー）</small></h2>
          <div className="cockpit-flow-list">
            {launchFlow.map(([label, description, status], index) => (
              <div className={`cockpit-flow-step cockpit-flow-step--${status}`} key={label}>
                <span>{index + 1}</span>
                <i>{index === 2 ? <TikTokMark /> : ["▣","🎮","","⛓","♟","⬡","◉"][index]}</i>
                <div><b>{label}</b><small>{description}</small>{status === "done" ? <em>● 完了</em> : <em>● 待機中</em>}</div>
              </div>
            ))}
          </div>
          <p className="cockpit-flow-note">初回は「初期セットアップ」でフォルダーを設定してください。</p>
        </aside>

        <div className="cockpit-lower-grid">
          <section className="cockpit-info-card">
          <h2><span><TikTokMark /></span> TikTok 接続設定</h2>
          <label>アカウント</label>
          <div className="cockpit-account-row">
            <b>@</b><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="配信アカウント名（ID）" />
            <em className={idApproved ? "is-approved" : "is-unapproved"}>● {idApproved ? "承認済み" : "非承認"}</em>
          </div>
          <button type="button" onClick={handleApplyBridge} disabled={applyBusy} className="cockpit-apply">
            <span>⬡</span>
            <div>
              <b>
                {applyBusy ? "承認中…" : idApproved ? "承認済み" : "IDを承認する"}
              </b>
              <small>RCON・イベント・ギフト連携に適用されます</small>
            </div>
            <i className={idApproved && !applyBusy ? "is-applied" : "is-idle"}>●</i>
          </button>

          <label style={{ marginTop: 14 }}>マイクラID（OP自動付与）</label>
          <div className="cockpit-account-row">
            <b>⛏</b>
            <input
              value={mcId}
              onChange={(e) => { setMcId(e.target.value); setMcIdMsg(null); }}
              placeholder="Minecraft のプレイヤーID"
            />
            <button
              type="button"
              onClick={handleSaveMcId}
              disabled={mcIdBusy}
              style={{
                minHeight: 30, padding: "0 12px", borderRadius: 9, whiteSpace: "nowrap",
                border: "1px solid rgba(39,216,255,0.5)", background: "rgba(7,50,73,0.75)",
                color: "#d5f2ff", fontSize: 11, fontWeight: 800,
              }}
            >
              {mcIdBusy ? "付与中…" : "OP権限を付与"}
            </button>
          </div>
          {mcIdMsg && (
            <small style={{ display: "block", marginTop: 6, color: mcIdMsg.type === "ok" ? "#9acd32" : mcIdMsg.type === "info" ? "#7dd3fc" : "#ff6578" }}>
              {mcIdMsg.text}
            </small>
          )}
          </section>

          <section className="cockpit-info-card cockpit-world-card">
          <h2><span><GrassBlockIcon /></span> 配信ワールド</h2>
          <label>ワールド</label>
          <select value={subfolder} onChange={(e) => setSubfolder(e.target.value)}>
            {worldFolders.map((folder) => <option value={folder} key={folder}>{WORLD_PREFIX}/ {folder}</option>)}
          </select>
          <WorldDiorama />
          <small>状態: <b>{levelName ? "起動準備OK" : "未設定"}</b></small>
          </section>

          <section className="cockpit-info-card cockpit-safety-card">
          <h2><span>⬡</span> 保護＆バックアップ</h2>
          <div className="cockpit-safety-state"><span>⬡</span><div><b>{safety.protection || safety.autoBackup ? "一部有効" : "未設定"}</b><small>運用センターで詳細を設定できます</small></div></div>
          <ul>
            <li>{bridgeProcess.running ? "✓" : "○"} BRIDGEログ監視{bridgeProcess.running ? "" : "（停止中）"}</li>
            <li>{safety.protection ? "✓" : "○"} 拠点保護エリア{safety.protection ? "" : "（未設定）"}</li>
            <li>{safety.autoBackup ? "✓" : "○"} サーバー起動時バックアップ{safety.autoBackup ? "" : "（無効）"}</li>
            <li>✓ クラッシュ時自動再起動</li>
          </ul>
          </section>
        </div>
      </div>

      <section className="cockpit-activity">
        <div><h2>アクティビティログ</h2><button type="button" onClick={() => setLog([])}>ログをクリア</button></div>
        <div className="cockpit-log">
          {log.length === 0 ? (
            <p className="cockpit-log-empty"><span className={logTypeStyle.info}>●</span><b>まだ操作履歴はありません。起動・停止などの操作を行うとここに記録されます。</b></p>
          ) : (
            log.slice(-12).map((entry) => (
              <p key={entry.id}><span className={logTypeStyle[entry.type]}>●</span><time>{entry.time}</time><b>{entry.text}</b></p>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </section>

      <div className="cockpit-log-panels">
        <section className="cockpit-bridge-log-panel">
          <div className="cockpit-bridge-log-head">
            <div>
              <h2>BRIDGEログ</h2>
              <p>
                状態: <b className={bridgeProcess.running ? "is-running" : "is-stopped"}>{bridgeProcess.running ? "稼働中" : "停止中"}</b>
                {bridgeProcess.pid ? <span> PID {bridgeProcess.pid}</span> : null}
                {typeof bridgeProcess.cpuPercent === "number" ? <span> CPU {bridgeProcess.cpuPercent}%</span> : null}
                {typeof bridgeProcess.memMb === "number" ? <span> MEM {bridgeProcess.memMb}MB</span> : null}
              </p>
            </div>
            <button type="button" onClick={handleBridgeRestart} disabled={isBusy}>↻ BRIDGE再起動</button>
          </div>
          <div className="cockpit-bridge-log-body">
            {bridgeLogs.length ? bridgeLogs.slice(-80).map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            )) : (
              <p className="is-muted">BRIDGEログはまだありません。BRIDGEを起動するとここに表示されます。</p>
            )}
          </div>
        </section>

        <section className="cockpit-bridge-log-panel">
          <div className="cockpit-bridge-log-head">
            <div>
              <h2>Forgeサーバーログ</h2>
              <p>
                状態: <b className={serverProc.running ? "is-running" : "is-stopped"}>{serverProc.running ? "稼働中" : "停止中"}</b>
                {serverProc.pid ? <span> PID {serverProc.pid}</span> : null}
              </p>
            </div>
            <button type="button" onClick={handleServerStop} disabled={isBusy || !serverProc.running}>■ サーバー停止</button>
          </div>
          <div className="cockpit-bridge-log-body">
            {serverLogs.length ? serverLogs.slice(-80).map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
            )) : (
              <p className="is-muted">Forgeサーバーのログはここに表示されます（黒い別ウィンドウは開きません）。</p>
            )}
          </div>
          <form
            className="flex gap-2 mt-2"
            onSubmit={(e) => { e.preventDefault(); void handleSendServerCommand(); }}
          >
            <input
              value={consoleCmd}
              onChange={(e) => setConsoleCmd(e.target.value)}
              placeholder={serverProc.running ? "サーバーコマンドを入力して Enter（例: op プレイヤー名）" : "サーバー起動後にコマンドを送信できます"}
              disabled={!serverProc.running}
              spellCheck={false}
              className="flex-1 bg-black/40 border border-gray-600/50 rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-cyan-500/60 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!serverProc.running || !consoleCmd.trim()}
              className="text-xs px-3 py-1.5 rounded-lg border border-cyan-500/40 text-cyan-300 hover:border-cyan-400 transition disabled:opacity-40"
            >
              送信
            </button>
          </form>
        </section>
      </div>

      <div className="cockpit-hidden-actions" aria-hidden="true">
        <button onClick={handleServerStart}>start</button><button onClick={handleServerStop}>stop</button>
        <button onClick={handleBridgeStart}>bridge</button><button onClick={handleBridgeStop}>bridge stop</button><button onClick={handleBridgeRestart}>bridge restart</button>
        <button onClick={handleMinecraftLaunch}>minecraft</button><button onClick={handleAllStop}>all stop</button>
        <button onClick={handleWorldSave}>save</button>
      </div>
    </div>
  );
};

export default DashboardPage;
