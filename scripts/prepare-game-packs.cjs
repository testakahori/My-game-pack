const fs = require('node:fs');
const path = require('node:path');
const { inspectPackage, jarModIds } = require('../electron/game_profiles.cjs');
const root = path.resolve(__dirname,'..');
function prepareGamePacks() {
  const source = path.join(root,'game-packs/saikutu');
  const manifest = JSON.parse(fs.readFileSync(path.join(source,'game.json'),'utf8'));
  const jar = path.join(root,'SaikutuMod/build/libs',manifest.serverJar);
  if (!fs.existsSync(jar) || !jarModIds(fs.readFileSync(jar)).includes('saikutumod')) throw new Error('先にBridgeModとSaikutuModをビルドしてください');
  const dest = path.join(root,'build/game-packs/saikutu');
  fs.mkdirSync(dest,{recursive:true});
  fs.copyFileSync(jar,path.join(dest,manifest.serverJar));
  fs.copyFileSync(path.join(source,'game.json'),path.join(dest,'game.json'));
  inspectPackage(dest);
  console.log('採掘ゲームパックを準備しました: ' + dest);
}
if (require.main === module) prepareGamePacks();
module.exports = { prepareGamePacks };
