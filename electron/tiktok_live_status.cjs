const { normalizeTikTokId, isValidTikTokId } = require('../bridge/tiktok_id.cjs');

function createLiveStatusChecker({ query, now = Date.now, ttlMs = 30000 }) {
  const cache = new Map(), pending = new Map();
  let generation = 0;
  async function check(value) {
    // 整え方と確かめは tiktok_id.cjs の1か所（2026-10-18 設計書の 9）。
    const username = normalizeTikTokId(value);
    if (!username) return { username, state: 'empty' };
    if (!isValidTikTokId(username)) return { username, state: 'error', error: 'TikTokのアカウントIDを確認してください。' };
    const previous = cache.get(username);
    if (previous && now() - previous.time < ttlMs) return previous.result;
    if (pending.has(username)) return pending.get(username);
    const startedGeneration = generation;
    const task = (async () => {
      let result;
      try {
        const response = await query(username);
        if (typeof response?.live !== 'boolean') throw new Error('Invalid response');
        result = { username, state: response.live ? 'live' : 'offline', checkedAt: new Date(now()).toISOString() };
      } catch {
        result = { username, state: 'error', checkedAt: new Date(now()).toISOString(), error: '配信状態を確認できませんでした。通信状態を確認してください。' };
      }
      if (generation === startedGeneration) {
        if (cache.size >= 10) cache.delete(cache.keys().next().value);
        cache.set(username, { time: now(), result });
      }
      return result;
    })();
    pending.set(username, task);
    try { return await task; } finally { if (pending.get(username) === task) pending.delete(username); }
  }
  check.clearCache = () => { generation += 1; cache.clear(); pending.clear(); };
  return check;
}
module.exports = { createLiveStatusChecker };
