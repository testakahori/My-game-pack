// src/App.tsx
import React, { useEffect, useRef, useState } from "react";
import { AppPage } from "./types";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./components/DashboardPage";
import GiftSettingsPage from "./components/GiftSettingsPage";
import InitialSetupPage from "./components/InitialSetupPage";
import GiftsViewerPage from "./components/GiftsViewerPage";
import EventSettingsPage from "./components/EventSettingsPage";
import TTSSettingsPage from "./components/TTSSettingsPage";

const PAGE_TITLE: Partial<Record<AppPage, string>> = {
  [AppPage.DASHBOARD]: "ダッシュボード",
  [AppPage.GIFTS]: "ギフト設定",
  [AppPage.EVENTS]: "イベント設定",
  [AppPage.TTS]: "🔊 読み上げ設定",
  [AppPage.GIFTS_VIEWER]: "ギフト一覧",
  [AppPage.SETUP]: "初期セットアップ",
};

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<AppPage>(AppPage.SETUP);
  const [setupComplete, setSetupComplete] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const eventsDirtyRef = useRef(false);

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
    <div className="flex h-screen bg-gray-900 text-gray-100 overflow-hidden">
      {/* 左サイドバー */}
      <Sidebar
        activePage={activePage}
        setActivePage={navigateTo}
        setupComplete={setupComplete}
      />

      {/* 右コンテンツ */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* ページタイトルバー */}
        <header className="bg-gray-800/60 border-b border-gray-700 px-6 py-3 flex items-center gap-3 shrink-0">
          <div className="text-sm font-bold text-gray-200">{PAGE_TITLE[activePage]}</div>
          <div className="ml-auto text-[11px] text-gray-500">MyGamePack Manager</div>
        </header>

        {/* ページコンテンツ */}
        <main className="flex-1 overflow-y-auto">
          {activePage === AppPage.DASHBOARD && (
            <div className="p-6">
              <DashboardPage />
            </div>
          )}

          {/* GiftSettingsPage は独自に Header（タブ）を持つため p-0 */}
          {activePage === AppPage.GIFTS && <GiftSettingsPage />}

          {activePage === AppPage.EVENTS && (
            <div className="p-6">
              <EventSettingsPage onDirtyChange={(d) => { eventsDirtyRef.current = d; }} />
            </div>
          )}

          {activePage === AppPage.TTS && (
            <div className="p-6">
              <TTSSettingsPage />
            </div>
          )}

          {activePage === AppPage.SETUP && (
            <div className="p-6">
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
  );
};

export default App;
