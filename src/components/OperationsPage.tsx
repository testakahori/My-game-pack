import React, { useCallback, useEffect, useMemo, useState } from "react";

type ModStatus = {
  online: boolean;
  gift?: number;
  like?: number;
  other?: number;
  executed?: number;
  failed?: number;
  lastError?: string;
  error?: string;
  protectedSkips?: number;
  tps?: number;
  tickMs?: number;
  player?: { online: boolean; x: number; y: number; z: number };
};

type HistoryRow = {
  at: string;
  type: string;
  sender: string;
  commandFile: string;
  count: number;
  ok: boolean;
  message?: string;
};

type Stats = {
  total: number;
  succeeded: number;
  failed: number;
  topCommands: Array<{ name: string; count: number }>;
  topSenders: Array<{ name: string; count: number }>;
};

type CommandFile = { name: string; title: string };

const defaultStatus: ModStatus = {
  online: false,
  gift: 0,
  like: 0,
  other: 0,
  executed: 0,
  failed: 0,
  protectedSkips: 0,
};

const defaultStats: Stats = {
  total: 0,
  succeeded: 0,
  failed: 0,
  topCommands: [],
  topSenders: [],
};

function fmtClock(date = new Date()) {
  return date.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtShortTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function tailPath(value?: string, fallback = "server/Douma_Craft") {
  if (!value) return fallback;
  const parts = String(value).split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/") || fallback;
}

function parseWorldName(value?: string) {
  if (!value) return "sakura";
  const parts = String(value).split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || value;
}

function displayCommandTitle(command?: CommandFile, fallback = "コマンド未選択") {
  if (!command) return fallback;
  return command.title ? `${command.title}（${command.name}）` : command.name;
}

function FieldLabel({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`ops-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function OpsPanel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <section className={`ops-panel ${className}`.trim()}>{children}</section>;
}

function CreeperSignal() {
  return (
    <div className="ops-creeper-signal" aria-hidden="true">
      <span className="ops-creeper-face">
        <i />
        <i />
        <b />
      </span>
    </div>
  );
}

function ProtectionMap() {
  return (
    <div className="ops-protection-map" aria-hidden="true">
      <div className="ops-map-grid" />
      <span className="ops-map-pin ops-map-pin--nw" />
      <span className="ops-map-pin ops-map-pin--ne" />
      <span className="ops-map-pin ops-map-pin--sw" />
      <span className="ops-map-pin ops-map-pin--se" />
      <span className="ops-map-axis ops-map-axis--n">N</span>
      <span className="ops-map-axis ops-map-axis--e">E</span>
      <span className="ops-map-axis ops-map-axis--s">S</span>
      <span className="ops-map-axis ops-map-axis--w">W</span>
      <span className="ops-map-shield">🛡</span>
      <span className="ops-map-label">拠点</span>
    </div>
  );
}

export default function OperationsPage() {
  const api = (window as any).mygamepack;
  const [status, setStatus] = useState<ModStatus>(defaultStatus);
  const [commands, setCommands] = useState<CommandFile[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [commandFile, setCommandFile] = useState("");
  const [sender, setSender] = useState("テスト視聴者");
  const [count, setCount] = useState(1);
  const [likeCount, setLikeCount] = useState(100);
  const [notice, setNotice] = useState("");
  const [cfg, setCfg] = useState<any>({});
  const [appCfg, setAppCfg] = useState<any>({});
  const [serverProps, setServerProps] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [gameplayText, setGameplayText] = useState("{}");
  const [updater, setUpdater] = useState<any>({ state: "idle" });
  const [bridgeProcess, setBridgeProcess] = useState<any>({ running: false, restartCount: 0 });
  const [bridgeSync, setBridgeSync] = useState<any>({ state: "idle" });
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(new Date());
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");

  useEffect(() => {
    api.appVersion?.().then((v: string) => setAppVersion(v)).catch(() => {});
  }, [api]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const [s, h, st, up, bp, bs] = await Promise.allSettled([
      api.modStatus(),
      api.operationsHistory(),
      api.operationsStats(),
      api.updaterStatus(),
      api.bridgeProcessStatus(),
      api.bridgeSyncStatus ? api.bridgeSyncStatus() : Promise.resolve({ state: "unknown" }),
    ]);

    if (s.status === "fulfilled") setStatus({ ...defaultStatus, ...(s.value || {}) });
    if (h.status === "fulfilled") setHistory(Array.isArray(h.value) ? h.value : []);
    if (st.status === "fulfilled") setStats({ ...defaultStats, ...(st.value || {}) });
    if (up.status === "fulfilled") setUpdater(up.value || { state: "idle" });
    if (bp.status === "fulfilled") setBridgeProcess(bp.value || { running: false, restartCount: 0 });
    if (bs.status === "fulfilled") setBridgeSync(bs.value || { state: "unknown" });
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      api.bridgeCommandsList(),
      api.configRead(),
      api.appConfigRead(),
      api.serverPropsRead ? api.serverPropsRead() : Promise.resolve({}),
    ]).then(([list, config, appConfig, props]) => {
      if (cancelled) return;
      const commandList = list.status === "fulfilled" && Array.isArray(list.value) ? list.value : [];
      const bridgeConfig = config.status === "fulfilled" ? config.value || {} : {};
      const appConfigValue = appConfig.status === "fulfilled" ? appConfig.value || {} : {};
      const propsValue = props.status === "fulfilled" ? props.value || {} : {};

      setCommands(commandList);
      setCommandFile(commandList[0]?.name || "");
      setCfg(bridgeConfig);
      setAppCfg(appConfigValue);
      setServerProps(propsValue);
      setGameplayText(JSON.stringify(bridgeConfig?.options?.gameplay || {}, null, 2));
    });

    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, refresh]);

  const selectedCommand = useMemo(
    () => commands.find((command) => command.name === commandFile),
    [commands, commandFile],
  );

  const o = cfg.options || {};
  const protection = o.protection || {};
  const backlog = (status.gift || 0) + (status.like || 0) + (status.other || 0);
  const pct = Math.min(100, Math.max(8, backlog ? backlog / 10 : status.online ? 24 : 62));
  const latestAt = history[0]?.at;
  const worldName = parseWorldName(serverProps["level-name"] || appCfg.world || cfg.world);
  const serverFolderLabel = tailPath(appCfg.serverFolder);
  const jsonLineCount = gameplayText.split(/\r?\n/).length;
  const jsonBytes = new Blob([gameplayText]).size;

  const setOption = (key: string, value: any) => {
    setCfg((valueBefore: any) => ({
      ...valueBefore,
      options: {
        ...(valueBefore.options || {}),
        [key]: value,
      },
    }));
  };

  const setProtection = (patch: Record<string, any>) => {
    setOption("protection", {
      ...(cfg.options?.protection || {}),
      ...patch,
    });
  };

  const fire = async (type: "gift" | "like") => {
    try {
      setNotice("テストイベントを送信中…");
      // いいね発火は本番と同じ「しきい値ラダー」シミュレート（イベント設定①のルールに従う）
      const result = type === "like"
        ? await api.testEvent({ type, likeCount, listenerName: sender })
        : await api.testEvent({ type, commandFile, count, listenerName: sender });
      setNotice(result?.ok === false
        ? `失敗: ${result.message || "送信できませんでした"}`
        : result?.message || "テストイベントを送信しました");
      await refresh();
    } catch (error: any) {
      setNotice(`送信失敗: ${error?.message || String(error)}`);
    }
  };

  const save = async () => {
    try {
      const gameplay = JSON.parse(gameplayText);
      const next = { ...cfg, options: { ...(cfg.options || {}), gameplay } };
      const validation = await api.configValidate(next);
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      await Promise.all([
        api.configWrite(next),
        api.appConfigWrite({ autoBackupOnServerStart: appCfg.autoBackupOnServerStart !== false }),
      ]);
      setCfg(next);
      setLastSavedAt(new Date().toISOString());
      setNotice(validation.warnings?.length ? `保存しました: ${validation.warnings.join(" / ")}` : "運用設定を保存しました");
      await refresh();
    } catch (error: any) {
      setNotice(`保存失敗: ${error?.message || String(error)}`);
    }
  };

  const backupWorld = async () => {
    try {
      setNotice("ワールドをバックアップ中…");
      const result = await api.worldBackup();
      setNotice(result?.message || "ワールドをバックアップしました");
    } catch (error: any) {
      setNotice(`バックアップ失敗: ${error?.message || String(error)}`);
    }
  };

  const openCommandsFolder = async () => {
    try {
      if (api.bridgeCommandsOpenFolder) {
        await api.bridgeCommandsOpenFolder();
        setNotice("コマンドフォルダを開きました");
      } else {
        setNotice("コマンドフォルダを開くAPIが見つかりません");
      }
    } catch (error: any) {
      setNotice(`ファイルを開けませんでした: ${error?.message || String(error)}`);
    }
  };

  const checkUpdate = async () => {
    try {
      setNotice("更新を確認中…");
      const result = await api.updaterCheck();
      setUpdater(result || { state: "idle" });
      setNotice(result?.error ? "更新確認に失敗しました。詳細を確認してください。" : "更新確認が完了しました");
    } catch (error: any) {
      setNotice(`更新確認失敗: ${error?.message || String(error)}`);
    }
  };

  const clearHistory = async () => {
    try {
      await api.operationsHistoryClear();
      await refresh();
      setNotice("ログをクリアしました");
    } catch (error: any) {
      setNotice(`ログクリア失敗: ${error?.message || String(error)}`);
    }
  };

  const formatGameplayJson = () => {
    try {
      setGameplayText(JSON.stringify(JSON.parse(gameplayText), null, 2));
      setNotice("JSONを整形しました");
    } catch (error: any) {
      setNotice(`JSON整形失敗: ${error?.message || String(error)}`);
    }
  };

  // bridge/feature_engine.js が解釈する options.gameplay の記入例
  const GAMEPLAY_EXAMPLE = {
    combo: {
      windowMs: 10000,
      levels: [{ count: 5, commandFile: "tnt.txt", repeat: 1 }],
    },
    likeMilestones: [{ threshold: 100, commandFile: "cod.txt", repeat: 3 }],
    followMilestones: [{ threshold: 5, commandFile: "heal.txt", repeat: 1 }],
    commentCommands: { "!creeper": { commandFile: "creeper.txt", repeat: 1 } },
    timedMode: { enabled: false, start: "21:00", end: "23:00", multiplier: 2 },
  };

  const insertGameplayExample = () => {
    const current = gameplayText.replace(/\s/g, "");
    if (current && current !== "{}" && !window.confirm("現在のJSONを記入例で置き換えます。よろしいですか？")) return;
    setGameplayText(JSON.stringify(GAMEPLAY_EXAMPLE, null, 2));
    setNotice("記入例を貼り付けました。必要な項目だけ残して保存してください");
  };

  const gameplayJsonError = useMemo(() => {
    try { JSON.parse(gameplayText); return null; }
    catch (error: any) { return error?.message || "invalid JSON"; }
  }, [gameplayText]);

  return (
    <div className="operations-page ops-page">
      <header className="ops-header">
        <div>
          <h1>運用センター / <span>Mission Control</span></h1>
          <p>サーバーの監視・テスト・安全運用を統合管理します。</p>
        </div>
        <div className="ops-header-cards" aria-label="現在の運用状態">
          <div>
            <small>接続先</small>
            <b><i className="ops-dot ops-dot--green" />{serverFolderLabel}</b>
          </div>
          <div>
            <small>ワールド</small>
            <b>🧊 {worldName}</b>
          </div>
          <div>
            <small>現在時刻</small>
            <b>{fmtClock(now)}</b>
          </div>
        </div>
      </header>

      <OpsPanel className={`ops-monitor ${status.online ? "is-online" : "is-offline"}`}>
        <div className="ops-monitor-left">
          <div className="ops-panel-heading">
            <span className="ops-panel-icon ops-panel-icon--cyan">❄</span>
            <div>
              <h2>Mod死活監視</h2>
              <p>2秒ごとに /douma/status を確認</p>
            </div>
          </div>

          <div className="ops-metric-strip">
            <span><small>Gift</small><b>{status.gift || 0}</b></span>
            <span><small>Like</small><b>{status.like || 0}</b></span>
            <span><small>Other</small><b>{status.other || 0}</b></span>
            <span><small>成功</small><b className="ok">{status.executed || stats.succeeded || 0}</b></span>
            <span
              title="失敗＝実行したコマンド1行単位の空振り（対象プレイヤー不在・セレクタ不一致など）。ギフトの取りこぼしではありません。"
            ><small>失敗 ⓘ</small><b className="bad">{status.failed || stats.failed || 0}</b></span>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 10, color: "#77899f" }}>
            ※「失敗」はコマンド1行単位の空振り（プレイヤー不在時の演出コマンド等）で、ギフト不発の数ではありません。
          </p>

          <div className="ops-status-meta">
            <span>TPS <b>{status.tps?.toFixed?.(1) ?? "--"}</b></span>
            <span>Tick <b>{status.tickMs?.toFixed?.(1) ?? "--"} ms</b></span>
            <span>Bridgeプロセス <b className={bridgeProcess.running ? "ok" : "bad"}>{bridgeProcess.running ? "起動中" : "停止中"}</b></span>
            <span>Bridge同期 <b className={bridgeSync.state === "error" ? "bad" : "ok"}>{bridgeSync.state || "unknown"}</b></span>
          </div>
        </div>

        <div className="ops-monitor-right">
          <div className="ops-alert-row">
            <span className={`ops-status-pill ${status.online ? "is-ok" : "is-alert"}`}>
              {status.online ? "● 正常（サーバー・Mod応答あり）" : "● 応答なし（サーバー停止・Mod未ロード）"}
            </span>
            <button type="button" className="ops-ghost-button" onClick={() => setShowHistory((value) => !value)}>
              ⊞ ログを表示
            </button>
          </div>

          <div className="ops-heartbeat">
            {Array.from({ length: 46 }).map((_, index) => (
              <span
                key={index}
                className={index < Math.round((pct / 100) * 46) ? "is-active" : ""}
                style={{ ["--i" as string]: index }}
              />
            ))}
            <svg viewBox="0 0 150 38" aria-hidden="true">
              <polyline points="0,24 24,24 32,7 43,32 58,17 75,19 88,22 103,17 118,24 150,24" />
            </svg>
          </div>

          <div className="ops-monitor-bottom">
            <span>最終確認: {fmtShortTime(latestAt)}（2秒前）</span>
            <b>次回確認まで: 00:00:01</b>
          </div>
        </div>

        <CreeperSignal />
      </OpsPanel>

      <div className="ops-main-grid">
        <OpsPanel className="ops-test-card">
          <div className="ops-panel-heading">
            <span className="ops-panel-icon ops-panel-icon--blue">▣</span>
            <div>
              <h2>オフライン・テストモード</h2>
              <p>TikTok接続なしでModへ直接イベントを送ります。</p>
            </div>
          </div>

          <div className="ops-test-controls">
            <FieldLabel label="コマンドファイル">
              <div className="ops-inline-control">
                <select value={commandFile} onChange={(event) => setCommandFile(event.target.value)}>
                  {commands.length ? (
                    commands.map((command) => (
                      <option key={command.name} value={command.name}>{displayCommandTitle(command)}</option>
                    ))
                  ) : (
                    <option value="">コマンドが見つかりません</option>
                  )}
                </select>
                <button type="button" className="ops-small-button" onClick={openCommandsFolder}>▧ ファイルを開く</button>
              </div>
            </FieldLabel>
            <div className="ops-two-cols">
              <FieldLabel label="テスト視聴者名">
                <input value={sender} onChange={(event) => setSender(event.target.value)} placeholder="テスト視聴者" />
              </FieldLabel>
              <FieldLabel label="ギフト発火数">
                <div className="ops-count-row">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={count}
                    onChange={(event) => setCount(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
                  />
                  <small>回<br />(1〜100)</small>
                </div>
              </FieldLabel>
              <FieldLabel label="いいね発火数">
                <div className="ops-count-row">
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={likeCount}
                    onChange={(event) => setLikeCount(Math.max(1, Math.min(10000, Number(event.target.value) || 1)))}
                  />
                  <small>いいね<br />(1〜10000)</small>
                </div>
              </FieldLabel>
            </div>
            <div className="ops-action-row">
              <button type="button" className="ops-primary-button ops-primary-button--pink" onClick={() => fire("gift")}>
                🎁 ギフト発火
              </button>
              <button type="button" className="ops-primary-button ops-primary-button--cyan" onClick={() => fire("like")}>
                ♥ いいね発火
              </button>
            </div>
            <p className="ops-test-note" style={{ margin: "6px 0 0", fontSize: 11, color: "#8ba0b8" }}>
              ♥ いいね発火は「イベント設定①」のしきい値ルールに従って発火します（コマンドファイル選択は使いません）。
            </p>
          </div>

          <div className="ops-preview-log">
            <div>
              <b>プレビューログ（直近10件）</b>
              <button type="button" onClick={clearHistory}>クリア</button>
            </div>
            {(history.length ? history : [{
              at: new Date().toISOString(),
              type: "INFO",
              sender: "SYSTEM",
              commandFile: selectedCommand?.name || commandFile || "未選択",
              count,
              ok: true,
              message: `コマンドファイルを読み込みました: ${selectedCommand?.name || commandFile || "—"}`,
            }]).slice(0, 4).map((row, index) => (
              <p key={`${row.at}-${index}`}>
                <span>[{fmtShortTime(row.at)}]</span>
                <b className={row.ok ? "ok" : "bad"}>{row.ok ? "OK" : "ERR"}</b>
                <em>{row.message || `${row.type} / ${row.sender} / ${row.commandFile} × ${row.count}`}</em>
              </p>
            ))}
          </div>
        </OpsPanel>

        <OpsPanel className="ops-stability-card">
          <div className="ops-panel-heading">
            <span className="ops-panel-icon ops-panel-icon--shield">🛡</span>
            <div>
              <h2>安定運用・荒らし対策</h2>
              <p>連打・保護・バックアップを安全側に調整します。</p>
            </div>
          </div>

          <div className="ops-stability-layout">
            <div className="ops-stability-fields">
              <div className="ops-two-cols">
                <FieldLabel label="ギフト間隔(ms)">
                  <input type="number" value={o.giftCooldownMs ?? 300} onChange={(event) => setOption("giftCooldownMs", Number(event.target.value) || 0)} />
                </FieldLabel>
                <FieldLabel label="いいねバッチ(ms)">
                  <input type="number" value={o.likeBatchWindowMs ?? o.likeBatchMs ?? 1200} onChange={(event) => setOption("likeBatchWindowMs", Number(event.target.value) || 0)} />
                </FieldLabel>
                <FieldLabel label="いいね追いつき上限">
                  <input type="number" value={o.maxLikeCatchUpPerEvent ?? o.likeCatchupLimit ?? 5} onChange={(event) => setOption("maxLikeCatchUpPerEvent", Number(event.target.value) || 0)} />
                </FieldLabel>
                <FieldLabel label="個別最大コマンド数">
                  <input type="number" value={o.maxCommandsPerGift ?? 200} onChange={(event) => setOption("maxCommandsPerGift", Number(event.target.value) || 0)} />
                </FieldLabel>
              </div>
              <FieldLabel label="ミュートユーザー（カンマ区切り）">
                <input value={(o.mutedUsers || []).join(", ")} onChange={(event) => setOption("mutedUsers", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="例）baduser1,baduser2" />
              </FieldLabel>
              <FieldLabel label="TTS NGワード（カンマ区切り）">
                <input value={(o.ttsNgWords || []).join(", ")} onChange={(event) => setOption("ttsNgWords", event.target.value.split(",").map((value) => value.trim()).filter(Boolean))} placeholder="例）暴言, URL, 宣伝" />
              </FieldLabel>
              <label className="ops-check-row">
                <input
                  type="checkbox"
                  checked={appCfg.autoBackupOnServerStart !== false}
                  onChange={(event) => setAppCfg((value: any) => ({ ...value, autoBackupOnServerStart: event.target.checked }))}
                />
                サーバー起動前にワールドを自動バックアップ
              </label>
              <label className="ops-check-row">
                <input
                  type="checkbox"
                  checked={protection.enabled === true}
                  onChange={(event) => setProtection({ enabled: event.target.checked })}
                />
                拠点保護エリア内ではTNT・マグマ・落とし穴を抑止
              </label>
            </div>

            <div className="ops-protection">
              <div className="ops-protection-head">
                <span>保護エリア（座標） ⓘ</span>
                <button type="button" className="ops-small-button" onClick={() => setNotice("保護エリアを画面内で確認しました")}>⌘ 地図で確認</button>
              </div>
              <div className="ops-two-cols">
                <FieldLabel label="X1">
                  <input type="number" value={protection.x1 ?? -20} onChange={(event) => setProtection({ x1: Number(event.target.value) || 0 })} />
                </FieldLabel>
                <FieldLabel label="Z1">
                  <input type="number" value={protection.z1 ?? -20} onChange={(event) => setProtection({ z1: Number(event.target.value) || 0 })} />
                </FieldLabel>
                <FieldLabel label="X2">
                  <input type="number" value={protection.x2 ?? 20} onChange={(event) => setProtection({ x2: Number(event.target.value) || 0 })} />
                </FieldLabel>
                <FieldLabel label="Z2">
                  <input type="number" value={protection.z2 ?? 20} onChange={(event) => setProtection({ z2: Number(event.target.value) || 0 })} />
                </FieldLabel>
              </div>
              <ProtectionMap />
              <div className="ops-save-row">
                <button type="button" className="ops-primary-button ops-primary-button--violet" onClick={save}>▣ 保存</button>
                <button
                  type="button"
                  className="ops-primary-button ops-primary-button--orange"
                  onClick={backupWorld}
                >
                  ▣ ワールドを今すぐバックアップ
                </button>
              </div>
            </div>
          </div>
        </OpsPanel>
      </div>

      <div className="ops-bottom-grid">
        <OpsPanel className="ops-json-card">
          <div className="ops-card-topline">
            <div className="ops-panel-heading">
              <span className="ops-panel-icon ops-panel-icon--violet">☷</span>
              <div>
                <h2>演出・ゲーム性設定</h2>
                <p>コンボ、マイルストーン、コメントコマンド、時限モードをJSONで設定します（上級者向け）。</p>
              </div>
            </div>
            <button type="button" className="ops-small-button" onClick={formatGameplayJson}>整形</button>
          </div>
          <details className="ops-json-help">
            <summary>📖 書き方ガイド（設定できる項目と記入例）</summary>
            <ul>
              <li><b>combo</b> — 同じギフトが windowMs ミリ秒以内に連続し、合計数が levels の count に達すると commandFile を repeat 回発動</li>
              <li><b>likeMilestones</b> — 配信中の累計いいねが threshold に到達した瞬間に1回発動</li>
              <li><b>followMilestones</b> — 配信中の新規フォローが threshold 人目に達したら発動</li>
              <li><b>commentCommands</b> — コメント本文が完全一致したら発動（例：「!creeper」）</li>
              <li><b>timedMode</b> — start〜end の時間帯だけギフトのコンボ集計を multiplier 倍にする</li>
            </ul>
            <p>commandFile はイベント設定と同じ bridge/commands/minecraft/ 内のtxtファイル名です。使わない項目は書かなくてOK（空の {"{}"} のままでも問題ありません）。</p>
            <pre>{JSON.stringify(GAMEPLAY_EXAMPLE, null, 2)}</pre>
            <button type="button" className="ops-small-button" onClick={insertGameplayExample}>この記入例をエディタに貼り付け</button>
          </details>
          <textarea
            value={gameplayText}
            onChange={(event) => setGameplayText(event.target.value)}
            spellCheck={false}
            placeholder={'空でOK。設定するときは上の「書き方ガイド」の記入例を参照してください。'}
          />
          <div className="ops-json-status">
            {gameplayJsonError
              ? <span>⚠ JSON <b className="bad">エラー</b></span>
              : <span>✅ JSON <b>正常</b></span>}
            <span>最終保存: {lastSavedAt ? fmtClock(new Date(lastSavedAt)) : "未保存"}</span>
            <span>{jsonLineCount} 行 / {(jsonBytes / 1024).toFixed(1)} KB</span>
          </div>
        </OpsPanel>

        <OpsPanel className="ops-update-card">
          <div className="ops-card-topline">
            <div>
              <h2>アプリ自動更新 <span className="ops-wip-badge">開発中</span></h2>
              <p>状態: <b className={updater.state === "error" ? "bad" : "ok"}>{updater.state || "idle"}</b></p>
            </div>
            <button
              type="button"
              className="ops-small-button"
              onClick={() => setNotice(
                updater.error
                  ? `更新エラー: ${updater.error}`
                  : `更新状態: ${updater.state || "idle"}（バージョン ${updater.version || appVersion || "不明"}）`
              )}
            >
              詳細を表示
            </button>
          </div>

          {updater.error && (
            <div className="ops-update-error">
              ⚠ 更新に失敗しています: {updater.error}
            </div>
          )}

          <div className="ops-update-diags">
            <span><small>エラー内容</small><b className={updater.error ? "bad" : "ok"}>{updater.error || "なし"}</b></span>
            <span><small>コード署名</small><b className="warn">なし（未署名の自己ビルド配布）</b></span>
            <span><small>現在のバージョン</small><b className="ok">{appVersion || "確認中…"}</b></span>
            <span><small>最終確認</small><b className="ok">{updater.checkedAt ? fmtShortTime(updater.checkedAt) : "未確認"}</b></span>
          </div>

          <div className="ops-updater-meta">
            <span>リポジトリ: github.com/testakahori/My-game-pack</span>
          </div>

          <div className="ops-update-cta">
            <CreeperSignal />
            <button type="button" className="ops-primary-button ops-primary-button--violet" onClick={checkUpdate}>↻ 更新を確認</button>
            {updater.state === "ready" && (
              <button type="button" className="ops-primary-button ops-primary-button--cyan" onClick={() => api.updaterInstall()}>
                再起動して適用
              </button>
            )}
          </div>
        </OpsPanel>
      </div>

      {notice && <div className="ops-notice">{notice}</div>}

      {showHistory && (
        <OpsPanel className="ops-history-panel">
          <div className="ops-card-topline">
            <h2>イベント履歴</h2>
            <button type="button" className="ops-small-button" onClick={clearHistory}>履歴を消去</button>
          </div>
          <div className="ops-history-table">
            <table>
              <thead>
                <tr><th>時刻</th><th>種別</th><th>送信者</th><th>発動</th><th>回数</th><th>結果</th></tr>
              </thead>
              <tbody>
                {history.length ? history.map((row, index) => (
                  <tr key={`${row.at}-${index}`}>
                    <td>{new Date(row.at).toLocaleString("ja-JP")}</td>
                    <td>{row.type}</td>
                    <td>{row.sender}</td>
                    <td>{row.commandFile}</td>
                    <td>{row.count}</td>
                    <td className={row.ok ? "ok" : "bad"}>{row.ok ? "成功" : row.message || "失敗"}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6}>履歴はまだありません。</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </OpsPanel>
      )}
    </div>
  );
}
