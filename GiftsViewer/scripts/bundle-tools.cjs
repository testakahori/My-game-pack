"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "tools-bundled");

fs.mkdirSync(outDir, { recursive: true });

// fetch_gifts.cjs を esbuild でバンドル（tiktok-live-connector など依存を全て内包）
const esbuild = path.join(root, "node_modules", ".bin", "esbuild");
execSync(
  `"${esbuild}" "${path.join(root, "tools", "fetch_gifts.cjs")}" --bundle --platform=node --format=cjs --outfile="${path.join(outDir, "fetch_gifts.cjs")}"`,
  { stdio: "inherit", cwd: root }
);

// gifts_to_html.cjs は外部依存なしなのでそのままコピー
fs.copyFileSync(
  path.join(root, "tools", "gifts_to_html.cjs"),
  path.join(outDir, "gifts_to_html.cjs")
);

console.log("Done: tools-bundled/ ready");
