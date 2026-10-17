// Minecraft のランチャー・ゲーム本体の稼働の確かめ（Game ノードの表示・ゲームの切り替えの前）と、Minecraft の起動。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・child_process は読み込まず、spawn・process は main から受け取る。
const path = require("path");
const fs = require("fs");
const { tasklistNames, minecraftProcesses, readJavaCommandLines } = require('./minecraft_processes.cjs');

function createMinecraftClient({ process, spawn, readAppConfig, assertGameProfileIdle }) {
  // --------------------
  // IPC: Minecraft ランチャー/ゲーム本体の稼働検知（Gameノード表示用）
  // --------------------
  // 数える名前と java.exe の見分け方は minecraft_processes.cjs にある。
  async function getMinecraftProcessStatus(strict = false) {
    if (process.platform !== "win32") return { running: false, processes: [] };
    const csv = await new Promise((resolve) => {
      let out = "";
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(out); } };
      let p;
      try {
        p = spawn("tasklist.exe", ["/FO", "CSV", "/NH"], { windowsHide: true });
      } catch {
        return finish();
      }
      p.stdout.on("data", (d) => (out += d.toString("utf8")));
      p.on("close", finish);
      p.on("error", finish);
      setTimeout(() => { try { p.kill(); } catch { /* ignore */ } finish(); }, 4000);
    });
    if (strict && !String(csv).trim()) throw new Error('Minecraftの停止状態を確認できません。切替を中止しました');
    const names = tasklistNames(csv);
    const javaCommandLines = strict && names.includes('java.exe') ? await readJavaCommandLines() : null;
    const processes = minecraftProcesses(names, { strict, javaCommandLines });
    return { running: processes.length > 0, processes };
  }

  // --------------------
  // IPC: Minecraft 起動
  // --------------------
  function getMinecraftLauncherCandidates() {
    const cfg = readAppConfig();
    const list = [];
    if (cfg.minecraftLauncherPath) list.push(cfg.minecraftLauncherPath); // 設定で明示指定を最優先
    list.push(
      "C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe",
      "C:\\XboxGames\\Minecraft Launcher\\Content\\Minecraft.exe",
      path.join(process.env.LOCALAPPDATA || "", "Programs", "Minecraft Launcher", "MinecraftLauncher.exe"),
      path.join(process.env.PROGRAMFILES || "", "Minecraft Launcher", "MinecraftLauncher.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "", "Minecraft Launcher", "MinecraftLauncher.exe"),
    );
    return list.filter(Boolean);
  }

  function register(ipcMain) {
    ipcMain.handle("minecraft:status", () => getMinecraftProcessStatus());

    ipcMain.handle("minecraft:launch", async () => {
      assertGameProfileIdle();
      const candidates = getMinecraftLauncherCandidates();
      const found = candidates.find((p) => fs.existsSync(p));
      if (found) {
        spawn(found, [], { detached: true, stdio: "ignore" }).unref();
        return { ok: true, path: found };
      }
      // Microsoft Store 版をシェル経由で起動（存在すれば開く。無ければ何も起きないだけ）
      try {
        spawn("explorer.exe", ["shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft"],
          { detached: true, stdio: "ignore" }).unref();
        return { ok: true, viaShell: true };
      } catch {
        throw new Error(
          "Minecraft ランチャーが見つかりませんでした。手動で起動するか、ランチャーの場所を設定してください。\n確認したパス:\n" +
          candidates.join("\n")
        );
      }
    });
  }

  return { getMinecraftProcessStatus, register };
}

module.exports = { createMinecraftClient };
