const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const esbuild = require("esbuild");
const { newBridgeConfig } = require("../bridge/config_defaults.cjs");

const projectRoot = path.resolve(__dirname, "..");
const bridgeDir = path.join(projectRoot, "bridge");
const outDir = path.join(projectRoot, "build", "bridge-bundle");
const bundlePath = path.join(outDir, "index.bundle.cjs");
const nodeOutDir = path.join(outDir, "node");
const bundledNodeExe = path.join(bridgeDir, "node", "node.exe");
// クリーンcloneでもWindows版Node 20+でビルドできるよう、専用runtimeが無い場合は
// ビルドに使っているnode.exeを配布runtimeとして採用する。
const currentNodeMajor = Number(process.versions.node.split(".", 1)[0]);
const nodeExeSrc = fs.existsSync(bundledNodeExe)
  ? bundledNodeExe
  : (process.platform === "win32" && currentNodeMajor >= 20 ? process.execPath : bundledNodeExe);
const nodeExeDst = path.join(nodeOutDir, "node.exe");
const manifestPath = path.join(outDir, "bridge-runtime-manifest.json");
const giftsViewerDir = path.join(projectRoot, "GiftsViewer");
const giftsToolsDir = path.join(giftsViewerDir, "tools");
const giftsToolsOutDir = path.join(giftsViewerDir, "tools-bundled");

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readPackageVersion(filePath) {
  try {
    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return String(json.version || "");
  } catch {
    return "";
  }
}

function assertExists(p, label) {
  if (!fs.existsSync(p)) throw new Error(`${label} not found: ${p}`);
}

assertExists(path.join(bridgeDir, "index.js"), "Bridge index.js");
assertExists(path.join(bridgeDir, "weighted_choice.cjs"), "Bridge weighted_choice.cjs");
assertExists(path.join(bridgeDir, "config_schema.js"), "Bridge config_schema.js");
assertExists(path.join(bridgeDir, "node_modules"), "Bridge node_modules");
assertExists(nodeExeSrc, "Bridge node.exe (or Windows Node 20+ used for this build)");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(nodeOutDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(bridgeDir, "index.js")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: bundlePath,
  logLevel: "silent",
});

// 配布設定が参照するGiftsViewer/tools-bundledもclean cloneから生成する。
// Bridgeと同じ監査済みconnectorを解決し、古いGiftsViewer/node_modulesへ依存しない。
fs.mkdirSync(giftsToolsOutDir, { recursive: true });
esbuild.buildSync({
  entryPoints: [path.join(giftsToolsDir, "fetch_gifts.cjs"), path.join(giftsToolsDir, "live_status.cjs")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir: giftsToolsOutDir,
  outExtension: { ".js": ".cjs" },
  nodePaths: [path.join(bridgeDir, "node_modules")],
  logLevel: "silent",
});
fs.copyFileSync(
  path.join(giftsToolsDir, "gifts_to_html.cjs"),
  path.join(giftsToolsOutDir, "gifts_to_html.cjs")
);

fs.copyFileSync(nodeExeSrc, nodeExeDst);

// 開発環境の bridge/config.minecraft.json には実データ（本物のTikTokユーザー名・RCONパスワード・
// 開発機の絶対パスcommandsDir）が入ったまま残っている。electron-builder の extraResources は
// "bridge" -> "bridge" (生の bridge/ 一式) の後に "build/bridge-bundle" -> "bridge" を上書きコピーするため、
// ここにクリーンな既定configを書き出しておけば配布物には実データが混入しない。
// （このクリーンconfigには commandsDir が無いが、BRIDGE は書いていなければ commands/minecraft を読む。
//   初回セットアップの config:write が commandsDir を serverFolder内の絶対パスにしてから Bridge を起動する）
// 雛形は bridge/config_defaults.cjs の1か所（アプリの electron/paths.cjs と同じ。処理のコピー PR4）。
const cleanConfigPath = path.join(outDir, "config.minecraft.json");
const cleanConfig = newBridgeConfig();
fs.writeFileSync(cleanConfigPath, JSON.stringify(cleanConfig, null, 2), "utf8");

const manifest = {
  runtimeKind: "bundle",
  createdAt: new Date().toISOString(),
  entry: "index.bundle.cjs",
  bundleSha256: sha256File(bundlePath),
  bundleBytes: fs.statSync(bundlePath).size,
  nodeExeBytes: fs.statSync(nodeExeDst).size,
  nodeExeSha256: sha256File(nodeExeDst),
  dependencies: {
    "tiktok-live-connector": readPackageVersion(path.join(bridgeDir, "node_modules", "tiktok-live-connector", "package.json")),
    "rcon-client": readPackageVersion(path.join(bridgeDir, "node_modules", "rcon-client", "package.json")),
  },
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
console.log(`[prepare-bridge-runtime] bundle ${bundlePath}`);
console.log(`[prepare-bridge-runtime] bundle ${(manifest.bundleBytes / 1024 / 1024).toFixed(1)} MiB sha256=${manifest.bundleSha256}`);
console.log(`[prepare-bridge-runtime] node.exe ${(manifest.nodeExeBytes / 1024 / 1024).toFixed(1)} MiB sha256=${manifest.nodeExeSha256}`);
console.log(`[prepare-bridge-runtime] gifts tools ${giftsToolsOutDir}`);
