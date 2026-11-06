"use strict";
// 配信者に配るインストーラーを作る1本の手順（npm run release:win。2026-10-24 ユーザーの決定。HANDOFF04 の「リリース手順が2つ」）。
// 前は scripts/package-windows.cjs だけを動かすと、画面のビルドや BRIDGE・サーバーの雛形・ゲームパックの準備をせずに、前に作ったものがそのまま入った。
// npm run pack:win は準備までしたが、最後に electron-builder をそのまま呼び、2回目からはサーバーの雛形の置き場が残っていて止まった。
// 版を確かめ、MOD の作り直し忘れを確かめ、作った物の置き場を空にしてから、画面のビルド → BRIDGE・サーバーの雛形・ゲームパックの準備 →
// インストーラー（scripts/package-windows.cjs）の順に必ず通す。MOD の jar は作り直さず、MOD を変えたときに作っておいたものを同梱する（ユーザー）。
// 試し用の版（-local.）は scripts/package-local.cjs から同じ流れを通す。
// 作る前にコミットしていない変更と node_modules の版を確かめ、作ったあとに配る物の中身を確かめ、何から何を作ったかを
// <出力先>/<版>-manifest.json に残す（2026-11-06 品質レビュー。確かめの中身は scripts/release_checks.cjs）。
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const { assertReleaseVersion, RELEASE_PIPELINE_ENV } = require("./release_version.cjs");
const { modJars } = require("./mod_jars.cjs");
const { SOURCE_DIRS, SOURCE_FILES, CHANGED_DURING_BUILD, jarInputsHash, readStamp } = require("./jar_inputs.cjs");
const { GAMES } = require("../bridge/game_commands.cjs");
const checks = require("./release_checks.cjs");

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

// 配る物に入ったゲームの初期マップ（build/game-packs/<id>/maps/<マップ名>。games.json の maps）のファイルの数と大きさ。
// 本当に入ったかを、最後の表示で jar と並べて見せる（埋め立て PR3 の最後のレビュー 軽い8）。
const formatSize = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
function gameMapLines(root) {
  return GAMES.filter(game => game.maps?.length).flatMap(game => game.maps.map(name => {
    const dir = path.join(root, "build", "game-packs", game.id, "maps", name);
    if (!fs.existsSync(path.join(dir, "level.dat"))) return `${game.name}の初期マップ ${name}: 入っていません`;
    const files = fs.readdirSync(dir, { recursive: true }).map(n => path.join(dir, String(n))).filter(file => fs.statSync(file).isFile());
    return `${game.name}の初期マップ ${name}: ${files.length} ファイル・${formatSize(files.reduce((sum, file) => sum + fs.statSync(file).size, 0))}`;
  }));
}

