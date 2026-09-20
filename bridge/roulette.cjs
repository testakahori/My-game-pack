const fs = require("node:fs");
const path = require("node:path");

function cleanText(value, length) {
  return Array.from(String(value ?? "").replace(/[\r\n\t]/g, " ").replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, length).join("");
}

function commandPath(commandsDir, commandFile) {
  const file = path.basename(String(commandFile).replace(/\\/g, "/"));
  const name = /\.txt$/i.test(file) ? file : `${file}.txt`;
  // UIで保存する commands/minecraft と旧設定の commands の両方に対応する。
  const direct = path.join(commandsDir, name);
  return fs.existsSync(direct) || path.basename(commandsDir).toLowerCase() === "minecraft"
    ? direct : path.join(commandsDir, "minecraft", name);
}

function prepareRoulette(config, commandsDir, random = Math.random) {
  const items = (Array.isArray(config?.items) ? config.items : []).flatMap(item => {
    if (!String(item?.commandFile || "").trim()) return [];
    const file = commandPath(commandsDir, String(item.commandFile).trim());
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
    const commandFile = path.basename(file);
    if (/^roulette\.txt$/i.test(commandFile)) return [];
    const description = fs.readFileSync(file, "utf8").match(/^\/\/\s*(.+)$/m)?.[1]?.trim() || "";
    return [{
      commandFile,
      label: cleanText(String(item.label || "").trim() || commandFile.replace(/\.txt$/i, ""), 24),
      description: cleanText(description, 36),
      weight: Number.isFinite(Number(item.weight)) ? Math.max(1, Number(item.weight)) : 1,
      repeat: Number.isFinite(Number(item.repeat)) ? Math.max(1, Math.min(100, Math.floor(Number(item.repeat) || 1))) : 1,
    }];
  });
  if (!items.length) throw new Error("ルーレットの有効な項目がありません。イベント設定②で存在するコマンドを選び、保存してください。");
  let pick = random() * items.reduce((sum, item) => sum + item.weight, 0);
  const winner = items.find(item => (pick -= item.weight) < 0) || items.at(-1);
  const mcId = (value, fallback) => /^[a-z0-9_.:-]+$/.test(String(value || "")) ? value : fallback;
  return { items, winner, stopSound: mcId(config.stopSound, "entity.player.levelup"), particle: mcId(config.particle, "minecraft:totem_of_undying") };
}

// 本番Bridgeとアプリ内テストが同じ抽選・文字・タイミングを使う。
// HTTPを順番に待ち、前フレームや当選コマンドが結果表示を追い越さないようにする。
function createRouletteRunner({ sendFrame, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let queue = Promise.resolve();
  return (round, listenerName, fireWinner) => {
    const run = queue.then(async () => {
      const text = (value, color, bold = false) => JSON.stringify({ text: value, color, bold });
      const delays = [...Array(24).fill(50), 70, 90, 120, 160];
      for (let frame = 0; frame < delays.length; frame++) {
        const item = round.items[frame % round.items.length];
        await sendFrame([
          "title @a times 0 6 0",
          `title @a subtitle ${text(item.description || "ルーレット回転中…", "green")}`,
          `title @a title ${text(item.label, "yellow", true)}`,
          "execute as @a at @s run playsound block.note_block.hat master @s ~ ~ ~ 0.7 1.4",
        ], listenerName);
        await sleep(delays[frame]);
      }
      const winner = round.winner;
      await sendFrame([
        "title @a times 0 55 15",
        `title @a subtitle ${text(winner.description || winner.label, "green")}`,
        `title @a title ${text(`▶ ${winner.label} ◀`, "yellow", true)}`,
        `title @a actionbar ${text(cleanText(listenerName || "ルーレット", 30), "aqua")}`,
        `execute as @a at @s run playsound ${round.stopSound} master @s ~ ~ ~ 1 1`,
        `execute at @a run particle ${round.particle} ~ ~1 ~ 0.8 1 0.8 0.08 30 force`,
      ], listenerName);
      await sleep(400);
      await fireWinner(winner);
      return winner;
    });
    // 失敗した回は呼び出し元へ伝え、次の回は通常どおり実行できるようにする。
    queue = run.catch(() => {});
    return run;
  };
}

module.exports = { commandPath, prepareRoulette, createRouletteRunner };
