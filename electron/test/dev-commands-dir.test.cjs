// 開発版のアプリが渡すコマンドの置き場所（BRIDGE_MOD_COMMANDS_DIR）を、BridgeMOD が最初に見ることをソースで確かめる。
// 判定そのもの（空・実在しないフォルダーは使わない）は scripts/test-game-contract.cjs の契約テストで確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

test('BridgeMOD は BRIDGE_MOD_COMMANDS_DIR があればそこを読み、なければサーバーフォルダーを読む', () => {
  const source = read('BridgeMod/src/main/java/jp/douma/bridgemod/BridgeMod.java');
  const base = source.slice(source.indexOf('private Path findCommandsBase('));
  const override = base.indexOf('CommandRouting.overrideDir(System.getenv("BRIDGE_MOD_COMMANDS_DIR"))');
  const direct = base.indexOf('serverDir.resolve("bridge")');
  assert.ok(override > 0 && override < direct, '環境変数の置き場所を、サーバーフォルダーより先に見る');
  assert.match(base.slice(override, direct), /if \(override != null\) return override;/);
});

test('BridgeMOD は 1.6.1（開発版のコマンドの置き場所を読む版）', () => {
  assert.match(read('BridgeMod/gradle.properties'), /^mod_version=1\.6\.1$/m);
});
