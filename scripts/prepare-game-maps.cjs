"use strict";
// 配る物に、ゲームの初期マップを入れる（npm run prepare:game-maps。埋め立て PR3）。
// どのゲームがどのマップを持つかは bridge/games.json の maps（ゲームの一覧の1か所）。元はリポジトリの map/<マップ名>（git の外）。
// 置き場は build/game-packs/<id>/maps/<マップ名>（配る物では resources/game-packs/<id>/maps/<マップ名>）。アプリはここからサーバーの map_backup へ写す。
// CI の mod-build はマップを持たないので、ゲームパックの準備（prepare-game-packs.cjs）とは分ける。
const fs = require("node:fs");
const path = require("node:path");
const { GAMES } = require("../bridge/game_commands.cjs");

const root = path.resolve(__dirname, "..");
// 作った人のプレイヤーの記録は配らない（一番上だけ。data/ の下などは地図の中身なので残す）。
const MAP_EXCLUDES = ["playerdata", "stats", "advancements"];

function prepareGameMaps(repoRoot = root) {
  return GAMES.filter(game => game.maps?.length).flatMap(game => game.maps.map(name => {
    const source = path.join(repoRoot, "map", name);
    if (!fs.existsSync(path.join(source, "level.dat"))) throw new Error(`初期マップ map/${name} がありません（${game.name}の初期マップ。git の外なので、手元に置いてから動かしてください）`);
    const dest = path.join(repoRoot, "build", "game-packs", game.id, "maps", name);
    fs.rmSync(dest, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    fs.cpSync(source, dest, {
      recursive: true,
      filter: file => {
        const rel = path.relative(source, file);
        return path.basename(file) !== "session.lock" && !MAP_EXCLUDES.includes(rel.split(path.sep)[0]);
      },
    });
    if (!fs.existsSync(path.join(dest, "level.dat"))) throw new Error(`初期マップ map/${name} を写せませんでした: ${dest}`);
    console.log(`${game.name}の初期マップを準備しました: ${dest}`);
    return dest;
  }));
}

if (require.main === module) prepareGameMaps();
module.exports = { MAP_EXCLUDES, prepareGameMaps };
