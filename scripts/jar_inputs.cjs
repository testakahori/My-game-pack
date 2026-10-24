"use strict";
// MOD の jar を作ったときの元の中身のハッシュ（印）。MOD を作ると、Gradle（scripts/jar_inputs.gradle）が jar の横に
// <jar>.inputs.json を書く。npm run release:win はこれと今のソースを比べ、作り直し忘れを時刻ではなく中身で見分ける
// （時刻で比べると、git でブランチを切り替えたときに中身が同じでも止まり、ビルドの途中で保存した変更を見逃した。2026-10-24 最後のレビュー 軽い3）。
// ハッシュの決まりは jar_inputs.gradle と同じにする。CI の mod-build で scripts/check-jar-inputs.cjs が照らす。
//   - 見る元：<MOD>/src/main・<MOD>/src/generated の下の全部と、<MOD> の build.gradle・gradle.properties・settings.gradle。
//   - ファイルごとに「リポジトリの直下からの場所（/ 区切り）」「改行」「中身の SHA-256（16進の小文字）」「改行」を、場所の順に並べ、全体の SHA-256 を取る。
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_DIRS = ["src/main", "src/generated"];
const SOURCE_FILES = ["build.gradle", "gradle.properties", "settings.gradle"];
// ビルドの初めと終わりで元の中身が違ったときに、Gradle が印に書く値。
const CHANGED_DURING_BUILD = "changed-during-build";

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const sha256File = file => sha256(fs.readFileSync(file));

function inputFiles(root, dir) {
  const files = [];
  const visit = file => {
    const stat = fs.statSync(file);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    else files.push(file);
  };
  for (const sub of SOURCE_DIRS) if (fs.existsSync(path.join(root, dir, sub))) visit(path.join(root, dir, sub));
  for (const name of SOURCE_FILES) if (fs.existsSync(path.join(root, dir, name))) files.push(path.join(root, dir, name));
  return files;
}

function jarInputsHash(root, dir) {
  const rows = inputFiles(root, dir).map(file => [path.relative(root, file).split(path.sep).join("/"), file]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256(Buffer.from(rows.map(([key, file]) => `${key}\n${sha256File(file)}\n`).join(""), "utf8"));
}

const stampPath = jar => `${jar}.inputs.json`;

// その jar のための印。無い・読めない・別の jar のもの（印を書かない古い作りで jar を作り直した）なら null。
function readStamp(jar) {
  let stamp;
  try { stamp = JSON.parse(fs.readFileSync(stampPath(jar), "utf8")); } catch { return null; }
  if (!stamp || typeof stamp.inputs !== "object" || !stamp.inputs || stamp.jar !== sha256File(jar)) return null;
  return stamp;
}

module.exports = { SOURCE_DIRS, SOURCE_FILES, CHANGED_DURING_BUILD, sha256File, jarInputsHash, stampPath, readStamp };
