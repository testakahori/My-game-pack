const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// 採掘へ移したコマンド。最初の14件と、2026-10-12 に移した採掘速度上昇・低下（give_haste・give_fatigue）。
const KEYS = Object.freeze(["randomtp","skytrap","cataclysm","iceage","flood","maguma_jigoku","fissure","otosiana","tntdaibakuhatu","get_ender_pearl","get_iron_pickaxe","get_tree","get_water_backet","pikkerubossyuu","give_haste","give_fatigue"]);
const FILES = new Set(KEYS.map(key => key + '.txt'));
function hasLegacy(value) {
  if (!value || typeof value !== 'object') return false;
  if (FILES.has(value.commandFile)) return true;
  return Object.values(value).some(hasLegacy);
}
function mapLegacy(value) {
  if (Array.isArray(value)) return value.map(mapLegacy);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'commandFile' && FILES.has(item) ? 'game_saikutu_' + item : mapLegacy(item)]));
}
function withoutLegacy(value) {
  if (!value || typeof value !== 'object') return value;
  if (FILES.has(value.commandFile)) return undefined;
  if (Array.isArray(value)) return value.map(withoutLegacy).filter(item => item !== undefined);
  return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,withoutLegacy(item)]).filter(([,item]) => item !== undefined));
}
// Move only the former bundled commands listed in KEYS; keep their original text for recovery.
function retireCommands(bridgeRoot) {
  const dir = path.join(bridgeRoot,'commands','minecraft');
  const found = KEYS.map(key => key + '.txt').filter(name => fs.existsSync(path.join(dir,name)));
  if (!found.length) return;
  const backup = path.join(bridgeRoot,'.retired-saikutu-commands',crypto.randomUUID());
  fs.mkdirSync(backup,{recursive:true});
  for (const name of found) {
    const source = path.join(dir,name), stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('採掘コマンドの退避元を確認してください: ' + name);
    fs.renameSync(source,path.join(backup,name));
  }
}
module.exports = { KEYS, FILES, hasLegacy, mapLegacy, withoutLegacy, retireCommands };
