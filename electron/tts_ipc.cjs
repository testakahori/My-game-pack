// 読み上げ（TTS）の設定とエンジンの ipc。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・child_process は読み込まず、app・shell・spawn・process は main から受け取る。
const path = require("path");
const fs = require("fs");
const { ENGINE_PORTS, checkEngine, getSpeakers, flattenSpeakers, synthesize } = require("./tts.cjs");
// 既定値・範囲と整え方は BRIDGE と同じ bridge/tts_settings.cjs（処理のコピー PR9）。
const { TTS_SETTINGS, normalizeTtsSettings } = require("../bridge/tts_settings.cjs");
const TTS_DEFAULTS = TTS_SETTINGS.defaults;

function createTtsIpc({ app, process, shell, spawn, getBridgeBatDir, getConfigPath, settingsBackups }) {
  // --------------------
  // TTS (読み上げ)
  // --------------------
  function getTtsSettingsPath() {
    return path.join(app.getPath("userData"), "tts-settings.json");
  }

  function readTtsSettingsFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    try {
      return normalizeTtsSettings(JSON.parse(fs.readFileSync(filePath, "utf-8")));
    } catch {
      return null;
    }
  }

  function readTtsSettings() {
    // ライブコメントを処理する bridge/index.js は bridge/tts-settings.json を読む。
    // ここで userData 側を先に読むと、UIが起動するエンジンとBridgeが使用する
    // エンジンが食い違い、正常に保存済みでも無音になるためBridge側を正とする。
    const bridgeSettings = readTtsSettingsFile(path.join(getBridgeBatDir(), "tts-settings.json"));
    if (bridgeSettings) return bridgeSettings;
    return readTtsSettingsFile(getTtsSettingsPath()) || { ...TTS_DEFAULTS };
  }

  function writeTtsSettings(settings) {
    const normalized = normalizeTtsSettings(settings);
    const p = getTtsSettingsPath();
    // bridge フォルダにも同期（bridge/index.js が読む）
    const bridgeTtsPath = path.join(getBridgeBatDir(), "tts-settings.json");
    fs.mkdirSync(path.dirname(bridgeTtsPath), { recursive: true });
    fs.writeFileSync(bridgeTtsPath, JSON.stringify(normalized, null, 2), "utf-8");
    fs.writeFileSync(p, JSON.stringify(normalized, null, 2), "utf-8");
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
