const { randomUUID } = require("node:crypto");

// The MOD answers these when the request itself is wrong (bad command name, unknown route, oversized body, not JSON).
// Resending the same request can never succeed and would block every later event in the same FIFO lane.
// 403 is not listed: a restarted server issues a new token, and the next attempt reads it again.
const PERMANENT_HTTP_STATUSES = new Set([400, 404, 405, 413, 415]);
function isPermanentDeliveryFailure(error) {
  return error?.permanent === true || PERMANENT_HTTP_STATUSES.has(Number(error?.status));
}

// Each lane is FIFO. A full like queue must never hold up a gift's HTTP request.
// Only 429, 5xx, connection errors and timeouts are retried; a rejected request is reported and skipped.
function createModEventDelivery({ send, delivered = () => {}, retry = () => {}, rejected = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxRetries = Infinity, prepare = event => event } = {}) {
  const lanes = { gift: [], like: [], other: [] };
  const running = new Set();
  const report = (event, error) => {
    try { rejected(event, error); } catch { /* Recording failure must not stop the remaining events. */ }
  };
  async function drain(lane) {
    if (running.has(lane)) return;
    running.add(lane);
    try {
      while (lanes[lane].length) {
        const job = lanes[lane][0];
        // A separate flag: a rejection value may itself be falsy.
        let failed = false, failure;
        while (job.remaining > 0 && !failed && !job.discarded) {
          const count = job.event.gameMod ? Math.min(job.event.count, job.remaining) : Math.min(100, job.remaining);
          const chunk = { ...job.event, count, requestId: `${job.id}:${job.part}`, eventId: `${job.id}:${job.part}` };
          let attempts = 0;
          // Shared by every retry of this chunk, so diagnostics can count consecutive failures of one kind.
          const retryState = {};
          // 送信中の分は、捨てる回数に数えない（応答が来れば送れた分になる）。
          let sent = false;
          for (;;) {
            // 捨てたいいね（配信終了）は、再送の待ちが明けても送り直さない。
            if (job.discarded) break;
            try { job.inFlight = count; await send(chunk); sent = true; break; }
            catch (error) {
              job.inFlight = 0;
              // 送信中に捨てたいいねが送れなかったときは、再送を待たずに次へ進む（PR #94 再レビュー）。
              if (job.discarded) break;
              attempts++;
              // A finite retry limit is only for explicit callers/tests, never the live dispatcher.
              if (isPermanentDeliveryFailure(error) || attempts > maxRetries) { failed = true; failure = error; break; }
              try { retry(chunk, error, attempts, retryState); } catch { /* Diagnostics cannot discard a queued event. */ }
              await sleep(Math.min(3000, 250 * 2 ** Math.min(attempts - 1, 4)));
            }
          }
          job.inFlight = 0;
          // 捨てたあとに応答が来ても、送れた分は送れた分として数える（PR #94 レビュー）。
          if (sent) { job.remaining -= count; job.part++; }
          if (failed || !sent) break;
        }
        lanes[lane].shift();
        if (job.discarded) {
          const done = job.total - job.remaining;
          if (done > 0) try { delivered({ ...job.event, count: done }); } catch { /* Recording failure must not affect gameplay delivery. */ }
          job.resolve();
          continue;
        }
        if (failed) {
          report({ ...job.event, count: job.remaining }, failure);
          job.reject(failure);
          continue;
        }
        try { delivered({ ...job.event, count: job.total }); } catch { /* Recording failure must not affect gameplay delivery. */ }
        job.resolve();
      }
    } catch (error) {
      // Only an injected sleep can throw here; drop that head so the lane keeps moving.
      const job = lanes[lane].shift();
      if (job) { report({ ...job.event, count: job.remaining }, error); job.reject(error); }
    } finally {
      running.delete(lane);
      if (lanes[lane].length) void drain(lane);
    }
  }
  return {
    enqueue(event) {
      const fail = error => { report({ ...event }, error); return Promise.reject(error); };
      try { event = prepare({ ...event }); } catch (error) { return fail(error); }
      const count = Number(event.count ?? 1);
      if (!Number.isSafeInteger(count) || count < 1 || event.gameMod && count > 100000) return fail(new Error("Invalid event count"));
      const repetitions = event.gameMod ? Number(event.repeatRequests ?? 1) : 1;
      const total = count * repetitions;
      if (!Number.isSafeInteger(repetitions) || repetitions < 1 || !Number.isSafeInteger(total)) return fail(new Error("Invalid game request repetitions"));
      const lane = event.type === "gift" ? "gift" : event.type === "like" ? "like" : "other";
      return new Promise((resolve, reject) => {
        lanes[lane].push({ event: { ...event, count }, remaining: total, total, part: 0, id: randomUUID(), resolve, reject });
        void drain(lane);
      });
    },
    pending() { return Object.fromEntries(Object.entries(lanes).map(([key, jobs]) => [key, jobs.reduce((n, job) => n + (job.discarded ? 0 : job.remaining), 0)])); },
    // まだ送っていない分を捨て、捨てた回数を返す（配信が終わったときのいいね。2026-10-14 ユーザーの決定）。
    // 送信中の1回は止められないので、その応答のあとで止まる。捨てた要求は失敗として記録しない。
    discard(lane) {
      if (!lanes[lane]) return 0;
      let discarded = 0;
      for (const job of lanes[lane]) {
        if (job.discarded) continue;
        discarded += job.remaining - (job.inFlight || 0);
        job.discarded = true;
      }
      // 先頭以外は今すぐ外す。先頭は送信や再送の待ちの途中なので、drain が外す。
      const head = running.has(lane) ? lanes[lane].slice(0, 1) : [];
      for (const job of lanes[lane].slice(head.length)) job.resolve();
      lanes[lane] = head;
      return discarded;
    },
  };
}

