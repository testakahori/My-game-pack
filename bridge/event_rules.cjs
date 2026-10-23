// 本番Bridgeとオフラインテストで共有するイベント条件。
const { isResourceId } = require('./minecraft_ids.cjs');
const { CONFIG_DEFAULTS } = require('./config_defaults.cjs');
// txt の # COOLDOWN（ミリ秒）の上限。BRIDGE と TXT 作成の確かめ（bridge/command_rows.cjs）が使う（処理のコピー PR8）。
const COMMAND_COOLDOWN_MAX_MS = 60000;
function boundedInt(value, min, max, fallback = min) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}
function enabledCommand(rule) {
  return Boolean(rule && rule.enabled !== false && String(rule.commandFile || '').trim());
}
function matchingCommentRules(config, text) {
  if (config?.enabled !== true) return [];
  return (Array.isArray(config.rules) ? config.rules : []).filter(rule =>
    enabledCommand(rule) && String(rule.match || '').trim() && String(text).includes(String(rule.match).trim()));
}
function deathRouletteMatches(config, deaths) {
  const n = Number(deaths);
  return config?.enabled === true && Number.isInteger(n) && n > 0 &&
    n % deathRouletteEvery(config) === 0;
}
// 何回死ぬごとに回すか。設定に無いときは config_defaults.json の 3（画面の表示に合わせる。2026-10-23 ユーザーの決定。処理のコピー PR9）。
function deathRouletteEvery(config) {
  const fallback = CONFIG_DEFAULTS.deathRoulette.everyDeaths;
  return boundedInt(config?.everyDeaths ?? fallback, 1, 1000, fallback);
}
function likeRuleProgress(rule, total, previousMultiple, catchUpLimit = 5) {
  const threshold = boundedInt(rule.threshold, 1, 1000000, 10);
  const currentMultiple = Math.floor(total / threshold);
  const newTriggers = previousMultiple == null ? 0 : Math.max(0, currentMultiple - previousMultiple);
  const triggersToRun = Math.min(newTriggers, boundedInt(catchUpLimit, 1, 100, 5));
  return { threshold, currentMultiple, newTriggers, triggersToRun, skippedTriggers: newTriggers - triggersToRun };
}
function commentExtras(rule) {
  // 音・粒子の ID の決まりは minecraft_ids.cjs の1か所（DisplayMOD と同じ）。正しくなければ既定の音・粒子にする（処理のコピー PR7）。
  const id = (value, fallback) => isResourceId(value) ? value : fallback;
  const commands = [];
  if (rule.sound) commands.push(`playsound ${id(rule.sound, 'entity.experience_orb.pickup')} master @a ~ ~ ~ 1 1`);
  if (rule.particle) commands.push(`execute at @a run particle ${id(rule.particle, 'minecraft:happy_villager')} ~ ~1 ~ 0.6 0.8 0.6 0.05 20 force`);
  return commands;
}
// BridgeMOD（HTTP）で送る設定か。判定は command_files.cjs の1か所にまとめ、ここからも同じものを出す（PR #74 レビュー）。
const { isBridgeModTransport } = require('./command_files.cjs');
// 時限倍率（例：1.5倍）を掛けたあとのギフトの回数。小数は四捨五入する（BridgeMOD は小数の回数を拒否する）。
// 本番の Bridge とテスト発火で同じ丸め方をする（PR #85 レビュー）。
function giftTimes(amount) {
  const times = Math.round(Number(amount));
  return Number.isFinite(times) && times >= 1 ? times : 1;
}
module.exports = { COMMAND_COOLDOWN_MAX_MS, boundedInt, enabledCommand, matchingCommentRules, deathRouletteMatches, deathRouletteEvery, likeRuleProgress, commentExtras, isBridgeModTransport, giftTimes };
