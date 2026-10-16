// アプリ設定（userData/app-config.json）の読み書きと、その ipc（版・手動配布の知らせを含む）。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、app などは main から受け取る。
const path = require("path");
const fs = require("fs");

const RENDERER_APP_CONFIG_FIELDS = new Set([
  "serverFolder",
  "setupComplete",
  "setupRequiredByInstall",
  "minecraftPlayerName",
  "minecraftLauncherPath",
  "autoBackupOnServerStart",
]);

// あとで main で作られるもの（設定のバックアップ・サーバーの状態など）は、呼ばれたときに読む関数で受け取る。
function createAppConfig({ app, assertGameProfileIdle, assertMapIdle, isServerStarting, getConfigPath, getSettingsBackups, refreshGameModsOnStartup }) {
  function getAppConfigPath() {
    return path.join(app.getPath("userData"), "app-config.json");
  }

  function readAppConfig() {
    const p = getAppConfigPath();
    if (!fs.existsSync(p)) return { serverFolder: "", setupComplete: false };
    try { return JSON.parse(fs.readFileSync(p, "utf-8")); }
    catch { return { serverFolder: "", setupComplete: false }; }
  }

  function writeAppConfig(data) {
    const p = getAppConfigPath();
    const current = readAppConfig();
    const next = { ...current, ...data };
    if (next.serverFolder) next.serverFolder = path.resolve(next.serverFolder);
    fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf-8");
  }

  function readPublicAppConfig() {
    const config = readAppConfig();
    const { authEmail: _authEmail, authToken: _authToken, authLoginAt: _authLoginAt, ...publicConfig } = config;
    return publicConfig;
  }

  function sanitizeRendererAppConfigUpdate(data) {
    const next = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (!RENDERER_APP_CONFIG_FIELDS.has(key)) throw new Error(`変更できないアプリ設定です: ${key}`);
      if (["setupComplete", "setupRequiredByInstall", "autoBackupOnServerStart"].includes(key)) {
        if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
        next[key] = value;
        continue;
      }
      if (typeof value !== "string" || value.length > 4096) throw new Error(`${key} must be a string`);
      next[key] = value;
    }
    return next;
  }

  /**
   * The NSIS installer writes this one-shot marker after every successful install.
   * Consuming it here makes an installed build always open behind the setup gate,
   * while preserving the previously selected server folder for returning users.
   */
  function consumeInstallerSetupReset() {
    if (!app.isPackaged) return;

    const markerPath = path.join(app.getPath("userData"), "require-initial-setup.flag");
    if (!fs.existsSync(markerPath)) return;

    try {
      writeAppConfig({
        setupComplete: false,
        setupRequiredByInstall: true,
        setupRequiredAt: new Date().toISOString(),
      });
      fs.unlinkSync(markerPath);
    } catch (error) {
      console.warn("[setup] failed to consume installer reset marker:", error?.message || error);
    }
  }

  // Compatibility IPCs never contact GitHub or launch an installer. Distribution is manual.
  function manualUpdateStatus() {
    return { state: "manual", version: app.getVersion(), percent: 0, error: "", checkedAt: null,
      message: "最新版は配布者から受け取り、インストーラーを実行してください。" };
  }

  function register(ipcMain) {
    ipcMain.handle("updater:status", manualUpdateStatus);
    ipcMain.handle("updater:check", manualUpdateStatus);
    ipcMain.handle("updater:install", () => ({ ok: false, ...manualUpdateStatus() }));

    // アプリバージョン（UIのハードコード表記を廃してこれを使う）
    ipcMain.handle("app:version", () => app.getVersion());

    ipcMain.handle("app:config:read", async () => readPublicAppConfig());

    ipcMain.handle("app:config:write", async (_event, data) => {
      assertGameProfileIdle();
      if (data && ('serverFolder' in data || 'world' in data)) { assertMapIdle(); if (isServerStarting()) throw new Error('サーバーの起動中は保存先を変更できません。'); }
      if (typeof data !== "object" || data === null) throw new Error("data must be an object");
      if (Object.hasOwn(data, "autoBackupOnServerStart") && data.autoBackupOnServerStart !== readAppConfig().autoBackupOnServerStart && fs.existsSync(getConfigPath())) getSettingsBackups().create("automatic");
      const wasSetupComplete = readAppConfig().setupComplete === true;
      writeAppConfig(sanitizeRendererAppConfigUpdate(data));
      // 手動インストール（更新も含む）のあとは初期セットアップをやり直す。終えたら、アプリの更新に合わせて MOD を入れ替える（PR #91 レビュー）。
      if (!wasSetupComplete && readAppConfig().setupComplete === true) setTimeout(() => { refreshGameModsOnStartup().catch(e => console.warn("[games]", e?.message || e)); }, 0);
      return { ok: true };
    });
  }

  return { getAppConfigPath, readAppConfig, writeAppConfig, readPublicAppConfig, sanitizeRendererAppConfigUpdate, consumeInstallerSetupReset, register };
}

module.exports = { createAppConfig };
