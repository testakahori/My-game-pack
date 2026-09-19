const fs = require('node:fs');
const path = require('node:path');
const { FeatureEngine, parseWeightedList, chooseWeighted } = require('../bridge/feature_engine.js');
const { boundedInt, enabledCommand, matchingCommentRules, deathRouletteMatches, likeRuleProgress, commentExtras } = require('../bridge/event_rules.cjs');
const { prepareRoulette } = require('../bridge/roulette.cjs');

const TYPES = new Set(['gift', 'mapped_gift', 'unmapped_gift', 'like', 'share', 'follow', 'member', 'comment', 'death', 'roulette', 'combo', 'like_milestone', 'follow_milestone', 'comment_command', 'poll']);
function commandName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 160 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || name === '.' || name === '..') throw new Error('コマンドファイル名が不正です。');
  return /\.txt$/i.test(name) ? name : `${name}.txt`;
}
function planTestEvent(config, input, commandsDir) {
  if (!input || !TYPES.has(input.type)) throw new Error('対応していないテストイベントです。');
  const type = input.type;
  const sender = String(input.listenerName || 'テスト視聴者').replace(/[\r\n]/g, ' ').slice(0, 40);
  const steps = [], notes = [];
  const push = (file, count, label, eventType = type, extras = []) => {
    const commandFile = commandName(file);
    const roulette = commandFile.toLowerCase() === 'roulette.txt' ? config.roulette : null;
    if (roulette && roulette.enabled !== true) throw new Error('ルーレットが無効です。イベント設定②で有効にして保存してください。');
    if (commandFile.toLowerCase() === 'roulette.txt' && !roulette) throw new Error('ルーレットが未設定です。');
    if (roulette) prepareRoulette(roulette, commandsDir);
    else if (!fs.existsSync(path.join(commandsDir, commandFile))) throw new Error(`コマンドが見つかりません: ${commandFile}`);
    steps.push({ commandFile, count: boundedInt(count, 1, 100, 1), label, type: eventType, extras, ...(roulette ? { roulette } : {}) });
  };
  const featureEngine = new FeatureEngine(config.options?.gameplay || {}, feature => {
    push(feature.commandFile, feature.count, feature.label || feature.type, feature.type);
  });
  const number = (key, fallback, max = 1000000) => {
    const n = Number(input[key] ?? fallback);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${key}: 0〜${max}の整数を指定してください。`);
    return n;
  };
  const text = String(input.comment || '').trim().slice(0, 500);
  const simple = (key, label) => {
    const rule = config[key];
    if (enabledCommand(rule)) push(rule.commandFile, rule.repeat ?? 1, label);
    else notes.push(`${label}は無効または未設定です。`);
  };
  if ((Array.isArray(config.options?.mutedUsers) ? config.options.mutedUsers : []).some(v => String(v).trim().toLowerCase() === sender.trim().toLowerCase()) && type !== 'death') {
    return { type, sender, steps, notes: ['この視聴者はミュート対象のため発火しません。'] };
  }
  if (['gift', 'mapped_gift', 'combo'].includes(type) && number('count', 1, 100) < 1) throw new Error('ギフト数は1以上にしてください。');
  if (type === 'gift') push(input.commandFile, number('count', 1, 100), '選択コマンドの直接テスト', 'gift');
  if (type === 'mapped_gift' || type === 'combo') {
    const mapping = (config.mappings || []).find(m => String(m.giftId) === String(input.giftId));
    if (!mapping) notes.push('このギフトIDには割当がありません。未設定ギフトのテストを使用してください。');
    else {
      let file = commandName(mapping.commandFile);
      const meta = (name, key) => fs.readFileSync(path.join(commandsDir, name), 'utf8').match(new RegExp(`^#\\s*${key}:\\s*(.+)$`, 'mi'))?.[1] || '';
      const choices = parseWeightedList(meta(file, 'RANDOM')).map(c => ({ ...c, weight: c.explicitWeight ? c.weight : Math.max(1, Number(meta(commandName(c.commandFile), 'WEIGHT')) || 1) }));
      if (choices.length) { file = commandName(chooseWeighted(choices).commandFile); notes.push(`ランダム選択: ${file}（実行ごとに抽選）`); }
      const count = (number('count', 1, 100) || 1) * boundedInt(mapping.repeat ?? 1, 1, 100, 1);
      const actual = featureEngine.recordGift({ giftId: String(input.giftId), sender, commandFile: file, count });
      if (type === 'mapped_gift') push(file, actual, `${mapping.name || input.giftId}の割当`, 'gift');
      notes.push(`テスト用の新しいコンボとして判定。時限倍率: ${featureEngine.multiplier()}倍。`);
    }
  }
  if (type === 'unmapped_gift') {
    if ((config.mappings || []).some(m => String(m.giftId) === String(input.giftId))) notes.push('このIDは設定済みです。割当のないギフトIDを指定してください。');
    else simple('unmappedGiftEvent', '未設定ギフト');
  }
  if (type === 'share') simple('shareEvent', 'シェア');
  if (type === 'member') simple('memberEvent', '訪問');
  if (type === 'follow' || type === 'follow_milestone') {
    if (type === 'follow') simple('followEvent', 'フォロー');
    featureEngine.followCount = Math.max(0, number('followCount', 1) - 1);
    featureEngine.recordFollow(sender);
  }
  if (type === 'like' || type === 'like_milestone') {
    const total = number('likeCount', 100), before = number('previousLikes', 0);
    if (total < before) throw new Error('今回の累計いいねは前回以上にしてください。');
    if (type === 'like') for (const rule of (config.likeEvents || []).filter(enabledCommand)) {
      const threshold = boundedInt(rule.threshold, 1, 1000000, 10);
      const progress = likeRuleProgress(rule, total, Math.floor(before / threshold), config.options?.maxLikeCatchUpPerEvent ?? 5);
      if (progress.triggersToRun) push(rule.commandFile, progress.triggersToRun * boundedInt(rule.repeat ?? 1, 1, 100, 1), `${threshold}いいねごと`, 'like');
      if (progress.skippedTriggers) notes.push(`${threshold}いいねルール: 追いつき上限により${progress.skippedTriggers}回省略。`);
    }
    // 到達済みのマイルストーンは、前回の累計から復元して二重発火を防ぐ。
    for (const m of (config.options?.gameplay?.likeMilestones || [])) if (Number(m.threshold) <= before) featureEngine.likeMilestones.add(`like:${Number(m.threshold)}`);
    featureEngine.recordLikes(total, sender);
    notes.push(`累計${before}→${total}として判定。本番のいいね数は変更しません。`);
  }
  if (type === 'comment' || type === 'comment_command') {
    if (!text) throw new Error('テストするコメントを入力してください。');
    featureEngine.recordComment(text, sender);
    if (type === 'comment') for (const rule of matchingCommentRules(config.commentGifts, text)) push(rule.commandFile, rule.repeat ?? 1, `「${rule.match}」を含むコメント`, 'comment', commentExtras(rule));
    notes.push('新しいコメントとして判定します。読み上げは読み上げ設定のテストで確認できます。');
  }
  if (type === 'death' || type === 'roulette') {
    const rl = type === 'death' ? config.deathRoulette : config.roulette;
    const matched = type === 'death' ? deathRouletteMatches(rl, number('deaths', 1, 1000000)) : rl?.enabled === true;
    if (matched) {
      prepareRoulette(rl, commandsDir);
      steps.push({ commandFile: 'roulette.txt', count: 1, label: type === 'death' ? 'デスルーレット' : 'ルーレット', type: type === 'death' ? 'death_roulette' : 'roulette', roulette: rl, extras: [] });
    } else notes.push(type === 'death' ? `デスルーレットが無効、または死亡回数が${rl?.everyDeaths || 1}回ごとの条件に届いていません。` : 'ルーレットが無効です。');
  }
  if (type === 'poll') {
    const poll = config.options?.gameplay?.poll;
    const option = poll?.enabled && poll.options?.[String(input.pollOption || '')];
    if (option) push(option.commandFile || option, option.repeat ?? 1, `コメント投票: !${input.pollOption} が当選`, 'poll');
    else notes.push('投票が無効、または選択肢が未設定です。');
    notes.push('選択肢の当選後の発火を確認します。実際の投票待ち時間は省略します。');
  }
  if (!steps.length && !notes.length) notes.push('条件に一致する有効な設定がありません。');
  if (steps.length > 100) throw new Error('一度に100件を超えるため、条件を絞ってテストしてください。');
  return { type, sender, steps, notes };
}
module.exports = { planTestEvent };
