const { createMediaReporter } = require('./media_events.cjs');

function createMediaLive({ Connection, username, reporter, status, mutedUsers = [], now = Date.now, retryMs = 30000 }) {
  if (!/^[a-zA-Z0-9_.]{1,64}$/.test(username)) throw new Error('TikTokのユーザー名を確認してください。');
  const connection = new Connection(username, { enableExtendedGiftInfo: true, processInitialData: false });
  let stopped = false, connecting = false, connectedAt = null, retry = null;
  const seen = new Map();
  const muted = new Set(mutedUsers.map(value => String(value).trim().toLowerCase()));
  const current = data => !stopped && connectedAt !== null && (!Number(data.createTime) || Number(data.createTime) >= Math.floor(connectedAt / 1000)) && ![data.userId, data.uniqueId, data.nickname].some(value => value && muted.has(String(value).toLowerCase()));
  function schedule() { if (!stopped && !retry) retry = setTimeout(() => { retry = null; void connect(); }, retryMs); }
  async function connect() {
    if (stopped || connecting) return;
    connecting = true; status('connecting');
    try {
      await connection.connect();
      if (stopped) { connection.disconnect(); return; }
      connectedAt = now(); reporter.reset(); seen.clear(); status('connected');
    } catch { if (!stopped) { connectedAt = null; status('retrying'); schedule(); } }
    finally { connecting = false; }
  }
  connection.on('gift', data => {
    if (!current(data)) return;
    const sender = String(data.userId || data.uniqueId || data.nickname || 'viewer');
    const message = data.msgId || data.messageId || data.eventId;
    if (message) {
      const key = String(message) + ':' + Number(data.repeatCount || 1);
      if (seen.has(key)) return;
      seen.set(key, now()); if (seen.size > 2000) seen.delete(seen.keys().next().value);
    }
    reporter.gift(data, sender);
  });
  connection.on('like', data => { if (current(data)) reporter.like(data); });
  connection.on('disconnected', () => { connectedAt = null; if (!stopped) { status('retrying'); schedule(); } });
  connection.on('error', () => { if (!stopped) status('retrying'); });
  connection.on('streamEnd', () => { connectedAt = null; if (!stopped) { status('retrying'); schedule(); } });
  return { start: connect, stop: () => { stopped = true; connectedAt = null; if (retry) clearTimeout(retry); try { connection.disconnect(); } catch {} status('stopped'); } };
}
if (require.main === module) {
  const { TikTokLiveConnection } = require('tiktok-live-connector');
  const username = process.argv[2];
  let mutedUsers = []; try { const parsed = JSON.parse(process.env.MYGAMEPACK_MEDIA_MUTED_USERS || '[]'); if (Array.isArray(parsed)) mutedUsers = parsed; } catch {}
  const live = createMediaLive({ Connection: TikTokLiveConnection, username, reporter: createMediaReporter(), mutedUsers, status: state => console.log('[MEDIA-CONNECTION]' + JSON.stringify({ state })) });
  void live.start();
  process.on('SIGINT', () => { live.stop(); process.exit(0); });
  process.on('SIGTERM', () => { live.stop(); process.exit(0); });
}
module.exports = { createMediaLive };
