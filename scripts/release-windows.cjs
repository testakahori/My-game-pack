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
const { assertReleaseVersion, RELEASE_PIPELINE_ENV } = require("./release_version.cjs");
const { modJars } = require("./mod_jars.cjs");
const { SOURCE_DIRS, SOURCE_FILES, CHANGED_DURING_BUILD, jarInputsHash, readStamp } = require("./jar_inputs.cjs");

// prepare:game-maps はゲームの初期マップ（map/<マップ名>。git の外）をパックの置き場に入れるので、パックのあと（埋め立て PR3）。
const RELEASE_STEPS = ["build", "prepare:bridge-runtime", "prepare:server-template", "prepare:game-packs", "prepare:game-maps"];
// 準備の道具が作り直す置き場（git で管理していない）。前に作ったものが残っていると、止まるか、そのまま入る。
// build/ には git で管理するファイル（installer.nsh）もあるので、これだけを空にする。GiftsViewer/tools-bundled は prepare:bridge-runtime が上書きするだけで、古いファイルを消さない。
const GENERATED_DIRS = ["build/server-template", "build/game-packs", "GiftsViewer/tools-bundled"];
// 置き場には jdk や libraries の数千のファイルがある。エクスプローラーやウイルス対策が一瞬つかんでいても、何度か試し直す。
const REMOVE_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };

// 印（jar の横の <jar>.inputs.json）の無い古い jar のための、時刻での比べ方。jar に入る元（src/main・src/generated とビルドの設定）を見る。
// 契約テスト・テストのソース（src/contractTest・src/test）は jar に入らないので見ない。
function newestSourceTime(root, dir) {
  let newest = 0;
  const visit = file => {
    let stat;
    try { stat = fs.statSync(file); } catch { return; }
    // フォルダーの時刻も見る。ファイルを足す・消す・名前を変えると、そのフォルダーの時刻が新しくなる（消しただけのときも見逃さない）。
    newest = Math.max(newest, stat.mtimeMs);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
  };
  for (const sub of SOURCE_DIRS) visit(path.join(root, dir, sub));
  for (const name of SOURCE_FILES) visit(path.join(root, dir, name));
  return newest;
}

// MOD の作り直し忘れ。印があれば中身で比べる（git でブランチを切り替えて時刻だけ新しくなっても止めない）。
// 印の無い古い jar は時刻で比べる。コミットの時刻で比べないのは、jar を作ってからコミットしたときに作り直し忘れと見なしてしまうため。
// 時刻で比べると、git でブランチを切り替えたときに中身が同じでも止まる。作り直せば印が書かれ、次からは中身で比べる（安全な側に倒す）。
function staleMods(root) {
  return modJars(root).flatMap(mod => {
    if (!fs.existsSync(mod.jar)) return [{ ...mod, reason: "jar が無い" }];
    const parts = [{ dir: mod.dir }, ...(mod.uses ? [mod.uses] : [])];
    const stamp = readStamp(mod.jar);
    if (stamp) {
      for (const part of parts) {
        const recorded = stamp.inputs[part.dir];
        if (recorded === CHANGED_DURING_BUILD) return [{ ...mod, reason: "jar を作っている間にソースが変わった" }];
        if (recorded !== jarInputsHash(root, part.dir)) {
          return [{ ...mod, reason: part.name ? `${part.name} のソースが jar を作ったときと違う（${mod.name} は ${part.name} を使って作る）` : "ソースが jar を作ったときと違う" }];
        }
      }
      return [];
    }
    const jarTime = fs.statSync(mod.jar).mtimeMs;
    for (const part of parts) {
      if (newestSourceTime(root, part.dir) > jarTime) {
        return [{ ...mod, reason: part.name ? `${part.name} のソースが jar より新しい（${mod.name} は ${part.name} を使って作る）` : "ソースが jar より新しい" }];
      }
    }
    return [];
  });
}

