// BRIDGE の読み上げの設定（BRIDGE のフォルダーの tts-settings.json）が壊れても、読み上げを切っていた配信者の読み上げが動き出さない
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.2・9。設定ファイルの PR2）。
// 本番の bridge/index.js を試験台で動かし、コメントを送って、読み上げに回ったかを見る（声は出さない）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridgeFixture } = require('./helpers/bridge-fixture.cjs');
const { createSafeJsonFile } = require('../../bridge/safe_json_file.cjs');

// userData 側の読み上げの設定（main が起動のときに TTS_SETTINGS_FALLBACK_FILE で場所を渡す）。
function userDataSettings(t, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-userdata-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'tts-settings.json');
  if (value !== undefined) fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

const comment = (bridge, content = 'こんばんは') => bridge.emit('WebcastChatMessage', { content });

// 読み上げなかったことの確かめ。決まった時間だけ待つのではなく、読み上げ「あり」の正しい設定にして目印のコメントを送り、
// 目印だけが読み上げられるのを見る（コメントは届いた順に読み上げに回るので、前のコメントを読み上げていれば目印より前に入る。最後のレビューの軽い 5）。
async function expectNothingReadBefore(bridge) {
  fs.writeFileSync(path.join(bridge.dir, 'tts-settings.json'), JSON.stringify({ enabled: true }));
  await comment(bridge, '目印');
  await bridge.until(() => bridge.speech.length >= 1, 'marker speech');
  assert.deepEqual(bridge.speech.map(item => item.text), ['視聴者、目印'], '目印の前は読み上げていない');
}

// BRIDGE の記録は BRIDGE のログファイルにだけ書き、画面の BRIDGE ログ欄（BRIDGE の標準出力）には出さない（ユーザーの決定。最後のレビューの軽い 1）。
const fileLog = bridge => {
  const dir = path.join(bridge.dir, 'logs');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.startsWith('bridge-')).map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('') : '';
};
async function expectRecorded(bridge, text) {
  await bridge.until(() => fileLog(bridge).includes(text), 'file log: ' + text);
  assert.ok(!bridge.logs.some(line => line.includes('[設定]')), '画面のログ欄には出さない');
}

const brokenFiles = bridge => fs.readdirSync(bridge.dir).filter(name => name.startsWith('tts-settings.json.broken-'));

test('BRIDGE: 読み上げの設定が壊れていたら写しから戻し、読み上げを切ったまま。BRIDGE のログファイルにだけ記録する', async t => {
  const bridge = await startBridgeFixture(t);
  const file = path.join(bridge.dir, 'tts-settings.json');
  fs.writeFileSync(file + '.last-good', JSON.stringify({ enabled: false }));
  fs.writeFileSync(file, '{壊れた');
  await comment(bridge);
  await expectRecorded(bridge, '[設定] tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）ので、前の正しい状態の写しから戻した。');
  assert.equal(brokenFiles(bridge).length, 1);
  await expectNothingReadBefore(bridge);
});

// 2026-10-24 ユーザーの決定：userData 側の今の中身を、BRIDGE 側の写しより先に使う（写しは1つ前の保存。最後のレビューの重要 1）。
test('BRIDGE: 読み上げを切った直後に壊れても、userData 側の今の中身で戻し、切ったまま。userData 側には触らない', async t => {
  const fallback = userDataSettings(t, { enabled: false });
  const bridge = await startBridgeFixture(t, { env: { TTS_SETTINGS_FALLBACK_FILE: fallback } });
  const file = path.join(bridge.dir, 'tts-settings.json');
  fs.writeFileSync(file + '.last-good', JSON.stringify({ enabled: true }));
  fs.writeFileSync(file, '{壊れた');
  await comment(bridge);
  await expectRecorded(bridge, 'が壊れていた（JSON として読めない）ので、userData の読み上げの設定から戻した。');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { enabled: false });
  assert.equal(fs.readFileSync(fallback, 'utf8'), JSON.stringify({ enabled: false }), 'userData 側には触らない');
  assert.deepEqual(fs.readdirSync(path.dirname(fallback)), ['tts-settings.json']);
  await expectNothingReadBefore(bridge);
});

// 2か所とも壊れていれば、BRIDGE も userData 側の写しを見る（main と同じ値で動く。最後のレビューの軽い 3）。
test('BRIDGE: userData 側も壊れていて写しも無ければ、userData 側の写しを使う', async t => {
  const fallback = userDataSettings(t, '{壊れた');
  fs.writeFileSync(fallback + '.last-good', JSON.stringify({ enabled: false }));
  const bridge = await startBridgeFixture(t, { env: { TTS_SETTINGS_FALLBACK_FILE: fallback } });
  fs.writeFileSync(path.join(bridge.dir, 'tts-settings.json'), '{壊れた');
  await comment(bridge);
  await expectRecorded(bridge, 'userData の読み上げの設定（無ければ既定値）で動く');
  await expectNothingReadBefore(bridge);
});

// 上のテストが「読み上げたか」を見分けられることの確かめ。
test('BRIDGE: 写しも userData 側も無ければ既定値（読み上げる）', async t => {
  const bridge = await startBridgeFixture(t);
  fs.writeFileSync(path.join(bridge.dir, 'tts-settings.json'), '{壊れた');
  await comment(bridge);
  await bridge.until(() => bridge.speech.length === 1, 'speech');
  await expectRecorded(bridge, '[設定] tts-settings.json（BRIDGE のフォルダー） が壊れていた（JSON として読めない）。前の正しい状態の写しが無い（または壊れている）ので、既定値で動く。');
});

// 前の BRIDGE は、BRIDGE 側が無いと既定値（読み上げ「あり」）で動いた（PR2 の計画の決めたこと 3）。
test('BRIDGE: BRIDGE 側が無いときも userData 側を使う', async t => {
  const fallback = userDataSettings(t, { enabled: false });
  const bridge = await startBridgeFixture(t, { env: { TTS_SETTINGS_FALLBACK_FILE: fallback } });
  fs.unlinkSync(path.join(bridge.dir, 'tts-settings.json'));
  await comment(bridge);
  assert.ok(!fileLog(bridge).includes('[設定]'), '無いのは壊れていたのではないので記録しない');
  await expectNothingReadBefore(bridge);
});

test('BRIDGE: 古い版の、画面の値をそのまま書いた読み上げの設定は、壊れていると扱わない', async t => {
  const bridge = await startBridgeFixture(t);
  fs.writeFileSync(path.join(bridge.dir, 'tts-settings.json'), JSON.stringify({ enabled: false, speakerId: '3' }));
  await comment(bridge);
  assert.deepEqual(brokenFiles(bridge), []);
  await expectNothingReadBefore(bridge);
  assert.ok(!fileLog(bridge).includes('[設定]'));
});

// main（アプリ）と BRIDGE が同じファイルを読む。先に main が戻したら、BRIDGE は戻した中身で動き、同じことを2回記録しない。
test('BRIDGE: main が先に戻したあとは、戻した中身で動き、記録しない', async t => {
  const bridge = await startBridgeFixture(t);
  const file = path.join(bridge.dir, 'tts-settings.json');
  fs.writeFileSync(file + '.last-good', JSON.stringify({ enabled: false }));
  fs.writeFileSync(file, '{壊れた');
  assert.deepEqual(createSafeJsonFile({ file: () => file, defaults: () => ({}) }).read(), { enabled: false });
  await comment(bridge);
  assert.equal(brokenFiles(bridge).length, 1);
  await expectNothingReadBefore(bridge);
  assert.ok(!fileLog(bridge).includes('[設定]'));
});
