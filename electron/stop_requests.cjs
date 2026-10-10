'use strict';
// サーバー・BRIDGE の停止を、出どころ（どのボタン・操作から来たか）付きで記録する。
// 2026-10-10、BRIDGE停止だけを押したはずがサーバーも止まり、アプリ側にログが残っていなくて原因を追えなかった。
// アプリのログ欄はメモリ上だけなので、userData の logs/stop-requests.log にも残す。
const fs = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./settings_backups.cjs');

// 画面と main が渡す出どころの名前。ここにない名前は中身を書かない（画面から長い文字列を渡されても記録が膨らまない）。
const STOP_ORIGINS = Object.freeze({
  'stop-panel:all': '停止パネルの一括停止',
  'stop-panel:bridge': '停止パネルのBRIDGE停止',
  'stop-panel:server': '停止パネルのサーバー停止',
  'home:all': '配信ホームの一括停止',
  'home:bridge': '配信ホームのBRIDGE停止',
  'home:server': '配信ホームのサーバー停止',
  'home:bridge-restart': '配信ホームのBRIDGE再起動',
  'euler:bridge-restart': 'Euler APIキー設定のBRIDGE再起動',
  'map:save': 'MAPの保存',
  'map:load': 'MAPの読込',
  'map:backup': 'MAPのバックアップ',
  'console': 'コンソールコマンドのstop',
});
const TARGETS = Object.freeze({ server: 'サーバー停止', bridge: 'BRIDGE停止' });

function stopOriginLabel(origin) {
  if (origin === undefined || origin === null || origin === '') return '出どころの指定なし';
  // 文字列以外（オブジェクト・配列）はキーに変えずに断る。変えると toString が例外を投げ、停止まで止まる。
  if (typeof origin !== 'string') return '不明な出どころ';
  return Object.prototype.hasOwnProperty.call(STOP_ORIGINS, origin) ? STOP_ORIGINS[origin] : '不明な出どころ';
}

// コンソールから打ったコマンドがサーバーを止めるか。Brigadier は大文字小文字を区別し、stop は引数を取らない。
function isConsoleStop(command) {
  return /^(?:execute\b.*\brun\s+)?stop$/.test(String(command).trim().replace(/^\//, ''));
}

// Minecraft のサーバーログと並べて比べられるよう、端末の時刻をミリ秒まで書く。
function localTime(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

// 大きくなったら、後ろ半分のバイトのうち最初の改行より後（行の途中で切らない）だけを残す。
// 改行は UTF-8 の多バイト文字の途中には現れないので、バイトで切っても文字は壊れない。
function trimToRecentHalf(file, maxBytes) {
  let size;
  try { size = fs.statSync(file).size; } catch { return; }
  if (size <= maxBytes) return;
  const bytes = fs.readFileSync(file);
  const newline = bytes.indexOf(0x0a, bytes.length - Math.floor(maxBytes / 2));
  atomicWrite(file, newline < 0 ? Buffer.alloc(0) : bytes.subarray(newline + 1));
}

function createStopRequestLog({ file, now = () => new Date(), maxBytes = 256 * 1024 }) {
  return {
    // 記録できなくても停止は止めない。ログ欄に出す出どころの文言を返す。
    record(target, origin) {
      let label = '不明な出どころ';
      try {
        label = stopOriginLabel(origin);
        const logFile = file();
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        // 切り詰めに失敗しても、この回の行は足す。
        try { trimToRecentHalf(logFile, maxBytes); } catch { /* 古い行が残るだけ */ }
        fs.appendFileSync(logFile, `${localTime(now())} ${TARGETS[target] || target} ← ${label}\n`, 'utf8');
      } catch { /* 記録の失敗で停止を止めない */ }
      return label;
    },
  };
}

module.exports = { STOP_ORIGINS, stopOriginLabel, isConsoleStop, createStopRequestLog };
