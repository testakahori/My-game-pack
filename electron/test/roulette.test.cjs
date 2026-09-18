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

test("ルーレット: UI保存先と旧commandsルートで同じ項目・重み・回数を使う", t => {
  const { dir, config } = fixture(t);
  const direct = prepareRoulette(config, dir, () => 0.5);
  assert.deepEqual(direct, prepareRoulette(config, path.dirname(dir), () => 0.5));
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
  await run(round, '視聴者 "テスト"', winner => { events.push(winner); assert.equal(frames.length, 13); assert.equal(waits.at(-1), 600); });
  const titles = frames.map(commands => JSON.parse(commands.find(cmd => cmd.startsWith("title @a title ")).slice(15)).text);
  assert.equal(titles[0], 'ゾンビ "登場" 🧟');
  assert.equal(titles[1], "回復");
  assert.equal(titles.at(-1), '▶ ゾンビ "登場" 🧟 ◀');
  assert.ok(waits.slice(1, 12).every((ms, i) => ms >= waits[i]));
  assert.ok(frames.at(-1).some(cmd => cmd.includes(config.stopSound)));
  assert.ok(frames.at(-1).some(cmd => cmd.includes(config.particle)));
  assert.equal(events.length, 1);
  assert.equal(events[0].repeat, 3);
});

test("ルーレット: 同時発動は順に表示し、通信失敗を報告して次の回を再開できる", async t => {
  const { dir, config } = fixture(t);
  const round = prepareRoulette(config, dir);
  const order = [];
  let fail = true;
  const run = createRouletteRunner({ sendFrame: async (_commands, listener) => { if (fail) { fail = false; throw new Error("Modに接続できません"); } order.push(listener); }, sleep: async () => {} });
  let wins = 0;
  await assert.rejects(run(round, "failure", () => { wins++; }), /Modに接続できません/);
  await Promise.all([run(round, "first", () => { wins++; }), run(round, "second", () => { wins++; })]);
  assert.deepEqual(order, [...Array(13).fill("first"), ...Array(13).fill("second")]);
  assert.equal(wins, 2);
});
