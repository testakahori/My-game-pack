'use strict';
const { spawn } = require('child_process');

// ランチャーはゲーム起動と同時に自動で閉じる設定が既定のため、ゲーム本体
// （javaw.exe）も検知対象に含める。
const MINECRAFT_PROC_NAMES = new Set(['minecraftlauncher.exe', 'minecraft.exe', 'javaw.exe']);
// java.exe は VS Code の Java 拡張機能や Gradle も使うので、名前だけでは Minecraft と決めない。
// 外で起動したサーバーとワールド生成は @libraries/net/minecraftforge/... を、
// java.exe で動くゲーム本体は cpw.mods・net.minecraft・.minecraft を起動引数に含む。
const MINECRAFT_JAVA_ARGS = /cpw\.mods\.|net\.minecraft\.|[\\/]net[\\/]minecraftforge[\\/]|[\\/]\.minecraft(?:[\\/"\s]|$)|--gameDir\b|minecraft_server|forge-[^\\/\s"]*\.jar/i;

function tasklistNames(csv) {
  return String(csv).split('\n').map(line => (line.split('","')[0] || '').replace(/^"/, '').trim().toLowerCase()).filter(Boolean);
}

// 起動引数を読めないプロセスは、動いているかもしれないものとして数える。
function isMinecraftJava(commandLine) {
  return typeof commandLine !== 'string' || !commandLine.trim() || MINECRAFT_JAVA_ARGS.test(commandLine);
}

// strict（ゲーム切替の前）では java.exe も確かめる。javaCommandLines が null なら読めなかったので数える。
function minecraftProcesses(names, { strict = false, javaCommandLines = null } = {}) {
  const found = new Set(names.filter(name => MINECRAFT_PROC_NAMES.has(name)));
  if (strict && names.includes('java.exe') && (!Array.isArray(javaCommandLines) || javaCommandLines.some(isMinecraftJava))) found.add('java.exe');
  return [...found];
}

function parseCommandLines(out) {
  try {
    const value = JSON.parse(String(out).trim());
    const list = Array.isArray(value) ? value : [value];
    return list.every(item => item === null || typeof item === 'string') ? list : null;
  } catch { return null; }
}

// 読めなかったとき・時間切れのときは null を返す。
function readJavaCommandLines(spawnProcess = spawn, timeoutMs = 8000) {
  const script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " +
    "ConvertTo-Json -Compress -InputObject @(Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" -ErrorAction Stop | ForEach-Object { $_.CommandLine })";
  return new Promise((resolve) => {
    let out = '', settled = false, p;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    try {
      p = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    } catch { return finish(null); }
    p.stdout.on('data', (d) => (out += d.toString('utf8')));
    p.on('close', (code) => finish(code === 0 ? parseCommandLines(out) : null));
    p.on('error', () => finish(null));
    setTimeout(() => { try { p.kill(); } catch { /* ignore */ } finish(null); }, timeoutMs);
  });
}

module.exports = { MINECRAFT_PROC_NAMES, tasklistNames, isMinecraftJava, minecraftProcesses, parseCommandLines, readJavaCommandLines };
