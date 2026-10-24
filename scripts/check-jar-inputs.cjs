"use strict";
// MOD を作ったあと、jar の横の印（<jar>.inputs.json）が今のソースと合うかを確かめる。CI の mod-build で、Gradle 側
// （scripts/jar_inputs.gradle）と JS 側（scripts/jar_inputs.cjs）のハッシュの決まりが同じであることを照らす。
const fs = require("node:fs");
const path = require("node:path");
const { modJars } = require("./mod_jars.cjs");
const { jarInputsHash, readStamp, stampPath } = require("./jar_inputs.cjs");

function checkJarInputs(root) {
  return modJars(root).flatMap(mod => {
    if (!fs.existsSync(mod.jar)) return [{ name: mod.name, problem: `jar が無い: ${path.relative(root, mod.jar)}` }];
    const stamp = readStamp(mod.jar);
    if (!stamp) return [{ name: mod.name, problem: `印が無いか、jar と合わない: ${path.relative(root, stampPath(mod.jar))}` }];
    const wrong = [mod.dir, ...(mod.uses ? [mod.uses.dir] : [])].filter(dir => stamp.inputs[dir] !== jarInputsHash(root, dir));
    return wrong.length ? [{ name: mod.name, problem: `印のハッシュが今のソースと違う: ${wrong.join("、")}` }] : [];
  });
}

if (require.main === module) {
  const problems = checkJarInputs(path.resolve(__dirname, ".."));
  for (const row of problems) console.error(`${row.name}: ${row.problem}`);
  if (problems.length) process.exit(1);
  console.log("MOD の jar の印は、3つとも今のソースと合っています。");
}

module.exports = { checkJarInputs };
