// src/components/Sidebar.tsx
import React, { useEffect, useState } from "react";
import { AppPage } from "../types";

type Props = {
  activePage: AppPage;
  setActivePage: (p: AppPage) => void;
  setupComplete: boolean;
};

// セットアップ完了前はロックするページ
const LOCKED_PAGES: AppPage[] = [
  AppPage.DASHBOARD,
  AppPage.GIFTS,
  AppPage.EVENTS,
  AppPage.TTS,
  AppPage.GIFTS_VIEWER,
  AppPage.OPERATIONS,
  AppPage.STATS,
];

type NavItem = {
  page: AppPage;
  label: string;
  sub: string;
  icon: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    page: AppPage.DASHBOARD,
    label: "ダッシュボード",
    sub: "起動・停止",
    icon: "⚡",
  },
  {
    page: AppPage.GIFTS,
    label: "ギフト設定",
    sub: "BRIDGE 設定 UI",
    icon: "🎁",
  },
  {
    page: AppPage.EVENTS,
    label: "イベント設定",
    sub: "いいね・シェア・訪問",
    icon: "🎯",
  },
  {
    page: AppPage.TTS,
    label: "読み上げ設定",
    sub: "VOICEVOX / AivisSpeech",
    icon: "🔊",
  },
  {
    page: AppPage.GIFTS_VIEWER,
    label: "ギフト一覧",
    sub: "TikTok Gifts",
    icon: "🎀",
  },
  {
    page: AppPage.OPERATIONS,
    label: "運用センター",
    sub: "監視・テスト・安全設定",
    icon: "🛡️",
  },
  {
    page: AppPage.STATS,
    label: "配信統計",
    sub: "配信ごとの集計",
    icon: "📊",
  },
  {
    page: AppPage.SETUP,
    label: "初期セットアップ",
    sub: "setup.bat",
    icon: "🔧",
  },
];

