// src/components/Header.tsx
import React from "react";
import { AppTab } from "../types";

type Props = {
  activeTab: AppTab;
  setActiveTab: (t: AppTab) => void;

  // ※ もし subtitle を表示してるなら App.tsx から渡してるはずなので残す
  subtitle?: string;
};

const Header: React.FC<Props> = ({ activeTab, setActiveTab, subtitle }) => {
  const tabBtn = (tab: AppTab, label: string, icon: string) => {
    const isActive = activeTab === tab;

    return (
      <button
        type="button"
        onClick={() => setActiveTab(tab)}
        aria-current={isActive ? "page" : undefined}
        className={[
          "px-4 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2",
          "focus:outline-none focus:ring-2 focus:ring-cyan-500/60",
          isActive
            ? "bg-cyan-600 text-white shadow-lg"
            : "bg-gray-800 text-gray-200 hover:bg-gray-700 border border-gray-700",
        ].join(" ")}
      >
        <i className={icon}></i>
        {label}
      </button>
    );
  };

  return (
    <header className="bg-gray-900/60 backdrop-blur border-b border-gray-800 sticky top-0 z-50">
      <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
        {/* Left brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-600 to-blue-600 flex items-center justify-center shadow-lg shrink-0">
            <span className="text-white font-black">MC</span>
          </div>
          <div className="min-w-0">
            <div className="text-white font-black leading-tight truncate">MC TikTok Bridge（統合UI）</div>
            <div className="text-[11px] text-gray-400 truncate">{subtitle ?? "Minecraft / 7DTD を1画面で切り替え"}</div>
          </div>
        </div>

        {/* Center nav */}
        <nav className="flex items-center gap-2 flex-wrap justify-center">
          {tabBtn(AppTab.COMMAND_SETS, "コマンド設定", "fa-solid fa-file-lines")}
          {tabBtn(AppTab.MAPPINGS, "ギフト設定", "fa-solid fa-gift")}
          {tabBtn(AppTab.IMAGE_EDITOR, "画像編集", "fa-solid fa-image")}
        </nav>

        {/* Right spacer（右のボタン群は消したので余白だけ） */}
        <div className="w-10" />
      </div>
    </header>
  );
};

export default Header;