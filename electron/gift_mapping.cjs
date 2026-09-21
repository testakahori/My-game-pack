const { isDeepStrictEqual } = require('node:util');

// Apply one gift edit to the latest config. Never replace other gifts or settings
// with a renderer snapshot; reject a concurrent edit to this particular gift.
function updateGiftMapping(config, request, commandNames) {
  const { giftId, name, commandFile, repeat, expected } = request || {};
  if (typeof giftId !== 'string' || !giftId.trim() || giftId.length > 100) throw new Error('ギフトIDが不正です。');
  if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('ギフト名が不正です。');
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) throw new Error('実行回数は1〜100の整数にしてください。');
  if (typeof commandFile !== 'string' || !commandNames.includes(commandFile)) throw new Error('選択したコマンドが見つかりません。一覧を読み直してください。');
  const mappings = config.mappings || [];
  if (!Array.isArray(mappings)) throw new Error('登録済みギフトを読み取れません。');
  const matches = mappings.filter(row => String(row.giftId) === giftId);
  if (!Array.isArray(expected) || !isDeepStrictEqual(matches, expected)) throw new Error('このギフトの設定が別の操作で変更されました。閉じて開き直してから保存してください。');
  if (matches.length > 1) throw new Error('このギフトが重複登録されています。ギフト設定で重複を解消してください。');
  const updated = { ...matches[0], giftId, name, commandFile, repeat };
  return { ...config, mappings: matches.length ? mappings.map(row => String(row.giftId) === giftId ? updated : row) : [...mappings, updated] };
}

module.exports = { updateGiftMapping };
