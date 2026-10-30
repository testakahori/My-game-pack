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
// 視聴者名はコマンド・ログ・読み上げに埋め込まれる。どこに入れても壊れない形にする（BridgeMOD の ListenerNames.java と同じ規則。
// 同じ入力で同じ結果になることを scripts/test-bridge-contracts.cjs で確かめる）。
// " ' \ は全角の同じ形の文字へ、改行・タブは空白へ。書式コード（§ と次の1文字）・制御文字・文字の向きや行を変える制御文字・
// 片割れのサロゲートは除く。前後の空白（trimmedNameChar の一覧だけ）を削り、40文字（コードポイント）までにする。空になったら ''。
const NAME_MAX_LENGTH = 40;
const NAME_SYMBOLS = { '"': '”', "'": '’', '\\': '＼' };
function removedNameChar(cp) {
  return cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xd800 && cp <= 0xdfff)
    || cp === 0x061c || cp === 0x200e || cp === 0x200f || cp === 0x2028 || cp === 0x2029
    || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
}
// 前後から削る空白。String.prototype.trim（JS）と String.trim（Java）は範囲が違うので、この一覧だけを使う。
function trimmedNameChar(cp) {
  return cp === 0x20 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a)
    || cp === 0x202f || cp === 0x205f || cp === 0x3000 || cp === 0xfeff;
}
function safeDisplayName(value) {
  const chars = Array.from(String(value ?? '')), kept = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === '§') { i++; continue; } // 書式コードは「§」と次の1文字（§c など）をまとめて除く
    if (ch === '\r' || ch === '\n' || ch === '\t') kept.push(' ');
    else if (!removedNameChar(ch.codePointAt(0))) kept.push(NAME_SYMBOLS[ch] || ch);
  }
  // 前の空白を削ってから40文字で切り、後ろの空白を削る（ListenerNames.java と同じ順番）。
  let start = 0, end = kept.length;
  while (start < end && trimmedNameChar(kept[start].codePointAt(0))) start++;
  end = Math.min(end, start + NAME_MAX_LENGTH);
  while (end > start && trimmedNameChar(kept[end - 1].codePointAt(0))) end--;
  return kept.slice(start, end).join('');
}
// ミュートの照合。設定には生の名前（it's me）も、整えた後の表示名（it’s me）も書かれうる。
// 視聴者側の候補（生の ID・名前と整えた表示名）と設定の値を、それぞれ生のままと整えた形の両方で比べ、
// どれか1つでも一致すればミュートにする。大文字小文字と前後の空白は区別しない。
function muteKeys(values) {
  const keys = new Set();
  for (const value of values) {
    if (value == null) continue;
    for (const key of [String(value), safeDisplayName(value)]) {
      const normalized = key.trim().toLowerCase();
      if (normalized) keys.add(normalized);
    }
  }
  return keys;
}
function createMuteMatcher(entries) {
  const muted = muteKeys(Array.isArray(entries) ? entries : []);
  return candidates => muted.size > 0 && [...muteKeys(candidates)].some(key => muted.has(key));
}
function getStableSender(data) {
  const event = normalizeTikTokEvent(data);
  return safeDisplayName(event.nickname) || safeDisplayName(event.uniqueId) || safeDisplayName(event.userId) || 'unknown';
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
  // 配信の累計が届かず、つないでからの数で数えている間は true。
  let localCount = false;
  const seen = new Set();
  return {
    reset() { lastTotal = null; localCount = false; seen.clear(); },
    next(input) {
      const data = normalizeTikTokEvent(input, 'like');
      if (data.msgId) {
        if (seen.has(data.msgId)) return null;
        seen.add(data.msgId);
        if (seen.size > 4096) seen.delete(seen.values().next().value);
      }
      const delta = data.likeCount;
      let total = data.totalLikeCount;
      const derived = total == null || (total === 0 && delta > 0 && lastTotal == null);
      if (derived) {
        if (delta == null) return null;
        total = (lastTotal ?? 0) + delta;
      }
      // 配信の累計が初めて届いた。つないでからの数とは比べられないので、この通知の分だけを新しく数える（PR #96 レビュー）。
      const base = !derived && localCount ? null : lastTotal;
      if (!Number.isSafeInteger(total) || (base != null && total < base)) return null;
      // The first live packet's count belongs to this connection. Exclude older likes,
      // but do not discard the first 100 live likes by treating their total as the baseline.
      const previousTotal = base ?? Math.max(0, total - (delta ?? 0));
      if (derived && lastTotal == null) localCount = true;
      else if (!derived) localCount = false;
      lastTotal = total;
      // 前は local（つないでからの数で数えているか）も返していた。読んでいたのはいいねのマイルストーンだけなので外した（2026-10-30）。
      return { previousTotal, total, received: total - previousTotal };
    },
  };
}
module.exports = { normalizeTikTokEvent, getStableSender, getSenderIdentity, isPreConnectionEvent, createLikeCounter, safeDisplayName, createMuteMatcher };
