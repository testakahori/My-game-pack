"use strict";
// 配信者に配るインストーラーを作る1本の手順（npm run release:win。2026-10-24 ユーザーの決定。HANDOFF04 の「リリース手順が2つ」）。
// 前は scripts/package-windows.cjs だけを動かすと、画面のビルドや BRIDGE・サーバーの雛形・ゲームパックの準備をせずに、前に作ったものがそのまま入った。
// npm run pack:win は準備までしたが、最後に electron-builder をそのまま呼び、2回目からはサーバーの雛形の置き場が残っていて止まった。
// 版を確かめ、MOD の作り直し忘れを確かめ、作った物の置き場を空にしてから、画面のビルド → BRIDGE・サーバーの雛形・ゲームパックの準備 →
// インストーラー（scripts/package-windows.cjs）の順に必ず通す。MOD の jar は作り直さず、MOD を変えたときに作っておいたものを同梱する（ユーザー）。
// 試し用の版（-local.）は scripts/package-local.cjs から同じ流れを通す。
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { assertReleaseVersion } = require("./release_version.cjs");

const RELEASE_STEPS = ["build", "prepare:bridge-runtime", "prepare:server-template", "prepare:game-packs"];
// 準備の道具が「もうある」と止まる、作った物の置き場（git で管理していない）。build/ には git で管理するファイル（installer.nsh）もあるので、これだけを空にする。
const GENERATED_DIRS = ["build/server-template", "build/game-packs"];
// jar の元になるソース（src/main の下の全部と、ビルドの設定）。契約テスト・テストのソース（src/contractTest・src/test）は jar に入らないので見ない。
const SOURCE_FILES = ["build.gradle", "gradle.properties", "settings.gradle"];

const modVersion = (root, dir) => fs.readFileSync(path.join(root, dir, "gradle.properties"), "utf8").match(/^mod_version=(.+)$/m)?.[1]?.trim();

// 同梱する MOD の jar。決まりは scripts/prepare-server-template.cjs・prepare-game-packs.cjs と同じ。
function modJars(root) {
  const saikutu = JSON.parse(fs.readFileSync(path.join(root, "game-packs/saikutu/game.json"), "utf8"));
  return [
    { name: "BridgeMOD", dir: "BridgeMod", jar: path.join(root, "BridgeMod/build/libs", `bridgemod-${modVersion(root, "BridgeMod")}.jar`) },
    { name: "DisplayMOD", dir: "DisplayMod", jar: path.join(root, "DisplayMod/build/libs", `displaymod-${modVersion(root, "DisplayMod")}.jar`) },
    { name: "採掘MOD", dir: "SaikutuMod", jar: path.join(root, "SaikutuMod/build/libs", saikutu.serverJar) },
  ];
}

function newestSourceTime(root, dir) {
  let newest = 0;
  const visit = file => {
    let stat;
    try { stat = fs.statSync(file); } catch { return; }
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    else newest = Math.max(newest, stat.mtimeMs);
  };
  visit(path.join(root, dir, "src", "main"));
  for (const name of SOURCE_FILES) visit(path.join(root, dir, name));
  return newest;
}

// MOD の作り直し忘れ：jar が無い、またはソースのどれかが jar より新しい。ファイルの時刻で比べる
// （コミットの時刻で比べると、jar を作ってからコミットしたときに作り直し忘れと見なしてしまう）。
// git でブランチを切り替えると、中身が同じでも書き直されたファイルの時刻は新しくなり、ここで止まる。作り直せば同じ版の jar になって通る（安全な側に倒す）。
function staleMods(root) {
  return modJars(root).flatMap(mod => {
    if (!fs.existsSync(mod.jar)) return [{ ...mod, reason: "jar が無い" }];
    return newestSourceTime(root, mod.dir) > fs.statSync(mod.jar).mtimeMs ? [{ ...mod, reason: "ソースが jar より新しい" }] : [];
  });
}

// run(step) は npm run <step>、packageInstaller(args) は scripts/package-windows.cjs（テストでは偽物）。返すのは最後に表示する行。
async function runRelease({ root, local, outDir, run, packageInstaller, log = console.log }) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  assertReleaseVersion(version, local);
  const stale = staleMods(root);
  if (stale.length) {
    throw new Error(["MOD の jar が古いか無いので、インストーラーを作りません。",
      ...stale.map(mod => `- ${mod.name}（${mod.reason}）: ${path.relative(root, mod.jar)}`),
      "MOD を作り直してから、もう一度動かしてください。",
      "（MOD を変えていなくても、git でブランチを切り替えるとファイルの時刻だけ新しくなり、ここで止まることがあります。そのときも作り直せば通ります）"].join("\n"));
  }
  for (const dir of GENERATED_DIRS) fs.rmSync(path.join(root, dir), { recursive: true, force: true });
  for (const step of RELEASE_STEPS) {
    log(`[release] npm run ${step}`);
    await run(step);
  }
  const started = Date.now();
  await packageInstaller([...(local ? ["--local"] : []), outDir]);
  // 今回できた .exe だけを見る。electron-builder が失敗しても終了コード 0 で返ることがあり（10-24 実機）、前の回の .exe が残っていることもある。
  const installers = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(name => name.endsWith(".exe") && name.includes(version)
    && fs.statSync(path.join(outDir, name)).mtimeMs >= started - 1000) : [];
  if (!installers.length) throw new Error(`インストーラー（.exe）ができていません：${outDir}\n上に出た electron-builder のエラーを見てください。`);
  const summary = [
    `アプリ ${version}`,
    `インストーラー: ${installers.map(name => path.join(outDir, name)).join("、")}`,
    ...modJars(root).map(mod => `${mod.name}: ${path.basename(mod.jar)}`),
  ];
  for (const line of summary) log(`[release] ${line}`);
  return summary;
}

// npm を Node から直接呼ぶ（scripts/package-windows.cjs と同じ。Windows で npm を PowerShell に包んで動かさない）。
function npmCli() {
  const cli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (!fs.existsSync(cli) || !cli.endsWith("npm-cli.js")) throw new Error("Run through npm (npm run release:win) or set npm_execpath to npm-cli.js");
  return cli;
}

async function main(argv = process.argv.slice(2)) {
  const root = path.resolve(__dirname, "..");
  const local = argv.includes("--local");
  const outDir = path.resolve(argv.find(arg => arg !== "--local") || path.join(root, local ? "release-local" : "release"));
  const cli = npmCli();
  const exec = args => cp.execFileSync(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true, env: { ...process.env, npm_execpath: cli } });
  return runRelease({
    root, local, outDir,
    run: step => exec([cli, "run", step]),
    packageInstaller: args => exec([path.join(__dirname, "package-windows.cjs"), ...args]),
  });
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });

module.exports = { RELEASE_STEPS, GENERATED_DIRS, modJars, staleMods, runRelease, main };
