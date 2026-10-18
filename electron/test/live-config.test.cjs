// 配信中に保存した設定を BRIDGE の再起動なしで効かせる（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 8）。
// すぐ効かせる値の式と、再起動が要る「つなぎ方」の比べ方は bridge/live_config.cjs の1か所。
const test = require('node:test');
const assert = require('node:assert/strict');
const { liveOptions, restartRequired } = require('../../bridge/live_config.cjs');

test('すぐ効かせる値: 今の BRIDGE と同じ式で作る（既定値と範囲の丸め）', () => {
  assert.deepEqual(liveOptions({}), { giftCooldownMs: 300, maxCommandsPerGift: 200, maxLikeCatchUpPerEvent: 5, rconQueueWarnSize: 20, likeBatchWindowMs: 1200, streakTtlMs: 60000,
    logUnknownGifts: false, mutedUsers: [], ttsNgWords: [], announceFunction: 'gift_stream:_announce', announceStorage: 'gift_stream:bridge',
    announceEveryRepeat: true, announceEnabled: true, protection: { enabled: false }, gameplay: {} });
  const v = liveOptions({ maxLikeCatchUpPerEvent: 500, likeBatchWindowMs: 50, ttsNgWords: [' a ', '', 3], mutedUsers: ['troll'], announceEnabled: false, gameplay: { timedMode: { multiplier: 2 } } });
  assert.deepEqual([v.maxLikeCatchUpPerEvent, v.likeBatchWindowMs, v.ttsNgWords, v.mutedUsers, v.announceEnabled, v.gameplay.timedMode.multiplier], [100, 100, ['a', '3'], ['troll'], false, 2]);
  assert.deepEqual(liveOptions(undefined), liveOptions({}), 'options がない設定でも既定値');
  assert.deepEqual([liveOptions({ streakTtlMs: 1 }).streakTtlMs, liveOptions({ streakTtlMs: 9e9 }).streakTtlMs], [5000, 600000], '連打の区切りの時間も今の範囲に丸める');
});

test('配信ホーム: BRIDGE の状態の pendingRestart があれば「BRIDGE を再起動すると反映されます（名前）」を出す', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../src/components/DashboardPage.tsx'), 'utf8');
  assert.match(source, /bridgeProcess\.pendingRestart\?\.length/);
  assert.match(source, /BRIDGE を再起動すると反映されます（\{bridgeProcess\.pendingRestart\.join\("・"\)\}）。/);
});

test('つなぎ方: 違うものの名前だけを決まった順で返す。つなぎ方以外の違いは数えない', () => {
  const base = require('node:path').resolve('bridge-dir');
  const started = { tiktokUsername: 'a', rcon: { port: 25575 }, options: { commandTransport: 'bridge_mod', bridgeModPort: 25576, commandsDir: 'commands/minecraft', mutedUsers: [] }, mappings: [] };
  const changed = next => restartRequired(started, next, base);
  assert.deepEqual(changed({ ...started, mappings: [{ giftId: '1' }], options: { ...started.options, mutedUsers: ['x'] } }), []);
  assert.deepEqual(changed({ ...started, tiktokUsername: ' b ', options: { ...started.options, bridgeModPort: 25600, commandsDir: 'x' } }), ['TikTok ID', 'BridgeMOD のポート', 'コマンドの場所']);
  assert.deepEqual(changed({ ...started, tiktokUsername: ' a ', options: { ...started.options, commandTransport: ' BRIDGE_MOD ' } }), [], '前後の空白・大文字小文字だけの違いは同じ');
  assert.deepEqual(restartRequired({ options: { doumaModPort: 25600, commandTransport: 'bridge_mod' } }, { options: { bridgeModPort: 25600, commandTransport: 'bridge_mod' } }, base), [], '旧い名前の同じ値は同じ');
  assert.deepEqual(restartRequired({ options: { commandTransport: 'bridge_mod' } }, { options: { commandTransport: 'rcon' } }, base), ['送り方'], '送り方が変われば、送り方だけを出す');
});

// 実際に使う値で比べる（PR2 の最終レビュー）。並び・書き方・使っていない接続先の違いで、要らない再起動を促さない。
test('つなぎ方: 実際に使う値で比べる（同じフォルダーの相対と絶対、RCON のキーの並びと数の書き方、使っていない接続先）', () => {
  const path = require('node:path');
  const base = path.resolve('bridge-dir');
  const rcon = { tiktokUsername: 'a', rcon: { host: '127.0.0.1', port: 25575, password: 'x' }, options: { commandTransport: 'rcon', commandsDir: 'commands/minecraft' } };
  assert.deepEqual(restartRequired(rcon, { ...rcon, options: { ...rcon.options, commandsDir: path.join(base, 'commands', 'minecraft') } }, base), [], '同じフォルダーの相対と絶対');
  assert.deepEqual(restartRequired(rcon, { ...rcon, rcon: { password: 'x', port: '25575', host: ' 127.0.0.1 ' } }, base), [], 'キーの並び・数の書き方・前後の空白');
  assert.deepEqual(restartRequired(rcon, { ...rcon, rcon: { host: '127.0.0.1', port: 25580, password: 'x' } }, base), ['RCON・Telnet の接続先']);
  const mod = { tiktokUsername: 'a', options: { commandTransport: 'bridge_mod' } };
  assert.deepEqual(restartRequired(mod, { ...mod, rcon: { host: '10.0.0.2', port: 1 } }, base), [], 'BridgeMOD で送っているときの RCON の変更');
  assert.deepEqual(restartRequired(mod, { ...mod, options: { commandTransport: 'http' } }, base), [], 'どちらも BridgeMOD で送る名前');
  assert.deepEqual(restartRequired(rcon, { ...rcon, options: { ...rcon.options, bridgeModPort: 1 } }, base), [], 'RCON で送っているときの BridgeMOD のポートの変更');
});
