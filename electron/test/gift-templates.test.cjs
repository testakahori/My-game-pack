const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createGiftTemplates, parseTemplate } = require('../gift_templates.cjs');
const row = { giftId: '5655', name: 'バラ', commandFile: 'heal.txt', repeat: 2 };
const template = { format: 'mygamepack-gift-template', version: 1, name: '雑談セット', appVersion: '1.0.39', mappings: [row] };
function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mygamepack-gift-template-'));
  t.after(() => { assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(root, { recursive: true, force: true }); });
  const configPath = path.join(root, 'config.json');
  const filePath = path.join(root, '雑談セット.json');
  const initial = { tiktokUsername: 'private-account', rcon: { password: 'private-password' }, options: { commandsDir: 'D:/private' }, mappings: [{ giftId: '7934', name: 'ハート', commandFile: 'zombie.txt', repeat: 1 }] };
  fs.writeFileSync(configPath, JSON.stringify(initial));
  fs.writeFileSync(filePath, JSON.stringify(template));
  const state = { configPath, commands: [{ name: 'heal.txt', title: '回復！' }, { name: 'zombie.txt', title: 'ゾンビ' }], writes: 0, now: 1_800_000_000_000, fail: false, canceled: false, exportPath: filePath };
  const service = createGiftTemplates({
    dialog: { showSaveDialog: async () => ({ canceled: state.canceled, filePath: state.exportPath }), showOpenDialog: async () => ({ canceled: state.canceled, filePaths: [filePath] }) },
    context: () => state, appVersion: () => '1.0.39', now: () => state.now,
    writeConfig: next => { if (state.fail) throw new Error('disk full'); state.writes++; fs.writeFileSync(state.configPath, JSON.stringify(next)); },
  });
  return { root, configPath, filePath, initial, state, service, read: () => JSON.parse(fs.readFileSync(state.configPath, 'utf8')) };
}
test('shared templates export only gift/name/command/repeat, without account, password or paths', async t => {
  const h = harness(t);
  h.initial.mappings[0].privateExtra = 'secret-extra';
  fs.writeFileSync(h.configPath, JSON.stringify(h.initial));
  const result = await h.service.save();
  const raw = fs.readFileSync(h.filePath, 'utf8');
  const saved = JSON.parse(raw);
  assert.equal(result.count, 1);
  assert.equal(saved.name, '雑談セット');
  assert.equal(saved.appVersion, '1.0.39');
  assert.deepEqual(Object.keys(saved.mappings[0]), ['giftId', 'name', 'commandFile', 'repeat']);
  assert.doesNotMatch(raw, /private-account|private-password|D:\/private|secret-extra|rcon|tiktokUsername/);
  assert.equal(h.state.writes, 0);
});
test('import preview is read-only; applying replaces assignments and preserves latest unrelated settings', async t => {
  const h = harness(t);
  const opened = await h.service.open();
  assert.equal(opened.preview.currentCount, 1);
  assert.equal(opened.preview.mappings[0].title, '回復！');
  assert.deepEqual(h.read(), h.initial);
  const changed = h.read(); changed.options.someNewSetting = true;
  fs.writeFileSync(h.configPath, JSON.stringify(changed));
  assert.deepEqual(h.service.apply(opened.preview.token).mappings, [row]);
  assert.deepEqual(h.read(), { ...changed, mappings: [row] });
  assert.equal(h.state.writes, 1);
  assert.throws(() => h.service.apply(opened.preview.token), /期限切れ/);
});
test('canceling file dialogs or the preview leaves existing settings untouched', async t => {
  const h = harness(t);
  h.state.canceled = true;
  assert.equal((await h.service.save()).canceled, true);
  assert.equal((await h.service.open()).canceled, true);
  h.state.canceled = false;
  const opened = await h.service.open(); h.service.cancel(opened.preview.token);
  assert.throws(() => h.service.apply(opened.preview.token), /期限切れ/);
  assert.deepEqual(h.read(), h.initial);
  assert.equal(h.state.writes, 0);
});
test('missing commands are shown before import and checked again at apply time', async t => {
  const h = harness(t);
  h.state.commands = [];
  const opened = await h.service.open();
  assert.deepEqual(opened.preview.missingCommands, ['heal.txt']);
  assert.throws(() => h.service.apply(opened.preview.token), /ないコマンド/);
  assert.deepEqual(h.read(), h.initial);
  h.state.commands = [{ name: 'heal.txt', title: '回復！' }];
  const ready = await h.service.open(); h.state.commands = [];
  assert.throws(() => h.service.apply(ready.preview.token), /ないコマンド/);
});
test('concurrent assignment edits, changed server folder and expired previews cannot be overwritten', async t => {
  const h = harness(t);
  const opened = await h.service.open();
  const changed = h.read(); changed.mappings[0].repeat = 7;
  fs.writeFileSync(h.configPath, JSON.stringify(changed));
  assert.throws(() => h.service.apply(opened.preview.token), /別の操作/);
  const second = await h.service.open(); h.state.configPath = path.join(h.root, 'different.json');
  assert.throws(() => h.service.apply(second.preview.token), /保存先/);
  h.state.configPath = h.configPath;
  const third = await h.service.open(); h.state.now += 16 * 60 * 1000;
  assert.throws(() => h.service.apply(third.preview.token), /期限切れ/);
  assert.deepEqual(h.read(), changed);
});
test('write failure propagates, keeps existing settings, and allows retry', async t => {
  const h = harness(t), opened = await h.service.open();
  h.state.fail = true;
  assert.throws(() => h.service.apply(opened.preview.token), /disk full/);
  assert.deepEqual(h.read(), h.initial);
  h.state.fail = false;
  assert.equal(h.service.apply(opened.preview.token).ok, true);
});
test('only validated preview data is applied, even if the selected file changes afterward', async t => {
  const h = harness(t), opened = await h.service.open();
  fs.writeFileSync(h.filePath, 'not JSON anymore');
  h.service.apply(opened.preview.token);
  assert.deepEqual(h.read().mappings, [row]);
});
test('invalid files, unsupported versions, duplicate IDs and unsafe names fail before writes', () => {
  for (const value of [null, {}, { ...template, version: 2 }, { ...template, mappings: [] }, { ...template, mappings: [row, row] },
    { ...template, mappings: [{ ...row, commandFile: '../heal.txt' }] }, { ...template, mappings: [{ ...row, commandFile: '_gamerules.txt' }] },
    ...[0, 101, 1.5, '2'].map(repeat => ({ ...template, mappings: [{ ...row, repeat }] }))]) assert.throws(() => parseTemplate(JSON.stringify(value)));
  assert.throws(() => parseTemplate('{broken'), /JSON/);
  assert.deepEqual(parseTemplate('\uFEFF' + JSON.stringify({ ...template, password: 'unwanted', mappings: [{ ...row, giftId: 5655, extra: 'unwanted' }] })).mappings, [row]);
});
test('oversize templates and exporting over the live config are rejected', async t => {
  const h = harness(t);
  fs.writeFileSync(h.filePath, ' '.repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(h.service.open(), /2MB/);
  h.state.exportPath = h.configPath;
  await assert.rejects(h.service.save(), /上書きできません/);
  assert.deepEqual(h.read(), h.initial);
});
