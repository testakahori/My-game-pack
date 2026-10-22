const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { commandPath, prepareRoulette, createRouletteRunner } = require("../../bridge/roulette.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roulette-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, "commands", "minecraft");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "zombie.txt"), '// ゾンビを召喚「テスト」\nsay test\n');
  fs.writeFileSync(path.join(dir, "heal.txt"), '// 回復します\nsay heal\n');
  const config = { enabled: true, stopSound: "minecraft:block.note_block.bell", particle: "minecraft:happy_villager", items: [
    { commandFile: "zombie.txt", label: 'ゾンビ "登場" 🧟', weight: 1, repeat: 3 },
    { commandFile: "heal", label: "回復", weight: 3, repeat: 2 },
    { commandFile: "missing.txt", weight: 100 },
  ] };
  return { dir, config };
}

// コマンドの場所は bridge/config_defaults.cjs の bridgeCommandsDir の1か所で決める（処理のコピー PR4）。
// 前は、旧い commands のルートを渡されたら minecraft のフォルダーも探していた（BRIDGE の既定が commands だったため）。
test("ルーレット: 決めたコマンドの場所だけを読む（minecraft のフォルダーを探しに行かない）。項目・重み・回数", t => {
  const { dir, config } = fixture(t);
  const direct = prepareRoulette(config, dir, () => 0.5);
  assert.throws(() => prepareRoulette(config, path.dirname(dir), () => 0.5), /有効な項目がありません/, '旧い commands のルートでは探さない');
  assert.equal(direct.items.length, 2);
  assert.equal(direct.winner.commandFile, "heal.txt");
  assert.equal(direct.winner.repeat, 2);
  assert.equal(prepareRoulette(config, dir, () => 0).winner.commandFile, "zombie.txt");
  assert.equal(commandPath(dir, "../zombie"), path.join(dir, "zombie.txt"));
  assert.throws(() => prepareRoulette({ items: [{ commandFile: "missing" }] }, dir), /有効な項目がありません/);
});

test("ルーレット: 日本語・引用符・絵文字を表示して減速し、結果表示後に当選回数だけ発火", async t => {
  const { dir, config } = fixture(t);
  const round = prepareRoulette(config, dir, () => 0);
  const frames = [], waits = [], events = [];
  const run = createRouletteRunner({ sendFrame: async commands => { frames.push(commands); }, sleep: async ms => { waits.push(ms); } });
  await run(round, '視聴者 "テスト"', winner => { events.push(winner); assert.equal(frames.length, 29); assert.equal(waits.at(-1), 400); });
  const titles = frames.map(commands => JSON.parse(commands.find(cmd => cmd.startsWith("title @a title ")).slice(15)).text);
  assert.equal(titles[0], 'ゾンビ "登場" 🧟');
  assert.equal(titles[1], "回復");
  assert.equal(titles.at(-1), '▶ ゾンビ "登場" 🧟 ◀');
  assert.ok(waits.slice(0, 24).every(ms => ms === 50));
  assert.ok(waits.slice(24, 28).every((ms, i) => ms > waits[i + 23]));
  assert.ok(waits.reduce((sum, ms) => sum + ms, 0) < 2200);
  assert.ok(frames.at(-1).some(cmd => cmd.includes(config.stopSound)));
  assert.ok(frames.at(-1).some(cmd => cmd.includes(config.particle)));
  assert.equal(events.length, 1);
  assert.equal(events[0].repeat, 3);
});

test("ルーレット: 演出を送れなくても当選は必ず発火し、残りの演出は飛ばして次の回も順に表示する", async t => {
  const { dir, config } = fixture(t);
  const round = prepareRoulette(config, dir);
  const order = [], waits = [], frameErrors = [], wins = [];
  let fail = true;
  const run = createRouletteRunner({
    sendFrame: async (_commands, listener) => { if (fail) { fail = false; throw new Error("BridgeMod exec HTTP 403"); } order.push(listener); },
    sleep: async ms => { waits.push(ms); },
    onFrameError: error => { frameErrors.push(error.message); },
  });
  // 以前は1フレームの失敗で当選ごと消え、ルーレットに割り当てたギフトが再送も記録もされなかった。
  assert.equal((await run(round, "failure", () => { wins.push("failure"); })).commandFile, round.winner.commandFile);
  assert.deepEqual(frameErrors, ["BridgeMod exec HTTP 403"]);
  assert.deepEqual(waits, [], "失敗した回は待たずに当選へ進む（タイムアウトを29回待たない）");
  await Promise.all([run(round, "first", () => { wins.push("first"); }), run(round, "second", () => { wins.push("second"); })]);
  assert.ok(!order.includes("failure"), "失敗した回の残りの演出は送らない");
  assert.deepEqual(order, [...Array(29).fill("first"), ...Array(29).fill("second")]);
  assert.deepEqual(wins, ["failure", "first", "second"]);
});

test("ルーレット: 当選の発火に失敗したら呼び出し元へ伝え、次の回は通常どおり実行する", async t => {
  const { dir, config } = fixture(t);
  const round = prepareRoulette(config, dir);
  const run = createRouletteRunner({ sendFrame: async () => {}, sleep: async () => {} });
  await assert.rejects(run(round, "first", () => { throw new Error("発火できません"); }), /発火できません/);
  let wins = 0;
  await run(round, "second", () => { wins++; });
  assert.equal(wins, 1);
});

// 回数の丸めは event_rules.cjs の boundedInt の1つ（処理のコピー PR5）。直す前も後も同じ結果になることを見張る。
test("ルーレットの回数の丸めは前と同じ（0・空・数でない値は 1、小数は切り捨て、100 を超えたら 100）", t => {
  const { dir } = fixture(t);
  const repeats = [0, "", "x", 2.9, 500].map(repeat => prepareRoulette({ items: [{ commandFile: "zombie.txt", repeat }] }, dir, () => 0).winner.repeat);
  assert.deepEqual(repeats, [1, 1, 1, 2, 100]);
});
