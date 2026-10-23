const fs = require("node:fs");
const path = require("node:path");
const { parseCommandText } = require("./command_text.cjs");
const { ensureTxt, bridgeCommandKey } = require("./command_files.cjs");
const { boundedInt } = require("./event_rules.cjs");
const { isResourceId } = require("./minecraft_ids.cjs");
const { CONFIG_DEFAULTS } = require("./config_defaults.cjs");

function cleanText(value, length) {
  return Array.from(String(value ?? "").replace(/[\r\n\t]/g, " ").replace(/[\u0000-\u001f\u007f]/g, "")).slice(0, length).join("");
}

// ルーレットを回すコマンドの名前か（roulette.txt）。大文字小文字・前後の空白・.txt の有無を問わない（BridgeMOD も区別しない）。
// BRIDGE の判定と、項目から外す判定はこの1か所（処理のコピー PR7。前は BRIDGE が === "roulette" で比べ、Roulette.TXT を普通のコマンドとして送っていた）。
function isRouletteCommand(commandFile) {
  return ensureTxt(commandFile).slice(0, -4).toLowerCase() === "roulette";
}

function commandPath(commandsDir, commandFile) {
  const name = ensureTxt(path.basename(String(commandFile).replace(/\\/g, "/")));
  // commandsDir は BRIDGE が config_defaults.cjs の bridgeCommandsDir で決めた場所（既定は commands/minecraft。処理のコピー PR4）。
  // 前は旧い commands のルートのために minecraft のフォルダーも探していた（BRIDGE の既定が commands だったため）。
  return path.join(commandsDir, name);
}

// defaults は止まる音・粒子の既定（bridge/config_defaults.json の roulette か deathRoulette。処理のコピー PR9）。
function prepareRoulette(config, commandsDir, random = Math.random, defaults = CONFIG_DEFAULTS.roulette) {
  const items = (Array.isArray(config?.items) ? config.items : []).flatMap(item => {
    if (!String(item?.commandFile || "").trim()) return [];
    const file = commandPath(commandsDir, String(item.commandFile).trim());
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
    const commandFile = path.basename(file);
    if (isRouletteCommand(commandFile)) return [];
    // 説明文の読み方は command_text.cjs の1か所（アプリの一覧と同じ。2026-10-18）。
    const description = parseCommandText(fs.readFileSync(file, "utf8")).description;
    return [{
      commandFile,
      label: cleanText(String(item.label || "").trim() || bridgeCommandKey(commandFile), 24),
      description: cleanText(description, 36),
      weight: Number.isFinite(Number(item.weight)) ? Math.max(1, Number(item.weight)) : 1,
      // 回数の丸めは event_rules.cjs の boundedInt の1つ（処理のコピー PR5）。
      repeat: boundedInt(item.repeat ?? 1, 1, 100, 1),
    }];
  });
  if (!items.length) throw new Error("ルーレットの有効な項目がありません。イベント設定②で存在するコマンドを選び、保存してください。");
  let pick = random() * items.reduce((sum, item) => sum + item.weight, 0);
  const winner = items.find(item => (pick -= item.weight) < 0) || items.at(-1);
  // 音・粒子の ID の決まりは minecraft_ids.cjs の1か所（DisplayMOD と同じ）。正しくなければ既定にする（処理のコピー PR7）。
  const mcId = (value, fallback) => isResourceId(value) ? value : fallback;
  return { items, winner, stopSound: mcId(config.stopSound, defaults.stopSound), particle: mcId(config.particle, defaults.particle) };
}

// 本番Bridgeとアプリ内テストが同じ抽選・文字・タイミングを使う。
// HTTPを順番に待ち、前フレームや当選コマンドが結果表示を追い越さないようにする。
// 演出は飾り。フレームを送れなかったら残りの演出を飛ばし、当選の発火（再送のあるレーン）へ必ず進む。
// 以前は1フレームの失敗で当選ごと消え、ルーレットに割り当てたギフトが再送も記録もされなかった。
function createRouletteRunner({ sendFrame, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onFrameError = () => {} }) {
  let queue = Promise.resolve();
  return (round, listenerName, fireWinner) => {
    const run = queue.then(async () => {
      let animating = true;
      const show = async commands => {
        if (!animating) return;
        try { await sendFrame(commands, listenerName); }
        catch (error) {
          animating = false;
          try { onFrameError(error); } catch { /* 記録の失敗で当選の発火を止めない */ }
        }
      };
      const pause = async ms => { if (animating) await sleep(ms); };
      const text = (value, color, bold = false) => JSON.stringify({ text: value, color, bold });
      const delays = [...Array(24).fill(50), 70, 90, 120, 160];
      for (let frame = 0; frame < delays.length; frame++) {
        const item = round.items[frame % round.items.length];
        await show([
          "title @a times 0 6 0",
          `title @a subtitle ${text(item.description || "ルーレット回転中…", "green")}`,
          `title @a title ${text(item.label, "yellow", true)}`,
          "execute as @a at @s run playsound block.note_block.hat master @s ~ ~ ~ 0.7 1.4",
        ]);
        await pause(delays[frame]);
      }
      const winner = round.winner;
      await show([
        "title @a times 0 55 15",
        `title @a subtitle ${text(winner.description || winner.label, "green")}`,
        `title @a title ${text(`▶ ${winner.label} ◀`, "yellow", true)}`,
        `title @a actionbar ${text(cleanText(listenerName || "ルーレット", 30), "aqua")}`,
        `execute as @a at @s run playsound ${round.stopSound} master @s ~ ~ ~ 1 1`,
        `execute at @a run particle ${round.particle} ~ ~1 ~ 0.8 1 0.8 0.08 30 force`,
      ]);
      await pause(400);
      await fireWinner(winner);
      return winner;
    });
    // 失敗した回は呼び出し元へ伝え、次の回は通常どおり実行できるようにする。
    queue = run.catch(() => {});
    return run;
  };
}

// ルーレットを回す回数。送られた回数（ギフトの数×割当の回数など）だけ回す（2026-10-11 ユーザーの決定）。
// 時限倍率の端数は四捨五入し、数でなければ1回。
function rouletteSpins(count) {
  const spins = Math.round(Number(count));
  return Number.isFinite(spins) && spins >= 1 ? spins : 1;
}

module.exports = { isRouletteCommand, commandPath, prepareRoulette, createRouletteRunner, rouletteSpins };
