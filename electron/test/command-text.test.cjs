// コマンド txt の見出し行（# TITLE: など）の読み方は1つ（2026-10-18 設計書 docs/superpowers/specs/2026-10-18-logic-copies-design.md の 5）。
// 例の一覧は bridge/test/fixtures/command-text.json。BridgeMOD・SaikutuMod（Java）も scripts/test-bridge-contracts.cjs で同じ一覧に通す。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCommandText, trimText } = require('../../bridge/command_text.cjs');
const root = path.resolve(__dirname, '../..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'bridge/test/fixtures/command-text.json'), 'utf8'));

test('見出し行の決まり: 例の一覧のとおりに読む（BRIDGE・アプリ・MOD で同じ）', () => {
  for (const c of cases) assert.deepEqual(parseCommandText(c.text), { meta: c.meta, commands: c.commands, description: c.description }, c.name);
});

test('見出し行の決まり: 前後から除く空白は JavaScript の trim と同じ（BOM・全角空白・NBSP を含む）', () => {
  assert.equal(trimText('﻿　  a \t '), 'a');
  assert.equal(trimText('a​b'), 'a​b', '幅のない空白（U+200B）は空白ではない');
});

test('見出し行の決まり: BRIDGE・アプリの一覧・ルーレット・開発用の一覧は、自分の写しを持たず command_text.cjs を使う', () => {
  for (const file of ['bridge/index.js', 'electron/bridge_settings.cjs', 'bridge/roulette.cjs', 'vite.config.ts']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /command_text\.cjs/, file + ': command_text.cjs を読む');
    assert.doesNotMatch(source, /\^#\\s\*|\^\\\/\\\/\\s\*/, file + ': 見出し・説明文の正規表現の写しを持たない');
  }
});
