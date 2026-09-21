const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { atomicWrite } = require('./settings_backups.cjs');

const FORMAT = 'mygamepack-gift-template';
const MAX_BYTES = 2 * 1024 * 1024;
function normalizeMappings(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) throw new Error('ギフトの割り当ては1〜1000件にしてください。');
  const ids = new Set();
  return value.map((row, index) => {
    const label = `${index + 1}件目`;
    const giftId = String(row?.giftId ?? '').trim();
    if (!/^\d{1,30}$/.test(giftId)) throw new Error(`${label}: ギフトIDが不正です。`);
    if (ids.has(giftId)) throw new Error(`${label}: ギフトID ${giftId} が重複しています。`);
    ids.add(giftId);
    const commandFile = row?.commandFile;
    if (typeof commandFile !== 'string' || !/^[^<>:"/\\|?*\x00-\x1f]{1,150}\.txt$/.test(commandFile) || commandFile.startsWith('_')) throw new Error(`${label}: コマンドのファイル名が不正です。`);
    const repeat = row.repeat ?? 1;
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) throw new Error(`${label}: 実行回数は1〜100の整数にしてください。`);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : giftId;
    if (name.length > 100) throw new Error(`${label}: ギフト名は100文字以内にしてください。`);
    // Whitelist portable fields; account, RCON, local paths and arbitrary extras
    // from either config or a shared file must never enter a template/assignment.
    return { giftId, name, commandFile, repeat };
  });
}
function parseTemplate(raw) {
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) throw new Error('ギフト設定ファイルは2MBまでです。');
  let value;
  try { value = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { throw new Error('JSONを読み取れません。保存したギフト設定のファイルを選んでください。'); }
  if (value?.format !== FORMAT || value.version !== 1) throw new Error('対応していないファイル形式です。このアプリの「ギフト設定保存」で作成したJSONを選んでください。');
  return { format: FORMAT, version: 1,
    name: typeof value.name === 'string' ? value.name.slice(0, 100) : 'ギフト設定',
    appVersion: typeof value.appVersion === 'string' ? value.appVersion.slice(0, 30) : '',
    mappings: normalizeMappings(value.mappings) };
}

function createGiftTemplates({ dialog, context, writeConfig, appVersion, now = () => Date.now() }) {
  let pending = null;
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const missing = (rows, commands) => [...new Set(rows.filter(row => !commands.some(command => command.name === row.commandFile)).map(row => row.commandFile))];
  return {
    async save() {
      const source = context();
      const mappings = normalizeMappings(read(source.configPath).mappings);
      const picked = await dialog.showSaveDialog({ title: 'ギフト設定を保存', buttonLabel: '保存', defaultPath: 'ギフト設定_' + new Date(now()).toISOString().slice(0, 10) + '.json', filters: [{ name: 'ギフト設定保存', extensions: ['json'] }] });
      if (picked.canceled || !picked.filePath) return { canceled: true };
      if (path.resolve(picked.filePath).toLowerCase() === path.resolve(source.configPath).toLowerCase()) throw new Error('アプリの設定ファイル自体には上書きできません。別の名前で保存してください。');
      const name = path.basename(picked.filePath).replace(/\.json$/i, '').slice(0, 100);
      const template = { format: FORMAT, version: 1, name, appVersion: appVersion(), createdAt: new Date(now()).toISOString(), mappings };
      atomicWrite(picked.filePath, JSON.stringify(template, null, 2) + '\n');
      return { canceled: false, path: picked.filePath, name, count: mappings.length };
    },
    async open() {
      pending = null;
      const picked = await dialog.showOpenDialog({ title: 'ギフト設定を読込', buttonLabel: '読込', properties: ['openFile'], filters: [{ name: 'ギフト設定保存', extensions: ['json'] }] });
      if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
      const file = picked.filePaths[0];
      if (fs.statSync(file).size > MAX_BYTES) throw new Error('ギフト設定ファイルは2MBまでです。');
      const template = parseTemplate(fs.readFileSync(file, 'utf8'));
      const source = context();
      const before = read(source.configPath).mappings || [];
      if (!Array.isArray(before)) throw new Error('現在のギフト設定を読み取れません。運用センターで設定を確認してください。');
      const token = randomUUID();
      pending = { token, template, before, configPath: path.resolve(source.configPath), expires: now() + 15 * 60 * 1000 };
      return { canceled: false, preview: { token, name: template.name || path.basename(file), appVersion: template.appVersion,
        currentCount: before.length, missingCommands: missing(template.mappings, source.commands),
        mappings: template.mappings.map(row => ({ ...row, title: source.commands.find(command => command.name === row.commandFile)?.title || row.commandFile })) } };
    },
    apply(token) {
      if (!pending || pending.token !== token || pending.expires < now()) throw new Error('読込の確認が期限切れです。ファイルを選び直してください。');
      const source = context();
      if (path.resolve(source.configPath) !== pending.configPath) throw new Error('サーバーの保存先が変わりました。ファイルを選び直してください。');
      const current = read(source.configPath);
      if (!isDeepStrictEqual(current.mappings || [], pending.before)) throw new Error('ギフト設定が別の操作で変更されました。ファイルを選び直して確認してください。');
      const unavailable = missing(pending.template.mappings, source.commands);
      if (unavailable.length) throw new Error('このアプリにないコマンドがあります: ' + unavailable.join('、'));
      const next = { ...current, mappings: pending.template.mappings };
      // The existing writer makes a backup, validates, and atomically saves.
      // Read/check/write is synchronous; failed writes leave the preview retryable.
      writeConfig(next);
      pending = null;
      return { ok: true, mappings: next.mappings };
    },
    cancel(token) { if (pending?.token === token) pending = null; },
  };
}
module.exports = { normalizeMappings, parseTemplate, createGiftTemplates };
