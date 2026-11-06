// テスト用の小さな level.dat（gzip で包んだ NBT）。作った人のプレイヤーの記録（Data.Player）の有り・無しを作り分ける（2026-11-06 品質レビュー）。
// NBT の型をひととおり使う（読み飛ばしの確かめのため）。
const zlib = require('node:zlib');

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const named = (type, name, payload) => Buffer.concat([Buffer.from([type]), u16(Buffer.byteLength(name)), Buffer.from(name), payload]);
const compound = entries => Buffer.concat([...entries, Buffer.from([0])]);
const string = text => Buffer.concat([u16(Buffer.byteLength(text)), Buffer.from(text)]);
const list = (type, items) => Buffer.concat([Buffer.from([type]), i32(items.length), ...items]);
const ints = values => Buffer.concat([i32(values.length), ...values.map(i32)]);
const longs = count => Buffer.concat([i32(count), Buffer.alloc(8 * count, 7)]);
const bytes = count => Buffer.concat([i32(count), Buffer.alloc(count, 3)]);
const double = n => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return b; };
const float = n => { const b = Buffer.alloc(4); b.writeFloatBE(n); return b; };

// 作った人のプレイヤーの記録（UUID・持ち物・居場所）。
const PLAYER = named(10, 'Player', compound([
  named(11, 'UUID', ints([11, 22, 33, 44])),
  named(9, 'Inventory', list(10, [compound([named(8, 'id', string('minecraft:diamond')), named(1, 'Count', Buffer.from([5]))])])),
  named(9, 'Pos', list(6, [double(1.5), double(64), double(-3)])),
  named(5, 'XpP', float(0.5)),
  named(2, 'SleepTimer', u16(0)),
]));

// 解いた NBT。player が false なら Data.Player の無いもの（同じ並びで Player だけが無い）。
function levelNbt({ player = true } = {}) {
  return named(10, '', compound([
    named(10, 'Data', compound([
      named(8, 'LevelName', string('umetate_lab_map')),
      named(3, 'SpawnX', i32(12)),
      named(4, 'LastPlayed', Buffer.alloc(8, 1)),
      ...(player ? [PLAYER] : []),
      named(10, 'GameRules', compound([named(8, 'keepInventory', string('true'))])),
      named(9, 'ScheduledEvents', list(0, [])),
      named(12, 'Seeds', longs(2)),
      named(7, 'Flags', bytes(3)),
      named(6, 'BorderSize', double(59999968)),
    ])),
  ]));
}

const levelDat = options => zlib.gzipSync(levelNbt(options));

module.exports = { levelDat, levelNbt };
