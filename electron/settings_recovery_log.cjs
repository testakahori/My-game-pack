'use strict';
// 設定ファイルが壊れていて、前の正しい状態の写しから戻した（または既定値で動いた）ことを記録する
// （2026-10-23 設計書 docs/superpowers/specs/2026-10-23-settings-file-safety-design.md の 5.3）。
// 画面には出さない（ユーザーの決定）。不具合の連絡が来たときに調べられるよう、userData の logs/settings-recovery.log に残す。
// 形は停止の記録（logs/stop-requests.log）と同じ：端末の時刻をミリ秒まで書き、大きくなったら後ろ半分を残す。
const fs = require('node:fs');
const path = require('node:path');
const { describeRecovery } = require('../bridge/safe_json_file.cjs');
const { localTime, trimToRecentHalf } = require('./stop_requests.cjs');

function createSettingsRecoveryLog({ file, now = () => new Date(), maxBytes = 256 * 1024 }) {
  return {
    // 記録できなくても、設定の読み書きは止めない。
    record(entry) {
      try {
        const logFile = file();
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        // 切り詰めに失敗しても、この回の行は足す。
        try { trimToRecentHalf(logFile, maxBytes); } catch { /* 古い行が残るだけ */ }
        fs.appendFileSync(logFile, `${localTime(now())} ${describeRecovery(entry)}\n`, 'utf8');
      } catch { /* 記録の失敗で読み書きを止めない */ }
    },
  };
}

module.exports = { createSettingsRecoveryLog };
