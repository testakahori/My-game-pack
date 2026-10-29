// BRIDGE の配布（差分同期・同梱 node の準備・BridgeMOD の jar・ゲーム MOD の入れ替え）、サーバーテンプレートのコピー、BRIDGE の展開。
// main.cjs から分けた（2026-10-17 設計書 docs/superpowers/specs/2026-10-17-main-split-design.md）。electron・process_runner は読み込まず、main から受け取る
// （テストの loadApp が偽物に差し替えるのは main が読み込んだものだけのため）。
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { migrateRetiredCommands } = require("./command_migration.cjs");
const { bridgeCommandsDir } = require("../bridge/config_defaults.cjs");
const { refreshGameModsAfterUpdate } = require("./game_mods_refresh.cjs");
// 一時ファイルに書いてディスクに確実に残してから差し替える（設定ファイルの PR3）。
const { writeFileDurable } = require("../bridge/safe_json_file.cjs");

// サーバーの子プロセスとポートの稼働は、あとで main で作られるので、呼ばれたときに読む関数で受け取る。
function createBridgeSync({
  app, process, appDir, BrowserWindow, runProc, readAppConfig, writeAppConfig, getBridgeBatDir, getServerTemplatePath,
  gameProfiles, gameProfileOperation, assertGameProfileIdle, serverChild, isServerPortOpen,
}) {
  // --------------------
  // Bridge: resources → serverFolder/bridge へ差分同期
  // --------------------
  const BRIDGE_SYNC_MARKER = ".bridge-sync-state.json";
  const BRIDGE_RUNTIME_STATE = ".bridge-runtime-state.json";
  const BRIDGE_HEAVY_DIRS = new Set(["node", "node_modules"]);
  const BRIDGE_GENERATED_DIRS = new Set(["logs", "presets", "test"]);
  const BRIDGE_INTERNAL_BUNDLE_FILES = new Set(["bridge-runtime.zip", "bridge-runtime-manifest.json"]);
  const BRIDGE_PRESERVE_FILES = new Set([
    "config.minecraft.json",
    "config.7dtd.json",
    "tts-settings.json",
    "operations-history.json",
    "stream-sessions.json",
    "stream-metrics.jsonl",
    "stream-audience.json",
    "stream-earnings.json",
    "runtime-status.json",
  ]);
  // バンドルから廃止したファイルの墓標リスト。差分同期はコピーのみで配信先の余剰ファイルを
  // 消さないため、過去に同梱していて削除したものはここへ列挙して同期時に撤去する
  // （名前が完全一致するものだけ消すので、ユーザー自作のコマンドtxtには触れない）。
  const BRIDGE_REMOVED_BUNDLE_FILES = [
    "commands/minecraft/giant.txt",
    "commands/minecraft/invisible.txt",
    "commands/minecraft/tiny.txt",
    "commands/minecraft/seichi_donut.txt",
    "commands/minecraft/tornado.txt",
    "commands/minecraft/hukitobasu.txt",
    "commands/minecraft/hurricane.txt",
    "commands/minecraft/husk01.txt",
    "commands/minecraft/give_blindness.txt",
    "commands/minecraft/petsummon.txt",
  ];
  // 前の版の配布物に紛れていた開発機のファイル。中身が同じときだけ消す（配信者が書いたものは残す）。
  // _op.txt は開発者のマイクラIDを OP にする中身で、配信者が OP 付与をしていなければ残っていた。OP 付与は付けるたびに書き直すので、
  // 配信者の ID の _op.txt は残す（2026-10-29 ユーザーの決定：開発者の行のときだけ消す）。
  const BRIDGE_REMOVED_BUNDLE_CONTENTS = [
    { rel: "commands/minecraft/_op.txt", text: "# TITLE: OP付与\nop Douma_Akahori\n" },
  ];
  const COPY_HASH_LIMIT_BYTES = 1024 * 1024;

  let bridgeSyncState = {
    state: "idle",
    phase: "",
    error: "",
    stats: null,
    updatedAt: null,
  };

  function setBridgeSyncState(patch) {
    bridgeSyncState = { ...bridgeSyncState, ...patch, updatedAt: new Date().toISOString() };
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("bridge:syncStatus", bridgeSyncState);
    }
  }

  async function pathExists(p) {
    try {
      await fs.promises.access(p);
      return true;
    } catch {
      return false;
    }
  }

  async function safeStat(p) {
    try {
      return await fs.promises.stat(p);
    } catch {
      return null;
    }
  }

  async function sha256File(filePath) {
    const buf = await fs.promises.readFile(filePath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  }

  async function sha256FileIfExists(filePath) {
    try {
      return await sha256File(filePath);
    } catch {
      return "";
    }
  }

  async function readPackageVersion(filePath) {
    try {
      const json = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
      return String(json.version || "");
    } catch {
      return "";
    }
  }

  function normalizeBridgeRelPath(relPath) {
    return relPath.replace(/\\/g, "/");
  }

  function shouldPreserveBridgeFile(relPath) {
    return BRIDGE_PRESERVE_FILES.has(normalizeBridgeRelPath(relPath));
  }

  async function getBridgeRuntimeSignature(root) {
    const nodeExe = path.join(root, "node", "node.exe");
    const nodeStat = await safeStat(nodeExe);
    const bundlePath = path.join(root, "index.bundle.cjs");
    const bundleStat = await safeStat(bundlePath);
    const nodeModulesDir = path.join(root, "node_modules");
    const tiktokPkg = path.join(nodeModulesDir, "tiktok-live-connector", "package.json");
    const rconPkg = path.join(nodeModulesDir, "rcon-client", "package.json");

    return {
      bundleExists: !!bundleStat,
      bundleBytes: bundleStat?.size || 0,
      bundleSha256: await sha256FileIfExists(bundlePath),
      packageJsonSha256: await sha256FileIfExists(path.join(root, "package.json")),
      packageLockSha256: await sha256FileIfExists(path.join(root, "package-lock.json")),
      nodeExeBytes: nodeStat?.size || 0,
      nodeExeSha256: await sha256FileIfExists(nodeExe),
      nodeExeExists: !!nodeStat,
      nodeModulesReady: await pathExists(tiktokPkg) && await pathExists(rconPkg),
      tiktokLiveConnectorVersion: await readPackageVersion(tiktokPkg),
      rconClientVersion: await readPackageVersion(rconPkg),
    };
  }

  function getBridgeRuntimeArchivePath() {
    if (app.isPackaged) return path.join(process.resourcesPath, "bridge", "bridge-runtime.zip");
    return path.resolve(appDir, "..", "build", "bridge-runtime.zip");
  }

  function getBridgeRuntimeManifestPath() {
    if (app.isPackaged) return path.join(process.resourcesPath, "bridge", "bridge-runtime-manifest.json");
    return path.resolve(appDir, "..", "build", "bridge-runtime-manifest.json");
  }

  async function readJsonFileIfExists(filePath) {
    try {
      return JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  async function readBridgeRuntimeManifest() {
    return readJsonFileIfExists(getBridgeRuntimeManifestPath());
  }

  function getPackagedBridgeResourceDir() {
    if (app.isPackaged) return path.join(process.resourcesPath, "bridge");
    return path.resolve(appDir, "..", "build", "bridge-bundle");
  }

  function bridgeRuntimeMatchesManifest(signature, manifest) {
    if (!signature?.nodeExeExists || !manifest) return false;
    if (manifest.runtimeKind === "bundle") {
      if (!signature.bundleExists) return false;
      if (manifest.bundleSha256 && signature.bundleSha256 !== manifest.bundleSha256) return false;
      if (Number(signature.nodeExeBytes || 0) !== Number(manifest.nodeExeBytes || 0)) return false;
      if (manifest.nodeExeSha256 && signature.nodeExeSha256 !== manifest.nodeExeSha256) return false;
      return true;
    }
    if (!signature.nodeModulesReady) return false;
    if (Number(signature.nodeExeBytes || 0) !== Number(manifest.nodeExeBytes || 0)) return false;
    if (manifest.nodeExeSha256 && signature.nodeExeSha256 !== manifest.nodeExeSha256) return false;
    const deps = manifest.dependencies || {};
    if (deps["tiktok-live-connector"] && signature.tiktokLiveConnectorVersion !== deps["tiktok-live-connector"]) return false;
    if (deps["rcon-client"] && signature.rconClientVersion !== deps["rcon-client"]) return false;
    return true;
  }

  async function writeBridgeRuntimeState(bridgeDir, manifest, mode) {
    if (!manifest) return;
    const state = {
      appVersion: app.getVersion(),
      mode,
      runtimeKind: manifest.runtimeKind || "archive",
      updatedAt: new Date().toISOString(),
      archiveSha256: manifest.archiveSha256,
      bundleSha256: manifest.bundleSha256,
      packageJsonSha256: manifest.packageJsonSha256,
      packageLockSha256: manifest.packageLockSha256,
      nodeExeBytes: manifest.nodeExeBytes,
      nodeExeSha256: manifest.nodeExeSha256,
      dependencies: manifest.dependencies || {},
    };
    await fs.promises.writeFile(path.join(bridgeDir, BRIDGE_RUNTIME_STATE), JSON.stringify(state, null, 2), "utf8");
  }

  async function expandBridgeRuntimeArchive(archivePath, bridgeDir) {
    await fs.promises.mkdir(bridgeDir, { recursive: true });
    try {
      // Windows 10+ 標準の bsdtar。PowerShell Expand-Archive より大量ファイル展開がかなり速い。
      await runProc("tar.exe", ["-xf", archivePath, "-C", bridgeDir], bridgeDir);
    } catch (tarError) {
      const script = [
        "& { param($zip, $dest)",
        "$ErrorActionPreference='Stop';",
        "Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force",
        "}",
      ].join(" ");
      try {
        await runProc("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, archivePath, bridgeDir], bridgeDir);
      } catch (psError) {
        throw new Error(`Bridge runtime extraction failed. tar: ${tarError.message}; powershell: ${psError.message}`);
      }
    }
  }

  async function copyBundledRuntimeFiles(bridgeDir, manifest) {
    const sourceRoot = getPackagedBridgeResourceDir();
    const entry = manifest?.entry || "index.bundle.cjs";
    const srcBundle = path.join(sourceRoot, entry);
    const srcNode = path.join(sourceRoot, "node", "node.exe");
    if (!await pathExists(srcBundle)) throw new Error(`Bridge bundle not found: ${srcBundle}`);
    if (!await pathExists(srcNode)) throw new Error(`Bridge node.exe not found: ${srcNode}`);
    await fs.promises.mkdir(path.join(bridgeDir, "node"), { recursive: true });
    await fs.promises.copyFile(srcBundle, path.join(bridgeDir, entry));
    await fs.promises.copyFile(srcNode, path.join(bridgeDir, "node", "node.exe"));
  }

  async function ensureBridgeRuntimeReady(bridgeDir, stats = null) {
    const signature = await getBridgeRuntimeSignature(bridgeDir);
    const manifest = await readBridgeRuntimeManifest();
    const archivePath = getBridgeRuntimeArchivePath();
    const archiveExists = await pathExists(archivePath);
    const state = await readJsonFileIfExists(path.join(bridgeDir, BRIDGE_RUNTIME_STATE));
    const runtimeKind = manifest?.runtimeKind || "archive";
    const stateMatches = !!manifest && !!state &&
      (state.runtimeKind || "archive") === runtimeKind &&
      Number(state.nodeExeBytes || 0) === Number(manifest.nodeExeBytes || 0) &&
      (!manifest.nodeExeSha256 || state.nodeExeSha256 === manifest.nodeExeSha256) &&
      (runtimeKind === "bundle"
        ? state.bundleSha256 === manifest.bundleSha256
        : state.archiveSha256 === manifest.archiveSha256 && state.packageLockSha256 === manifest.packageLockSha256);

    if (bridgeRuntimeMatchesManifest(signature, manifest) && stateMatches) {
      const result = { ready: true, extracted: false, skipped: true, reason: "current" };
      if (stats) stats.runtime = result;
      return result;
    }

    if (bridgeRuntimeMatchesManifest(signature, manifest) && !stateMatches) {
      await writeBridgeRuntimeState(bridgeDir, manifest, "adopt-existing");
      const result = { ready: true, extracted: false, skipped: true, reason: "adopt-existing" };
      if (stats) stats.runtime = result;
      return result;
    }

    if (runtimeKind === "bundle") {
      setBridgeSyncState({ state: "running", phase: "copying-runtime", error: "", stats });
      await copyBundledRuntimeFiles(bridgeDir, manifest);
      const after = await getBridgeRuntimeSignature(bridgeDir);
      if (!bridgeRuntimeMatchesManifest(after, manifest)) {
        throw new Error(`Bridge bundled runtime copy failed: ${bridgeDir}`);
      }
      await writeBridgeRuntimeState(bridgeDir, manifest, "copied-bundle");
      const result = {
        ready: true,
        extracted: false,
        copied: true,
        skipped: false,
        reason: "copied-bundle",
        bundleBytes: manifest?.bundleBytes || after.bundleBytes || 0,
      };
      if (stats) stats.runtime = result;
      return result;
    }

    if (!archiveExists) {
      if (signature.nodeExeExists && signature.nodeModulesReady) {
        const result = { ready: true, extracted: false, skipped: true, reason: "existing-no-archive" };
        if (stats) stats.runtime = result;
        return result;
      }
      throw new Error(`Bridge runtime archive not found: ${archivePath}`);
    }

    setBridgeSyncState({ state: "running", phase: "extracting-runtime", error: "", stats });
    await expandBridgeRuntimeArchive(archivePath, bridgeDir);
    const after = await getBridgeRuntimeSignature(bridgeDir);
    if (!after.nodeExeExists || !after.nodeModulesReady) {
      throw new Error(`Bridge runtime extraction failed: ${bridgeDir}`);
    }
    await writeBridgeRuntimeState(bridgeDir, manifest, "extracted");
    const result = {
      ready: true,
      extracted: true,
      skipped: false,
      reason: "extracted",
      archiveBytes: manifest?.archiveBytes || (await safeStat(archivePath))?.size || 0,
    };
    if (stats) stats.runtime = result;
    return result;
  }

  async function ensureNodeRuntimeAvailable() {
    if (!app.isPackaged) return { ready: true, development: true };
    return ensureBridgeRuntimeReady(getBridgeBatDir());
  }

  function getBridgeEntryPoint(dir) {
    const bundled = path.join(dir, "index.bundle.cjs");
    if (fs.existsSync(bundled)) return bundled;
    return path.join(dir, "index.js");
  }

  async function filesSame(srcPath, dstPath, srcStat) {
    const dstStat = await safeStat(dstPath);
    if (!dstStat) return false;
    if (srcStat.size !== dstStat.size) return false;

    // 大きいファイルはサイズ一致なら同一扱いにする。
    // node/node_modules は基本的にディレクトリ単位でスキップ判定するため、
    // ここで巨大ファイルを毎回ハッシュしない。
    if (srcStat.size > COPY_HASH_LIMIT_BYTES) return true;

    // 同じコピー由来なら mtime も近いことが多い。軽量な早期 return。
    if (Math.abs(srcStat.mtimeMs - dstStat.mtimeMs) < 2000) return true;

    const [srcHash, dstHash] = await Promise.all([sha256File(srcPath), sha256File(dstPath)]);
    return srcHash === dstHash;
  }

  async function copyFileIfChanged(srcPath, dstPath, stats) {
    const srcStat = await safeStat(srcPath);
    if (!srcStat || !srcStat.isFile()) return;
    if (await filesSame(srcPath, dstPath, srcStat)) {
      stats.skippedFiles++;
      return;
    }
    await fs.promises.mkdir(path.dirname(dstPath), { recursive: true });
    await fs.promises.copyFile(srcPath, dstPath);
    stats.copiedFiles++;
    stats.copiedBytes += srcStat.size;
  }

  function shouldSkipHeavyDir(entryName, srcSig, dstSig, forceHeavy) {
    if (forceHeavy) return false;
    if (entryName === "node") {
      return srcSig.nodeExeExists && dstSig.nodeExeExists && srcSig.nodeExeBytes === dstSig.nodeExeBytes;
    }
    if (entryName === "node_modules") {
      return (
        dstSig.nodeModulesReady &&
        srcSig.packageJsonSha256 &&
        srcSig.packageLockSha256 &&
        srcSig.packageJsonSha256 === dstSig.packageJsonSha256 &&
        srcSig.packageLockSha256 === dstSig.packageLockSha256
      );
    }
    return false;
  }

  async function copyBridgeDifferential(src, dst, options = {}) {
    migrateRetiredCommands(dst);
    require("./saikutu_commands.cjs").retireCommands(dst);
    const forceHeavy = options.forceHeavy === true;
    const preserveUserFiles = options.preserveUserFiles !== false;
    const srcSig = await getBridgeRuntimeSignature(src);
    const dstSig = await getBridgeRuntimeSignature(dst);
    const stats = {
      copiedFiles: 0,
      copiedBytes: 0,
      skippedFiles: 0,
      preservedFiles: 0,
      skippedDirs: 0,
      skippedHeavyDirs: [],
      removedFiles: 0,
    };

    async function walk(srcDir, dstDir, relDir = "") {
      await fs.promises.mkdir(dstDir, { recursive: true });
      const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

      for (const entry of entries) {
        const relPath = relDir ? path.join(relDir, entry.name) : entry.name;
        const srcPath = path.join(srcDir, entry.name);
        const dstPath = path.join(dstDir, entry.name);

        if (entry.name === BRIDGE_SYNC_MARKER) {
          stats.skippedFiles++;
          continue;
        }
        if (!relDir && BRIDGE_INTERNAL_BUNDLE_FILES.has(entry.name)) {
          stats.skippedFiles++;
          continue;
        }

        if (entry.isDirectory()) {
          if (!relDir && BRIDGE_GENERATED_DIRS.has(entry.name)) {
            stats.skippedDirs++;
            continue;
          }
          if (!relDir && BRIDGE_HEAVY_DIRS.has(entry.name) && shouldSkipHeavyDir(entry.name, srcSig, dstSig, forceHeavy)) {
            stats.skippedHeavyDirs.push(entry.name);
            stats.skippedDirs++;
            continue;
          }
          await walk(srcPath, dstPath, relPath);
          continue;
        }

        if (!entry.isFile()) continue;
        if (preserveUserFiles && shouldPreserveBridgeFile(relPath) && await pathExists(dstPath)) {
          stats.preservedFiles++;
          continue;
        }
        await copyFileIfChanged(srcPath, dstPath, stats);
      }
    }

    await walk(src, dst);

    // 廃止済みバンドルファイルの掃除。万一同名がバンドルに復活していたら消さない。
    for (const rel of BRIDGE_REMOVED_BUNDLE_FILES) {
      if (await pathExists(path.join(src, rel))) continue;
      const target = path.join(dst, rel);
      if (!(await pathExists(target))) continue;
      try {
        await fs.promises.unlink(target);
        stats.removedFiles++;
        console.log(`[main] removed obsolete bundled file: ${rel}`);
      } catch { /* 消せなくても同期は続行 */ }
    }
    for (const { rel, text } of BRIDGE_REMOVED_BUNDLE_CONTENTS) {
      if (await pathExists(path.join(src, rel))) continue;
      const target = path.join(dst, rel);
      let current;
      try { current = await fs.promises.readFile(target, "utf8"); } catch { continue; }
      if (current.replace(/\r\n/g, "\n") !== text) continue;
      try {
        await fs.promises.unlink(target);
        stats.removedFiles++;
        console.log(`[main] removed leftover bundled file: ${rel}`);
      } catch { /* 消せなくても同期は続行 */ }
    }

    return { stats, signature: srcSig };
  }

  async function writeBridgeSyncMarker(dst, signature, stats) {
    const marker = {
      appVersion: app.getVersion(),
      syncedAt: new Date().toISOString(),
      signature,
      stats,
    };
    await fs.promises.writeFile(path.join(dst, BRIDGE_SYNC_MARKER), JSON.stringify(marker, null, 2), "utf8");
  }

  // アプリ更新・セットアップ時に bridgemod Mod jar をサーバーの mods/ へ最新版で揃える。
  // 旧実装はテンプレートの「ルート」から jar を探していたため、ルートに残置された
  // 旧版 jar（bridgemod-1.1.1.jar 等）を配布して mods/ の最新版を消す逆向きの動作をしていた。
  // 正しい供給元はテンプレートの mods/ 配下。
  async function refreshBridgeModJar(serverFolder) {
    const srcMods = path.join(getServerTemplatePath(), "mods");
    const jars = fs.existsSync(srcMods) ? fs.readdirSync(srcMods).filter(n => /^bridgemod-.*\.jar$/i.test(n)) : [];
    if (!jars.length) return;
    if (serverChild() || (await isServerPortOpen())) {
      throw new Error("BridgeMODを入れ替える前にMinecraftサーバーを停止してください");
    }
    jars.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    require("./bridge_mod_migration.cjs").replaceCommonMod(path.join(srcMods, jars[0]), serverFolder);
    const display = fs.readdirSync(srcMods).filter(n => /^displaymod-[0-9.]+\.jar$/i.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (display) require("./bridge_mod_migration.cjs").replaceCommonMod(path.join(srcMods, display), serverFolder, 'displaymod');
    // 標準装備の OBSMOD（サーバーにだけ入れる。2026-10-25）。
    const obs = fs.readdirSync(srcMods).filter(n => /^minecraft_obs_bridge-[0-9.]+\.jar$/i.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    if (obs) require("./bridge_mod_migration.cjs").replaceCommonMod(path.join(srcMods, obs), serverFolder, 'minecraft_obs_bridge');
  }

  function scheduleBridgeSync() {
    if (!app.isPackaged) return;
    setTimeout(() => {
      ensureBridgeExtracted()
        .then(() => refreshGameModsOnStartup())
        .catch((e) => {
          const message = e?.message || String(e);
          console.error("[main] bridge background sync failed:", message);
          setBridgeSyncState({ state: "error", phase: "failed", error: message });
        });
    }, 1000);
  }

  // アプリを更新したあと、今選んでいるゲームの MOD（サーバーと Minecraft の両方）とコマンドを、ホームの「保存」と同じ処理で新しくする。
  // 入れ替えられないときは何も変えず、次の起動でもう一度試す。どちらでもホームへ知らせて、ゲームの状態を読み直させる（2026-10-13 ユーザーの決定）。
  // 手動インストール（更新も含む）では初期セットアップをやり直すので、そのときはセットアップを終えたとき（app:config:write）に呼ぶ。
  async function refreshGameModsOnStartup() {
    if (!app.isPackaged) return;
    const cfg = readAppConfig();
    if (!cfg.setupComplete || !cfg.serverFolder) return;
    let result;
    try {
      result = await refreshGameModsAfterUpdate({ version: app.getVersion(), readConfig: readAppConfig, writeConfig: writeAppConfig, profiles: gameProfiles, run: gameProfileOperation });
    } catch (e) {
      // ゲームの状態が読めないときなど。BRIDGE の展開の失敗とは分けて、ログに残すだけにする。
      console.warn("[games] アプリの更新に合わせたMODの入れ替えを確かめられませんでした:", e?.message || e);
      return;
    }
    if (result.state === "done") console.log("[games] アプリの更新に合わせて、選んでいるゲームのMODを新しくしました:", result.game);
    else if (result.state === "failed") console.warn("[games] アプリの更新に合わせたMODの入れ替えをやめました（次の起動でもう一度試す）:", result.error);
    if (result.state === "done" || result.state === "failed") {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send("games:changed", { state: result.state, changed: result.changed === true });
    }
  }

  async function ensureBridgeExtracted() {
    if (!app.isPackaged) return; // dev は ui/bridge をそのまま使う

    const src = path.join(process.resourcesPath, "bridge");
    if (!fs.existsSync(src)) return; // resources に bridge がない場合は何もしない

    const cfg = readAppConfig();

    // setupComplete=false: セットアップ時に bridge:extractTo で展開するのでスキップ
    if (!cfg.setupComplete || !cfg.serverFolder) return;

    const dst = path.join(cfg.serverFolder, "bridge");
    const currentVersion = app.getVersion();

    // 同バージョン展開済みなら再コピーしない
    if (cfg.bridgeVersion === currentVersion && fs.existsSync(path.join(dst, "index.js"))) {
      setBridgeSyncState({ state: "running", phase: "checking-runtime", error: "", stats: null });
      const runtime = await ensureBridgeRuntimeReady(dst);
      setBridgeSyncState({ state: "current", phase: "skipped", error: "", stats: { runtime } });
      return;
    }

    setBridgeSyncState({ state: "running", phase: "copying", error: "", stats: null });
    const result = await copyBridgeDifferential(src, dst, { preserveUserFiles: true });
    await ensureBridgeRuntimeReady(dst, result.stats);
    await refreshBridgeModJar(cfg.serverFolder);
    await writeBridgeSyncMarker(dst, await getBridgeRuntimeSignature(dst), result.stats);
    writeAppConfig({ bridgeVersion: currentVersion });
    setBridgeSyncState({ state: "done", phase: "complete", error: "", stats: result.stats });
  }

  // --------------------
  // IPC: サーバーテンプレートをコピー（空フォルダ対応）
  // --------------------
  // 数百MB・数千ファイルのJDK同梱テンプレートを同期fsで丸ごとコピーするとメインプロセスが
  // 完全にブロックされ、アプリ全体が無応答になる。fs.promises化した上で、一定件数ごとに
  // setImmediateでイベントループへ制御を返し、進捗はポーリング用の状態に積んでUIへ公開する。
  let copyTemplateState = { state: "idle", copied: 0, total: 0, error: "" };

  function countFilesRecursive(dir) {
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      count += entry.isDirectory() ? countFilesRecursive(p) : 1;
    }
    return count;
  }

  async function copyRecursiveAsync(src, dst, onFileCopied) {
    await fs.promises.mkdir(dst, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    let sinceYield = 0;
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        await copyRecursiveAsync(srcPath, dstPath, onFileCopied);
      } else {
        // 既存ファイルはスキップ（上書きしない）
        if (!(await pathExists(dstPath))) {
          await fs.promises.copyFile(srcPath, dstPath);
        }
        onFileCopied();
        sinceYield += 1;
        if (sinceYield >= 25) {
          sinceYield = 0;
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
  }

  function register(ipcMain) {
    ipcMain.handle("bridge:syncStatus", () => bridgeSyncState);

    // --------------------
    // IPC: Bridge を指定フォルダ/bridge/ へ展開（初期セットアップ時）
    // --------------------
    ipcMain.handle("bridge:extractTo", async (_event, targetFolder) => {
      if (!targetFolder || typeof targetFolder !== "string") throw new Error("targetFolder is required");

      if (!app.isPackaged) {
        // dev: ui/bridge/ をそのまま使うので何もしない
        return { ok: true, skipped: true };
      }

      const src = path.join(process.resourcesPath, "bridge");
      if (!fs.existsSync(src)) throw new Error(`resources/bridge not found: ${src}`);

      const dst = path.join(targetFolder, "bridge");
      const dstConfigPath = path.join(dst, "config.minecraft.json");
      const hadUserConfig = fs.existsSync(dstConfigPath);
      const result = await copyBridgeDifferential(src, dst, { forceHeavy: true, preserveUserFiles: true });
      await ensureBridgeRuntimeReady(dst, result.stats);
      await writeBridgeSyncMarker(dst, await getBridgeRuntimeSignature(dst), result.stats);
      writeAppConfig({ bridgeVersion: app.getVersion() });

      // 新規セットアップ（既存configなし）の場合、同梱テンプレ由来のアカウント情報を
      // 引き継がせない。ID はユーザー自身がダッシュボードで入力して承認する。
      if (!hadUserConfig && fs.existsSync(dstConfigPath)) {
        try {
          const fresh = JSON.parse(fs.readFileSync(dstConfigPath, "utf8"));
          fresh.tiktokUsername = "";
          if (fresh.rcon) fresh.rcon.password = "";
          writeFileDurable(dstConfigPath, JSON.stringify(fresh, null, 2));
        } catch (e) {
          console.warn("[bridge:extractTo] fresh config sanitize failed:", e?.message || e);
        }
      }

      // 過去バージョンでセットアップされたフォルダを再利用しても mod jar を最新に揃える
      await refreshBridgeModJar(targetFolder);

      return { ok: true, dst, stats: result.stats };
    });

    // --------------------
    // IPC: サーバーテンプレートをコピー（空フォルダ対応。手伝いの関数は上の同じ見出しの所）
    // --------------------
    ipcMain.handle("server:copyTemplate", async (_event, targetFolder) => {
      assertGameProfileIdle();
      if (!targetFolder || typeof targetFolder !== "string") throw new Error("targetFolder is required");

      const template = getServerTemplatePath();
      if (!fs.existsSync(template)) throw new Error(`テンプレートが見つかりません: ${template}`);

      const commandsSrc = bridgeCommandsDir(app.isPackaged
        ? path.join(process.resourcesPath, "bridge")
        : path.resolve(appDir, "..", "bridge"));
      const commandsDst = bridgeCommandsDir(path.join(targetFolder, "bridge"));
      const hasCommandsSrc = fs.existsSync(commandsSrc);

      const total = countFilesRecursive(template) + (hasCommandsSrc ? countFilesRecursive(commandsSrc) : 0);
      copyTemplateState = { state: "running", copied: 0, total, error: "" };

      try {
        const onFileCopied = () => { copyTemplateState.copied += 1; };
        await copyRecursiveAsync(template, targetFolder, onFileCopied);

        // MODが読む bridge/commands/minecraft/ をテンプレートコピー時点で展開
        // (bridge:extractTo は確認ボタン後だが、MODはサーバー起動時に読むため早めに配置する)
        if (hasCommandsSrc) {
          await copyRecursiveAsync(commandsSrc, commandsDst, onFileCopied);
        }
        // copyRecursiveAsync は既存ファイルを上書きしないため、再利用フォルダには
        // 旧版の bridgemod jar が残り得る。ここで最新版に揃える（ルートの残骸も撤去）。
        await refreshBridgeModJar(targetFolder);
        copyTemplateState = { ...copyTemplateState, state: "done" };
      } catch (err) {
        copyTemplateState = { ...copyTemplateState, state: "error", error: String(err?.message || err) };
        throw err;
      }

      return { ok: true };
    });

    ipcMain.handle("server:copyTemplateStatus", () => copyTemplateState);
  }

  return { ensureNodeRuntimeAvailable, getBridgeEntryPoint, scheduleBridgeSync, refreshGameModsOnStartup, ensureBridgeExtracted, register };
}

module.exports = { createBridgeSync };
