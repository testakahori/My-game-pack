const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { migrateCommandReferences, migrateRetiredCommands } = require("../command_migration.cjs");

test("廃止コマンド: 砂の割り当ては引き継ぎ、廃止した演出を無効化し、他の設定を保持", () => {
  const input = { rcon: { password: "unchanged" }, mappings: [
    { giftId: "1", commandFile: "seichi_donut.txt", repeat: 4 },
    { giftId: "2", commandFile: "tornado.txt" }, { giftId: "3", commandFile: "meteor.txt" },
  ], followEvent: { enabled: true, commandFile: "tornado.txt" }, roulette: { items: [
    { commandFile: "seichi_donut.txt", weight: 8 }, { commandFile: "tornado.txt" },
  ] } };
  const next = migrateCommandReferences(input);
  assert.equal(input.mappings.length, 3);
  assert.deepEqual(next.mappings, [{ giftId: "1", commandFile: "fall_sand.txt", repeat: 4 }, { giftId: "3", commandFile: "meteor.txt" }]);
  assert.deepEqual(next.rcon, input.rcon);
  assert.deepEqual(next.followEvent, { enabled: false, commandFile: "" });
  assert.deepEqual(next.roulette.items, [{ commandFile: "fall_sand.txt", weight: 8 }]);
  assert.deepEqual(migrateCommandReferences(next), next);
});

test("コマンド移行: 元の割り当てを保存してから更新し、再実行でバックアップを増やさない", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "command-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const raw = JSON.stringify({ mappings: [{ giftId: "a", commandFile: "seichi_donut.txt" }] });
  fs.writeFileSync(path.join(root, "config.minecraft.json"), raw);
  migrateRetiredCommands(root);
  const backups = fs.readdirSync(path.join(root, "retired-command-backups"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(root, "retired-command-backups", backups[0], "config.minecraft.json"), "utf8"), raw);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "config.minecraft.json"))).mappings[0].commandFile, "fall_sand.txt");
  migrateRetiredCommands(root);
  assert.deepEqual(fs.readdirSync(path.join(root, "retired-command-backups")), backups);
});

test("吹き飛ばす・ハリケーンを削除し、重複ハスクは回数と重みを保持して統合", () => {
  const input = { mappings: [{ giftId: "1", commandFile: "hukitobasu.txt" }, { giftId: "2", commandFile: "hurricane.txt" }, { giftId: "3", commandFile: "husk01.txt", repeat: 5 }], deathEvent: { enabled: true, commandFile: "hurricane.txt" }, roulette: { items: [{ commandFile: "husk01.txt", weight: 3 }, { commandFile: "hukitobasu.txt" }] } };
  const next = migrateCommandReferences(input);
  assert.deepEqual(next.mappings, [{ giftId: "3", commandFile: "husk.txt", repeat: 5 }]);
  assert.deepEqual(next.deathEvent, { enabled: false, commandFile: "" });
  assert.deepEqual(next.roulette.items, [{ commandFile: "husk.txt", weight: 3 }]);
  assert.equal(input.mappings.length, 3);
  assert.deepEqual(migrateCommandReferences(next), next);
});

test('暗闇地獄とペット召喚だけを削除し、暗黒と愛犬の割り当てを保持', () => {
 const input={mappings:[{commandFile:'give_blindness.txt'},{commandFile:'petsummon.txt'},{commandFile:'darkness.txt'},{commandFile:'wolf.txt'}],shareEvent:{enabled:true,commandFile:'petsummon.txt'}};
 const next=migrateCommandReferences(input);assert.deepEqual(next.mappings,[{commandFile:'darkness.txt'},{commandFile:'wolf.txt'}]);assert.deepEqual(next.shareEvent,{enabled:false,commandFile:''});assert.equal(input.mappings.length,4);
});
