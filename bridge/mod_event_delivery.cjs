const { randomUUID } = require("node:crypto");

// Each lane is FIFO. A full like queue must never hold up a gift's HTTP request.
function createModEventDelivery({ send, delivered = () => {}, retry = () => {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxRetries = Infinity } = {}) {
  const lanes = { gift: [], like: [], other: [] };
  const running = new Set();
  async function drain(lane) {
    if (running.has(lane)) return;
    running.add(lane);
    try {
      while (lanes[lane].length) {
        const job = lanes[lane][0];
        while (job.remaining > 0) {
          const count = Math.min(100, job.remaining);
          const chunk = { ...job.event, count, eventId: `${job.id}:${job.part}` };
          let attempts = 0;
          for (;;) {
            try { await send(chunk); break; }
            catch (error) {
              attempts++;
              try { retry(chunk, error, attempts); } catch { /* Diagnostics cannot discard a queued event. */ }
              if (attempts > maxRetries) throw error;
              await sleep(Math.min(3000, 250 * 2 ** Math.min(attempts - 1, 4)));
            }
          }
          job.remaining -= count;
          job.part++;
        }
        lanes[lane].shift();
        try { delivered(job.event); } catch { /* Recording failure must not affect gameplay delivery. */ }
        job.resolve();
      }
    } catch (error) {
      // A finite retry limit is only for explicit callers/tests, never the live dispatcher.
      const job = lanes[lane].shift();
      job?.reject(error);
    } finally {
      running.delete(lane);
      if (lanes[lane].length) void drain(lane);
    }
  }
  return {
    enqueue(event) {
      const count = Number(event.count ?? 1);
      if (!Number.isSafeInteger(count) || count < 1) return Promise.reject(new Error("Invalid event count"));
      const lane = event.type === "gift" ? "gift" : event.type === "like" ? "like" : "other";
      return new Promise((resolve, reject) => {
        lanes[lane].push({ event: { ...event, count }, remaining: count, part: 0, id: randomUUID(), resolve, reject });
        void drain(lane);
      });
    },
    pending() { return Object.fromEntries(Object.entries(lanes).map(([key, jobs]) => [key, jobs.reduce((n, job) => n + job.remaining, 0)])); },
  };
}

// Coalesce only adjacent identical requests; retain every repetition and sender in order.
function createLikeBatcher({ dispatch, windowMs, schedule = setTimeout }) {
  let pending = [], timer = null;
  return (commandFile, count, sender, announce) => {
    const last = pending.at(-1);
    if (last && last.commandFile === commandFile && last.listenerName === sender && last.announce === announce
        && Number.isSafeInteger(last.count + count)) last.count += count;
    else pending.push({ type: "like", commandFile, count, listenerName: sender, announce });
    if (timer !== null) return;
    timer = schedule(() => {
      const batch = pending;
      pending = []; timer = null;
      for (const event of batch) dispatch(event);
    }, windowMs);
  };
}

module.exports = { createModEventDelivery, createLikeBatcher };
