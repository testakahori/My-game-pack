'use strict';
// アプリと一緒に配るゲームパックの場所（埋め立て PR2。2026-10-29）。
// どのゲームにパックがあるかは bridge/games.json の modDir（ゲームの一覧の1か所。設計書 13 の「自分の一覧を持たない」）。
// 配る物では resources/game-packs/<id>、開発版では build/game-packs/<id>（scripts/prepare-game-packs.cjs が作る）。
// scripts/ は配布のアプリに入らないので、ここから scripts/ を読まない。
const fs = require('node:fs');
const path = require('node:path');
const { GAMES } = require('../bridge/game_commands.cjs');

// game.json があるものだけを、games.json の順で返す。
function bundledGamePacks({ packaged, resourcesPath, appDir }) {
  const base = packaged ? path.join(resourcesPath, 'game-packs') : path.resolve(appDir, '..', 'build', 'game-packs');
  return GAMES.filter(game => game.modDir).map(game => ({ id: game.id, folder: path.join(base, game.id) }))
    .filter(pack => fs.existsSync(path.join(pack.folder, 'game.json')));
}

module.exports = { bundledGamePacks };
