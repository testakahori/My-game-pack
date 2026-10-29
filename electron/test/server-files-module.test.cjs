// server.properties・RCON パスワード・配布ワールド・OP の付与・ゲームルールの古い窓口（main.cjs から分けた。2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServerFiles } = require('../server_files.cjs');

function setup(t, { running = false, mapBusy = false, activeGame = () => 'saikutu', gameBusy = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'server-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bridge = path.join(root, 'bridge'), calls = [], config = {}, handlers = new Map();
  createServerFiles({
    getServerRoot: () => root, getBridgeBatDir: () => bridge, readAppConfig: () => config,
    assertMapIdle: () => { if (mapBusy) throw new Error('MAPを保存・読込中です。完了までお待ちください。'); },
    serverChild: () => (running ? { pid: 1 } : null),
    waitForBridgeMod: async () => { calls.push('wait'); return true; },
    requestBridgeMod: async (...args) => { calls.push(args); return { ok: true, environmentFixed: true }; },
    activeGame,
    assertGameProfileIdle: () => { if (gameBusy) throw new Error('ゲームの切替中、または切替の復旧が必要です。ホームのゲーム選択を確認してください'); },
  }).register({ handle: (name, fn) => handlers.set(name, fn) });
  return { root, bridge, calls, config, invoke: (name, ...args) => handlers.get(name)({}, ...args) };
}

test('OP の付与と古いゲームルールの窓口: サーバーが動いていれば BridgeMOD の応答を待ってから、main から受け取った通信で送る', async t => {
  const x = setup(t, { running: true });
  x.config.minecraftPlayerName = 'Steve_01';
  // 前の版の配布物には、開発者のマイクラIDを OP にする _op.txt が紛れていた。残っていても、保存したマイクラIDで書き直してから送る
  // （2026-10-29 ユーザーの決定：配布物から外す。OP の自動付与は外さない）。
  fs.mkdirSync(path.join(x.bridge, 'commands', 'minecraft'), { recursive: true });
  fs.writeFileSync(path.join(x.bridge, 'commands', 'minecraft', '_op.txt'), '# TITLE: OP付与\nop Douma_Akahori\n');
  assert.deepEqual(await x.invoke('minecraft:grantOp'), { ok: true, name: 'Steve_01' });
  assert.deepEqual(x.calls, ['wait', ['POST', '/bridge/event', { type: 'other', key: '_op', count: 1, listenerName: 'system', announce: false }]]);
  assert.equal(fs.readFileSync(path.join(x.bridge, 'commands', 'minecraft', '_op.txt'), 'utf8'), '# TITLE: OP付与\nop Steve_01\n');
  x.calls.length = 0;
  assert.deepEqual(await x.invoke('server:gamerules:apply'), { ok: true, transport: 'bridge_mod' });
  assert.deepEqual(x.calls, ['wait', ['GET', '/bridge/status']]);
});

test('server.properties の書き込み: 先に MAP の作業中でないかを確かめる', async t => {
  const x = setup(t, { mapBusy: true });
  fs.writeFileSync(path.join(x.root, 'server.properties'), 'motd=old\n');
  await assert.rejects(x.invoke('server:props:write', { motd: 'new' }), /MAPを保存・読込中です/);
  assert.equal(fs.readFileSync(path.join(x.root, 'server.properties'), 'utf8'), 'motd=old\n');
});

// 配信ホームの「配信ワールド」には、今のゲームで使えるワールドだけを出す（2026-10-30 ユーザーの決定）。
// 埋め立ては埋め立ての専用マップだけ。採掘は、どのゲームの専用マップでもないもの全部（自然に生成された world・プレイヤーが作ったマップ・配ったマップ）。
test('配信ワールドの一覧：埋め立てでは umetate_lab_map だけ。採掘では umetate_lab_map 以外の全部。フォルダーでないものは出さない', async t => {
  let active = 'umetate';
  const x = setup(t, { activeGame: () => active });
  for (const name of ['world', 'event', 'umetate_lab_map']) fs.mkdirSync(path.join(x.root, 'haihu_world', name), { recursive: true });
  fs.writeFileSync(path.join(x.root, 'haihu_world', 'note.txt'), 'x');
  assert.deepEqual(await x.invoke('server:worlds:list'), ['umetate_lab_map']);
  active = 'saikutu';
  assert.deepEqual((await x.invoke('server:worlds:list')).sort(), ['event', 'world']);
  // ゲームを保存していない（null）・選択肢に出さないサバイバルも、採掘と同じ。
  for (const game of [null, 'common']) { active = game; assert.deepEqual((await x.invoke('server:worlds:list')).sort(), ['event', 'world'], String(game)); }
});

// ゲームの切り替えの間（埋め立てのマップを写している数秒など）に配信ワールドを保存すると、切り替えで上書きされ、覚える値も古くなる（軽い9）。
test('server.properties の書き込み：ゲームの切り替え中・復旧が必要なときは書かない', async t => {
  const x = setup(t, { gameBusy: true });
  fs.writeFileSync(path.join(x.root, 'server.properties'), 'level-name=haihu_world/world\n');
  await assert.rejects(x.invoke('server:props:write', { 'level-name': 'haihu_world/event' }), /ゲームの切替中/);
  assert.equal(fs.readFileSync(path.join(x.root, 'server.properties'), 'utf8'), 'level-name=haihu_world/world\n');
});

// main.cjs のつなぎ（渡し忘れると、埋め立てで umetate_lab_map が一覧から消えても、ほかのテストは通る。軽い2）。
test('main.cjs：配信ワールドの一覧に今のゲームを、server.properties の書き込みにゲームの操作中の確かめを渡す', () => {
  const main = fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8');
  const start = main.indexOf('createServerFiles({');
  const block = main.slice(start, main.indexOf('});', start));
  assert.match(block, /activeGame: \(\) => gameProfiles\.list\(\)\.active,/);
  assert.match(block, /assertGameProfileIdle,/);
});
