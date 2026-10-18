'use strict';
const { FILES } = require('./saikutu_commands.cjs');
const { isTxtName } = require('../bridge/command_files.cjs');
const GAME_IDS = new Set(['common', 'umetate', 'run', 'saikutu']);
function assertGameReady(status) {
  if (!status?.applied || status.recoveryRequired || !GAME_IDS.has(status.active)) {
    throw new Error('TOPでプレイするゲームを選び「保存」を押してから設定してください。');
  }
}
function availableGameCommands(names, status) {
  if (!status?.applied || status.recoveryRequired || !GAME_IDS.has(status.active)) return [];
  return names.filter(name => {
    if (typeof name !== 'string' || !isTxtName(name) || name.startsWith('_') || /[\\/]/.test(name) || FILES.has(name.toLowerCase())) return false;
    const game = /^game_(umetate|run|saikutu)_/.exec(name);
    return !game || game[1] === status.active;
  });
}
function assertGameCommands(config, names, status) {
  assertGameReady(status);
  if ((config?.gameProfile || 'common') !== status.active) throw new Error('ゲームが切り替わっています。設定画面を開き直してください。');
  const available = new Set(availableGameCommands(names, status));
  function walk(value, location) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'commandFile' && typeof item === 'string' && item && !available.has(item)) {
        throw new Error('選択したゲームでは使えないコマンドです: ' + item + '（' + location + '）。TOPでゲームを確認してください。');
      }
      if (item && typeof item === 'object') walk(item, location ? location + '.' + key : key);
    }
  }
  walk(config, '');
}
module.exports = { assertGameReady, availableGameCommands, assertGameCommands };
