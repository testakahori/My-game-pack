"use strict";

// コマンド txt の読み方（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 5）。
// BRIDGE・アプリの一覧・ルーレット・開発用の一覧はこの1か所を使う。BridgeMOD・SaikutuMod（Java の CommandText）も同じ決まりで、
// scripts/test-bridge-contracts.cjs が同じ例の一覧（bridge/test/fixtures/command-text.json）を両方に通して確かめる。
// - 行は CRLF・LF・CR で区切り、前後の空白（JavaScript の trim と同じ文字。BOM・全角空白・NBSP を含む）を除く。
// - 「# キー: 値」は見出し。キーは英字と _ だけで、大文字にそろえる。値が空の行は無視する（次の行は拾わない）。同じキーは後の行が勝つ。
// - 「#」で始まるほかの行と「//」で始まる行はコマンドにしない。説明文は「//」のあとが空でない最初の行。

const HEADER = /^#\s*([A-Za-z_]+)\s*:([\s\S]*)$/;

// 前後の空白を除く（JavaScript の String.prototype.trim と同じ文字）。Java の CommandText も同じ一覧を使う。
function trimText(text) {
  return String(text ?? "").trim();
}

function parseCommandText(text) {
  const meta = {};
  const commands = [];
  let description = "";
  for (const raw of String(text ?? "").split(/\r\n|\r|\n/)) {
    const line = trimText(raw);
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(HEADER);
      const value = m ? trimText(m[2]) : "";
      if (value) meta[m[1].toUpperCase()] = value;
      continue;
    }
    if (line.startsWith("//")) {
      if (!description) description = trimText(line.slice(2));
      continue;
    }
    commands.push(line);
  }
  return { meta, commands, description };
}

module.exports = { parseCommandText, trimText };
