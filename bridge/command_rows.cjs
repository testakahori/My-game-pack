"use strict";

// アプリのコマンドの一覧の1行（処理のコピー PR8）。アプリ（electron/bridge_settings.cjs の bridge:commands:readMeta・list）と
// 開発用のブラウザー表示（vite.config.ts）がこの1つを使う。画面は写しを持たずに、ここで付けた印（ルーレット・使えない名前）を見る。
const { parseCommandText } = require("./command_text.cjs");
const { commandFileProblem, ensureTxt, sameCommandFile } = require("./command_files.cjs");
const { gameOfCommand, publicCommandKey } = require("./game_commands.cjs");
const { isRouletteCommand } = require("./roulette.cjs");
const { COMMAND_COOLDOWN_MAX_MS } = require("./event_rules.cjs");
const { weightOf } = require("./feature_engine.js");
const { isResourceId } = require("./minecraft_ids.cjs");

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

// TXT 作成（画面の CommandSetManager）の確かめ。main が bridge:commands:check で行い、画面は結果を出すだけ（処理のコピー PR8）。
// 見出しの確かめは、BRIDGE（# COOLDOWN は boundedInt の 0〜上限、# WEIGHT は weightOf）と BridgeMOD・DisplayMOD（# SOUND・# PARTICLE は isResourceId）が
// 実際に使う決まり。名前は .txt を付けるだけで書き換えない。existingNames に同じ名前（sameCommandFile）があれば、保存は上書きになる。
function checkCommandDraft({ filename, content, existingNames = [] } = {}) {
  const name = ensureTxt(String(filename ?? "").trim());
  const parsed = parseCommandText(typeof content === "string" ? content : "");
  const problems = [];
  if (!name) problems.push("ファイル名を入力してください");
  else if (gameOfCommand(name)) problems.push("ゲームパックのコマンドはパックを再登録して更新してください");
  else if (commandFileProblem(name)) problems.push(commandFileProblem(name));
  if (!parsed.commands.length) problems.push("コマンドの行がありません（# と // で始まる行はコマンドになりません）");
  const { COOLDOWN, WEIGHT, SOUND, PARTICLE } = parsed.meta;
  if (COOLDOWN !== undefined && !(/^\d+$/.test(COOLDOWN) && Number(COOLDOWN) <= COMMAND_COOLDOWN_MAX_MS)) {
    problems.push(`# COOLDOWN は 0〜${COMMAND_COOLDOWN_MAX_MS} の整数（ミリ秒）にしてください`);
  }
  if (WEIGHT !== undefined && weightOf(WEIGHT) !== Number(WEIGHT)) problems.push("# WEIGHT は 1 以上の数にしてください");
  if (SOUND !== undefined && !isResourceId(SOUND)) problems.push(`# SOUND「${SOUND}」は音の ID として正しくありません（例: entity.experience_orb.pickup）`);
  if (PARTICLE !== undefined && !isResourceId(PARTICLE)) problems.push(`# PARTICLE「${PARTICLE}」は粒子の ID として正しくありません（例: minecraft:happy_villager）`);
  const exists = Boolean(name) && (Array.isArray(existingNames) ? existingNames : []).some(other => sameCommandFile(other, name));
  return { filename: name, commands: parsed.commands, problems, exists };
}

module.exports = { commandListRow, checkCommandDraft };
