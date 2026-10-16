const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { UNREADABLE_JAVA, JAVA_CHECK_FAILED, tasklistNames, minecraftProcesses, parseCommandLines, readJavaCommandLines, switchBlockedMessage } = require('../minecraft_processes.cjs');

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

test('java.exe の起動引数を確かめられないときは、動いているものとして数え、読めないのか確認に失敗したのかがわかる名前にする', () => {
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: null }), [JAVA_CHECK_FAILED]);
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: [vscodeJava[0], null] }), [UNREADABLE_JAVA]);
  assert.deepEqual(minecraftProcesses(['java.exe'], { strict: true, javaCommandLines: [vscodeJava[0], '  '] }), [UNREADABLE_JAVA]);
  assert.deepEqual(minecraftProcesses(['code.exe'], { strict: true, javaCommandLines: null }), []);
  // Minecraft だと読めたものがあれば、そちらを出す
  assert.deepEqual(minecraftProcesses(['javaw.exe', 'java.exe'], { strict: true, javaCommandLines: [null, minecraftJava[0]] }), ['javaw.exe', 'java.exe']);
});

test('切替を止めるメッセージは、java.exe を確かめられなかったときだけ理由と対処を足す', () => {
  const plain = names => `Minecraftとランチャーを終了してから切り替えてください（動いているもの: ${names}）`;
  assert.equal(switchBlockedMessage(['javaw.exe', 'java.exe']), plain('javaw.exe、java.exe'));
  // Minecraft だと確かなものがあれば、推測の説明は足さない
  assert.equal(switchBlockedMessage(['javaw.exe', UNREADABLE_JAVA]), plain(`javaw.exe、${UNREADABLE_JAVA}`));

  const unreadable = switchBlockedMessage([UNREADABLE_JAVA]);
  assert.ok(unreadable.startsWith(`${plain('中身を確認できないjava.exe')}。`), unreadable);
  assert.match(unreadable, /Minecraftかもしれない/);
  assert.match(unreadable, /管理者として実行/);

  const failed = switchBlockedMessage([JAVA_CHECK_FAILED]);
  assert.ok(failed.startsWith(`${plain('確認に失敗したjava.exe')}。`), failed);
  assert.match(failed, /少し待ってから/);
  assert.match(failed, /Javaを使うプログラム（VS Codeなど）/);
  assert.doesNotMatch(failed, /管理者/);
});

// readJavaCommandLines に渡す spawn の代わり。stdout は本物のストリームにして、文字コードの扱いも確かめる。
function fakeSpawn({ throws = false } = {}) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    if (throws) throw new Error('spawn EPERM');
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.killed = 0;
    child.kill = () => { child.killed += 1; };
    calls.push({ command, args, options, child });
    return child;
  };
  return { spawnProcess, calls };
}
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
// stdout をすべて流し終えてから close を出す（実際の子プロセスと同じ順序）。
function finishWith(child, chunks, code) {
  child.stdout.on('end', () => child.emit('close', code));
  for (const chunk of chunks) child.stdout.write(chunk);
  child.stdout.end();
}

test('readJavaCommandLines は自分のログインセッションの java.exe だけを、標準入力とエラー出力を使わずに調べる', async () => {
  const { spawnProcess, calls } = fakeSpawn();
  const pending = readJavaCommandLines(spawnProcess, 1000);
  const { command, args, options, child } = calls[0];
  assert.match(command, /powershell\.exe$/i);
  const script = args[args.length - 1];
  assert.match(script, /\$session = \(Get-Process -Id \$PID\)\.SessionId/);
  assert.match(script, /-Filter "Name='java\.exe' AND SessionId=\$session"/);
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
  assert.equal(options.windowsHide, true);
  finishWith(child, ['[]'], 0);
  assert.deepEqual(await pending, []);
});

