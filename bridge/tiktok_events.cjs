// Keep the Bridge's event contract independent of the connector's protobuf layout.
// TikTokLiveConnection 2.4.x emits v3 user/common/gift objects and count/total likes.
function text(...values) {
  for (const value of values) {
    if (!['string', 'number', 'bigint'].includes(typeof value)) continue;
    const result = String(value).trim();
    if (result && result !== '0') return result;
  }
  return '';
}
function count(...values) {
  for (const value of values) {
    if (value == null || value === '' || !['string', 'number', 'bigint'].includes(typeof value)) continue;
    const number = Number(value);
    if (Number.isSafeInteger(number) && number >= 0) return number;
  }
  return null;
}
function normalizeTikTokEvent(input = {}, type = '') {
  const data = input || {}, user = data.user || {}, common = data.common || {};
  const gift = data.gift || {}, details = data.giftDetails || {}, extended = data.extendedGiftInfo || {};
  return {
    ...data,
    nickname: text(user.nickname, data.nickname),
    uniqueId: text(user.uniqueId, user.displayId, data.uniqueId),
    userId: text(user.userId, user.idStr, user.id, data.userId),
    msgId: text(common.msgId, data.msgId, data.messageId, data.eventId, data.id),
    createTime: count(common.createTime, data.createTime) || 0,
    comment: type === 'chat'
      ? (typeof data.comment === 'string' && data.comment.trim() ? data.comment : typeof data.content === 'string' ? data.content : '')
      : data.comment,
    giftId: text(data.giftId, gift.id, gift.gift_id),
    giftName: text(gift.name, details.giftName, details.name, data.giftName, extended.name),
    diamondCount: count(gift.diamondCount, details.diamondCount, data.diamondCount, extended.diamond_count) || 0,
    likeCount: type === 'like' ? count(data.likeCount, data.count) : data.likeCount,
    totalLikeCount: type === 'like' ? count(data.totalLikeCount, data.total) : data.totalLikeCount,
    viewerCount: type === 'roomUser' ? count(data.viewerCount, data.total) : data.viewerCount,
  };
}
function getStableSender(data) {
  const event = normalizeTikTokEvent(data);
  return event.nickname || event.uniqueId || event.userId || 'unknown';
}
function getSenderIdentity(data) {
  const event = normalizeTikTokEvent(data);
  return event.userId || event.uniqueId || event.nickname || 'unknown';
}
function isPreConnectionEvent(data, connectedAt) {
  const seconds = normalizeTikTokEvent(data).createTime;
  // Protobuf timestamps have whole-second precision; accept the connection second.
  return seconds > 0 && seconds < Math.floor(connectedAt / 1000);
}
function createLikeCounter() {
  let lastTotal = null;
  const seen = new Set();
  return {
    reset() { lastTotal = null; seen.clear(); },
    next(input) {
      const data = normalizeTikTokEvent(input, 'like');
      if (data.msgId) {
        if (seen.has(data.msgId)) return null;
        seen.add(data.msgId);
        if (seen.size > 4096) seen.delete(seen.values().next().value);
      }
      const delta = data.likeCount;
      let total = data.totalLikeCount;
      if (total == null || (total === 0 && delta > 0 && lastTotal == null)) {
        if (delta == null) return null;
        total = (lastTotal ?? 0) + delta;
      }
      if (!Number.isSafeInteger(total) || (lastTotal != null && total < lastTotal)) return null;
      // The first live packet's count belongs to this connection. Exclude older likes,
      // but do not discard the first 100 live likes by treating their total as the baseline.
      const previousTotal = lastTotal ?? Math.max(0, total - (delta ?? 0));
      lastTotal = total;
      return { previousTotal, total, received: total - previousTotal };
    },
  };
}
module.exports = { normalizeTikTokEvent, getStableSender, getSenderIdentity, isPreConnectionEvent, createLikeCounter };
