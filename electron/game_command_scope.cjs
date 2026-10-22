'use strict';
const { FILES } = require('./saikutu_commands.cjs');
const { isTxtName, ensureTxt, commandFileRefs } = require('../bridge/command_files.cjs');
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
  // 確かめるのは BRIDGE が動かしうる参照だけ（command_files.cjs の commandFileRefs の1か所。処理のコピー PR5）。
  // 名前は .txt を付けて、大文字小文字を区別せずに比べる（BRIDGE・BridgeMOD と同じ）。
  const available = new Set(availableGameCommands(names, status).map(name => name.toLowerCase()));
  for (const ref of commandFileRefs(config)) {
    if (!available.has(ensureTxt(ref.commandFile).toLowerCase())) {
      throw new Error('選択したゲームでは使えないコマンドです: ' + ref.commandFile + '（' + ref.where + '）。TOPでゲームを確認してください。');
    }
  }
}
module.exports = { assertGameReady, availableGameCommands, assertGameCommands };
