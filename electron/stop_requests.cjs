'use strict';
// サーバー・BRIDGE の停止を「どのボタン・操作から来たか」付きで記録する。
// 2026-10-10、BRIDGE停止だけを押したはずがサーバーも止まり、アプリ側にログが残っていなくて原因を追えなかった。
// アプリのログ欄はメモリ上だけなので、userData の logs/stop-requests.log にも残す。
const fs = require('node:fs');
const path = require('node:path');

// 画面と main が渡す出どころの名前。ここにない名前は中身を書かない（画面から長い文字列を渡されても記録が膨らまない）。
const STOP_ORIGINS = Object.freeze({
  'stop-panel:all': '停止パネルの一括停止',
  'stop-panel:bridge': '停止パネルのBRIDGE停止',
  'stop-panel:server': '停止パネルのサーバー停止',
  'home:all': '配信ホームの一括停止',
  'home:bridge': '配信ホームのBRIDGE停止',
  'home:server': '配信ホームのサーバー停止',
  'home:bridge-restart': '配信ホームのBRIDGE再起動',
  'euler:bridge-restart': 'Euler APIキーの保存後のBRIDGE再起動',
  'map:save': 'MAPの保存',
  'map:load': 'MAPの読込',
  'map:backup': 'MAPのバックアップ',
  'console': 'コンソールコマンドのstop',
});
const TARGETS = Object.freeze({ server: 'サーバー停止', bridge: 'BRIDGE停止' });

function stopOriginLabel(origin) {
  if (origin === undefined || origin === null || origin === '') return '呼び出し元の指定なし';
  return Object.prototype.hasOwnProperty.call(STOP_ORIGINS, origin) ? STOP_ORIGINS[origin] : '不明な呼び出し元';
}

// Minecraft のサーバーログと並べて比べられるよう、端末の時刻をミリ秒まで書く。
function localTime(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

// 大きくなったら新しい半分（行の途中で切らない）だけを残す。
function trimToRecentHalf(file, maxBytes) {
  let size;
  try { size = fs.statSync(file).size; } catch { return; }
  if (size <= maxBytes) return;
  const text = fs.readFileSync(file, 'utf8');
  const tail = text.slice(-Math.floor(maxBytes / 2));
  fs.writeFileSync(file, tail.slice(tail.indexOf('\n') + 1), 'utf8');
}

function createStopRequestLog({ file, now = () => new Date(), maxBytes = 256 * 1024 }) {
  return {
    // 記録できなくても停止は止めない。ログ欄に出す出どころの文言を返す。
    record(target, origin) {
      const label = stopOriginLabel(origin);
      try {
        const logFile = file();
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        trimToRecentHalf(logFile, maxBytes);
        fs.appendFileSync(logFile, `${localTime(now())} ${TARGETS[target] || target} ← ${label}\n`, 'utf8');
      } catch { /* 記録の失敗で停止を止めない */ }
      return label;
    },
  };
}

module.exports = { STOP_ORIGINS, stopOriginLabel, createStopRequestLog };
