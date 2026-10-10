'use strict';
const { spawn } = require('child_process');

// ランチャーはゲーム起動と同時に自動で閉じる設定が既定のため、ゲーム本体
// （javaw.exe）も検知対象に含める。
const MINECRAFT_PROC_NAMES = new Set(['minecraftlauncher.exe', 'minecraft.exe', 'javaw.exe']);
// java.exe は VS Code の Java 拡張機能や Gradle も使うので、名前だけでは Minecraft と決めない。
// 外で起動したサーバーとワールド生成は @libraries/net/minecraftforge/... を、
// java.exe で動くゲーム本体は cpw.mods・net.minecraft・.minecraft を起動引数に含む。
const MINECRAFT_JAVA_ARGS = /cpw\.mods\.|net\.minecraft\.|[\\/]net[\\/]minecraftforge[\\/]|[\\/]\.minecraft(?:[\\/"\s]|$)|--gameDir\b|minecraft_server|forge-[^\\/\s"]*\.jar/i;

// 中身（起動引数）を確かめられなかった java.exe の表示名。どちらも Minecraft かもしれないものとして数える。
// UNREADABLE_JAVA：一部の java.exe だけ読めない（管理者として実行したものは、ふつうの権限では読めない）。
// JAVA_CHECK_FAILED：PowerShell での確認そのものが失敗した・時間切れになった。
const UNREADABLE_JAVA = '中身を確認できないjava.exe';
const JAVA_CHECK_FAILED = '確認に失敗したjava.exe';

function tasklistNames(csv) {
  return String(csv).split('\n').map(line => (line.split('","')[0] || '').replace(/^"/, '').trim().toLowerCase()).filter(Boolean);
}

const readable = commandLine => typeof commandLine === 'string' && commandLine.trim() !== '';

// strict（ゲーム切替の前）では java.exe も確かめる。javaCommandLines が null なら確認に失敗したので数える。
// Minecraft だと読めたものがあれば java.exe、読めなかったものしかなければ UNREADABLE_JAVA を出す。
function minecraftProcesses(names, { strict = false, javaCommandLines = null } = {}) {
  const found = new Set(names.filter(name => MINECRAFT_PROC_NAMES.has(name)));
  if (strict && names.includes('java.exe')) {
    if (!Array.isArray(javaCommandLines)) found.add(JAVA_CHECK_FAILED);
    else if (javaCommandLines.some(line => readable(line) && MINECRAFT_JAVA_ARGS.test(line))) found.add('java.exe');
    else if (javaCommandLines.some(line => !readable(line))) found.add(UNREADABLE_JAVA);
  }
  return [...found];
}

// ゲーム切替を止めるときのメッセージ。Minecraft だと確かなものがあれば、推測の説明は足さない。
function switchBlockedMessage(processes) {
  const message = `Minecraftとランチャーを終了してから切り替えてください（動いているもの: ${processes.join('、')}）`;
  if (processes.some(name => name !== UNREADABLE_JAVA && name !== JAVA_CHECK_FAILED)) return message;
  if (processes.includes(JAVA_CHECK_FAILED)) {
    return `${message}。java.exeがMinecraftかどうかを確認できませんでした。少し待ってからもう一度お試しください。` +
      '続くときは、Javaを使うプログラム（VS Codeなど）をすべて閉じてからお試しください。';
  }
  return `${message}。中身を確認できないjava.exeも、Minecraftかもしれないので数えています。` +
    'Minecraftでなければ、管理者として実行しているJavaのプログラムなどを閉じてから、もう一度お試しください。';
}

function parseCommandLines(out) {
  try {
    const value = JSON.parse(String(out).trim());
    const list = Array.isArray(value) ? value : [value];
    return list.every(item => item === null || typeof item === 'string') ? list : null;
  } catch { return null; }
}

// 読めなかったとき・時間切れのときは null を返す。
// 自分のログインセッションだけを見る（サービスなど別セッションの java.exe は起動引数を読めず、切替を止めてしまうため）。
// 別セッションで動く Forge サーバーは、ゲーム切替の前のポート確認（main.cjs の ensureStopped）に任せる。
function readJavaCommandLines(spawnProcess = spawn, timeoutMs = 8000) {
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
    "$session = (Get-Process -Id $PID).SessionId; " +
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name='java.exe' AND SessionId=$session\" -ErrorAction Stop | ForEach-Object { $_.CommandLine })";
  return new Promise((resolve) => {
    let out = '', settled = false, p, timer;
    const finish = (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    try {
      p = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return finish(null); }
    // 日本語のパスが塊の境目で分かれても化けないよう、ストリームで文字に直す。
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => finish(code === 0 ? parseCommandLines(out) : null));
    p.on('error', () => finish(null));
    timer = setTimeout(() => { try { p.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
  });
}

module.exports = { MINECRAFT_PROC_NAMES, UNREADABLE_JAVA, JAVA_CHECK_FAILED, tasklistNames, minecraftProcesses, switchBlockedMessage, parseCommandLines, readJavaCommandLines };
