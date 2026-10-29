import "./lib/devApiMock";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fortawesome/fontawesome-free/css/all.min.css";
import "./index.css";
import "./studio.css";
// 配信ホームの並び（2026-10-29）。同じ強さの index.css・studio.css の決まりに勝つよう、いちばん後に読む。
import "./components/DashboardLayout.css";
// 見た目「コックピット強め」と小さすぎる文字の大きさ（2026-10-29）。並びの後に読む。
import "./components/CockpitTheme.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
