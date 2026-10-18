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
  const started = { tiktokUsername: 'a', rcon: { port: 25575 }, options: { commandTransport: 'bridge_mod', bridgeModPort: 25576, commandsDir: 'commands/minecraft', mutedUsers: [] }, mappings: [] };
  assert.deepEqual(restartRequired(started, { ...started, mappings: [{ giftId: '1' }], options: { ...started.options, mutedUsers: ['x'] } }), []);
  assert.deepEqual(restartRequired(started, { ...started, tiktokUsername: ' b ', options: { ...started.options, bridgeModPort: 25600, commandsDir: 'x' } }), ['TikTok ID', 'BridgeMOD のポート', 'コマンドの場所']);
  assert.deepEqual(restartRequired(started, { ...started, tiktokUsername: ' a ', options: { ...started.options, commandTransport: ' BRIDGE_MOD ' } }), [], '前後の空白・大文字小文字だけの違いは同じ');
  assert.deepEqual(restartRequired(started, { ...started, rcon: { port: 25580 } }), ['RCON・Telnet の接続先']);
  assert.deepEqual(restartRequired({ options: { doumaModPort: 25600 } }, { options: { bridgeModPort: 25600 } }), [], '旧い名前の同じ値は同じ');
  assert.deepEqual(restartRequired({ options: { commandTransport: 'bridge_mod', bridgeModHost: '127.0.0.1' } }, { options: { commandTransport: 'rcon', bridgeModHost: ' 10.0.0.2 ' } }), ['送り方', 'BridgeMOD のホスト']);
});
