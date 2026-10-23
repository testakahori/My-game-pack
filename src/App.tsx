// src/App.tsx
import React, { useEffect, useRef, useState } from "react";
import { AppPage } from "./types";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./components/DashboardPage";
import GiftSettingsPage from "./components/GiftSettingsPage";
import ImageEditorPage from "./components/ImageEditorPage";
import InitialSetupPage from "./components/InitialSetupPage";
import GiftsViewerPage from "./components/GiftsViewerPage";
import CommandsListPage from "./components/CommandsListPage";
import EventSettingsPage from "./components/EventSettingsPage";
import EventSettings2Page from "./components/EventSettings2Page";
import TTSSettingsPage from "./components/TTSSettingsPage";
import OperationsPage from "./components/OperationsPage";
import StatsDashboardPage from "./components/StatsDashboardPage";
import MinecraftBlockIcon from "./components/MinecraftBlockIcon";
import LoginPage from "./components/LoginPage";
import GameSelector from './components/GameSelector';
import StopPanel from "./components/StopPanel";
import { pauseView, pauseBannerText, setDisruptionPause, type PauseView } from "./lib/disruptionPause";
import type { GameStatus } from './types/electron';
import { UnsavedChangesProvider, useUnsavedGuard } from "./UnsavedChanges";
import { readAuthState } from "./lib/authState";

