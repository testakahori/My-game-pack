// src/index.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// ※ CSSは dist で扱いにくいので、今は読み込まない方針ならこのままでOK
// import "./index.css";

function mount() {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    // 画面が真っ白になった時に原因が分かりやすいように、DOMにも出す
    const msg = "[UI] #root が見つかりません。index.html の <div id='root'></div> を確認してね。";
    // eslint-disable-next-line no-console
    console.error(msg);
    document.body.innerHTML =
      "<div style='padding:16px;font-family:system-ui;color:#fff;background:#111;'>" +
      msg +
      "</div>";
    throw new Error("Could not find root element to mount to");
  }

  const root = ReactDOM.createRoot(rootElement);

  // StrictMode は開発時に useEffect が2回走る等の挙動があり「保存が2回走った？」に見えることがある
  // 超初心者向け＆挙動を分かりやすくするため、まずは StrictMode を外しておく（必要なら戻せる）
  root.render(<App />);
}

mount();
