import React from "react";
import { AppTab } from "../types";
type Props = { activeTab: AppTab; setActiveTab: (tab: AppTab) => void; subtitle?: string };
export default function Header({ activeTab, setActiveTab }: Props) {
  return <header className="studio-gift-header">
    <div><span className="studio-eyebrow">GIFT ACTIONS</span><h1>ギフト設定</h1><p>ギフトを選んで、Minecraftで起こることを決めよう。</p></div>
    <nav className="studio-subnav" aria-label="ギフト設定のメニュー">
      <button aria-current={activeTab === AppTab.MAPPINGS ? "page" : undefined} onClick={() => setActiveTab(AppTab.MAPPINGS)}><i className="fa-solid fa-gift" />ギフトの割り当て</button>
      <button aria-current={activeTab === AppTab.COMMAND_SETS ? "page" : undefined} onClick={() => setActiveTab(AppTab.COMMAND_SETS)}><i className="fa-solid fa-terminal" />コマンド編集</button>
      <button className="studio-subnav-link" onClick={() => setActiveTab(AppTab.IMAGE_EDITOR)}><i className="fa-regular fa-image" />配信画像を作る<i className="fa-solid fa-arrow-up-right-from-square" /></button>
    </nav>
  </header>;
}
