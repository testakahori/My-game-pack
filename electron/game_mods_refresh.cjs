"use strict";
// アプリを更新したあと、今選んでいるゲームの MOD（サーバーと Minecraft の両方）とゲームのコマンドを、
// ホームの「保存」と同じ処理で新しくする（2026-10-13 ユーザーの決定）。
// 入れ替えられないとき（サーバーや Minecraft が動いている、など）は何も変えず、次にアプリを起動したときにもう一度試す。
// まだ一度もゲームを「保存」していないときは何もしない（あとで「保存」すれば今の版が置かれる）。

async function refreshGameModsAfterUpdate({ version, readConfig, writeConfig, profiles, run = action => action() }) {
  if (readConfig().gameModsVersion === version) return { state: 'current' };
  const status = profiles.list();
  if (!status.applied && !status.recoveryRequired) {
    writeConfig({ gameModsVersion: version, gameModsRefreshFailed: '' });
    return { state: 'skipped' };
  }
  try {
    if (status.recoveryRequired) throw new Error('前回の切替が途中で止まっています。ホームで切替前の状態に戻してください');
    await run(() => profiles.activate(status.active));
  } catch (error) {
    writeConfig({ gameModsRefreshFailed: version });
    return { state: 'failed', error: error?.message || String(error) };
  }
  writeConfig({ gameModsVersion: version, gameModsRefreshFailed: '' });
  return { state: 'done', game: status.active };
}

// ホームに「MODが古いまま」と出すか：この版で入れ替えられず、まだ新しくしていないとき。
function gameModsOutdated(config, version) {
  return config.gameModsRefreshFailed === version && config.gameModsVersion !== version;
}

module.exports = { refreshGameModsAfterUpdate, gameModsOutdated };
