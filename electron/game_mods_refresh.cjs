"use strict";
// アプリを更新したあと、今選んでいるゲームの MOD（BridgeMOD・DisplayMOD・ゲームMOD）の jar を、サーバーと Minecraft の両方で
// 新しい版に入れ替え、ゲームのコマンドも新しくする（2026-10-13 ユーザーの決定）。ほかの MOD やファイルには触らない。
// 入れ替えられないとき（サーバーや Minecraft が動いている、など）は何も変えず、次にアプリを起動したときにもう一度試す。
// まだ一度もゲームを「保存」していないときは何もしない（あとで「保存」すれば今の版が置かれる）。

async function refreshGameModsAfterUpdate({ version, readConfig, writeConfig, profiles, run = action => action() }) {
  if (readConfig().gameModsVersion === version) return { state: 'current' };
  const status = profiles.list();
  if (!status.applied && !status.recoveryRequired) {
    writeConfig({ gameModsVersion: version, gameModsRefreshFailed: '', gameModsRefreshError: '' });
    return { state: 'skipped' };
  }
  let result;
  try {
    if (status.recoveryRequired) throw new Error('前回の切替が途中で止まっています。ホームで切替前の状態に戻してください');
    result = await run(() => profiles.refreshMods());
  } catch (error) {
    // ホームに理由も出す（PR #91 レビュー）。
    const message = error?.message || String(error);
    writeConfig({ gameModsRefreshFailed: version, gameModsRefreshError: message });
    return { state: 'failed', error: message };
  }
  writeConfig({ gameModsVersion: version, gameModsRefreshFailed: '', gameModsRefreshError: '' });
  return { state: 'done', game: status.active, changed: result?.changed === true };
}

// ホームに「MODが古いまま」と出すか：この版で入れ替えられず、まだ新しくしていないとき。
function gameModsOutdated(config, version) {
  return config.gameModsRefreshFailed === version && config.gameModsVersion !== version;
}

module.exports = { refreshGameModsAfterUpdate, gameModsOutdated };
