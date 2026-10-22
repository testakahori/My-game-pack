// MAP（ワールド）の保存・読込と、BRIDGE の設定のプリセット。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、サーバー・BRIDGE の操作は main から受け取る。
const path = require("path");
const fs = require("fs");
const { validateBridgeConfig } = require("./config_schema.cjs");
const { migrateBridgeConfig } = require("../bridge/config_migration.cjs");

// サーバーと BRIDGE の状態・操作は、それぞれの持ち主から呼ばれたときに読む関数で受け取る。
function createMapOperations({
  getServerRoot, getBridgeBatDir, getConfigPath, assertGameProfileIdle, isInitialSetupRunning, isServerStarting, isServerStopping,
  serverChild, startServer, stopMapServer, assertMapServerStopped, isBridgeActive, stopBridge, launchBridge, readSavedBridgeConfig, writeBridgeConfig,
}) {
  let mapOperationBusy = false;
  function assertMapIdle() {
    if (mapOperationBusy || mapSaves.isBusy()) throw new Error('MAPを保存・読込中です。完了までお待ちください。');
  }
  const mapSaves = require('./map_saves.cjs').createMapSaves({ getRoot: getServerRoot, assertStopped: assertMapServerStopped });
  async function runMapOperation(origin, action) {
    assertGameProfileIdle();
    assertMapIdle();
    if (isInitialSetupRunning() || isServerStarting() || isServerStopping()) throw new Error('サーバーの準備・停止が終わるまでお待ちください。');
    mapOperationBusy = true;
    const restartServer = Boolean(serverChild()), restartBridge = isBridgeActive();
    try {
      if (restartBridge) await stopBridge(origin);
      await stopMapServer(origin);
      const result = await action();
      let restartError = '';
      try {
        if (restartServer) await startServer(true);
        if (restartBridge) await launchBridge();
      } catch (error) { restartError = error.message; }
      return { ok: true, ...result, restarted: restartServer, restartError };
    } finally { mapOperationBusy = false; }
  }

  async function createWorldBackup() {
    const saved = await mapSaves.save('', 'manual');
    return { ok: true, path: path.join(getServerRoot(), 'map-saves', saved.id), reason, message: 'MAPを保存しました: ' + saved.name };
  }

  function getPresetDir() {
    const dir = path.join(getBridgeBatDir(), "presets");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ほかの仕事が見る「いまの状態」（MAP の作業中か）。main は呼ばれたときに mapOperations.xxx() で読む。
  function isBusy() { return mapOperationBusy; }

  function register(ipcMain) {
    ipcMain.handle('world:saves:list', async () => ({ ...(await mapSaves.list()), busy: mapOperationBusy || mapSaves.isBusy() }));
    ipcMain.handle('world:saves:save', (_event, name) => runMapOperation('map:save', async () => ({ saved: await mapSaves.save(name) })));
    ipcMain.handle('world:saves:load', (_event, id) => runMapOperation('map:load', () => mapSaves.load(id)));

    ipcMain.handle('world:backup', () => runMapOperation('map:backup', () => createWorldBackup()));

    ipcMain.handle("presets:list", () =>
      fs.readdirSync(getPresetDir()).filter(name => name.endsWith(".json")).sort()
    );
    ipcMain.handle("presets:save", (_event, name) => {
      const safe = String(name || "").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 60);
      if (!safe) throw new Error("プリセット名が空です");
      fs.copyFileSync(getConfigPath(), path.join(getPresetDir(), `${safe}.json`));
      return { ok: true };
    });
    ipcMain.handle("presets:load", (_event, name) => {
      const safe = path.basename(String(name || ""));
      const source = path.join(getPresetDir(), safe);
      if (!fs.existsSync(source)) throw new Error("プリセットがありません");
      // 古い版で保存したプリセット（回数 2.5 など）も読み込めるように、保存済みの設定と同じ直しを通してから確かめる（2026-10-18 設計書の 7）。
      const value = migrateBridgeConfig(JSON.parse(fs.readFileSync(source, "utf8"))).config;
      // 以前保存したプリセットは、その中の割り当ても「前からあるもの」として扱う（使えない名前は警告に留める）。
      const validation = validateBridgeConfig(value, { previous: [readSavedBridgeConfig(), value] });
      if (!validation.ok) throw new Error(validation.errors.join("\n"));
      writeBridgeConfig(value, { alsoKnown: [value] });
      return { ok: true, config: value };
    });
  }

  return { isBusy, assertIdle: assertMapIdle, mapSaves, register };
}

module.exports = { createMapOperations };
