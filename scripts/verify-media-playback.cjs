// Optional real Chromium decoder check. Run with Electron and a folder containing
// qa-stamp.png, qa-voice.wav (3+ sec), qa-video.mp4 (4+ sec, with audio).
// This creates isolated test windows and never attaches to the user's app.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMediaEffects } = require('../electron/media_effects.cjs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mygamepack-render-test-'));
app.setPath('userData', path.join(directory, 'electron'));
let effects;
const windows = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await sleep(50); }
  throw new Error('Timed out: ' + label);
}
app.whenReady().then(async () => {
  const fixtures = process.argv[2]; if (!fixtures) throw new Error('Fixture folder argument is required.');
  effects = createMediaEffects({ directory: path.join(directory, 'effects'), port: 0 }); await effects.start();
  await effects.importFiles(['qa-stamp.png', 'qa-voice.wav', 'qa-video.mp4'].map(name => path.join(fixtures, name)));
  const initial = effects.state(), [png, audio, video] = initial.settings.assets;
  const rule = { id: 'test', name: 'QA', enabled: true, trigger: 'likes', threshold: 100, giftId: '5655', coinMode: 'unit', visualId: png.id, audioId: '', x: 78, y: 72, width: 30, volume: 80, duration: 10, cooldown: 0 };
  initial.settings.profiles[0].rules = [rule]; effects.save(initial.settings, initial.revision);
  for (const channel of ['live', 'preview']) {
    const win = new BrowserWindow({ show: false, width: 960, height: 540, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required', partition: 'media-decoder-test' } });
    windows.push(win); await win.loadURL(effects.url(channel));
  }
  const [live, preview] = windows, js = (win, code) => win.webContents.executeJavaScript(code);
  await until(() => effects.state().liveClients === 1 && effects.state().previewClients === 1, 'SSE connection');
  effects.receive({ id: 'baseline', type: 'like', total: 0 }); effects.receive({ id: 'like', type: 'like', total: 100 });
  await until(() => js(live, "document.querySelector('img')?.naturalWidth > 0"), 'PNG decode');
  assert.equal(await js(live, "document.querySelector('img').style.left"), '78%');
  assert.equal(await js(preview, "document.querySelectorAll('img').length"), 0);
  assert.equal(await js(live, "getComputedStyle(document.body).backgroundColor"), 'rgba(0, 0, 0, 0)');
  effects.control('stop');
  const counted = effects.state(); counted.settings.profiles[0].rules[0].duration = 1; effects.save(counted.settings, counted.revision);
  for (const win of windows) await js(win, `globalThis.stampStarts = 0; new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeName === 'IMG') globalThis.stampStarts++;
  }).observe(document.querySelector('#stage'), { childList: true });`);
  effects.receive({ id: 'baseline-multiple', type: 'like', total: 0 });
  assert.equal(effects.receive({ id: 'multiple', type: 'like', total: 350 }).plays[0].count, 3);
  await until(async () => await js(live, 'globalThis.stampStarts') === 3 && effects.state().playing === '', 'three individual live stamps');
  assert.equal(await js(preview, 'globalThis.stampStarts'), 0);
  assert.equal(effects.testEvent({ type: 'like', previousLikes: 0, total: 350 }).plays[0].count, 3);
  await until(async () => await js(preview, 'globalThis.stampStarts') === 3 && effects.state().previewPlaying === '', 'three individual preview stamps');
  assert.equal(await js(live, 'globalThis.stampStarts'), 3);
  effects.testAsset(audio.id);
  await until(() => js(preview, "document.querySelector('audio')?.currentTime > .1"), 'WAV playback');
  assert.equal(await js(preview, "document.querySelector('audio').volume"), .35);
  await until(() => preview.webContents.isCurrentlyAudible(), 'Chromium audio output');
  effects.control('pause'); await sleep(150);
  const at = await js(preview, "document.querySelector('audio').currentTime"); await sleep(200);
  assert.ok(Math.abs(await js(preview, "document.querySelector('audio').currentTime") - at) < .08);
  effects.control('mute'); effects.control('resume'); await sleep(100);
  assert.equal(await js(preview, "document.querySelector('audio').muted"), true);
  effects.control('stop'); await until(() => js(preview, "document.querySelectorAll('audio').length === 0"), 'audio stop');
  effects.control('unmute'); effects.testAsset(video.id);
  await until(() => js(preview, "document.querySelector('video')?.videoWidth === 640 && document.querySelector('video')?.currentTime > .1"), 'MP4 decode/playback');
  await until(() => preview.webContents.isCurrentlyAudible(), 'MP4 audio output');
  await until(() => effects.state().previewPlaying === '', 'video end advances queue');
  effects.calibration();
  await until(() => js(preview, "!!document.querySelector('.calibration')"), 'preflight visual');
  await until(() => preview.webContents.isCurrentlyAudible(), 'preflight tone');
  effects.confirm('visual'); effects.confirm('audio'); assert.equal(effects.preflight().status, 'ok');
  effects.control('stop'); await until(() => js(preview, "document.querySelector('#stage').childElementCount === 0"), 'all stop');
  assert.equal(effects.state().error, '');
  console.log('PASS: PNG / 350 likes -> 3 individual stamps (live and preview) / transparent live output / preview isolation / WAV / pause / mute / stop / MP4 / audio / completion / preflight');
}).then(() => finish(0), error => { console.error(error); finish(1); });
function finish(code) {
  effects?.close(); for (const win of windows) if (!win.isDestroyed()) win.destroy();
  // Electron may still hold cache files until exit. Keep its isolated temp folder
  // for the OS to clean up; do not delete a live Chromium profile recursively.
  app.exit(code);
}
