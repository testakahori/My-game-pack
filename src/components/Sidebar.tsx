import React from "react";
import { AppPage } from "../types";
const GROUPS = [
  { label: "配信", items: [
    [AppPage.DASHBOARD, "配信ホーム", "house"], [AppPage.STATS, "配信統計", "chart-simple"],
  ] },
  { label: "配信づくり", items: [
    [AppPage.GIFTS, "ギフト設定", "gift"], [AppPage.EVENTS, "いいね・フォロー", "heart"],
    [AppPage.EVENTS2, "ルーレット・コメント", "bullseye"], [AppPage.TTS, "読み上げ", "volume-high"],
    [AppPage.IMAGE_EDITOR, "配信画像", "layer-group"],
  ] },
  { label: "管理・ライブラリ", items: [
    [AppPage.GIFTS_VIEWER, "ギフト一覧", "shapes"], [AppPage.COMMANDS, "コマンド一覧", "terminal"],
    [AppPage.OPERATIONS, "運用センター", "shield-halved"], [AppPage.SETUP, "初期セットアップ", "sliders"],
  ] },
] as const;
export default function Sidebar({ activePage, setActivePage, setupComplete }: {
  activePage: AppPage; setActivePage: (page: AppPage) => void; setupComplete: boolean;
}) {
  return <aside className="studio-sidebar">
    <div className="studio-sidebar-label"><span>WORKSPACE</span><b>配信をつくる場所</b></div>
    <nav className="studio-nav" aria-label="メインメニュー">
      {GROUPS.map(group => <div className="studio-nav-group" key={group.label}>
        <h2>{group.label}</h2>
        {group.items.map(([page, label, icon]) => {
          const locked = !setupComplete && page !== AppPage.SETUP && page !== AppPage.IMAGE_EDITOR;
          return <button key={page} type="button" aria-current={activePage === page ? "page" : undefined}
            className={page === AppPage.IMAGE_EDITOR ? "is-creator" : ""} disabled={locked}
            title={locked ? "初期セットアップを完了してください" : undefined} onClick={() => setActivePage(page)}>
            <i className={"fa-solid fa-" + icon} aria-hidden="true" /><span>{label}</span>
            {locked && <i className="fa-solid fa-lock studio-nav-lock" />}
          </button>;
        })}
      </div>)}
    </nav>
    <div className="studio-sidebar-footer">{setupComplete ? <><span className="studio-ready-dot" />セットアップ済み</> : "まずは初期セットアップから"}</div>
  </aside>;
}
