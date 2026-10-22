'use strict';
const { FILES } = require('./saikutu_commands.cjs');
const { isTxtName, ensureTxt, commandFileRefs } = require('../bridge/command_files.cjs');
// ゲームの一覧とゲーム専用の判定は bridge/game_commands.cjs の1か所（処理のコピー PR6）。
const { GAME_IDS: GAME_ID_LIST, gameOfCommand } = require('../bridge/game_commands.cjs');
const GAME_IDS = new Set(GAME_ID_LIST);
function assertGameReady(status) {
  if (!status?.applied || status.recoveryRequired || !GAME_IDS.has(status.active)) {
    throw new Error('TOPでプレイするゲームを選び「保存」を押してから設定してください。');
  }
}
function availableGameCommands(names, status) {
  if (!status?.applied || status.recoveryRequired || !GAME_IDS.has(status.active)) return [];
  return names.filter(name => {
    if (typeof name !== 'string' || !isTxtName(name) || name.startsWith('_') || /[\\/]/.test(name) || FILES.has(name.toLowerCase())) return false;
    // ほかのゲームのコマンドは出さない（大文字の GAME_RUN_X.TXT も RUN のもの）。game_mode_on.txt などは共通。
    const game = gameOfCommand(name);
    return !game || game === status.active;
  });
}
function assertGameCommands(config, names, status) {
  assertGameReady(status);
  if ((config?.gameProfile || 'common') !== status.active) throw new Error('ゲームが切り替わっています。設定画面を開き直してください。');
  // 確かめるのは BRIDGE が動かしうる参照だけ（command_files.cjs の commandFileRefs の1か所。処理のコピー PR5）。
  const available = availableSet(names, status);
  for (const ref of commandFileRefs(config)) checkCommandFile(ref.commandFile, available, ref.where);
}
// 名前は .txt を付けて、大文字小文字を区別せずに比べる（BRIDGE・BridgeMOD と同じ。処理のコピー PR5）。
function availableSet(names, status) {
  return new Set(availableGameCommands(names, status).map(name => name.toLowerCase()));
}
function checkCommandFile(commandFile, available, where) {
  if (!available.has(ensureTxt(commandFile).toLowerCase())) {
    throw new Error('選択したゲームでは使えないコマンドです: ' + commandFile + '（' + where + '）。TOPでゲームを確認してください。');
  }
}
// 設定の外で1つのコマンドだけを確かめる（テスト発火の「ギフト（コマンド直接）」。PR5 の最終レビュー）。
function assertGameCommandFile(commandFile, names, status, where) {
  assertGameReady(status);
  checkCommandFile(String(commandFile ?? '').trim(), availableSet(names, status), where);
}
module.exports = { assertGameReady, availableGameCommands, assertGameCommands, assertGameCommandFile };
