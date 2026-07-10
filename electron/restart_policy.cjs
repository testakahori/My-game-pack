"use strict";

// Bridge のクラッシュ自動再起動ポリシー。
// - 手動停止(requestStop)中は再起動しない
// - 直近ウィンドウ内の再起動回数が上限を超えたら諦める（config不正等での無限再起動を防ぐ）
// - 再起動間隔は指数バックオフ
class RestartPolicy {
  constructor(opts = {}) {
    this.stopRequested = true;
    this.restartCount = 0;
    this.maxRestarts = opts.maxRestarts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
    this.maxDelayMs = opts.maxDelayMs ?? 30000;
    this.windowMs = opts.windowMs ?? 60000;
    this._firstRestartAt = 0;
  }
  start() {
    // 手動起動/再起動のたびにカウンタをリセット（クラッシュループ判定は直近ウィンドウの回数で見る）
    this.stopRequested = false;
    this.restartCount = 0;
    this._firstRestartAt = 0;
  }
  requestStop() { this.stopRequested = true; }
  shouldRestart() {
    if (this.stopRequested) return false;
    const now = Date.now();
    if (!this._firstRestartAt || now - this._firstRestartAt > this.windowMs) {
      this._firstRestartAt = now;
      this.restartCount = 0;
    }
    if (this.restartCount >= this.maxRestarts) return false;
    this.restartCount++;
    return true;
  }
  nextDelayMs() {
    const n = Math.max(1, this.restartCount);
    return Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, n - 1));
  }
  exhausted() {
    return !this.stopRequested && this.restartCount >= this.maxRestarts;
  }
  status(pid) {
    return { running: Boolean(pid), pid: pid || null, stopRequested: this.stopRequested,
      restartCount: this.restartCount };
  }
}

module.exports = { RestartPolicy };
