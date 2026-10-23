// 読み上げ（TTS）の設定とエンジンの ipc。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・child_process は読み込まず、app・shell・spawn・process は main から受け取る。
const path = require("path");
const fs = require("fs");
const { ENGINE_PORTS, checkEngine, getSpeakers, flattenSpeakers, synthesize } = require("./tts.cjs");
// 既定値・範囲と整え方は BRIDGE と同じ bridge/tts_settings.cjs（処理のコピー PR9）。
const { TTS_SETTINGS, normalizeTtsSettings } = require("../bridge/tts_settings.cjs");
const TTS_DEFAULTS = TTS_SETTINGS.defaults;
const { createSafeJsonFile } = require("../bridge/safe_json_file.cjs");

// recordRecovery は、壊れていて戻したことの記録（main が logs/settings-recovery.log に書く）。
function createTtsIpc({ app, process, shell, spawn, getBridgeBatDir, getConfigPath, settingsBackups, recordRecovery, now }) {
  // --------------------
  // TTS (読み上げ)
  // --------------------
  function getTtsSettingsPath() {
    return path.join(app.getPath("userData"), "tts-settings.json");
  }

  // 2か所とも、壊れていたら前の正しい状態の写しから戻し、壊れたファイルは名前を変えて残す
  // （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 6.2）。
  // 古い版は画面の値をそのまま書いていたので、項目の型では壊れていると決めない（値は normalizeTtsSettings で整える）。
  // 記録の名前には、どちらのフォルダーかを入れる（同じ名前のファイルが2か所にある）。
  const userDataFile = createSafeJsonFile({
    file: getTtsSettingsPath, label: "tts-settings.json（userData）", defaults: () => ({ ...TTS_DEFAULTS }), record: recordRecovery, now,
  });
  // BRIDGE 側が壊れていたら、userData 側の今の中身 → BRIDGE 側の写し → userData 側（それも無ければ既定値）の順に使う。
  // アプリはいつも2か所に同じ値を書くので、userData 側が最新（写しは1つ前の保存。2026-10-24 ユーザーの決定）。
  // BRIDGE 側が無いときも userData 側。読み上げを切っていた配信者の読み上げが動き出さないように。
  const bridgeFile = createSafeJsonFile({
    file: () => path.join(getBridgeBatDir(), "tts-settings.json"), label: "tts-settings.json（BRIDGE のフォルダー）",
    restoreSources: () => [{ file: getTtsSettingsPath(), label: "userData の読み上げの設定" }],
    defaults: () => userDataFile.read(), defaultsLabel: "userData の読み上げの設定（無ければ既定値）", record: recordRecovery, now,
  });

  function readTtsSettings() {
    // ライブコメントを処理する bridge/index.js は bridge/tts-settings.json を読む。
    // ここで userData 側を先に読むと、UIが起動するエンジンとBridgeが使用する
    // エンジンが食い違い、正常に保存済みでも無音になるためBridge側を正とする。
    return normalizeTtsSettings(bridgeFile.read());
  }

  function writeTtsSettings(settings) {
    const normalized = normalizeTtsSettings(settings);
    // bridge フォルダにも同期（bridge/index.js が読む）
    bridgeFile.write(normalized);
    userDataFile.write(normalized);
    return normalized;
  }

  // 読み上げエンジンの実行ファイルの候補。main から受け取った process の環境変数で決める（テストでは偽物になる）。
  const ENGINE_EXE_PATHS = {
    voicevox: [
      path.join(require("os").homedir(), "AppData", "Local", "Programs", "VOICEVOX", "VOICEVOX.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "VOICEVOX", "VOICEVOX.exe"),
      path.join(process.env.PROGRAMFILES || "", "VOICEVOX", "VOICEVOX.exe"),
    ],
    aivis: [
      path.join(require("os").homedir(), "AppData", "Local", "Programs", "AivisSpeech", "AivisSpeech.exe"),
      path.join(process.env.LOCALAPPDATA || "", "Programs", "AivisSpeech", "AivisSpeech.exe"),
      path.join(process.env.PROGRAMFILES || "", "AivisSpeech", "AivisSpeech.exe"),
    ],
  };

  function resolveEngineExe(engine) {
    const candidates = ENGINE_EXE_PATHS[engine] || [];
    return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
  }

  async function waitForTtsEngine(engine, timeoutMs = 60000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await checkEngine(engine)) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  function register(ipcMain) {
    ipcMain.handle("tts:settings:read", () => readTtsSettings());

    ipcMain.handle("tts:settings:write", (_event, settings) => {
      if (fs.existsSync(getConfigPath()) && JSON.stringify(readTtsSettings()) !== JSON.stringify(settings)) settingsBackups.create("automatic");
      return { ok: true, settings: writeTtsSettings(settings) };
    });

    ipcMain.handle("tts:checkEngine", async (_event, engine) => {
      return await checkEngine(engine);
    });

    ipcMain.handle("tts:getSpeakers", async (_event, engine) => {
      try {
        const raw = await getSpeakers(engine);
        return flattenSpeakers(raw);
      } catch {
        return [];
      }
    });

    ipcMain.handle("tts:launchEngine", async (_event, engine) => {
      if (!ENGINE_PORTS[engine]) {
        return { ok: false, message: `未対応の読み上げエンジンです: ${engine}` };
      }
      if (await checkEngine(engine)) {
        return { ok: true, alreadyRunning: true, message: "すでに起動しています。" };
      }

      const exePath = resolveEngineExe(engine);
      if (!exePath) {
        const expected = (ENGINE_EXE_PATHS[engine] || []).filter(Boolean).join("\n");
        return { ok: false, message: `実行ファイルが見つかりません。公式サイトからインストールしてください。\n${expected}` };
      }
      try {
        await new Promise((resolve, reject) => {
          const child = spawn(exePath, [], { cwd: path.dirname(exePath), detached: true, stdio: "ignore" });
          child.once("error", reject);
          child.once("spawn", () => { child.unref(); resolve(); });
        });
      } catch (spawnError) {
        const shellError = await shell.openPath(exePath);
        if (shellError) {
          return { ok: false, message: spawnError?.message || shellError };
        }
      }

      try {
        const ready = await waitForTtsEngine(engine);
        if (ready) {
          return { ok: true, message: "起動しました。" };
        }
        const port = ENGINE_PORTS[engine];
        return { ok: false, message: `起動は実行しましたが、APIがまだ応答していません。${port}番ポートで起動しているか確認してください。` };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    });

    ipcMain.handle("tts:test", async (_event, settings) => {
      try {
        const normalized = normalizeTtsSettings(settings);
        const ok = await checkEngine(normalized.engine);
        if (!ok) return { ok: false, message: "エンジンが起動していません" };
        const text = ((settings?.testText && String(settings.testText).trim()) || "テスト再生。こんにちは！").slice(0, 200);
        // 整えた設定ごと渡す（音量も入る。本番の BRIDGE と同じ。前は音量を渡さず、100〜200% が同じ大きさで鳴った）。
        const wav = await synthesize(normalized.engine, text, normalized);
        return { ok: true, base64: wav.toString("base64") };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    });
  }

  return { getTtsSettingsPath, readTtsSettings, writeTtsSettings, normalizeTtsSettings, register };
}

module.exports = { createTtsIpc };
