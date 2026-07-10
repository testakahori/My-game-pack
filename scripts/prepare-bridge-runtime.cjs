const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "..");
const bridgeDir = path.join(projectRoot, "bridge");
const outDir = path.join(projectRoot, "build", "bridge-bundle");
const bundlePath = path.join(outDir, "index.bundle.cjs");
const nodeOutDir = path.join(outDir, "node");
const nodeExeSrc = path.join(bridgeDir, "node", "node.exe");
const nodeExeDst = path.join(nodeOutDir, "node.exe");
const manifestPath = path.join(outDir, "bridge-runtime-manifest.json");

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
assertExists(path.join(bridgeDir, "feature_engine.js"), "Bridge feature_engine.js");
assertExists(path.join(bridgeDir, "config_schema.js"), "Bridge config_schema.js");
assertExists(path.join(bridgeDir, "node_modules"), "Bridge node_modules");
assertExists(nodeExeSrc, "Bridge node.exe");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(nodeOutDir, { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(bridgeDir, "index.js")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: bundlePath,
  logLevel: "silent",
});

fs.copyFileSync(nodeExeSrc, nodeExeDst);

// 開発環境の bridge/config.minecraft.json には実データ（本物のTikTokユーザー名・RCONパスワード・
// 開発機の絶対パスcommandsDir）が入ったまま残っている。electron-builder の extraResources は
// "bridge" -> "bridge" (生の bridge/ 一式) の後に "build/bridge-bundle" -> "bridge" を上書きコピーするため、
// ここにクリーンな既定configを書き出しておけば配布物には実データが混入しない。
// （bridge/index.js 自身の起動時チェックはこのクリーンconfigのままだと commandsDir が無いため
//   exit(1) するが、初回セットアップの config:write が commandsDir を serverFolder内へ矯正してから
//   Bridge起動する導線なので問題ない）
const cleanConfigPath = path.join(outDir, "config.minecraft.json");
const cleanConfig = {
  tiktokUsername: "",
  rcon: { host: "127.0.0.1", port: 25575, password: "" },
  mappings: [],
  likeEvents: [],
  unmappedGiftEvent: { commandFile: "", repeat: 1, enabled: false },
  shareEvent: { commandFile: "", repeat: 1, enabled: false },
  followEvent: { commandFile: "", repeat: 1, enabled: false },
  memberEvent: { commandFile: "", repeat: 1, enabled: false },
  options: {
    giftCooldownMs: 300,
    maxCommandsPerGift: 200,
    commandTransport: "douma_mod",
    doumaModHost: "127.0.0.1",
    doumaModPort: 25576,
    maxLikeCatchUpPerEvent: 5,
    logUnknownGifts: true,
  },
};
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
