const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createMapSaves, inventory } = require('../map_saves.cjs');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'map-saves-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const world = path.join(root, 'haihu_world', 'world');
  fs.mkdirSync(path.join(world, 'playerdata'), { recursive: true });
  fs.mkdirSync(path.join(world, 'DIM-1', 'region'), { recursive: true });
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=haihu_world/world\n');
  fs.writeFileSync(path.join(world, 'level.dat'), 'original world');
  fs.writeFileSync(path.join(world, 'session.lock'), 'lock');
  fs.writeFileSync(path.join(world, 'playerdata', 'player.dat'), 'inventory before');
  fs.writeFileSync(path.join(world, 'DIM-1', 'region', 'r.0.0.mca'), 'nether before');
  return { root, world, service: createMapSaves({ getRoot: () => root, ...options }) };
}
test('MAP: only explicit saves add history; repeated loads restore terrain without automatic saves', async t => {
  const { root, world, service } = fixture(t);
  const before = await inventory(world), saved = await service.save('配信前 / ダイヤ集め');
  assert.equal(saved.name, '配信前 / ダイヤ集め'); assert.equal(saved.files, 3);
  assert.equal(fs.existsSync(path.join(root, 'map-saves', saved.id, 'world', 'session.lock')), false);
  fs.writeFileSync(path.join(world, 'level.dat'), 'destroyed');
  fs.writeFileSync(path.join(world, 'playerdata', 'player.dat'), 'inventory after');
  fs.writeFileSync(path.join(world, 'DIM-1', 'region', 'r.0.0.mca'), 'nether after');
  fs.writeFileSync(path.join(world, 'new.dat'), 'new file');
  await service.load(saved.id);
  assert.deepEqual(await inventory(world), before);
  assert.equal((await service.list()).saves.length, 1);
  await service.load(saved.id);
  await service.recover();
  assert.deepEqual(await inventory(world), before);
  assert.equal((await service.list()).saves.length, 1);
  assert.deepEqual(fs.readdirSync(root).filter(n => n.startsWith('.map-')), []);
});
test('MAP: corrupted save, missing files and traversal are rejected before altering current world', async t => {
  const { root, world, service } = fixture(t);
  const saved = await service.save('checkpoint'), before = await inventory(world);
  fs.writeFileSync(path.join(root, 'map-saves', saved.id, 'world', 'level.dat'), 'corrupt');
  await assert.rejects(service.load(saved.id), /破損/);
  assert.deepEqual(await inventory(world), before);
  await assert.rejects(service.load('../world'), /不正/);
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=../outside');
  await assert.rejects(service.save('escape'), /不正/);
});
test('MAP: failed swap rolls current world back and the service can retry', async t => {
  let fail = false;
  const { root, world, service } = fixture(t, { rename: async (a, b) => { if (fail && path.basename(a).startsWith('.map-stage-')) { fail = false; throw new Error('simulated rename failure'); } await fs.promises.rename(a, b); } });
  const saved = await service.save('before'); fs.writeFileSync(path.join(world, 'level.dat'), 'current');
  const current = await inventory(world); fail = true;
  await assert.rejects(service.load(saved.id), /rename failure/);
  assert.deepEqual(await inventory(world), current);
  assert.equal(fs.existsSync(path.join(root, 'map-saves', 'restore-pending.json')), false);
  await service.load(saved.id); assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'original world');
});
test('MAP: interrupted swap recovers before allowing Minecraft to create an empty world', async t => {
  const { root, world, service } = fixture(t); const before = await inventory(world);
  await service.save('checkpoint');
  const safetyId = crypto.randomUUID(), stageId = crypto.randomUUID();
  const savedDir = path.join(root, 'map-saves', safetyId); fs.mkdirSync(savedDir);
  fs.renameSync(world, path.join(savedDir, 'world'));
  fs.mkdirSync(path.join(root, '.map-stage-' + stageId));
  fs.writeFileSync(path.join(root, 'map-saves', 'restore-pending.json'), JSON.stringify({ level: 'haihu_world/world', safetyId, stageId }));
  await service.recover(); assert.deepEqual(await inventory(world), before);
  assert.equal(fs.existsSync(path.join(root, '.map-stage-' + stageId)), false);
});
test('MAP: running server blocks all writes; concurrent operations cannot overlap', async t => {
  let release;
  const { root, service } = fixture(t, { assertStopped: () => new Promise(resolve => { release = resolve; }) });
  const saving = service.save('one');
  await assert.rejects(service.save('two'), /保存・読込中/);
  await assert.rejects(service.load(crypto.randomUUID()), /保存・読込中/);
  release(); await saving;
  const blocked = createMapSaves({ getRoot: () => root, assertStopped: async () => { throw new Error('server running'); } });
  const before = fs.readdirSync(path.join(root, 'map-saves'));
  await assert.rejects(blocked.save('unsafe'), /server running/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'map-saves')), before);
});
test('MAP: linked world directories and links inside a save cannot escape the server', async t => {
  const { root, world, service } = fixture(t);
  const linked = path.join(root, 'linked'); fs.mkdirSync(linked);
  fs.symlinkSync(linked, path.join(world, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(service.save('unsafe'), /リンク/);
  assert.deepEqual(fs.readdirSync(linked), []);
});

test('MAP: interrupted temporary rollback recovers without adding saved history', async t => {
  const { root, world, service } = fixture(t); const before = await inventory(world);
  await service.save('manual checkpoint');
  const rollbackId = crypto.randomUUID(), stageId = crypto.randomUUID();
  fs.renameSync(world, path.join(root, '.map-rollback-' + rollbackId));
  fs.mkdirSync(path.join(root, '.map-stage-' + stageId));
  fs.writeFileSync(path.join(root, 'map-saves', 'restore-pending.json'), JSON.stringify({ version: 2, level: 'haihu_world/world', rollbackId, stageId }));
  await service.recover();
  assert.deepEqual(await inventory(world), before);
  assert.equal((await service.list()).saves.length, 1);
  assert.deepEqual(fs.readdirSync(root).filter(n => n.startsWith('.map-')), []);
});
