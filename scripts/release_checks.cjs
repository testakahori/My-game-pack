"use strict";
// npm run release:win の確かめ（2026-11-06 品質レビュー。scripts/release-windows.cjs が使う）。
// - 作る前：コミットしていない変更が無いか。node_modules が package-lock.json どおりか（1.0.48 は bridge に tiktok-live-connector 2.4.3 が入ったまま配られた。lock は 2.5.0）。
// - 作ったあと：配る物（<出力先>/win-unpacked/resources と app.asar・exe）に、配ってはいけない物が無いか、入るべき物がそのとおり入っているか。
// - 最後に：何から何を作ったかの記録（<出力先>/<版>-manifest.json）。
// 外の道具（git・npm）は引数で受け取り、小さな偽の置き場でテストする（electron/test/release-checks.test.cjs）。
const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { modJars } = require("./mod_jars.cjs");
const { hasPlayer } = require("./level_dat.cjs");
const { MAP_EXCLUDES, MAP_SKIP_FILES } = require("./prepare-game-maps.cjs");
const { GAMES, PACK_GAME_IDS } = require("../bridge/game_commands.cjs");
const { newBridgeConfig } = require("../bridge/config_defaults.cjs");
const { FORGE_VERSION } = require("../electron/forge_version.cjs");
const { JAVA_DIR } = require("../electron/initial_setup.cjs");

