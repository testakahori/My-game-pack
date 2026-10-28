const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { steps, commandLine } = require('../../scripts/refresh-dev.cjs');

const root = path.resolve(__dirname, '..', '..');

test('開発版が使う生成物を CI と同じ順で作り直す', () => {
  const list = steps({ windows: true });
  assert.deepEqual(list.map(step => step.title), [
    '画面（dist）',
    'BRIDGE の同梱物とギフト取得ツール',
    'BridgeMod の jar',
    'DisplayMod の jar',
    'SaikutuMod の jar',
    'ObsMod の jar',
    'UmetateMod の jar',
    'ゲームパック（採掘・埋め立て）',
  ]);
  assert.deepEqual(list[0].npm, ['run', 'build']);
  assert.deepEqual(list[1].npm, ['run', 'prepare:bridge-runtime']);
  // 開発版は build/game-packs の jar を置くので、SaikutuMod と UmetateMod を作ったあとにパックを作る（埋め立て PR2）。
  assert.deepEqual(list[7].args, [path.join(root, 'scripts', 'prepare-game-packs.cjs')]);
});

test('MOD は5つとも BridgeMod の gradlew で、オフライン・証明書確認なしでビルドする', () => {
  for (const [windows, name] of [[true, 'gradlew.bat'], [false, 'gradlew']]) {
    const mods = steps({ windows }).filter(step => step.title.endsWith(' の jar'));
    for (const step of mods) {
      assert.equal(step.cmd, path.join(root, 'BridgeMod', name));
      assert.deepEqual(step.args, ['build', '--offline', '--no-daemon', '-Dnet.minecraftforge.gradle.check.certs=false']);
      assert.equal(step.cwd, path.join(root, step.title.replace(' の jar', '')));
    }
  }
});

test('cmd.exe に渡す1行は、空白を含むものだけを引用符で囲む', () => {
  assert.equal(commandLine('D:\\新しいフォルダー (3)\\gradlew.bat', ['build', '--offline']), '""D:\\新しいフォルダー (3)\\gradlew.bat" build --offline"');
  assert.equal(commandLine('npm', ['run', 'build']), '"npm run build"');
});