// どのコミットから作ったか（表示だけ。止めない）。git が使えなければ null。
function gitState(root) {
  const git = (...args) => cp.execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
  try {
    const changes = git("status", "--porcelain", "--untracked-files=no");
    return { commit: git("rev-parse", "--short", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), changes: changes ? changes.split("\n").length : 0 };
  } catch {
    return null;
  }
}

function removeGenerated(root, remove) {
  for (const dir of GENERATED_DIRS) {
    try {
      remove(path.join(root, dir));
    } catch (error) {
      throw new Error(`${dir} を消せません（${error.code || error.message}）。そのフォルダーを開いているもの（エクスプローラー・エディター・ウイルス対策など）を閉じてから、もう一度動かしてください。`);
    }
  }
}

// run(step) は npm run <step>、packageInstaller(args) は scripts/package-windows.cjs（テストでは偽物）。返すのは最後に表示する行。
async function runRelease({ root, local, outDir, run, packageInstaller, log = console.log, remove = dir => fs.rmSync(dir, REMOVE_OPTIONS) }) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  assertReleaseVersion(version, local);
  const stale = staleMods(root);
  if (stale.length) {
    throw new Error(["MOD の jar が古いか無いので、インストーラーを作りません。",
      ...stale.map(mod => `- ${mod.name}（${mod.reason}）: ${path.relative(root, mod.jar)}`),
      "MOD を作り直してから、もう一度動かしてください。",
      "（印の無い古い jar は時刻で比べるので、MOD を変えていなくても、git でブランチを切り替えるとここで止まることがあります。作り直すと印が書かれ、次からは中身で比べます）"].join("\n"));
  }
  removeGenerated(root, remove);
  for (const step of RELEASE_STEPS) {
    log(`[release] npm run ${step}`);
    await run(step);
  }
  const started = Date.now();
  await packageInstaller([...(local ? ["--local"] : []), outDir]);
  // 今回できた .exe だけを見る。electron-builder が失敗しても終了コード 0 で返ることがあり（10-24 実機）、前の回の .exe が残っていることもある。
  const installers = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter(name => name.endsWith(`-${version}.exe`)
    && fs.statSync(path.join(outDir, name)).mtimeMs >= started - 1000) : [];
  if (!installers.length) throw new Error(`インストーラー（.exe）ができていません：${outDir}\n上に出た electron-builder のエラーを見てください。`);
  const state = gitState(root);
  const summary = [
    `アプリ ${version}`,
    `インストーラー: ${installers.map(name => path.join(outDir, name)).join("、")}`,
    state ? `作った元: ${state.commit}（${state.branch === "HEAD" ? "ブランチなし" : state.branch}）・コミットしていない変更 ${state.changes} 件` : "作った元: git の情報が取れない",
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

// 引数：出力先（無ければ release、試し用は release-local）と --local。
function releaseOptions(argv, root) {
  const local = argv.includes("--local");
  return { local, outDir: path.resolve(argv.find(arg => arg !== "--local") || path.join(root, local ? "release-local" : "release")) };
}

const execNode = (args, options) => cp.execFileSync(process.execPath, args, { ...options, stdio: "inherit", windowsHide: true });

// root・cli・exec・log はテストで差し替える。package-windows.cjs には合図（RELEASE_PIPELINE_ENV）を渡す。無いと止まる。
async function main(argv = process.argv.slice(2), { root = path.resolve(__dirname, ".."), cli, exec = execNode, log } = {}) {
  const { local, outDir } = releaseOptions(argv, root);
  const npm = cli || npmCli();
  const options = { cwd: root, env: { ...process.env, npm_execpath: npm, [RELEASE_PIPELINE_ENV]: "1" } };
  return runRelease({
    root, local, outDir, log,
    run: step => exec([npm, "run", step], options),
    packageInstaller: args => exec([path.join(__dirname, "package-windows.cjs"), ...args], options),
  });
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });

module.exports = { RELEASE_STEPS, GENERATED_DIRS, REMOVE_OPTIONS, staleMods, runRelease, releaseOptions, main };
