// Minecraft のランチャー・ゲーム本体の稼働の確かめと、Minecraft の起動（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createMinecraftClient } = require('../minecraft_client.cjs');

function setup(t, { platform = 'win32', csv = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minecraft-client-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [], spawned = [], config = {}, handlers = new Map();
  // tasklist.exe の代わり。渡した CSV を出して終わる。ランチャーの起動は unref だけ受ける。
  const spawn = (cmd, args, options) => {
    spawned.push([cmd, args, options]);
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), kill() {}, unref() {} });
    setImmediate(() => { if (csv) child.stdout.emit('data', Buffer.from(csv)); child.emit('close', 0); });
    return child;
  };
  const client = createMinecraftClient({ process: { platform, env: {} }, spawn, readAppConfig: () => config, assertGameProfileIdle: () => calls.push('gameProfileIdle') });
  client.register({ handle: (name, fn) => handlers.set(name, fn) });
  return { dir, calls, spawned, config, client, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('Minecraft の稼働: Windows 以外は調べない。Windows では main から受け取った spawn で tasklist を読み、ランチャーとゲーム本体を数える', async t => {
  const other = setup(t, { platform: 'linux' });
  assert.deepEqual(await other.client.getMinecraftProcessStatus(), { running: false, processes: [] });
  assert.equal(other.spawned.length, 0);
  const win = setup(t, { csv: '"MinecraftLauncher.exe","100","Console","1","10,000 K"\r\n"javaw.exe","200","Console","1","10,000 K"\r\n"notepad.exe","300","Console","1","1,000 K"\r\n' });
  assert.deepEqual(await win.invoke('minecraft:status'), { running: true, processes: ['minecraftlauncher.exe', 'javaw.exe'] });
  assert.deepEqual(win.spawned[0].slice(0, 2), ['tasklist.exe', ['/FO', 'CSV', '/NH']]);
  const empty = setup(t);
  await assert.rejects(empty.client.getMinecraftProcessStatus(true), /Minecraftの停止状態を確認できません。切替を中止しました/);
});

test('Minecraft の起動: アプリ設定のランチャーを main から受け取った spawn で開く', async t => {
  const x = setup(t);
  const launcher = path.join(x.dir, 'MyLauncher.exe');
  fs.writeFileSync(launcher, '');
  x.config.minecraftLauncherPath = launcher;
  assert.deepEqual(await x.invoke('minecraft:launch'), { ok: true, path: launcher });
  assert.deepEqual(x.spawned.at(-1), [launcher, [], { detached: true, stdio: 'ignore' }]);
  assert.deepEqual(x.calls, ['gameProfileIdle']);
});
