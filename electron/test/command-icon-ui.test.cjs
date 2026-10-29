// コマンドの名前の横に出すアイコン（src/components/MinecraftCommandIcon.tsx）。マグマスライム！には、マグマキューブの顔の絵を出す
// （2026-10-29 ユーザーの決定。写真で選んだ案A：黒っぽい体に溶岩の筋、赤い目に黄色い瞳）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('esbuild');
const file = path.resolve(__dirname, '../../src/components/MinecraftCommandIcon.tsx');
const compiled = new Module(file, module);
compiled.paths = Module._nodeModulePaths(path.dirname(file));
compiled._compile(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'tsx', format: 'cjs', target: 'node20', jsx: 'transform' }).code, file);
const { commandKind, default: MinecraftCommandIcon } = compiled.exports;
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('マグマスライム！（magma_cube.txt）はマグマの絵。名前に「スライム」があっても、スライムの絵にしない', () => {
  for (const name of ['magma_cube.txt', 'マグマスライム！', 'MAGMA_CUBE.TXT']) assert.equal(commandKind(name), 'magma', name);
  for (const name of ['slime.txt', 'スライム！']) assert.equal(commandKind(name), 'slime', name);
  const html = renderToStaticMarkup(React.createElement(MinecraftCommandIcon, { command: 'magma_cube.txt' }));
  assert.match(html, /data-command-kind="magma"/);
  for (const color of ['#3a1410', '#ff7a1a', '#ff3d1f', '#ffe14a']) assert.ok(html.includes(color), color);
});