// Coalesce only adjacent identical requests; retain every repetition and sender in order.
function createLikeBatcher({ dispatch, windowMs, schedule = setTimeout, prepare = event => event, failed = () => {} }) {
  let pending = [], timer = null, generation = 0;
  const batch = (commandFile, count, sender, announce, triggers = 1) => {
    const event = prepare({ type: "like", commandFile, count, listenerName: sender, announce });
    if (event.gameMod) {
      // Keep each threshold crossing as a separate request; freeze its round before any wait.
      if (!Number.isSafeInteger(triggers) || triggers < 1 || !Number.isSafeInteger(count / triggers)) throw new Error("Invalid game like triggers");
      // A compact job emits separate HTTP requests/IDs lazily, avoiding a huge synchronous allocation.
      pending.push({ ...event, count: count / triggers, repeatRequests: triggers });
    } else {
    const last = pending.at(-1);
    if (last && !last.gameMod && last.commandFile === commandFile && last.listenerName === sender && last.announce === announce
        && Number.isSafeInteger(last.count + count)) last.count += count;
    else pending.push(event);
    }
    if (timer !== null) return;
    const mine = generation;
    timer = schedule(() => {
      // 捨てたあとに、前の待ち時間が明けても何もしない（次のまとめは新しい待ち時間で送る）。
      if (mine !== generation) return;
      const events = pending;
      pending = []; timer = null;
      // Runs inside a timer: one failing event must not crash the process or drop the rest of the batch.
      for (const event of events) {
        try { dispatch(event); }
        catch (error) { try { failed(event, error); } catch { /* Recording failure must not stop the batch. */ } }
      }
      // windowMs は数か、まとまりを始めるたびに呼ぶ関数（配信中に保存したまとめる時間を、次のまとまりから効かせる。2026-10-18）。
    }, typeof windowMs === "function" ? windowMs() : windowMs);
  };
  // まとめ送りを待っている分を捨て、捨てた回数を返す（配信が終わったときのいいね）。
  batch.discard = () => {
    const discarded = pending.reduce((n, event) => n + event.count * (event.repeatRequests || 1), 0);
    pending = []; timer = null; generation++;
    return discarded;
  };
  return batch;
}

// Capture the round at creation, not when the head eventually reaches the network.
function captureGameEvent(event, gameMod, sessions = {}) {
  gameMod = event.gameMod || gameMod;
  if (!gameMod) return event;
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(gameMod)) throw new Error("Invalid game MOD ID");
  const args = event.args || {};
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length > 32) throw new Error("Invalid game args");
  let textLength = 0;
  for (const [key, value] of Object.entries(args)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype'].includes(key)) throw new Error("Invalid game argument key");
    if (typeof value === 'string') {
      textLength += value.length;
      if (value.length > 1024 || textLength > 8192) throw new Error("Game arguments too long");
    } else if (typeof value !== 'boolean' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error("Invalid game argument value");
  }
  return Object.freeze({ ...event, gameMod, gameSessionId: event.gameSessionId ?? sessions[gameMod]?.sessionId ?? '', args: Object.freeze({ ...args }) });
}
module.exports = { createModEventDelivery, createLikeBatcher, captureGameEvent, isPermanentDeliveryFailure };
