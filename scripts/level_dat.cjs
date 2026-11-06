"use strict";
// ワールドの level.dat（gzip で包んだ NBT）から、作った人のプレイヤーの記録（Data.Player）を外す（2026-11-06 品質レビュー）。
// 1人用で遊んだワールドの level.dat には、遊んだ人の UUID・持ち物・居場所が入る。専用サーバーはこれを使わず（playerdata を使う）、
// 保存するときに読んだまま書き戻すので、外さないと配信者のサーバーにも残り続ける。
// 新しい依存を足さないよう、要る所だけを読む。Player の項目をそのバイトの範囲ごと切り取るだけで、ほかの中身は1バイトも変えない
// （NBT のまとまりは長さを持たず、終わりの印で閉じるので、項目を1つ抜いても前後を直さなくてよい）。
const zlib = require("node:zlib");

const END = 0, LIST = 9, COMPOUND = 10;
// 長さの決まった型（Byte・Short・Int・Long・Float・Double）のバイト数。
const FIXED = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 };

function count(buf, pos) {
  const n = buf.readInt32BE(pos);
  if (n < 0) throw new Error("level.dat の中身が壊れています（長さが負）");
  return n;
}

// 型 type の中身（pos から）の終わりの位置。
function skipPayload(buf, pos, type) {
  if (FIXED[type]) return pos + FIXED[type];
  switch (type) {
    case 7: return pos + 4 + count(buf, pos); // Byte Array
    case 8: return pos + 2 + buf.readUInt16BE(pos); // String
    case LIST: {
      const itemType = buf.readUInt8(pos);
      const items = count(buf, pos + 1);
      pos += 5;
      for (let i = 0; i < items; i++) pos = skipPayload(buf, pos, itemType);
      return pos;
    }
    case COMPOUND: return compoundEntries(buf, pos).end;
    case 11: return pos + 4 + 4 * count(buf, pos); // Int Array
    case 12: return pos + 4 + 8 * count(buf, pos); // Long Array
    default: throw new Error(`level.dat の中身が壊れています（分からない型 ${type}）`);
  }
}

// 名前つきの項目（型・名前・中身）。start〜end がこの項目のバイトの範囲。
function readNamed(buf, pos) {
  const type = buf.readUInt8(pos);
  const nameLength = buf.readUInt16BE(pos + 1);
  const name = buf.toString("utf8", pos + 3, pos + 3 + nameLength);
  const payload = pos + 3 + nameLength;
  const end = skipPayload(buf, payload, type);
  if (end > buf.length) throw new Error("level.dat の中身が途中で切れています");
  return { type, name, start: pos, payload, end };
}

// まとまり（Compound）の中の項目の一覧と、終わりの印のあとの位置。
function compoundEntries(buf, pos) {
  const entries = [];
  for (;;) {
    if (buf.readUInt8(pos) === END) return { entries, end: pos + 1 };
    const entry = readNamed(buf, pos);
    entries.push(entry);
    pos = entry.end;
  }
}

// 解いた NBT の Data.Player の項目（無ければ null）。全体を最後まで読めることも確かめる。
function findPlayer(nbt) {
  try { return findPlayerIn(nbt); }
  catch (error) {
    // 途中で切れていると、Buffer の読み出しが範囲の外で止まる。
    if (error instanceof RangeError) throw new Error("level.dat の中身が途中で切れています");
    throw error;
  }
}

function findPlayerIn(nbt) {
  const root = readNamed(nbt, 0);
  if (root.type !== COMPOUND || root.end !== nbt.length) throw new Error("level.dat の形が違います");
  const data = compoundEntries(nbt, root.payload).entries.find(entry => entry.name === "Data" && entry.type === COMPOUND);
  if (!data) throw new Error("level.dat に Data がありません");
  return compoundEntries(nbt, data.payload).entries.find(entry => entry.name === "Player") || null;
}

function unzip(bytes) {
  try { return zlib.gunzipSync(bytes); }
  catch (error) { throw new Error(`level.dat を読めません（gzip ではない: ${error.code || error.message}）`); }
}

// level.dat（gzip のまま）に Data.Player があるか。
const hasPlayer = bytes => Boolean(findPlayer(unzip(bytes)));

// Data.Player を外した level.dat（gzip）。無ければ受け取ったまま返す。
function stripPlayer(bytes) {
  const nbt = unzip(bytes);
  const player = findPlayer(nbt);
  if (!player) return { changed: false, bytes };
  const stripped = Buffer.concat([nbt.subarray(0, player.start), nbt.subarray(player.end)]);
  if (findPlayer(stripped)) throw new Error("level.dat から Player を外せませんでした");
  return { changed: true, bytes: zlib.gzipSync(stripped) };
}

module.exports = { hasPlayer, stripPlayer };
