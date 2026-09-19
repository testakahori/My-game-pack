// 本番Bridgeとオフラインテストで共有するイベント条件。
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
    n % boundedInt(config.everyDeaths ?? 1, 1, 1000, 1) === 0;
}
function likeRuleProgress(rule, total, previousMultiple, catchUpLimit = 5) {
  const threshold = boundedInt(rule.threshold, 1, 1000000, 10);
  const currentMultiple = Math.floor(total / threshold);
  const newTriggers = previousMultiple == null ? 0 : Math.max(0, currentMultiple - previousMultiple);
  const triggersToRun = Math.min(newTriggers, boundedInt(catchUpLimit, 1, 100, 5));
  return { threshold, currentMultiple, newTriggers, triggersToRun, skippedTriggers: newTriggers - triggersToRun };
}
function commentExtras(rule) {
  const id = (value, fallback) => /^[a-z0-9_.:-]+$/.test(String(value || '')) ? value : fallback;
  const commands = [];
  if (rule.sound) commands.push(`playsound ${id(rule.sound, 'entity.experience_orb.pickup')} master @a ~ ~ ~ 1 1`);
  if (rule.particle) commands.push(`execute at @a run particle ${id(rule.particle, 'minecraft:happy_villager')} ~ ~1 ~ 0.6 0.8 0.6 0.05 20 force`);
  return commands;
}
module.exports = { boundedInt, enabledCommand, matchingCommentRules, deathRouletteMatches, likeRuleProgress, commentExtras };
