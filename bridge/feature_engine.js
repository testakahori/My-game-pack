"use strict";

function parseWeightedList(raw) {
  return String(raw || "").split(",").map(part => {
    const [file, weightRaw] = part.trim().split(/[=*]/);
    return { commandFile: file?.trim(), weight: Math.max(1, Number(weightRaw || 1)),
      explicitWeight: weightRaw != null };
  }).filter(x => x.commandFile);
}

function chooseWeighted(items, random = Math.random) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return null;
  let cursor = random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return items[items.length - 1] || null;
}

class FeatureEngine {
  constructor(config = {}, emit = () => {}) {
    this.config = config;
    this.emit = emit;
    this.giftBursts = new Map();
    this.likeMilestones = new Set();
    this.followCount = 0;
    this.topGifters = new Map();
    this.poll = null;
  }

  multiplier() {
    const mode = this.config.timedMode || {};
    if (mode.enabled === false) return 1;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const parse = value => {
      const [h, m] = String(value || "00:00").split(":").map(Number);
      return h * 60 + m;
    };
    const start = parse(mode.start);
    const end = parse(mode.end);
    const active = start <= end ? current >= start && current < end : current >= start || current < end;
    return active ? Math.max(1, Math.min(10, Number(mode.multiplier || 2))) : 1;
  }

  recordGift({ giftId, sender, commandFile, count = 1 }) {
    const amount = Math.max(1, Number(count)) * this.multiplier();
    this.topGifters.set(sender, (this.topGifters.get(sender) || 0) + amount);
    const combo = this.config.combo || {};
    const now = Date.now();
    const previous = this.giftBursts.get(giftId);
    const burst = previous && now - previous.at <= Number(combo.windowMs || 10000)
      ? { at: now, count: previous.count + amount } : { at: now, count: amount };
    this.giftBursts.set(giftId, burst);
    for (const level of (combo.levels || [])) {
      const marker = `${giftId}:${level.count}:${Math.floor(burst.count / level.count)}`;
      if (burst.count >= level.count && !this.likeMilestones.has(marker)) {
        this.likeMilestones.add(marker);
        this.emit({ type: "combo", commandFile: level.commandFile || commandFile,
          count: Number(level.repeat || 1), sender, label: `${burst.count}連コンボ` });
      }
    }
    return amount;
  }

  recordLikes(total, sender) {
    for (const milestone of (this.config.likeMilestones || [])) {
      const threshold = Number(milestone.threshold);
      if (total >= threshold && !this.likeMilestones.has(`like:${threshold}`)) {
        this.likeMilestones.add(`like:${threshold}`);
        this.emit({ type: "milestone", commandFile: milestone.commandFile,
          count: Number(milestone.repeat || 1), sender, label: `${threshold}いいね` });
      }
    }
  }

  recordFollow(sender) {
    this.followCount++;
    for (const milestone of (this.config.followMilestones || [])) {
      const threshold = Number(milestone.threshold);
      if (this.followCount === threshold) this.emit({ type: "milestone",
        commandFile: milestone.commandFile, count: Number(milestone.repeat || 1),
        sender, label: `${threshold}フォロー` });
    }
  }

  recordComment(text, sender) {
    const command = (this.config.commentCommands || {})[String(text || "").trim()];
    if (command) this.emit({ type: "comment", commandFile: command.commandFile || command,
      count: Number(command.repeat || 1), sender, label: text });
    if (!this.poll) return;
    const match = String(text || "").trim().match(/^!(\d+)$/);
    if (match && this.poll.options[match[1]]) {
      const key = `${sender}:${match[1]}`;
      if (!this.poll.voters.has(sender)) {
        this.poll.voters.add(sender);
        this.poll.votes.set(match[1], (this.poll.votes.get(match[1]) || 0) + 1);
      }
    }
  }

  startPoll() {
    const poll = this.config.poll;
    if (!poll?.enabled || !poll.options) return;
    this.poll = { options: poll.options, votes: new Map(), voters: new Set() };
    setTimeout(() => {
      const winner = [...this.poll.votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
        || Object.keys(poll.options)[0];
      const chosen = poll.options[winner];
      if (chosen) this.emit({ type: "poll", commandFile: chosen.commandFile || chosen,
        count: Number(chosen.repeat || 1), sender: "コメント投票", label: `!${winner}` });
      this.poll = null;
    }, Math.max(5000, Number(poll.durationMs || 30000)));
  }

  topGifter() {
    return [...this.topGifters.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }
}

module.exports = { FeatureEngine, parseWeightedList, chooseWeighted };
