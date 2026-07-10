// src/App.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppPage } from "./types";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./components/DashboardPage";
import GiftSettingsPage from "./components/GiftSettingsPage";
import InitialSetupPage from "./components/InitialSetupPage";
import GiftsViewerPage from "./components/GiftsViewerPage";
import EventSettingsPage from "./components/EventSettingsPage";
import TTSSettingsPage from "./components/TTSSettingsPage";
import OperationsPage from "./components/OperationsPage";
import StatsDashboardPage from "./components/StatsDashboardPage";
import MinecraftBlockIcon from "./components/MinecraftBlockIcon";

const PAGE_TITLE: Partial<Record<AppPage, string>> = {
  [AppPage.DASHBOARD]: "ダッシュボード",
  [AppPage.GIFTS]: "ギフト設定",
  [AppPage.EVENTS]: "イベント設定",
  [AppPage.TTS]: "🔊 読み上げ設定",
  [AppPage.GIFTS_VIEWER]: "ギフト一覧",
  [AppPage.SETUP]: "初期セットアップ",
  [AppPage.OPERATIONS]: "運用センター",
  [AppPage.STATS]: "配信統計",
};

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<AppPage>(AppPage.SETUP);
  const [setupComplete, setSetupComplete] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [clock, setClock] = useState(new Date());
  const [headerStatus, setHeaderStatus] = useState({ bridgeRunning: false, modOnline: false });
  const eventsDirtyRef = useRef(false);
  const contentRef = useRef<HTMLElement>(null);

  // App.tsx はヘッダーのポーリング（bridgeProcessStatus/modStatus/時計）で数秒おきに再レンダリングされる。
  // インラインの onDirtyChange を渡すと毎回新しい関数になり、EventSettingsPage側のuseEffect(load)が
  // それを検知して未保存の編集内容をディスクの内容で上書きしてしまう事故があったため、参照を固定する。
  const handleEventsDirtyChange = useCallback((dirty: boolean) => {
    eventsDirtyRef.current = dirty;
  }, []);

  const navigateTo = (page: AppPage) => {
    if (activePage === AppPage.EVENTS && eventsDirtyRef.current) {
      if (!window.confirm("イベント設定に保存されていない変更があります。\nこのまま移動しますか？")) return;
      eventsDirtyRef.current = false;
    }
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
        if (!cancelled) setHeaderStatus({ bridgeRunning: Boolean(bridge?.running), modOnline: Boolean(mod?.online) });
      } catch { /* ヘッダーの参考表示なので失敗しても無視 */ }
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const handleSetupComplete = () => {
    setSetupComplete(true);
    setActivePage(AppPage.DASHBOARD);
  };

  const handleResetSetup = async () => {
    const api = (window as any).mygamepack;
    try {
      await api.appConfigWrite({ setupComplete: false, serverFolder: "" });
    } catch { /* ignore */ }
    setSetupComplete(false);
    setActivePage(AppPage.SETUP);
  };

  if (!configLoaded) {
    return (
      <div className="flex h-screen bg-gray-900 items-center justify-center text-gray-400 text-sm">
        読み込み中…
      </div>
    );
  }

  return (
    <div className="app-shell flex h-screen flex-col bg-gray-900 text-gray-100 overflow-hidden">
      <header className="global-app-header">
        <div className="global-app-identity">
          <div className="global-app-cube"><MinecraftBlockIcon /></div>
          <div><b>MC TikTok Bridge（統合UI）</b><small>{appVersion ? `v${appVersion}` : ""}</small></div>
        </div>
        <div className="global-app-status">
          <span><i className={`status-dot ${headerStatus.bridgeRunning ? "status-dot--ok" : "status-dot--warn"}`} />システム状態: <b>{headerStatus.bridgeRunning ? "正常" : "Bridge停止中"}</b></span>
          <span>⌁ 接続: <b>{headerStatus.modOnline ? "オンライン" : "オフライン"}</b></span>
          <span>⬡ Bridge: <b>{headerStatus.bridgeRunning ? "監視中" : "停止中"}</b></span>
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
          <header className="app-topbar" aria-hidden="true">
            <div className="app-topbar-title">{PAGE_TITLE[activePage]}</div>
          </header>

          <main ref={contentRef} className="app-content flex-1 overflow-y-auto">
          {activePage === AppPage.DASHBOARD && (
            <div className="page-pad p-6">
              <DashboardPage />
            </div>
          )}

          {/* GiftSettingsPage は独自に Header（タブ）を持つため p-0 */}
          {activePage === AppPage.GIFTS && <GiftSettingsPage />}

          {activePage === AppPage.EVENTS && (
            <div className="page-pad p-6">
              <EventSettingsPage onDirtyChange={handleEventsDirtyChange} />
            </div>
          )}

          {activePage === AppPage.TTS && (
            <div className="page-pad p-6">
              <TTSSettingsPage />
            </div>
          )}
          {activePage === AppPage.OPERATIONS && (
            <div className="page-pad p-6"><OperationsPage /></div>
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

          {/* GiftsViewerPage は自身でスクロール管理するため h-full */}
          {activePage === AppPage.GIFTS_VIEWER && (
            <div className="h-full">
              <GiftsViewerPage />
            </div>
          )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default App;