// 変更があっても作ってよいという合図（試し用の版だけ）。引数なら --allow-dirty。
const ALLOW_DIRTY_FLAG = "--allow-dirty";
const ALLOW_DIRTY_ENV = "MYGAMEPACK_RELEASE_ALLOW_DIRTY";

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
// インストーラーは 400MB を超えるので、少しずつ読んでハッシュを取る。
function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const chunk = Buffer.alloc(8 * 1024 * 1024);
  const fd = fs.openSync(file, "r");
  try {
    for (let read; (read = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
const toSlash = name => String(name).split(path.sep).join("/");
// フォルダーの中のすべて（ファイルとフォルダー。/ 区切りの相対の道。並びは名前の順）。
const listAll = dir => fs.readdirSync(dir, { recursive: true }).map(toSlash).sort();
const listFiles = dir => listAll(dir).filter(name => fs.statSync(path.join(dir, name)).isFile());

function gitCommand(root) {
  return (...args) => cp.execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trimEnd();
}

// 開発版のアプリが書き換える設定（electron/paths.cjs。起動しただけで configVersion が足される）。配る物からは外しているので、変更があっても止めない
// （止めると、開発中の TikTok ID や RCON のパスワードを入れたまま「コミットしてから」に従ってしまう。2026-11-06 レビュー 重要1）。
const DEV_ONLY_FILES = new Set(["bridge/config.minecraft.json", "bridge/tts-settings.json"]);

// どのコミットから作るか。changes は、コミットしていない変更（git で管理しているファイルだけ）の行。git が使えなければ null。
// 日本語のファイル名を "\343…" にしないよう、core.quotepath を切る（レビュー 軽い5）。
function gitState(root, git = gitCommand(root)) {
  try {
    const lines = git("-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=no");
    const all = lines ? lines.split(/\r?\n/) : [];
    const changes = all.filter(line => !DEV_ONLY_FILES.has(line.slice(3).replace(/^"|"$/g, "")));
    const devOnly = all.filter(line => !changes.includes(line));
    return { commit: git("rev-parse", "HEAD"), short: git("rev-parse", "--short", "HEAD"), branch: git("rev-parse", "--abbrev-ref", "HEAD"), changes, devOnly };
  } catch {
    return null;
  }
}

// コミットしていない変更があれば止める。何から作ったか（manifest の commit）が中身と合わなくなるため。
// 試し用の版（-local.）だけは、--allow-dirty（または環境変数 MYGAMEPACK_RELEASE_ALLOW_DIRTY=1）で変更を入れたまま作れる。
function assertCleanTree(state, { local, allowDirty }) {
  if (allowDirty && !local) throw new Error(`${ALLOW_DIRTY_FLAG}（${ALLOW_DIRTY_ENV}）は試し用の版（-local.）だけで使えます。配る版は、コミットしてから作ってください。`);
  if (allowDirty) return;
  if (!state) throw new Error("git の情報が取れないので、どのコミットから作るかが分かりません。git の作業コピーで動かしてください。");
  if (!state.changes.length) return;
  throw new Error([`コミットしていない変更が ${state.changes.length} 件あるので、インストーラーを作りません。`,
    ...state.changes.slice(0, 20).map(line => `- ${line}`), ...(state.changes.length > 20 ? ["- …"] : []),
    `コミットしてから、もう一度動かしてください（試し用の版を変更を入れたまま作るときは ${ALLOW_DIRTY_FLAG}。docs/ローカル更新.md）。`].join("\n"));
}

// 直接使うパッケージ（package.json の dependencies・devDependencies）が、package-lock.json の版で node_modules に入っているか。
function lockMismatches(dir) {
  const pkg = readJson(path.join(dir, "package.json"));
  const lock = readJson(path.join(dir, "package-lock.json"));
  return Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).sort().flatMap(name => {
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    let installed = "";
    try { installed = readJson(path.join(dir, "node_modules", name, "package.json")).version; } catch {}
    if (!locked) return [`${name}: package-lock.json にありません`];
    if (installed === locked) return [];
    return [installed ? `${name}: node_modules は ${installed}、package-lock.json は ${locked}` : `${name}: node_modules に入っていません（package-lock.json は ${locked}）`];
  });
}

// npm ls --depth=0 の問題（入っていない・版が合わない・余分なもの）。npmLs(dir) は { status, stdout }（stdout は --json の出力）。
function npmLsProblems(dir, npmLs) {
  const { status, stdout } = npmLs(dir);
  if (status === 0) return [];
  let problems = [];
  try { problems = JSON.parse(stdout).problems || []; } catch {}
  return problems.length ? problems : [`npm ls が失敗しました（終了コード ${status}）`];
}

// 直下（画面・electron-builder）と bridge（配る BRIDGE が使う）の両方を見る。
function dependencyProblems(root, npmLs) {
  return [["", root], ["bridge/", path.join(root, "bridge")]].flatMap(([label, dir]) =>
    [...lockMismatches(dir), ...npmLsProblems(dir, npmLs)].map(problem => `${label || "（直下）"} ${problem}`));
}

function assertDependencies(problems) {
  if (!problems.length) return;
  throw new Error(["node_modules が package.json・package-lock.json と合わないので、インストーラーを作りません。",
    ...problems.map(problem => `- ${problem}`),
    "合わないフォルダー（直下か bridge）で npm ci --ignore-scripts を動かしてから、もう一度動かしてください（node_modules がジャンクションやリンクのときは、先にそれを外す）。"].join("\n"));
}

// exe・dll の版（VS_VERSION_INFO の中の VS_FIXEDFILEINFO の FileVersion）。読めなければ null。
const VERSION_KEY = Buffer.from("VS_VERSION_INFO\0", "utf16le");
const FIXED_SIGNATURE = Buffer.from([0xbd, 0x04, 0xef, 0xfe]);
function exeFileVersion(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return null; }
  for (let at = bytes.indexOf(VERSION_KEY); at >= 0; at = bytes.indexOf(VERSION_KEY, at + 1)) {
    const from = at + VERSION_KEY.length;
    const signature = bytes.indexOf(FIXED_SIGNATURE, from);
    if (signature < 0 || signature - from >= 4 || signature + 16 > bytes.length) continue;
    const ms = bytes.readUInt32LE(signature + 8), ls = bytes.readUInt32LE(signature + 12);
    return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join(".");
  }
  return null;
}

// app.asar を読む道具（electron-builder が使っているもの）。
const asarModule = () => require(require.resolve("@electron/asar", { paths: [path.dirname(require.resolve("app-builder-lib/package.json"))] }));

// 配る物の置き場。
const resourcesOf = outDir => path.join(outDir, "win-unpacked", "resources");
const isToolDir = name => name.split("/").some(part => /^\.(omc|claude)$/i.test(part));
// 同梱する共通の MOD（サーバーの雛形に入れる BridgeMOD・DisplayMOD・OBSMOD）。ゲームの MOD はゲームパックで配る。
const commonMods = root => modJars(root).filter(mod => !GAMES.some(game => game.modDir === mod.dir));
const gameModJar = (root, game) => modJars(root).find(mod => mod.dir === game.modDir)?.jar;

// 配る物の確かめ。見つけた問題を並べて返す（無ければ空）。
function outputProblems({ root, outDir }) {
  const resources = resourcesOf(outDir);
  if (!fs.existsSync(resources)) return [`配る物の置き場がありません: ${resources}`];
  const pkg = readJson(path.join(root, "package.json"));
  const problems = [];
  const all = listAll(resources);
  const has = rel => fs.existsSync(path.join(resources, rel));

  // 作業の道具（.omc・.claude）の記録は、どこにも入れない。app.asar の中も見る。
  for (const name of all.filter(isToolDir)) problems.push(`作業の道具の記録が入っています: resources/${name}`);
  let asarFiles = [];
  // 同じ場所の app.asar の中身を覚えているので、毎回読み直す。
  try { asarModule().uncache(path.join(resources, "app.asar")); } catch {}
  try { asarFiles = asarModule().listPackage(path.join(resources, "app.asar")).map(name => toSlash(name).replace(/^\/+/, "").replace(/\\/g, "/")); }
  catch (error) { problems.push(`app.asar を読めません（${error.code || error.message}）`); }
  for (const name of asarFiles.filter(isToolDir)) problems.push(`作業の道具の記録が入っています: app.asar/${name}`);

  // BRIDGE：開発機の残り物と開発用のファイルは入れない。設定は空の既定（bridge/config_defaults.cjs）と同じ。
  const gameCommand = new RegExp(`^bridge/commands/minecraft/game_(${PACK_GAME_IDS.join("|")})_.*\\.txt$`, "i");
  const devFiles = ["bridge/commands/minecraft/_op.txt", "bridge/telnet_test.js", "bridge/ui_server.js", "bridge/bridge起動.bat"];
  for (const name of all.filter(name => devFiles.includes(name) || gameCommand.test(name))) problems.push(`配らないファイルが入っています: resources/${name}`);
  try {
    if (!isDeepStrictEqual(readJson(path.join(resources, "bridge", "config.minecraft.json")), newBridgeConfig())) {
      problems.push("BRIDGE の設定（bridge/config.minecraft.json）が、空の既定の設定（newBridgeConfig）と違います（開発の設定が入った？）");
    }
  } catch (error) { problems.push(`BRIDGE の設定（bridge/config.minecraft.json）を読めません（${error.code || error.message}）`); }
  try {
    const manifest = readJson(path.join(resources, "bridge", "bridge-runtime-manifest.json"));
    const lock = readJson(path.join(root, "bridge", "package-lock.json"));
    for (const [name, version] of Object.entries(manifest.dependencies || {})) {
      const locked = lock.packages?.[`node_modules/${name}`]?.version;
      if (version !== locked) problems.push(`BRIDGE に入った ${name} は ${version || "不明"}、bridge/package-lock.json は ${locked || "なし"}`);
    }
  } catch (error) { problems.push(`BRIDGE の部品の記録（bridge/bridge-runtime-manifest.json）を読めません（${error.code || error.message}）`); }

  // サーバーの雛形：Mojang のサーバー本体と対応表（mappings）は配らない。初回の環境構築でインストーラーを動かすのに要るものは入れる。
  const template = "server/Douma_Craft";
  if (!has(template)) problems.push(`サーバーの雛形がありません: resources/${template}`);
  else {
    const files = listFiles(path.join(resources, template));
    for (const name of files.filter(name => name.startsWith("libraries/net/minecraft/") || /mappings[^/]*\.txt$/i.test(name))) problems.push(`Mojang のサーバー本体か対応表（mappings）が入っています: resources/${template}/${name}`);
    if (has(`${template}/libraries`)) problems.push(`サーバーの雛形に libraries が入っています（初回の環境構築で取りに行く決まり）: resources/${template}/libraries`);
    for (const name of [`forge-${FORGE_VERSION}-installer.jar`, `${JAVA_DIR}/bin/java.exe`, `${JAVA_DIR}/bin/javaw.exe`, "run.bat", "user_jvm_args.txt"]) {
      if (!files.includes(name)) problems.push(`サーバーの雛形に ${name} がありません`);
    }
    const shipped = files.filter(name => name.startsWith("mods/")).map(name => name.slice("mods/".length)).sort();
    const expected = commonMods(root);
    const names = expected.map(mod => path.basename(mod.jar)).sort();
    if (!isDeepStrictEqual(shipped, names)) problems.push(`サーバーの雛形の mods が違います（入っている: ${shipped.join("、") || "なし"}／入れる: ${names.join("、")}）`);
    for (const mod of expected) {
      const file = path.join(resources, template, "mods", path.basename(mod.jar));
      if (!fs.existsSync(mod.jar)) problems.push(`${mod.name} の jar が無いので、同じかを比べられません: ${mod.jar}`);
      else if (fs.existsSync(file) && sha256File(file) !== sha256File(mod.jar)) problems.push(`${mod.name} の jar が build/libs のものと違います: ${path.basename(mod.jar)}`);
    }
  }

  // ゲームパック：MOD の jar は build/libs のもの。初期マップに、作った人のプレイヤーの記録を入れない。
  for (const game of GAMES.filter(game => game.modDir)) {
    const jar = gameModJar(root, game);
    const file = jar && path.join(resources, "game-packs", game.id, path.basename(jar));
    if (!file || !fs.existsSync(file)) problems.push(`${game.name}のゲームパックに MOD の jar がありません`);
    else if (!fs.existsSync(jar)) problems.push(`${game.name}MOD の jar が無いので、同じかを比べられません: ${jar}`);
    else if (sha256File(file) !== sha256File(jar)) problems.push(`${game.name}のゲームパックの jar が build/libs のものと違います: ${path.basename(jar)}`);
  }
  for (const game of GAMES.filter(game => game.maps?.length)) {
    for (const name of game.maps) {
      const map = `game-packs/${game.id}/maps/${name}`;
      if (!has(`${map}/level.dat`)) { problems.push(`${game.name}の初期マップがありません: resources/${map}`); continue; }
      for (const rel of listAll(path.join(resources, map))) {
        if (MAP_EXCLUDES.includes(rel.split("/")[0]) || MAP_SKIP_FILES.includes(path.posix.basename(rel))) problems.push(`初期マップに配らないものが入っています: resources/${map}/${rel}`);
      }
      try { if (hasPlayer(fs.readFileSync(path.join(resources, map, "level.dat")))) problems.push(`初期マップの level.dat に作った人のプレイヤーの記録（Data.Player）が入っています: resources/${map}/level.dat`); }
      catch (error) { problems.push(`初期マップの level.dat を確かめられません（${error.message}）: resources/${map}/level.dat`); }
    }
  }

  // アプリの版：app.asar の package.json と exe の版が package.json と同じ。
  try {
    const asarVersion = JSON.parse(asarModule().extractFile(path.join(resources, "app.asar"), "package.json").toString("utf8")).version;
    if (asarVersion !== pkg.version) problems.push(`app.asar の版が ${asarVersion}（package.json は ${pkg.version}）`);
  } catch (error) { problems.push(`app.asar の package.json を読めません（${error.code || error.message}）`); }
  const exe = path.join(outDir, "win-unpacked", `${pkg.build.productName}.exe`);
  const exeVersion = exeFileVersion(exe);
  const core = String(pkg.version).split(/[-+]/)[0];
  if (!exeVersion) problems.push(`アプリの exe の版を読めません: ${exe}`);
  else if (exeVersion.split(".").slice(0, 3).join(".") !== core) problems.push(`アプリの exe の版が ${exeVersion}（package.json は ${pkg.version}）`);
  return problems;
}

function assertOutput(problems, installer) {
  if (!problems.length) return;
  throw new Error([`できたインストーラーに問題があります（${problems.length} 件）。このインストーラーは配らないでください: ${installer}`,
    ...problems.map(problem => `- ${problem}`)].join("\n"));
}

// 何から何を作ったかの記録。読めないものは null にする。
function releaseManifest({ root, outDir, installer, state, local, allowDirty }) {
  const pkg = readJson(path.join(root, "package.json"));
  const resources = resourcesOf(outDir);
  const template = path.join(resources, "server", "Douma_Craft");
  const count = dir => (fs.existsSync(dir) ? listFiles(dir).length : null);
  const fileRow = file => (fs.existsSync(file) ? { file: path.basename(file), bytes: fs.statSync(file).size, sha256: sha256File(file) } : null);
  let electron = null;
  try { electron = readJson(path.join(root, "node_modules", "electron", "package.json")).version; } catch {}
  const node = exeFileVersion(path.join(resources, "bridge", "node", "node.exe"));
  return {
    version: pkg.version,
    local: Boolean(local),
    createdAt: new Date().toISOString(),
    commit: state?.commit || null,
    branch: state?.branch || null,
    uncommittedChanges: state ? state.changes : null,
    allowDirty: Boolean(allowDirty),
    installer: fileRow(installer),
    electron,
    bundledNode: node ? `v${node.split(".").slice(0, 3).join(".")}` : null,
    jdk: fs.existsSync(template) ? fs.readdirSync(template).filter(name => /^jdk-/i.test(name)) : null,
    forge: FORGE_VERSION,
    mods: fs.existsSync(path.join(template, "mods")) ? fs.readdirSync(path.join(template, "mods")).sort().map(name => fileRow(path.join(template, "mods", name))) : null,
    gamePacks: GAMES.filter(game => game.modDir || game.maps?.length).map(game => {
      const dir = path.join(resources, "game-packs", game.id);
      const jar = game.modDir ? gameModJar(root, game) : null;
      return {
        id: game.id,
        files: count(dir),
        jar: jar ? fileRow(path.join(dir, path.basename(jar))) : null,
        maps: (game.maps || []).map(name => ({ name, files: count(path.join(dir, "maps", name)) })),
      };
    }),
  };
}

function writeManifest(outDir, manifest) {
  const file = path.join(outDir, `${manifest.version}-manifest.json`);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return file;
}

module.exports = {
  ALLOW_DIRTY_FLAG, ALLOW_DIRTY_ENV, gitState, assertCleanTree, lockMismatches, npmLsProblems, dependencyProblems, assertDependencies,
  sha256File, exeFileVersion, outputProblems, assertOutput, releaseManifest, writeManifest,
};
