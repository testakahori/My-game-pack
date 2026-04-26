// src/components/Sidebar.tsx
import React from "react";
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
    page: AppPage.SETUP,
    label: "初期セットアップ",
    sub: "setup.bat",
    icon: "🔧",
  },
];

const Sidebar: React.FC<Props> = ({ activePage, setActivePage, setupComplete }) => {
  return (
    <aside className="w-56 shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col">
      {/* ブランド */}
      <div className="px-5 py-5 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shrink-0">
            <span className="text-white font-black text-xs">MC</span>
          </div>
          <div>
            <div className="text-white font-black text-sm leading-tight">MyGamePack</div>
            <div className="text-gray-500 text-[10px]">Manager</div>
          </div>
        </div>
      </div>

      {/* ナビ */}
      <nav className="flex-1 py-3 px-2 space-y-1">
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
                "w-full text-left px-3 py-3 rounded-xl transition-all flex items-center gap-3",
                "focus:outline-none focus:ring-2 focus:ring-cyan-500/50",
                isLocked
                  ? "opacity-40 cursor-not-allowed border border-transparent text-gray-600"
                  : isActive
                  ? "bg-cyan-600/20 border border-cyan-500/40 text-cyan-300"
                  : "text-gray-400 hover:bg-gray-800 hover:text-gray-100 border border-transparent",
              ].join(" ")}
            >
              <span className={`text-lg leading-none shrink-0 ${isLocked ? "grayscale" : ""}`}>
                {item.icon}
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

      {/* フッター */}
      <div className="px-4 py-3 border-t border-gray-800 text-[10px] text-gray-600">
        © 2026 Douma Akahori
      </div>
    </aside>
  );
};

export default Sidebar;
