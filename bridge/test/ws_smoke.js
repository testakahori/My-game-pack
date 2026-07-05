"use strict";

const messages = [];
const ws = new WebSocket("ws://127.0.0.1:25577");
const timeout = setTimeout(() => {
  console.error("WebSocket smoke test timed out", messages);
  process.exit(1);
}, 10000);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({
    type: "gift", key: "creeper", count: 1,
    listenerName: "WebSocketテスト", announce: true,
  }));
});
ws.addEventListener("message", event => {
  const value = JSON.parse(String(event.data));
  messages.push(value);
  if (messages.some(x => x.ok === true && Object.hasOwn(x, "tps"))
      && messages.some(x => x.type === "ack" && x.ok === true)) {
    clearTimeout(timeout);
    console.log(JSON.stringify(messages, null, 2));
    ws.close();
    process.exit(0);
  }
});
ws.addEventListener("error", error => {
  clearTimeout(timeout);
  console.error(error);
  process.exit(1);
});
