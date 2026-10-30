const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Called only before starting a stopped server. Keep the old files outside active folders.
function retireLegacyEnvironment(serverRoot) {
  const root = fs.realpathSync(serverRoot);
  const props = path.join(root, 'server.properties');
  if (!fs.existsSync(props)) return;
  const level = fs.readFileSync(props, 'utf8').match(/^level-name=(.+)$/m)?.[1]?.trim() || 'world';
  const world = path.resolve(root, level);
  if (!world.startsWith(root + path.sep)) throw new Error('ワールドの保存先がサーバーフォルダの外です');
  const pack = path.join(world, 'datapacks', 'NightVision_Pack');
  if (!fs.existsSync(pack)) return;
  const mods = path.join(root, 'mods');
  const bridge = fs.existsSync(mods) ? fs.readdirSync(mods).find(n => /^bridgemod-.*\.jar$/i.test(n)) : null;
  if (!bridge || !require('./game_profiles.cjs').jarModIds(fs.readFileSync(path.join(mods, bridge))).includes('bridgemod')) throw new Error('旧暗視パックを移行する前に、ホームのゲーム選択からBridgeMODを配置してください');
  if (fs.lstatSync(pack).isSymbolicLink() || fs.realpathSync(pack) !== pack) throw new Error('旧暗視データパックの保存先を確認してください');
  const tick = path.join(pack, 'data', 'nv_pack', 'functions', 'tick.mcfunction');
  if (!fs.existsSync(tick) || !fs.readFileSync(tick, 'utf8').includes('minecraft:night_vision')) throw new Error('NightVision_Packの内容が標準と異なります。退避してから起動してください');
  const backup = path.join(world, '.mygamepack-retired-packs', crypto.randomUUID());
  fs.mkdirSync(backup, { recursive: true });
  fs.renameSync(pack, path.join(backup, 'NightVision_Pack'));
}

function replaceCommonMod(source, serverRoot, modId = 'bridgemod') {
  if (!['bridgemod', 'displaymod', 'minecraft_obs_bridge'].includes(modId)) throw new Error('共通MOD IDが不正です');
  const bytes = fs.readFileSync(source);
  const { jarModIds } = require('./game_profiles.cjs');
  if (!jarModIds(bytes).includes(modId)) throw new Error(`${modId}のjarを確認できません`);
  const mods = path.join(serverRoot, 'mods'); fs.mkdirSync(mods, { recursive: true });
  const name = path.basename(source), destination = path.join(mods, name);
  // 同じ名前で中身も同じ jar は、そのまま使う。退避して置き直すと、環境構築などで呼ぶたびに同じ jar の写しが退避先にたまっていた（2026-10-30 ユーザーの決定：最新の jar は退避しない）。
  let current = false;
  try { current = fs.readFileSync(destination).equals(bytes); } catch { /* 無い・読めないときは置き直す */ }
  const backup = path.join(serverRoot, '.mygamepack-retired-mods', crypto.randomUUID());
  const moved = [];
  let writing = false;
  try {
    const pattern = modId === 'bridgemod' ? /^(doumacmd|bridgemod)-.*\.jar$/i : modId === 'displaymod' ? /^displaymod-.*\.jar$/i : /^minecraft_obs_bridge-.*\.jar$/i;
    // mods の中は、名前が違っても jar の中の MOD ID が同じものを退避する（手で入れた OBSMOD-handmade.jar など。残すと同じ MOD が2つ並び、Forge が起動しない。2026-10-25）。
    const sameMod = name => { if (!/\.jar$/i.test(name)) return false; try { return jarModIds(fs.readFileSync(path.join(mods, name))).includes(modId); } catch { return false; } };
    for (const dir of [serverRoot, mods]) for (const old of fs.readdirSync(dir).filter(n => pattern.test(n) || (dir === mods && sameMod(n)))) {
      const file = path.join(dir, old);
      if (path.resolve(file) === path.resolve(source)) continue;
      if (current && path.resolve(file) === path.resolve(destination)) continue;
      const slot = path.join(backup, dir === mods ? 'mods' : 'root'); fs.mkdirSync(slot, { recursive: true });
      const target = path.join(slot, old); fs.renameSync(file, target); moved.push([file, target]);
    }
    // 大文字小文字だけ違う名前で退避したときは、無くなっているので置き直す。
    if (path.resolve(destination) !== path.resolve(source) && !(current && fs.existsSync(destination))) { writing = true; fs.writeFileSync(destination, bytes); }
  } catch (error) {
    // 消すのは書きかけの jar だけ（書く前に止まったときは、元からある jar を消さない）。
    if (writing && fs.existsSync(destination)) fs.unlinkSync(destination);
    for (const [file, target] of moved.reverse()) fs.renameSync(target, file);
    throw error;
  }
}
module.exports = { retireLegacyEnvironment, replaceCommonMod };
