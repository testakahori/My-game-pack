// ゲームの選択・切り替え・Minecraft の保存先（games:* の ipc）。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、app・dialog・process は main から受け取る。
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { createGameProfiles } = require('./game_profiles.cjs');
const { bundledGamePacks } = require('./bundled_game_packs.cjs');
const { refreshGameModsAfterUpdate, gameModsOutdated } = require('./game_mods_refresh.cjs');
const { discoverMinecraftLocations, validateMinecraftFolder } = require('./minecraft_locations.cjs');
const { switchBlockedMessage } = require('./minecraft_processes.cjs');

// 切り替えを止める判定（初期セットアップ・サーバー・BRIDGE・MAP・Minecraft）は、それぞれの持ち主の関数を main から受け取る。
function createGamesIpc({
  app, process, appDir, dialog, readAppConfig, writeAppConfig, getServerRoot, getConfigPath, getServerTemplatePath,
  assertMapIdle, isInitialSetupRunning, isServerStarting, isServerStopping, isBridgeActive, getServerProcessStatus, getMinecraftProcessStatus,
  // 切り替えの記録が壊れていて戻したことの記録（main が logs/settings-recovery.log に書く。設定ファイルの PR3）。
  recordRecovery, now,
}) {
  function minecraftLocationOptions() {
    return { appData: app.getPath('appData'), currentFolder: readAppConfig().minecraftGameFolder, serverRoot: getServerRoot() };
  }
  let gameProfileBusy = false;
  // ゲームの選択の記録の場所。テストが記録を用意するときにも使う。
  const getGameProfilesDir = () => path.join(app.getPath('userData'), 'game-profiles', crypto.createHash('sha256').update(path.resolve(getServerRoot())).digest('hex').slice(0, 16));
  const gameProfiles = createGameProfiles({
    storage: getGameProfilesDir, recordRecovery, now,
    serverRoot: () => getServerRoot(),
    clientRoot: () => readAppConfig().minecraftGameFolder || path.join(app.getPath('appData'), '.minecraft'),
    configPath: () => getConfigPath(),
    // 同梱のゲームパック（採掘・埋め立て）。場所の決まりは electron/bundled_game_packs.cjs（埋め立て PR2）。
    bundledPackages: () => bundledGamePacks({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appDir }),
    displayJar: () => {
      const dir = app.isPackaged ? path.join(getServerTemplatePath(), 'mods') : path.resolve(appDir, '..', 'DisplayMod', 'build', 'libs');
      const jars = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^displaymod-[0-9.]+\.jar$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
      return jars.length ? path.join(dir, jars[0]) : null;
    },
    // 標準装備の OBSMOD（サーバーにだけ入れる。2026-10-25）。無ければ入れない。
    obsJar: () => {
      const dir = app.isPackaged ? path.join(getServerTemplatePath(), 'mods') : path.resolve(appDir, '..', 'ObsMod', 'build', 'libs');
      const jars = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^minecraft_obs_bridge-[0-9.]+\.jar$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
      return jars.length ? path.join(dir, jars[0]) : null;
    },
    bridgeJar: () => {
      const dir = app.isPackaged ? path.join(getServerTemplatePath(), 'mods') : path.resolve(appDir, '..', 'BridgeMod', 'build', 'libs');
      const jars = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^bridgemod-[0-9.]+\.jar$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
      if (!jars.length) throw new Error('BridgeMODのjarがありません。開発版のビルドまたは配布ファイルを確認してください');
      return path.join(dir, jars[0]);
    },
    ensureStopped: async () => {
      assertMapIdle();
      if (isInitialSetupRunning() || isServerStarting() || isServerStopping() || isBridgeActive() || (await getServerProcessStatus()).running) throw new Error('サーバーとBRIDGEを停止し、セットアップの完了を待ってから切り替えてください');
      const minecraft = await getMinecraftProcessStatus(true);
      if (minecraft.running) throw new Error(switchBlockedMessage(minecraft.processes));
    },
    // 初期マップが無いときの案内。開発者向けの手順は開発版だけに出す（埋め立て PR3 の最後のレビュー 軽い6）。
    missingMapHint: app.isPackaged ? '' : '（開発版では npm run dev:refresh を動かしてください）',
    // 「マップを初期化」はマップを読むサーバーだけを見る（BRIDGE・Minecraft は動いていてよい。埋め立て PR3）。
    ensureServerStopped: async () => {
      assertMapIdle();
      if (isInitialSetupRunning() || isServerStarting() || isServerStopping() || (await getServerProcessStatus()).running) throw new Error('サーバーが動いています。サーバーを止めてから「マップを初期化」を押してください');
    },
  });
  // ゲームの操作の最中か（設定のバックアップの復元・ウィンドウを閉じるときに main が見る）。
  function isGameProfileBusy() {
    return gameProfileBusy;
  }
  function assertGameProfileIdle() {
    if (gameProfileBusy || gameProfiles.list().recoveryRequired) throw new Error('ゲームの切替中、または切替の復旧が必要です。ホームのゲーム選択を確認してください');
  }
  async function gameProfileOperation(action) {
    if (gameProfileBusy) throw new Error('ゲームの操作が進行中です');
    gameProfileBusy = true;
    try { return await action(); } finally { gameProfileBusy = false; }
  }
  // ホームのゲームの状態。どの応答にも、アプリの更新で MOD が古いままかとその理由を含める（PR #91 再レビュー）。
  function gamesStatus() {
    const cfg = readAppConfig();
    return { ...gameProfiles.list(), modsOutdatedAfterUpdate: gameModsOutdated(cfg, app.getVersion()), modsRefreshError: cfg.gameModsRefreshError || '' };
  }
  async function saveMinecraftFolder(value, requireCandidate) {
    const options = minecraftLocationOptions();
    const { candidates } = await discoverMinecraftLocations(options);
    const folder = await validateMinecraftFolder(value, { ...options, candidates, requireCandidate });
    writeAppConfig({ minecraftGameFolder: folder });
    return gameProfiles.list();
  }

  function register(ipcMain) {
    ipcMain.handle('games:list', () => gamesStatus());
    ipcMain.handle('games:activate', (_event, id) => gameProfileOperation(async () => {
      const result = await gameProfiles.activate(id);
      // 「保存」で今の版の MOD を置いたので、アプリ更新後の入れ替えは済んだことにする（2026-10-13）。
      // 開発版は配布版とアプリ設定の場所が同じなので書かない。書けなくても切替は成功として返す（PR #91 レビュー）。
      if (app.isPackaged) {
        try { writeAppConfig({ gameModsVersion: app.getVersion(), gameModsRefreshFailed: '', gameModsRefreshError: '' }); }
        catch (e) { console.warn("[games] アプリ更新後の入れ替えの記録を書けませんでした:", e?.message || e); }
      }
      return { ...result, ...gamesStatus() };
    }));
    ipcMain.handle('games:recover', () => gameProfileOperation(async () => { await gameProfiles.recover(); return gamesStatus(); }));
    // TOP の「マップを初期化」（今のゲームの初期マップに戻す。埋め立て PR3）。
    ipcMain.handle('games:resetMap', () => gameProfileOperation(async () => { await gameProfiles.resetMap(); return gamesStatus(); }));
    ipcMain.handle('games:install', () => gameProfileOperation(async () => {
      const selected = await dialog.showOpenDialog({ title: 'ゲームパックを登録', properties: ['openDirectory'] });
      if (selected.canceled) return { canceled: true };
      await gameProfiles.install(selected.filePaths[0]);
      return gamesStatus();
    }));
    // ホームの「今すぐ入れ替える」：アプリの更新に合わせた入れ替えを、もう一度試す。「保存」と違ってほかの MOD を退避しない（PR #91 再レビュー）。
    ipcMain.handle('games:refreshMods', async () => {
      if (!app.isPackaged) throw new Error('開発版では使えません。ゲームを「保存」してください');
      const result = await refreshGameModsAfterUpdate({ version: app.getVersion(), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation });
      if (result.state === 'failed') throw new Error(result.error);
      return gamesStatus();
    });
    ipcMain.handle('games:clientFolders', () => discoverMinecraftLocations(minecraftLocationOptions()));
    ipcMain.handle('games:selectClientFolder', (_event, folder) => gameProfileOperation(async () => {
      if (gameProfiles.list().recoveryRequired) throw new Error('切替を復旧してから保存先を変更してください');
      return saveMinecraftFolder(folder, true);
    }));
    ipcMain.handle('games:clientFolder', () => gameProfileOperation(async () => {
      if (gameProfiles.list().recoveryRequired) throw new Error('切替を復旧してから保存先を変更してください');
      const selected = await dialog.showOpenDialog({ title: 'Minecraftのゲームフォルダー（modsの1つ上）', properties: ['openDirectory'] });
      if (selected.canceled) return { canceled: true };
      return saveMinecraftFolder(selected.filePaths[0], false);
    }));
  }

  return { gameProfiles, isGameProfileBusy, assertGameProfileIdle, gameProfileOperation, gamesStatus, getGameProfilesDir, register };
}

module.exports = { createGamesIpc };