const PAGE_TITLE: Partial<Record<AppPage, string>> = {
  [AppPage.DASHBOARD]: "配信ホーム",
  [AppPage.GIFTS]: "ギフト設定",
  [AppPage.EVENTS]: "いいね・フォロー",
  [AppPage.EVENTS2]: "ルーレット・コメント",
  [AppPage.TTS]: "読み上げ",
  [AppPage.IMAGE_EDITOR]: "配信画像",
  [AppPage.GIFTS_VIEWER]: "ギフト一覧",
  [AppPage.COMMANDS]: "コマンド一覧",
  [AppPage.SETUP]: "初期セットアップ",
  [AppPage.OPERATIONS]: "運用センター",
  [AppPage.STATS]: "配信統計",
};

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<AppPage>(AppPage.SETUP);
  const [setupComplete, setSetupComplete] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  // 認証状態: checking=起動時確認中 / authed=ログイン済み / unauthed=ログイン画面を表示
  const [authState, setAuthState] = useState<"checking" | "authed" | "unauthed">("checking");
  const [appVersion, setAppVersion] = useState("");
  const [clock, setClock] = useState(new Date());
  const [headerStatus, setHeaderStatus] = useState({ bridgeRunning: false, modOnline: false, modAuthFailed: false });
  // 妨害の一時停止（2026-10-16）。止めている間は、どのページにも帯を出す。
  const [disruption, setDisruption] = useState<PauseView>(() => pauseView(null));
  const [pauseError, setPauseError] = useState("");
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const { confirmDiscard, hasChanges } = useUnsavedGuard();
  const [settingsRevision, setSettingsRevision] = useState(0);
  const contentRef = useRef<HTMLElement>(null);
  const [gameStatus, setGameStatus] = useState<GameStatus | null>(null);
  const [gameLoading, setGameLoading] = useState(true);
  const gameReady = Boolean(gameStatus?.applied && !gameStatus.recoveryRequired);
  const gameSettingsPage = [AppPage.GIFTS, AppPage.EVENTS, AppPage.EVENTS2, AppPage.COMMANDS].includes(activePage);

  useEffect(() => {
    let disposed = false;
    setGameLoading(true);
    setGameStatus(null);
    window.mygamepack?.gamesList?.().then(next => { if (!disposed) setGameStatus(next); })
      .catch(() => { if (!disposed) setGameStatus(null); })
      .finally(() => { if (!disposed) setGameLoading(false); });
    return () => { disposed = true; };
  }, [setupComplete, settingsRevision]);

  const navigateTo = (page: AppPage) => {
    if (page === activePage || !confirmDiscard()) return;
    setActivePage(page);
  };

  useEffect(() => {
    const api = (window as any).mygamepack;
    (async () => {
      try {
        const cfg = await api.appConfigRead();
        if (cfg?.setupComplete === true) {
          // 保存済み「完了」を実際のフォルダで検証
          try {
            const result = await api.serverCheckSetupComplete();
            if (result.complete) {
              setSetupComplete(true);
              setActivePage(AppPage.DASHBOARD);
            } else {
              // ファイルが存在しない → リセット
              await api.appConfigWrite({ setupComplete: false });
              setSetupComplete(false);
            }
          } catch {
            setSetupComplete(false);
          }
        }
      } catch {
        /* 設定なし = 初回 */
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activePage]);

  useEffect(() => {
    const api = (window as any).mygamepack;
    api?.appVersion?.().then((v: string) => setAppVersion(v)).catch(() => {});
  }, []);

  useEffect(() => {
    const api = (window as any).mygamepack;
    // 確かめられないとき（失敗・窓口が無い）はログイン画面を出す（2026-10-23 設計書の 7）。
    (async () => { setAuthState(await readAuthState(api)); })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const api = (window as any).mygamepack;
    let cancelled = false;
    const poll = async () => {
      try {
        const [bridge, mod] = await Promise.all([
          api?.bridgeProcessStatus ? api.bridgeProcessStatus() : Promise.resolve({ running: false }),
          api?.modStatus ? api.modStatus() : Promise.resolve({ online: false }),
        ]);
        if (!cancelled) setHeaderStatus({ bridgeRunning: Boolean(bridge?.running), modOnline: Boolean(mod?.online), modAuthFailed: mod?.authFailed === true });
        if (!cancelled) setDisruption(pauseView(mod));
      } catch { /* ヘッダーの参考表示なので失敗しても無視 */ }
    };
    pollRef.current = poll;
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // 一時停止・再開（2026-10-16）。出どころは配信ホームと帯で分けて記録する。
  // 切り替えたあとは5秒待たずに読み直す。失敗したら理由を出す（止めたことにしない）。
  const changeDisruptionPause = async (pause: boolean): Promise<string | null> => {
    const api = (window as any).mygamepack;
    const result = await setDisruptionPause(api, pause, pause ? "home:pause" : "home:resume");
    await pollRef.current();
    return result.ok ? null : result.message || "一時停止を切り替えられませんでした。";
  };
  const resumeFromBanner = async () => {
    const api = (window as any).mygamepack;
    const result = await setDisruptionPause(api, false, "banner:resume");
    setPauseError(result.ok ? "" : result.message || "再開できませんでした。");
    await pollRef.current();
  };

  const handleSetupComplete = () => {
    setSetupComplete(true);
    setActivePage(AppPage.DASHBOARD);
  };

  const handleResetSetup = async () => {
    const api = (window as any).mygamepack;
    try {
      await api.appConfigWrite({ setupComplete: false });
    } catch { /* ignore */ }
    setSetupComplete(false);
    setActivePage(AppPage.SETUP);
  };

  if (!configLoaded || authState === "checking") {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center text-gray-400 text-sm">
        読み込み中…
      </div>
    );
  }

  if (authState === "unauthed") {
    return <LoginPage onLoginSuccess={() => setAuthState("authed")} />;
  }

  return (
    <div className="app-shell ui-refresh flex h-screen flex-col bg-gray-900 text-gray-100 overflow-hidden">
      <header className="global-app-header">
        <div className="global-app-identity">
          <div className="global-app-cube"><MinecraftBlockIcon /></div>
          <div><b>MyGamePack <em className="global-app-edition">BRIDGE</em></b><small>{appVersion ? `v${appVersion}` : ""}</small></div>
        </div>
        <div className="global-app-status">
          <span title={headerStatus.modAuthFailed ? "BridgeMODは応答していますが、認証に失敗しています。Minecraftサーバーを起動し直すと直ります。" : undefined}><i className={`status-dot ${headerStatus.modOnline ? "status-dot--ok" : "status-dot--warn"}`} />Minecraft <b>{headerStatus.modOnline ? "接続済み" : headerStatus.modAuthFailed ? "認証エラー" : "未接続"}</b></span>
          <span>BRIDGE <b>{headerStatus.bridgeRunning ? "稼働中" : "停止中"}</b></span>
          <time>{clock.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}</time>
        </div>
        <div className="global-window-controls">
          <button type="button" aria-label="最小化" onClick={() => (window as any).mygamepack?.windowMinimize?.()}>―</button>
          <button type="button" aria-label="最大化" onClick={() => (window as any).mygamepack?.windowMaximizeToggle?.()}>□</button>
          <button type="button" aria-label="閉じる" onClick={() => (window as any).mygamepack?.windowClose?.()}>×</button>
        </div>
      </header>

      <div className="app-workspace flex flex-1 min-h-0 overflow-hidden">
        <Sidebar
          activePage={activePage}
          setActivePage={navigateTo}
          setupComplete={setupComplete}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="app-topbar">
            <div className="app-topbar-title">{PAGE_TITLE[activePage]}</div>

          </header>

          {hasChanges && <div className="unsaved-banner" role="status">未保存の変更があります。保存してから画面を移動してください。</div>}
          {disruption.paused && <div className="pause-banner" role="status">
            <span>{pauseBannerText(disruption)}</span>
            <button type="button" onClick={resumeFromBanner}>▶ 再開</button>
            {pauseError && <em role="alert">{pauseError}</em>}
          </div>}
          <main id="main-content" tabIndex={-1} aria-label={PAGE_TITLE[activePage]} key={settingsRevision} ref={contentRef} className="app-content flex-1 overflow-y-auto">
          {gameSettingsPage && gameReady && <div className="current-game-label">プレイ中のゲーム：<strong>{gameStatus?.games.find(game => game.id === gameStatus.active)?.name}</strong><span>変更はTOPから</span></div>}
          {setupComplete && activePage === AppPage.DASHBOARD && <GameSelector onStatus={setGameStatus} onChanged={() => setSettingsRevision(value => value + 1)} />}
          {gameSettingsPage && !gameReady && <section className="game-required" role="status">
            <h2>{gameLoading ? "ゲームの保存状態を確認しています…" : "配信ホームでゲームを選んで保存してください"}</h2>
            {!gameLoading && <><p>{gameStatus?.recoveryRequired ? "前回のゲーム切替を復旧してから設定を続けてください。" : "ゲームを保存すると、そのゲームで使えるコマンドをギフト・ルーレット・デスルーレット・いいね・シェア・訪問・未設定ギフトなどに設定できます。"}</p>
            {activePage !== AppPage.DASHBOARD && <button type="button" onClick={() => navigateTo(AppPage.DASHBOARD)}>配信ホームへ戻る</button>}</>}
            {/* 操作盤を出せない間も止められるようにする（ゲームの保存・復旧は停止中に行うため） */}
            {setupComplete && <StopPanel />}
          </section>}
          {activePage === AppPage.DASHBOARD && (
            <div className="page-pad p-6">
              <DashboardPage onNavigate={navigateTo} disruption={disruption} onDisruptionPause={changeDisruptionPause} startReady={gameReady} />
            </div>
          )}

          {/* GiftSettingsPage は独自に Header（タブ）を持つため p-0 */}
          {activePage === AppPage.GIFTS && gameReady && <GiftSettingsPage onOpenImageEditor={() => navigateTo(AppPage.IMAGE_EDITOR)} />}
          {activePage === AppPage.IMAGE_EDITOR && <div className="page-pad p-6"><ImageEditorPage /></div>}

          {activePage === AppPage.EVENTS && gameReady && (
            <div className="page-pad p-6">
              <EventSettingsPage />
            </div>
          )}

          {activePage === AppPage.EVENTS2 && gameReady && (
            <div className="page-pad p-6">
              <EventSettings2Page />
            </div>
          )}

          {activePage === AppPage.TTS && (
            <div className="page-pad p-6">
              <TTSSettingsPage />
            </div>
          )}
          {activePage === AppPage.OPERATIONS && (
            <div className="page-pad p-6"><OperationsPage onRestored={() => { setSettingsRevision(value => value + 1); window.alert("設定を復元しました。復元前の設定もバックアップから戻せます。"); }} /></div>
          )}
          {activePage === AppPage.STATS && (
            <div className="page-pad p-6"><StatsDashboardPage /></div>
          )}

          {activePage === AppPage.SETUP && (
            <div className="page-pad p-6">
              <InitialSetupPage
                setupComplete={setupComplete}
                onSetupComplete={handleSetupComplete}
                onResetSetup={handleResetSetup}
              />
            </div>
          )}

          {activePage === AppPage.COMMANDS && gameReady && (
            <div className="page-pad p-6">
              <CommandsListPage />
            </div>
          )}

          {/* GiftsViewerPage は自身でスクロール管理するため h-full */}
          {activePage === AppPage.GIFTS_VIEWER && (
            <div className="h-full">
              <GiftsViewerPage bridgeRunning={headerStatus.bridgeRunning} modOnline={headerStatus.modOnline} />
            </div>
          )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default function GuardedApp() { return <UnsavedChangesProvider><App /></UnsavedChangesProvider>; }
