const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const { ensureManagedWorld, generateInitialWorld, worldPath, worldReady, INCOMPLETE } = require("../world_setup.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "setup-world-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, content = "saved world") => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), content);
  };
  return { root, write };
}
const stopped = async () => {};

test("初回ワールド: haihu_world/worldへ生成し、保存完了後だけ完了になる", async t => {
  const { root, write } = fixture(t);
  let selected, generated = 0;
  const result = await ensureManagedWorld(root, { ensureStopped: stopped, selectWorld: name => { selected = name; },
    generateWorld: async (_root, dir) => {
      generated++;
      assert.equal(dir, path.join(root, "haihu_world", "world"));
      assert.equal(worldReady(root, "haihu_world/world"), false);
      write("haihu_world/world/level.dat");
    },
  });
  assert.equal(result.world, "haihu_world/world");
  assert.equal(selected, result.world);
  assert.equal(generated, 1);
  assert.equal(worldReady(root, result.world), true);
  await ensureManagedWorld(root, { levelName: selected, ensureStopped: stopped, generateWorld: () => { throw Error("must not regenerate"); } });
});

test("既存world: ワールド・プレイヤーデータを保持して移動し、再生成しない", async t => {
  const { root, write } = fixture(t);
  write("world/level.dat", "existing level");
  write("world/region/r.0.0.mca", "existing terrain");
  write("world/playerdata/player.dat", "existing inventory");
  let selected;
  await ensureManagedWorld(root, { ensureStopped: stopped, selectWorld: name => { selected = name; }, generateWorld: () => { throw Error("must not regenerate"); } });
  assert.equal(selected, "haihu_world/world");
  assert.equal(fs.existsSync(path.join(root, "world")), false);
  assert.equal(fs.readFileSync(path.join(root, selected, "region/r.0.0.mca"), "utf8"), "existing terrain");
  assert.equal(fs.readFileSync(path.join(root, selected, "playerdata/player.dat"), "utf8"), "existing inventory");
});

test("移動先衝突: どちらのワールドも上書きしない", async t => {
  const { root, write } = fixture(t);
  write("world/level.dat", "source"); write("haihu_world/world/level.dat", "destination");
  await assert.rejects(ensureManagedWorld(root, { ensureStopped: stopped, selectWorld: () => { throw Error("must not select"); } }), /両方が存在/);
  assert.equal(fs.readFileSync(path.join(root, "world/level.dat"), "utf8"), "source");
  assert.equal(fs.readFileSync(path.join(root, "haihu_world/world/level.dat"), "utf8"), "destination");
});

test("設定済みの別ワールドは切り替えない", async t => {
  const { root, write } = fixture(t);
  write("haihu_world/custom/level.dat");
  const result = await ensureManagedWorld(root, { levelName: "haihu_world/custom", ensureStopped: stopped, selectWorld: () => { throw Error("must not change"); } });
  assert.equal(result.world, "haihu_world/custom");
  assert.equal(fs.existsSync(path.join(root, "haihu_world/world")), false);
});

test("生成失敗: 中途半端なlevel.datを完了扱いせず、同じ保存先で再試行できる", async t => {
  const { root, write } = fixture(t);
  const options = { levelName: "haihu_world/world", ensureStopped: stopped };
  await assert.rejects(ensureManagedWorld(root, { ...options, generateWorld: async () => {
    write("haihu_world/world/level.dat", "partial"); throw Error("save failed");
  } }), /save failed/);
  assert.equal(fs.existsSync(path.join(root, INCOMPLETE)), true);
  assert.equal(worldReady(root, options.levelName), false);
  await ensureManagedWorld(root, { ...options, generateWorld: async () => write("haihu_world/world/level.dat", "complete") });
  assert.equal(worldReady(root, options.levelName), true);
});

test("サーバー稼働中: 移動や生成を始めない", async t => {
  const { root, write } = fixture(t);
  write("world/level.dat");
  await assert.rejects(ensureManagedWorld(root, { ensureStopped: async () => { throw Error("server running"); } }), /server running/);
  assert.equal(fs.existsSync(path.join(root, "world/level.dat")), true);
  assert.equal(fs.existsSync(path.join(root, "haihu_world")), false);
});

test("保存先外・リンク先にはワールドを移動しない", async t => {
  const { root, write } = fixture(t);
  assert.throws(() => worldPath(root, "../outside"), /サーバーフォルダー内/);
  assert.throws(() => worldPath(root, root), /サーバーフォルダー内/);
  write("outside/level.dat", "untouched");
  fs.symlinkSync(path.join(root, "outside"), path.join(root, "haihu_world"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(ensureManagedWorld(root, { ensureStopped: stopped }), /リンク/);
  assert.equal(fs.readFileSync(path.join(root, "outside/level.dat"), "utf8"), "untouched");
});

test("生成プロセス: Done後にstopを送り、終了と保存を待って返す", async t => {
  const { root, write } = fixture(t);
  const destination = path.join(root, "haihu_world/world");
  let stoppedCommand, exited = false;
  await generateInitialWorld(root, destination, { spawnProcess: (_java, args, options) => {
    assert.equal(options.windowsHide, true);
    assert.equal(options.cwd, root);
    assert.ok(args.includes("-Xmx1536M"));
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      stoppedCommand = String(chunk); callback();
      setTimeout(() => { write("haihu_world/world/level.dat"); exited = true; child.emit("close", 0); }, 10);
    } });
    process.nextTick(() => { child.stdout.write("Done ("); child.stdout.write('1.25s)! For help, type "help"\n'); });
    return child;
  } });
  assert.equal(stoppedCommand, "stop\n");
  assert.equal(exited, true);
});

test("生成タイムアウト: stopで保存・終了させても成功と偽らない", async t => {
  const { root } = fixture(t);
  let stoppedCommand;
  await assert.rejects(generateInitialWorld(root, root, { startupTimeoutMs: 10, stopTimeoutMs: 1000,
    spawnProcess: () => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.stdin = new Writable({ write(chunk, _encoding, callback) {
        stoppedCommand = String(chunk); callback(); process.nextTick(() => child.emit("close", 0));
      } });
      return child;
    },
  }), /時間内に完了/);
  assert.equal(stoppedCommand, "stop\n");
});