const NavGlyph: React.FC<{ page: AppPage }> = ({ page }) => {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Partial<Record<AppPage, React.ReactNode>> = {
    [AppPage.DASHBOARD]: <><path {...common} d="M3 11.5 12 4l9 7.5" /><path {...common} d="M5.5 10v9h13v-9M9 19v-6h6v6" /></>,
    [AppPage.GIFTS]: <><path {...common} d="M4 9h16v11H4zM3 6h18v4H3zM12 6v14" /><path {...common} d="M12 6c-4 0-5-5-1-4 2 .5 1 4 1 4Zm0 0c4 0 5-5 1-4-2 .5-1 4-1 4Z" /></>,
    [AppPage.EVENTS]: <><circle {...common} cx="12" cy="12" r="8" /><circle {...common} cx="12" cy="12" r="4" /><path {...common} d="m12 12 7-7M16 5h3v3" /></>,
    [AppPage.TTS]: <><path {...common} d="M4 10v4h4l5 4V6L8 10H4Z" /><path {...common} d="M16 9c1 2 1 4 0 6M19 6c3 4 3 8 0 12" /></>,
    [AppPage.GIFTS_VIEWER]: <><path {...common} d="M7 4c3 0 5 3 5 7-4 0-7-2-7-5 0-1 1-2 2-2ZM17 4c-3 0-5 3-5 7 4 0 7-2 7-5 0-1-1-2-2-2Z" /><path {...common} d="M12 11v10M12 14l-4 5M12 14l4 5" /></>,
    [AppPage.OPERATIONS]: <><path {...common} d="M12 3 4.5 6v5c0 5 3 8 7.5 10 4.5-2 7.5-5 7.5-10V6L12 3Z" /><path {...common} d="m8.5 12 2.2 2.2 4.8-5" /></>,
    [AppPage.STATS]: <><path {...common} d="M5 20V11h3v9M11 20V5h3v15M17 20v-7h3v7M3 20h19" /></>,
    [AppPage.SETUP]: <><path {...common} d="M14.7 6.3a4 4 0 0 0-5-5l2.1 2.1-3 3-2.1-2.1a4 4 0 0 0 5 5l7 7a2 2 0 0 1-3 3l-7-7a4 4 0 0 0-5-5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[page]}</svg>;
};

const Sidebar: React.FC<Props> = ({ activePage, setActivePage, setupComplete }) => {
  const [bridgeStatus, setBridgeStatus] = useState<{ running?: boolean; cpuPercent?: number | null; memMb?: number | null }>({});

  useEffect(() => {
    if (!setupComplete) return;
    let disposed = false;
    const api = (window as any).mygamepack;
    const refresh = async () => {
      try {
        const status = await api?.bridgeProcessStatus?.();
        if (!disposed) setBridgeStatus(status || {});
      } catch {
        if (!disposed) setBridgeStatus({});
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [setupComplete]);

  const cpuText = typeof bridgeStatus.cpuPercent === "number" ? `${bridgeStatus.cpuPercent}%` : "—";
  const memText = typeof bridgeStatus.memMb === "number" ? `${bridgeStatus.memMb}MB` : "—";

  return (
    <aside className="app-sidebar w-56 shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col">
      {/* ブランド */}
      <div className="sidebar-brand px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="sidebar-logo w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shrink-0">
            <span className="text-white font-black text-xs">MC</span>
          </div>
          <div>
            <div className="text-white font-black text-sm leading-tight">MyGamePack</div>
            <div className="text-gray-500 text-[10px]">Manager</div>
          </div>
        </div>
      </div>

      {/* ナビ */}
      <nav className="sidebar-nav flex-1 py-3 px-2 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activePage === item.page;
          const isLocked = !setupComplete && LOCKED_PAGES.includes(item.page);
          return (
            <button
              key={item.page}
              type="button"
              onClick={() => !isLocked && setActivePage(item.page)}
              disabled={isLocked}
              title={isLocked ? "初期セットアップを完了してください" : undefined}
              className={[
                "sidebar-nav-item w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3",
                "focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
                isLocked
                  ? "opacity-40 cursor-not-allowed border border-transparent text-gray-600"
                  : isActive
                  ? "bg-cyan-600/20 border border-cyan-500/40 text-cyan-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-100 border border-transparent",
              ].join(" ")}
            >
              <span className={`sidebar-nav-icon text-lg leading-none shrink-0 ${isLocked ? "grayscale" : ""}`}>
                <NavGlyph page={item.page} />
              </span>
              <div className="min-w-0">
                <div className={`text-sm font-bold leading-tight truncate ${isActive && !isLocked ? "text-cyan-300" : ""}`}>
                  {item.label}
                </div>
                <div className="text-[10px] text-gray-500 truncate mt-0.5">{item.sub}</div>
              </div>
              {isLocked ? (
                <span className="ml-auto text-[11px] shrink-0">🔒</span>
              ) : isActive ? (
                <div className="ml-auto w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* セットアップ未完了バナー */}
      {!setupComplete && (
        <div className="mx-2 mb-2 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-600/30 text-[10px] text-amber-400 leading-snug">
          初期セットアップを完了すると他の機能が使えます
        </div>
      )}

      {setupComplete && (
        <div className={`sidebar-runtime-card ${bridgeStatus.running ? "is-running" : "is-stopped"}`}>
          <div className="sidebar-runtime-title">Bridge プロセス</div>
          <div className="sidebar-runtime-state"><span /> {bridgeStatus.running ? "稼働中" : "停止中"}</div>
          <div className="sidebar-runtime-wave" aria-hidden="true" />
          <div className="sidebar-runtime-meters"><span>CPU <b>{cpuText}</b></span><span>MEM <b>{memText}</b></span></div>
        </div>
      )}

      {/* フッター */}
      <div className="px-4 py-3 border-t border-gray-800 text-[10px] text-gray-600">
        © 2026 Douma Akahori
      </div>
    </aside>
  );
};

export default Sidebar;