// git の bridge のファイル（bridge から見た道）。git が使えなければ null。
function gitBridgeFiles(root) {
  try {
    const out = cp.execFileSync("git", ["-C", root, "ls-files", "-z", "--", "bridge"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    return out.split("\0").filter(Boolean).map(file => file.slice("bridge/".length));
  } catch {
    return null;
  }
}

// 配る物の bridge（<出力先>/win-unpacked/resources/bridge）に、git で管理していないファイル（開発機の残り物）が入っていないか。止めずに名前を並べて知らせる
// （前の版には _op.txt・ゲームのコマンドの写し・.omc が入っていた。2026-10-29 ユーザーの決定）。
// 入っているべきものは、git の bridge のファイルと、prepare:bridge-runtime が作る build/bridge-bundle の中身。
const listFiles = dir => fs.readdirSync(dir, { recursive: true }).map(name => String(name).replace(/\\/g, "/")).filter(name => fs.statSync(path.join(dir, name)).isFile());
function extraBridgeLine(root, outDir, bridgeFiles) {
  const shipped = path.join(outDir, "win-unpacked", "resources", "bridge");
  if (!fs.existsSync(shipped)) return "配る物の bridge: win-unpacked が無いので確かめていません";
  const tracked = bridgeFiles();
  if (!tracked) return "配る物の bridge: git の情報が取れないので確かめていません";
  const bundle = path.join(root, "build", "bridge-bundle");
  const expected = new Set([...tracked, ...(fs.existsSync(bundle) ? listFiles(bundle) : [])]);
  const extra = listFiles(shipped).filter(file => !expected.has(file)).sort();
  return extra.length ? `配る物の bridge に git に無いファイルがあります（${extra.length} 件）: ${extra.join("、")}` : "配る物の bridge の git に無いファイル: なし";
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

// npm ls を Node から直接呼ぶ（Windows で npm を PowerShell に包んで動かさない）。
const npmLs = cli => dir => {
  const result = cp.spawnSync(process.execPath, [cli, "ls", "--depth=0", "--json"], { cwd: dir, encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout };
};

// run(step) は npm run <step>、packageInstaller(args) は scripts/package-windows.cjs、bridgeFiles() は git の bridge のファイル（テストでは偽物）。
// git() は作る元の git の様子、dependencies() は node_modules の問題、verifyOutput() は配る物の問題（scripts/release_checks.cjs。テストでは偽物）。
// allowDirty は試し用の版で、コミットしていない変更を入れたまま作る合図（--allow-dirty）。返すのは最後に表示する行。
async function runRelease({ root, local, allowDirty = false, outDir, run, packageInstaller, log = console.log, remove = dir => fs.rmSync(dir, REMOVE_OPTIONS),
  bridgeFiles = () => gitBridgeFiles(root), git = () => checks.gitState(root), dependencies = () => checks.dependencyProblems(root, npmLs(npmCli())),
  verifyOutput = () => checks.outputProblems({ root, outDir }) }) {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  assertReleaseVersion(version, local);
  // 何から作ったか（manifest の commit）が中身と合うよう、コミットしていない変更があれば止める。
  const state = git();
  checks.assertCleanTree(state, { local, allowDirty });
  // 開発版が書き換える設定（配る物には入らない）は止めずに知らせる。コミットしないで、git restore で戻す（2026-11-06 レビュー 重要1）。
  if (state?.devOnly?.length) log(`[release] 開発版が書き換えた設定（配る物には入らない）: ${state.devOnly.map(line => line.slice(3)).join("、")}。コミットせず、git restore で戻してください。`);
  // node_modules が package-lock.json と違うと、違う版の部品が配られる（1.0.48 の tiktok-live-connector）。
  checks.assertDependencies(dependencies());
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
  const installer = path.join(outDir, installers[0]);
  // 配る物の中身を確かめる。問題があれば、記録（manifest）を書かずに止める。
  // 通らなかったインストーラーは名前を「….rejected.exe」に変え、うっかり配らないようにする（2026-11-06 レビュー 軽い6）。
  try {
    checks.assertOutput(verifyOutput(), installer);
  } catch (error) {
    try { fs.renameSync(installer, installer.replace(/\.exe$/i, ".rejected.exe")); } catch { /* 名前を変えられなくても、止める理由はそのまま出す */ }
    throw error;
  }
  const manifest = checks.releaseManifest({ root, outDir, installer, state, local, allowDirty });
  const manifestFile = checks.writeManifest(outDir, manifest);
  const summary = [
    `アプリ ${version}`,
    `インストーラー: ${installer}`,
    `SHA-256: ${manifest.installer?.sha256 || "取れない"}`,
    state ? `作った元: ${state.short}（${state.branch === "HEAD" ? "ブランチなし" : state.branch}）・コミットしていない変更 ${state.changes.length} 件` : "作った元: git の情報が取れない",
    ...modJars(root).map(mod => `${mod.name}: ${path.basename(mod.jar)}`),
    ...gameMapLines(root),
    extraBridgeLine(root, outDir, bridgeFiles),
    "配る物の確かめ: 問題なし",
    `記録: ${manifestFile}`,
    // タグはこのスクリプトでは付けない。付けるときの形だけを出す。
    ...(!local && state ? [`タグを付けるとき: git tag v${version} ${state.commit} && git push origin v${version}`] : []),
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

// 引数：出力先（無ければ release、試し用は release-local）と --local・--allow-dirty（環境変数 MYGAMEPACK_RELEASE_ALLOW_DIRTY=1 でも同じ）。
function releaseOptions(argv, root, env = process.env) {
  const local = argv.includes("--local");
  const allowDirty = argv.includes(checks.ALLOW_DIRTY_FLAG) || env[checks.ALLOW_DIRTY_ENV] === "1";
  return { local, allowDirty, outDir: path.resolve(argv.find(arg => !arg.startsWith("--")) || path.join(root, local ? "release-local" : "release")) };
}

const execNode = (args, options) => cp.execFileSync(process.execPath, args, { ...options, stdio: "inherit", windowsHide: true });

// root・cli・exec・log と、確かめ（git・dependencies・verifyOutput）はテストで差し替える。package-windows.cjs には合図（RELEASE_PIPELINE_ENV）を渡す。無いと止まる。
async function main(argv = process.argv.slice(2), { root = path.resolve(__dirname, ".."), cli, exec = execNode, log, env = process.env, ...fakes } = {}) {
  const { local, allowDirty, outDir } = releaseOptions(argv, root, env);
  const npm = cli || npmCli();
  const options = { cwd: root, env: { ...env, npm_execpath: npm, [RELEASE_PIPELINE_ENV]: "1" } };
  return runRelease({
    dependencies: () => checks.dependencyProblems(root, npmLs(npm)),
    ...fakes, root, local, allowDirty, outDir, log,
    run: step => exec([npm, "run", step], options),
    packageInstaller: args => exec([path.join(__dirname, "package-windows.cjs"), ...args], options),
  });
}

if (require.main === module) main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });

module.exports = { RELEASE_STEPS, GENERATED_DIRS, REMOVE_OPTIONS, staleMods, runRelease, releaseOptions, main };
