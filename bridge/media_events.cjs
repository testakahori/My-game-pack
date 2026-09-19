const http = require('node:http');
const crypto = require('node:crypto');

function createGiftNormalizer(now = Date.now) {
  const streaks = new Map();
  return {
    reset() { streaks.clear(); },
    gift(data, sender) {
      const giftId = String(data.giftId ?? ''), unitCoins = Number(data.diamondCount ?? data.extendedGiftInfo?.diamond_count ?? 0);
      if (!/^\d{1,20}$/.test(giftId) || !Number.isFinite(unitCoins) || unitCoins < 0 || unitCoins > 1e9) return null;
      const count = Math.max(1, Math.min(1e6, Math.floor(Number(data.repeatCount) || 1)));
      const key = giftId + ':' + sender;
      const isStreak = Number(data.giftType ?? data.extendedGiftInfo?.type) === 1;
      let previous = 0;
      if (isStreak) {
        const old = streaks.get(key);
        const message = String(data.groupId || data.msgId || data.messageId || '');
        const ended = Boolean(data.repeatEnd), fresh = old && now() - old.at < 120000;
        const newMessageAtSameCount = fresh && message && old.message && message !== old.message && count <= old.count && (!ended || old.ended);
        if (fresh && count >= old.count && !(old.ended && !ended) && !newMessageAtSameCount) previous = old.count;
        streaks.set(key, { count, at: now(), ended, message });
        if (streaks.size > 2000) streaks.delete(streaks.keys().next().value);
      }
      const delta = count - previous;
      if (delta <= 0) return null; // 同じ累積数の終了通知では再生しない。
      return { type: 'gift', giftId, unitCoins, delta, previousCoins: unitCoins * previous, totalCoins: unitCoins * count };
    },
  };
}

function createMediaReporter(env = process.env) {
  const normalizer = createGiftNormalizer();
  let endpoint;
  try { endpoint = new URL(env.MYGAMEPACK_MEDIA_URL); } catch {}
  if (!endpoint || endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/event' || !/^[a-f0-9]{64}$/.test(env.MYGAMEPACK_MEDIA_TOKEN || '')) return { gift() {}, like() {}, reset() {} };
  const session = crypto.randomUUID(); let sequence = 0, sending = false;
  const queue = [];
  function send(event) {
    if (!event) return;
    if (queue.length >= 64) queue.shift();
    queue.push({ ...event, id: session + ':' + (++sequence), queuedAt: Date.now() });
    flush();
  }
  function flush() {
    if (sending || !queue.length) return;
    const event = queue.shift();
    if (Date.now() - event.queuedAt > 3000) { flush(); return; }
    sending = true;
    const payload = JSON.stringify(event);
    const request = http.request(endpoint, { method: 'POST', headers: { Authorization: 'Bearer ' + env.MYGAMEPACK_MEDIA_TOKEN, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, response => {
      response.resume(); response.on('end', done);
    });
    let finished = false;
    function done() { if (finished) return; finished = true; sending = false; flush(); }
    request.setTimeout(800, () => request.destroy()); request.on('error', done); request.on('close', done); request.end(payload);
  }
  return {
    gift: (data, sender) => send(normalizer.gift(data, sender)),
    like: data => { const total = Number(data.totalLikeCount); if (Number.isFinite(total) && total >= 0) send({ type: 'like', total }); },
    reset: () => { normalizer.reset(); queue.length = 0; send({ type: 'reset' }); },
  };
}
module.exports = { createGiftNormalizer, createMediaReporter };
