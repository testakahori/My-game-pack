const test = require('node:test');
const assert = require('node:assert/strict');
const { tasklistNames, minecraftProcesses, parseCommandLines } = require('../minecraft_processes.cjs');

const vscodeJava = [
  'c:\\Users\\user\\.vscode\\extensions\\redhat.java-1.56.0-win32-x64\\jre\\21.0.12.1-win32-x86_64\\bin\\java --add-modules=ALL-SYSTEM -Declipse.application=org.eclipse.jdt.ls.core.id1 -Xmx4G -jar c:\\Users\\user\\.vscode\\extensions\\redhat.java-1.56.0-win32-x64\\server\\plugins\\org.eclipse.equinox.launcher_1.7.0.jar',
  'C:\\Users\\user\\.vscode\\extensions\\redhat.java-1.56.0-win32-x64\\jre\\21.0.12.1-win32-x86_64\\bin\\java.exe -Xmx3G -Dfile.encoding=utf8 -Dnet.minecraftforge.gradle.check.certs=false -cp C:\\Users\\user\\.gradle\\wrapper\\dists\\gradle-8.8-bin\\x\\gradle-8.8\\lib\\gradle-launcher-8.8.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.8',
  '"c:\\Users\\user\\.vscode\\extensions\\redhat.java-1.56.0-win32-x64\\jre\\21.0.12.1-win32-x86_64/bin/java.exe" "-Dfile.encoding=UTF-8" -classpath "c:\\Users\\user\\.vscode\\extensions\\vscjava.vscode-gradle-3.18.0\\lib\\gradle-server.jar" com.github.badsyntax.gradle.GradleServer',
];
const minecraftJava = [
  // 外で起動したサーバー（run.bat）とワールド生成
  '".\\jdk-21.0.4+7\\bin\\java.exe" @user_jvm_args.txt @libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt nogui',
  'D:\\server\\jdk-21.0.4+7\\bin\\java.exe @user_jvm_args.txt -Xms512M -Xmx1536M @libraries/net/minecraftforge/forge/1.20.1-47.4.10/win_args.txt nogui',
  // java.exe で動くゲーム本体
  'C:\\java\\bin\\java.exe -cp C:\\Users\\user\\AppData\\Roaming\\.minecraft\\libraries\\x.jar cpw.mods.bootstraplauncher.BootstrapLauncher --launchTarget forgeclient --gameDir C:\\Users\\user\\AppData\\Roaming\\.minecraft',
  'java.exe -cp client.jar net.minecraft.client.main.Main --version 1.20.1',
];

test('tasklist の CSV からプロセス名を小文字で取り出す', () => {
  const csv = '"System Idle Process","0","Services","0","8 K"\r\n"javaw.exe","123","Console","1","900,000 K"\r\n"Java.EXE","456","Console","1","300,000 K"\r\n';
  assert.deepEqual(tasklistNames(csv), ['system idle process', 'javaw.exe', 'java.exe']);
  assert.deepEqual(tasklistNames(''), []);
});

test('ランチャーと javaw.exe は名前だけで数え、通常の確認では java.exe を数えない', () => {
  assert.deepEqual(minecraftProcesses(['minecraftlauncher.exe', 'javaw.exe', 'code.exe']), ['minecraftlauncher.exe', 'javaw.exe']);
  assert.deepEqual(minecraftProcesses(['java.exe'], { javaCommandLines: minecraftJava }), []);
});

test('切替前の確認でも VS Code の Java 拡張機能と Gradle の java.exe は Minecraft と見なさない', () => {
  assert.deepEqual(minecraftProcesses(['java.exe', 'code.exe'], { strict: true, javaCommandLines: vscodeJava }), []);
  // tasklist のあとに終了していれば、起動引数の一覧は空になる
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: [] }), []);
});

test('切替前の確認では Minecraft・Forge の java.exe（サーバー・ワールド生成・ゲーム本体）を数える', () => {
  for (const commandLine of minecraftJava) {
    assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: [...vscodeJava, commandLine] }), ['java.exe'], commandLine);
  }
});

test('java.exe の起動引数を読めないときは、動いているものとして数える', () => {
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: null }), ['java.exe']);
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: [vscodeJava[0], null] }), ['java.exe']);
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: [vscodeJava[0], '  '] }), ['java.exe']);
  assert.deepEqual(minecraftProcesses(['code.exe'], { strict: true, javaCommandLines: null }), []);
});

test('PowerShell の出力を起動引数の一覧にし、読めない出力は null にする', () => {
  assert.deepEqual(parseCommandLines('[]\r\n'), []);
  assert.deepEqual(parseCommandLines('["java.exe -jar a.jar",null]'), ['java.exe -jar a.jar', null]);
  assert.deepEqual(parseCommandLines('"java.exe -jar a.jar"'), ['java.exe -jar a.jar']);
  for (const out of ['', '   ', 'Get-CimInstance : error', '{"a":1}', '[1]']) assert.equal(parseCommandLines(out), null, out);
});