test('readJavaCommandLines は塊の境目で分かれた日本語も化けずに読む', async () => {
  const { spawnProcess, calls } = fakeSpawn();
  const pending = readJavaCommandLines(spawnProcess, 1000);
  const bytes = Buffer.from(JSON.stringify(['D:\\新しいフォルダー (3)\\jdk\\bin\\java.exe @libraries/net/minecraftforge/forge/win_args.txt']), 'utf8');
  const cut = bytes.indexOf(Buffer.from('新', 'utf8')) + 1; // 「新」の3バイトの途中で切る
  finishWith(calls[0].child, [bytes.subarray(0, cut), bytes.subarray(cut)], 0);
  assert.deepEqual(await pending, ['D:\\新しいフォルダー (3)\\jdk\\bin\\java.exe @libraries/net/minecraftforge/forge/win_args.txt']);
});

test('readJavaCommandLines は失敗したとき null を返す（終了コード・error・spawn の例外・時間切れ）', async () => {
  {
    const { spawnProcess, calls } = fakeSpawn();
    const pending = readJavaCommandLines(spawnProcess, 1000);
    finishWith(calls[0].child, ['["java.exe -jar a.jar"]'], 1);
    assert.equal(await pending, null, '終了コード 1');
  }
  {
    const { spawnProcess, calls } = fakeSpawn();
    const pending = readJavaCommandLines(spawnProcess, 20);
    calls[0].child.emit('error', new Error('ENOENT'));
    assert.equal(await pending, null, 'error イベント');
    // 時間切れではなく error で終わった（終わったのでタイマーも止まっている）
    await tick(50);
    assert.equal(calls[0].child.killed, 0, 'error で終わったあとは PowerShell を止めに行かない');
  }
  assert.equal(await readJavaCommandLines(fakeSpawn({ throws: true }).spawnProcess, 1000), null, 'spawn の例外');
  {
    const { spawnProcess, calls } = fakeSpawn();
    const pending = readJavaCommandLines(spawnProcess, 20);
    assert.equal(await pending, null, '時間切れ');
    assert.equal(calls[0].child.killed, 1, '時間切れでは PowerShell を止める');
  }
});

test('readJavaCommandLines は error の結果をあとの close で上書きせず、終わったあとはタイマーで止めない', async () => {
  {
    // error のあとに close が来ても、結果は error の null のまま
    const { spawnProcess, calls } = fakeSpawn();
    const pending = readJavaCommandLines(spawnProcess, 20);
    const { child } = calls[0];
    child.emit('error', new Error('ENOENT'));
    finishWith(child, ['["java.exe -jar a.jar"]'], 0);
    assert.equal(await pending, null);
    await tick(50);
    assert.equal(child.killed, 0);
  }
  {
    // 読み終えたあとに時間切れの時刻を過ぎても、PowerShell を止めに行かない
    const { spawnProcess, calls } = fakeSpawn();
    const pending = readJavaCommandLines(spawnProcess, 20);
    finishWith(calls[0].child, ['["java.exe -jar a.jar"]'], 0);
    assert.deepEqual(await pending, ['java.exe -jar a.jar']);
    await tick(50);
    assert.equal(calls[0].child.killed, 0);
  }
});

// 上のテストはスクリプトの形だけを見ているので、Windows では本物の PowerShell で引用符と $session の展開まで確かめる。
// 速さは確かめない。CI の Windows では、ほかのテストと同時に走ると PowerShell の起動と最初の Get-CimInstance が遅くなり、
// 直近30回でふだん約3.4秒、長いと7.4秒かかり、3回は本番の待ち時間（8秒）を越えて落ちた（2026-10-16）。テストでは30秒待つ。
test('readJavaCommandLines は Windows の本物の PowerShell で java.exe の一覧を読める', { skip: process.platform !== 'win32' }, async () => {
  const started = Date.now();
  const lines = await readJavaCommandLines(undefined, 30000);
  assert.ok(Array.isArray(lines), `確認に失敗した: ${lines}（${Date.now() - started}ms）`);
});

test('PowerShell の出力を起動引数の一覧にし、読めない出力は null にする', () => {
  assert.deepEqual(parseCommandLines('[]\r\n'), []);
  assert.deepEqual(parseCommandLines('["java.exe -jar a.jar",null]'), ['java.exe -jar a.jar', null]);
  assert.deepEqual(parseCommandLines('"java.exe -jar a.jar"'), ['java.exe -jar a.jar']);
  for (const out of ['', '   ', 'Get-CimInstance : error', '{"a":1}', '[1]']) assert.equal(parseCommandLines(out), null, out);
});
