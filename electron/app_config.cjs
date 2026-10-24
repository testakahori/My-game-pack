// アプリ設定（userData/app-config.json）の読み書きと、その ipc（版・手動配布の知らせを含む）。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron は読み込まず、app などは main から受け取る。
const path = require("path");
const fs = require("fs");
const { createSafeJsonFile } = require("../bridge/safe_json_file.cjs");

// 既定値と項目の型は app_config_fields.json の1か所（2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.1）。
// fields の値は型の見本（文字列は ""、真偽は false）で、既定値ではない。画面の型の宣言（src/types/electron.d.ts）も同じ表から型を取る。
const APP_CONFIG_FIELDS = require("./app_config_fields.json");
const RENDERER_APP_CONFIG_FIELDS = new Set(APP_CONFIG_FIELDS.rendererWritable);
const BOOLEAN_FIELDS = new Set(Object.keys(APP_CONFIG_FIELDS.fields).filter(key => typeof APP_CONFIG_FIELDS.fields[key] === "boolean"));
// 使わなくなった項目（運営ログインのメールアドレス・トークン・ログインした時刻）。運営ログインはなくした（誰が使えるかは公式 HP の購入者ログインで決める。
// 2026-10-24 ユーザーの決定）。配信者の PC に残っていても読まず、書かない。app-config.json からは次に保存したときに消え、前の正しい状態の写し（.last-good）からは
// その次の保存で消える。壊れたファイルの写し（.broken-…）には残るが、画面にも記録にも出ず、もう使い道もない。
const RETIRED_FIELDS = new Set(APP_CONFIG_FIELDS.retired);

// 表の項目の型が1つでも違えば、ファイル全体を壊れていると扱う（項目ごとには直さない）。null も違う型。表に無い項目は確かめない。
function appConfigProblem(value) {
  for (const [key, sample] of Object.entries(APP_CONFIG_FIELDS.fields)) {
    if (value[key] === undefined) continue;
    if (value[key] === null || typeof value[key] !== typeof sample) return `項目 ${key} の型が違う`;
  }
  return "";
}

// あとで main で作られるもの（設定のバックアップ・サーバーの状態など）は、呼ばれたときに読む関数で受け取る。
// recordRecovery は、壊れていて戻したことの記録（main が logs/settings-recovery.log に書く）。
function createAppConfig({ app, assertGameProfileIdle, assertMapIdle, isServerStarting, getConfigPath, getSettingsBackups, refreshGameModsOnStartup, migrateSavedConfig, recordRecovery, now }) {
  function getAppConfigPath() {
    return path.join(app.getPath("userData"), "app-config.json");
  }

  // 壊れていたら前の正しい状態の写しから戻し、壊れたファイルは名前を変えて残す（写しも無ければ既定値）。
  const store = createSafeJsonFile({
    file: getAppConfigPath, defaults: () => ({ ...APP_CONFIG_FIELDS.defaults }), problem: appConfigProblem, record: recordRecovery, now,
  });

  // 既定値の上にファイルの中身を重ねる（使う所はどれも、項目が無いのと既定値を同じに扱う）。使わなくなった項目は外す。
  function readAppConfig() {
    const saved = Object.fromEntries(Object.entries(store.read()).filter(([key]) => !RETIRED_FIELDS.has(key)));
    return { ...APP_CONFIG_FIELDS.defaults, ...saved };
  }

  function writeAppConfig(data) {
    const next = { ...readAppConfig(), ...Object.fromEntries(Object.entries(data || {}).filter(([key]) => !RETIRED_FIELDS.has(key))) };
    if (next.serverFolder) next.serverFolder = path.resolve(next.serverFolder);
    store.write(next);
  }

  // 画面に渡すアプリの設定（前は運営ログインの項目を外していた。今は使わなくなった項目を readAppConfig が外す）。
  function readPublicAppConfig() {
    return readAppConfig();
  }

  function sanitizeRendererAppConfigUpdate(data) {
    const next = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (!RENDERER_APP_CONFIG_FIELDS.has(key)) throw new Error(`変更できないアプリ設定です: ${key}`);
      if (BOOLEAN_FIELDS.has(key)) {
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
      // 設定の場所（serverFolder/bridge）が決まったとき・変わったときは、古い版の設定を画面が読む前に直す（2026-10-18 設計書の 7。PR3 の最終レビュー）。
      if (readAppConfig().setupComplete === true && (!wasSetupComplete || 'serverFolder' in data)) migrateSavedConfig?.();
      return { ok: true };
    });
  }

  return { getAppConfigPath, readAppConfig, writeAppConfig, readPublicAppConfig, sanitizeRendererAppConfigUpdate, consumeInstallerSetupReset, register };
}

module.exports = { createAppConfig, appConfigProblem };
