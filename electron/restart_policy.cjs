"use strict";

class RestartPolicy {
  constructor() {
    this.stopRequested = true;
    this.restartCount = 0;
  }
  start() { this.stopRequested = false; }
  requestStop() { this.stopRequested = true; }
  shouldRestart() {
    if (this.stopRequested) return false;
    this.restartCount++;
    return true;
  }
  status(pid) {
    return { running: Boolean(pid), pid: pid || null, stopRequested: this.stopRequested,
      restartCount: this.restartCount };
  }
}

module.exports = { RestartPolicy };
