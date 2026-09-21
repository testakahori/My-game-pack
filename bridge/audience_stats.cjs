// Received activity is independent of command mappings, multipliers and failures.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeTikTokEvent, getSenderIdentity } = require('./tiktok_events.cjs');
function readAudienceStats(file) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (value.version !== 1 || !Array.isArray(value.streams)) throw new Error('受信統計の形式が不正です。既存ファイルを保護しました。');
  return value.streams;
}
function createAudienceRecorder(getPath, now = Date.now) {
  let streams, current = null, dirty = false, freshConnection = true;
  const stamp = () => new Date(now()).toISOString();
  function flush() {
    if (!dirty) return;
    const file = getPath(), temp = file + '.' + crypto.randomUUID() + '.tmp';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.writeFileSync(temp, JSON.stringify({ version: 1, streams }) + '\n'); fs.renameSync(temp, file); dirty = false; }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function connect(session) {
    flush(); current = null; streams = readAudienceStats(getPath());
    current = streams.find(row => row.id === session.id);
    if (!current) {
      current = { id: session.id, roomId: session.roomId, username: session.username, startedAt: stamp(), updatedAt: stamp(),
        gifts: 0, coins: 0, unknownCoinGifts: 0, likes: 0, comments: 0, follows: 0, shares: 0, visits: 0,
        giftBreakdown: [], viewerSamples: 0, viewerSum: 0, maxViewers: 0,
        seen: [], streaks: {}, lastLikeTotal: null };
      streams.push(current);
    }
    for (const row of streams) if (row !== current) { row.seen = row.seen.filter(([, at]) => now() - at < 600000); if (now() - Date.parse(row.updatedAt) > 600000) row.streaks = {}; }
    freshConnection = true; dirty = true; flush();
  }
  function receive(type, input) {
    if (!current) return;
    const data = normalizeTikTokEvent(input, type), time = now();
    const rawRepeat = Number(data.repeatCount);
    const repeat = Number.isSafeInteger(rawRepeat) && rawRepeat > 0 ? rawRepeat : 1;
    const key = data.msgId ? type + ':' + data.msgId + (type === 'gift' ? ':' + repeat + ':' + Boolean(data.repeatEnd) : '') : '';
    current.seen = current.seen.filter(([, at]) => time - at < 600000).slice(-4096);
    if (key && current.seen.some(([id]) => id === key)) return;
    if (key) current.seen.push([key, time]);
    current.updatedAt = stamp(); dirty = true;
    if (type === 'gift') {
      const identity = crypto.createHash('sha256').update(getSenderIdentity(data)).digest('hex').slice(0, 24);
      const rawGroup = String(data.groupId || data.gift?.groupId || '');
      const group = rawGroup === '0' ? '' : rawGroup;
      const streakKey = data.giftId + ':' + identity + ':' + group;
      for (const [id, previous] of Object.entries(current.streaks)) if (time - previous.at > 600000) delete current.streaks[id];
      const previous = current.streaks[streakKey];
      const fresh = previous && time - previous.at < 120000;
      const giftType = data.giftType ?? data.gift?.type;
      const isStreak = Number(giftType) === 1 || repeat > 1 || (giftType == null && !data.repeatEnd);
      let amount = repeat;
      if (fresh && (group || !previous.ended) && (isStreak || previous.streak)) {
        if (repeat >= previous.count) amount = repeat - previous.count;
        else if (group) amount = 0; // An older packet from the same streak.
      }
      if (fresh && group && previous.ended && repeat <= previous.count) amount = 0;
      // Retain the final baseline: an end notification must not count the streak twice.
      current.streaks[streakKey] = { count: group && fresh ? Math.max(repeat, previous.count) : repeat, at: time, ended: Boolean(data.repeatEnd), streak: isStreak };
      if (!amount) return;
      const coinValue = Number(data.diamondCount) > 0 ? Number(data.diamondCount) : null;
      current.gifts += amount;
      if (coinValue == null) current.unknownCoinGifts += amount;
      else current.coins += amount * coinValue;
      let gift = current.giftBreakdown.find(row => row.id === data.giftId && row.coinValue === coinValue);
      if (!gift) { gift = { id: data.giftId, name: data.giftName || data.giftId || '名称未取得', coinValue, count: 0, coins: 0 }; current.giftBreakdown.push(gift); }
      gift.count += amount; gift.coins += amount * (coinValue || 0);
    } else if (type === 'like') {
      const delta = data.likeCount;
      const total = data.totalLikeCount === 0 && delta > 0 ? null : data.totalLikeCount;
      if (total != null && current.lastLikeTotal != null && total < current.lastLikeTotal) return;
      let amount = delta ?? 0;
      if (total != null && total > 0) {
        if (current.lastLikeTotal != null) amount = Math.max(0, total - current.lastLikeTotal);
        // Do not attribute likes received while disconnected (or before first join).
        if (freshConnection) amount = Math.min(amount, delta ?? 0);
        current.lastLikeTotal = total;
      }
      if (total == null && current.lastLikeTotal != null) current.lastLikeTotal += amount;
      current.likes += amount; freshConnection = false;
    } else if (type === 'roomUser') {
      const viewers = data.viewerCount;
      if (viewers != null) {
        current.maxViewers = Math.max(current.maxViewers, viewers);
        if (!current.viewerSamples || time - (current.lastViewerSample || 0) >= 60000) {
          current.viewerSamples++; current.viewerSum += viewers; current.lastViewerSample = time;
        }
      }
    } else {
      const field = { chat: 'comments', follow: 'follows', share: 'shares', member: 'visits' }[type];
      if (field) current[field]++;
    }
  }
  function end() { flush(); current = null; }
  return { connect, receive, flush, end, active: () => Boolean(current) };
}
module.exports = { createAudienceRecorder, readAudienceStats };
