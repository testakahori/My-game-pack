const fs = require('node:fs');
const path = require('node:path');
const { inspectPackage, jarModIds } = require('../electron/game_profiles.cjs');
const { modJar } = require('./mod_jars.cjs');
// どのゲームにパックがあるかは bridge/games.json の modDir（ゲームの一覧の1か所。埋め立て PR2 で埋め立ても足した）。
const { GAMES } = require('../bridge/game_commands.cjs');
const root = path.resolve(__dirname,'..');

// build/game-packs/<id> に game.json と jar を置き、アプリのゲームパックの確かめを通す。作ったフォルダーの一覧を返す。
function prepareGamePacks(repoRoot = root) {
  return GAMES.filter(game => game.modDir).map(game => {
    const source = path.join(repoRoot, 'game-packs', game.id);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'game.json'), 'utf8'));
    // jar の場所の決まりは scripts/mod_jars.cjs の1か所（npm run release:win と同じ）。
    const jar = modJar(repoRoot, game.modDir);
    if (!fs.existsSync(jar) || !jarModIds(fs.readFileSync(jar)).includes(manifest.modId)) throw new Error(`先にBridgeModと${game.modDir}をビルドしてください（${game.name}のゲームパック）`);
    const dest = path.join(repoRoot, 'build/game-packs', game.id);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(jar, path.join(dest, manifest.serverJar));
    fs.copyFileSync(path.join(source, 'game.json'), path.join(dest, 'game.json'));
    inspectPackage(dest);
    console.log(`${game.name}のゲームパックを準備しました: ${dest}`);
    return dest;
  });
}
if (require.main === module) prepareGamePacks();
module.exports = { prepareGamePacks };
