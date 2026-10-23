"use strict";

// アプリのコマンドの一覧の1行（処理のコピー PR8）。アプリ（electron/bridge_settings.cjs の bridge:commands:readMeta・list）と
// 開発用のブラウザー表示（vite.config.ts）がこの1つを使う。画面は写しを持たずに、ここで付けた印（ルーレット・使えない名前）を見る。
const { parseCommandText } = require("./command_text.cjs");
const { commandFileProblem } = require("./command_files.cjs");
const { publicCommandKey } = require("./game_commands.cjs");
const { isRouletteCommand } = require("./roulette.cjs");

// text はファイルの中身。読めなかったときは null（題名はファイル名、分類と説明文は空）。
// title はルーレット名やギフト画像にそのまま使われるので変えず、使えない名前には印と直し方の文（invalidReason）だけを付ける。
// chatKey はチャットの名前（/bridge <名前>。BridgeMOD の publicKey と同じ決まり。処理のコピー PR6）。
function commandListRow(name, text) {
  let title = name, category = "", description = "";
  if (typeof text === "string") {
    const parsed = parseCommandText(text);
    if (parsed.meta.TITLE) title = parsed.meta.TITLE;
    category = parsed.meta.CATEGORY || "";
    description = parsed.description;
  }
  const problem = commandFileProblem(name);
  return {
    name, title, category, description, chatKey: publicCommandKey(name),
    ...(isRouletteCommand(name) ? { roulette: true } : {}),
    ...(problem ? { invalidName: true, invalidReason: problem } : {}),
  };
}

module.exports = { commandListRow };
