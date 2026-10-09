import React, { useCallback, useEffect, useMemo, useState } from "react";
import EventTestPanel from "./EventTestPanel";
import WorldSavesPanel from "./WorldSavesPanel";
import SettingsBackupsPanel from "./SettingsBackupsPanel";
import ListInput from "./ListInput";
import { COMMA_ONLY } from "../lib/listInput";
import { useUnsavedChanges, useUnsavedGuard } from "../UnsavedChanges";

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
  if (!value) return "未設定";
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

export default function OperationsPage({ onRestored }: { onRestored: () => void }) {
  const { hasChanges } = useUnsavedGuard();
  const api = (window as any).mygamepack;
  const [status, setStatus] = useState<ModStatus>(defaultStatus);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [notice, setNotice] = useState("");
  const [cfg, setCfg] = useState<any>({});
  const [appCfg, setAppCfg] = useState<any>({});
  const [serverProps, setServerProps] = useState<Record<string, string>>({});
  const [stats, setStats] = useState<Stats>(defaultStats);
  const [gameplayText, setGameplayText] = useState("{}");
  const [bridgeProcess, setBridgeProcess] = useState<any>({ running: false, restartCount: 0 });
  const [bridgeSync, setBridgeSync] = useState<any>({ state: "idle" });
  const [opsTab, setOpsTab] = useState("map");
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(new Date());
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const currentSnapshot = JSON.stringify({ options: cfg.options || {}, gameplayText });
  useUnsavedChanges(Boolean(savedSnapshot) && currentSnapshot !== savedSnapshot, saving);

  useEffect(() => {
    api.appVersion?.().then((v: string) => setAppVersion(v)).catch(() => {});
  }, [api]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    const [s, h, st, bp, bs] = await Promise.allSettled([
      api.modStatus(),
      api.operationsHistory(),
      api.operationsStats(),
      api.bridgeProcessStatus(),
      api.bridgeSyncStatus ? api.bridgeSyncStatus() : Promise.resolve({ state: "unknown" }),
    ]);

    if (s.status === "fulfilled") setStatus({ ...defaultStatus, ...(s.value || {}) });
    if (h.status === "fulfilled") setHistory(Array.isArray(h.value) ? h.value : []);
    if (st.status === "fulfilled") setStats({ ...defaultStats, ...(st.value || {}) });
    if (bp.status === "fulfilled") setBridgeProcess(bp.value || { running: false, restartCount: 0 });
    if (bs.status === "fulfilled") setBridgeSync(bs.value || { state: "unknown" });
  }, [api]);

  useEffect(() => {
    let cancelled = false;

    Promise.allSettled([
      api.configRead(),
      api.appConfigRead(),
      api.serverPropsRead ? api.serverPropsRead() : Promise.resolve({}),
    ]).then(([config, appConfig, props]) => {
      if (cancelled) return;
      const bridgeConfig = config.status === "fulfilled" ? config.value || {} : {};
      const appConfigValue = appConfig.status === "fulfilled" ? appConfig.value || {} : {};
      const propsValue = props.status === "fulfilled" ? props.value || {} : {};

      setCfg(bridgeConfig);
      setAppCfg(appConfigValue);
      setServerProps(propsValue);
      setGameplayText(JSON.stringify(bridgeConfig?.options?.gameplay || {}, null, 2));
      if (config.status === "fulfilled" && appConfig.status === "fulfilled") setSavedSnapshot(JSON.stringify({ options: bridgeConfig.options || {}, gameplayText: JSON.stringify(bridgeConfig?.options?.gameplay || {}, null, 2) }));
    });

    refresh();
    const id = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, refresh]);


  const o = cfg.options || {};
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

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const gameplay = JSON.parse(gameplayText);
      const latest = await api.configRead();
      const next = { ...latest, options: { ...(latest.options || {}), ...(cfg.options || {}), gameplay } };
      const validation = await api.configValidate(next);
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      await api.configWrite(next);
      setSavedSnapshot(currentSnapshot);
      setLastSavedAt(new Date().toISOString());
      setNotice(validation.warnings?.length ? `保存しました: ${validation.warnings.join(" / ")}` : "運用設定を保存しました");
      await refresh();
    } catch (error: any) {
      setNotice(`保存失敗: ${error?.message || String(error)}`);
    } finally { setSaving(false); }
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
          <h1>運用センター</h1>
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
              <h2>接続状況</h2>
              <p>2秒ごとに /bridge/status を確認</p>
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

          <p className="studio-monitor-note">{status.online ? "サーバーとModが応答しています。下のテストでイベントの発火を確認できます。" : "サーバーを起動すると、接続状態とコマンドの実行状況をここで確認できます。"}</p>

          <div className="ops-monitor-bottom">
            <span>最終イベント: {latestAt ? fmtShortTime(latestAt) : "なし"}</span>
            <span>2秒ごとに接続を確認</span>
          </div>
        </div>

        <CreeperSignal />
      </OpsPanel>

      <nav className="studio-ops-tabs" aria-label="運用センターのメニュー">{[["map", "MAPセーブ・ロード"], ["test", "イベントテスト"], ["safety", "動作設定"], ["maintenance", "設定復元・更新"], ["advanced", "詳細設定"]].map(([id, label]) => <button key={id} aria-pressed={opsTab === id} onClick={() => setOpsTab(id)}>{label}</button>)}{hasChanges && <button className="studio-ops-save" disabled={saving} onClick={save}>変更を保存</button>}</nav>
      <div hidden={opsTab !== "map"}><WorldSavesPanel active={opsTab === "map"} /></div>
      <div hidden={opsTab !== "test"}><EventTestPanel onTested={refresh} /></div>
      <div className="ops-main-grid" hidden={opsTab !== "safety"}>

        <OpsPanel className="ops-stability-card">
          <div className="ops-panel-heading">
            <span className="ops-panel-icon ops-panel-icon--shield">🛡</span>
            <div>
              <h2>安定運用・荒らし対策</h2>
              <p>連打・読み上げの動作を調整します。</p>
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
              {/* ニックネームでもミュートするので、読点の入った名前（例：ゆき、だよ）を分けないよう半角カンマだけで区切る */}
              <FieldLabel label="ミュートユーザー（半角カンマ区切り）">
                <ListInput values={o.mutedUsers || []} separators={COMMA_ONLY} onChange={(values) => setOption("mutedUsers", values)} placeholder="例）baduser1, baduser2" />
              </FieldLabel>
              <FieldLabel label="TTS NGワード（カンマ区切り）">
                <ListInput values={o.ttsNgWords || []} onChange={(values) => setOption("ttsNgWords", values)} placeholder="例）暴言, URL, 宣伝" />
              </FieldLabel>
              <button type="button" className="ops-primary-button ops-primary-button--violet" disabled={saving} onClick={save}>動作設定を保存</button>
            </div>
          </div>
        </OpsPanel>
      </div>

      <div className="ops-bottom-grid">
        <div hidden={opsTab !== "advanced"}><OpsPanel className="ops-json-card">
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

        </div>
        <div hidden={opsTab !== "maintenance"}><SettingsBackupsPanel onRestored={onRestored} /><OpsPanel className="ops-update-card">
          <div className="ops-card-topline">
            <div>
              <h2>アプリのバージョン・更新方法</h2>
              <p>最新版は配布者から受け取ってください。</p>
            </div>
          </div>
          <div className="ops-update-diags">
            <span><small>現在のバージョン</small><b className="ok">{appVersion || "確認中…"}</b></span>
            <span><small>更新方法</small><b>配布されたインストーラーで更新</b></span>
          </div>
          <ol>
            <li>設定を保存し、BRIDGE・サーバー・Minecraftを停止します。</li>
            <li>このアプリを終了し、配布者から受け取った最新版のインストーラーを実行します。</li>
            <li>現在と同じインストール先を選び、完了後にアプリを起動します。</li>
          </ol>
          <p>アプリをアンインストールする必要はありません。設定とMAPはそのまま引き継ぎます。</p>
        </OpsPanel>
      </div>

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
