"use strict";

// Bridge のクラッシュ自動再起動ポリシー。
// - 手動停止(requestStop)中は再起動しない
// - 直近ウィンドウ内の再起動回数が上限を超えたら諦める（config不正等での無限再起動を防ぐ）
// - 起動してすぐ（quickCrashMs 以内）に落ちるのが maxQuickCrashes 回続いたら、ウィンドウの回数を待たずに諦める
// - 再起動間隔は指数バックオフ
// 前はウィンドウ（60秒）が待ち時間の合計（2+4+8+16+30秒）より短く、5回目の前にウィンドウを抜けて数え直していた。
// 起動して 0.5 秒で落ちる BRIDGE が、いつまでも再起動を続けていた（2026-11-07 品質レビュー）。
// 今は再起動した時刻を残し、ウィンドウ（既定10分）の中の回数で見る。
class RestartPolicy {
  constructor(opts = {}) {
    this.stopRequested = true;
    this.restartCount = 0;
    this.maxRestarts = opts.maxRestarts ?? 5;
    this.baseDelayMs = opts.baseDelayMs ?? 2000;
    this.maxDelayMs = opts.maxDelayMs ?? 30000;
    this.windowMs = opts.windowMs ?? 10 * 60 * 1000;
    this.quickCrashMs = opts.quickCrashMs ?? 5000;
    this.maxQuickCrashes = opts.maxQuickCrashes ?? 3;
    this.now = opts.now ?? (() => Date.now());
    this._restartTimes = [];
    this._quickCrashes = 0;
    this._spawnedAt = null;
    this._exhausted = false;
  }
  start() {
    // 手動起動/再起動のたびにカウンタをリセット（クラッシュループ判定は直近ウィンドウの回数で見る）
    this.stopRequested = false;
    this.restartCount = 0;
    this._restartTimes = [];
    this._quickCrashes = 0;
    this._spawnedAt = null;
    this._exhausted = false;
  }
  // BRIDGE を起動した（手動でも自動再起動でも）。落ちたときに、起動してすぐかを見る。
  spawned() { this._spawnedAt = this.now(); }
  requestStop() { this.stopRequested = true; }
  shouldRestart() {
    if (this.stopRequested) return false;
    const now = this.now();
    const quick = this._spawnedAt !== null && now - this._spawnedAt < this.quickCrashMs;
    this._quickCrashes = quick ? this._quickCrashes + 1 : 0;
    this._restartTimes = this._restartTimes.filter(at => now - at < this.windowMs);
    if (this._restartTimes.length >= this.maxRestarts || this._quickCrashes >= this.maxQuickCrashes) {
      this._exhausted = true;
      return false;
    }
    this._restartTimes.push(now);
    this.restartCount++;
    return true;
  }
  nextDelayMs() {
    const n = Math.max(1, this._restartTimes.length);
    return Math.min(this.maxDelayMs, this.baseDelayMs * Math.pow(2, n - 1));
  }
  exhausted() {
    return !this.stopRequested && this._exhausted;
  }
  // restartExhausted：自動再起動の上限に達して止めた。配信ホームに出す（ログ欄は閉じていることが多いので）。
  status(pid) {
    return { running: Boolean(pid), pid: pid || null, stopRequested: this.stopRequested,
      restartCount: this.restartCount, restartExhausted: this.exhausted() };
  }
}

module.exports = { RestartPolicy };
