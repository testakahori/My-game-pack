// bridge/telnet_test.js
"use strict";
const net = require("net");

const HOST = "127.0.0.1";
const PORT = 8081;

const PLAYER_ID = 171;

function sendLine(socket, line) {
  socket.write(line + "\r\n");
  console.log("[SEND]", line);
}

const socket = net.createConnection({ host: HOST, port: PORT }, () => {
  console.log("[TELNET] connected");

  setTimeout(() => {
    sendLine(socket, `se ${PLAYER_ID} 235 1`);
  }, 300);

  setTimeout(() => {
    console.log("[TELNET] end");
    socket.end();
  }, 1200);
});

socket.on("data", (buf) => process.stdout.write(buf.toString("utf8")));
socket.on("error", (err) => console.error("[TELNET] error", err.message));
