const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { atomicWrite } = require('./settings_backups.cjs');

const FORMATS = {
  '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'],
  '.mp3': ['audio', 'audio/mpeg'], '.wav': ['audio', 'audio/wav'], '.ogg': ['audio', 'audio/ogg'], '.m4a': ['audio', 'audio/mp4'],
  '.mp4': ['video', 'video/mp4'], '.webm': ['video', 'video/webm'],
};
const clone = value => JSON.parse(JSON.stringify(value));
const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const defaults = () => ({ version: 1, activeProfile: 'chat', assets: [], profiles: [
  { id: 'chat', name: '雑談', volume: 35, rules: [] },
  { id: 'minecraft', name: 'マイクラ', volume: 45, rules: [] },
  { id: 'sing', name: '歌', volume: 20, rules: [] },
] });

function validateSettings(input) {
  const fail = () => { throw new Error('演出設定の値が不正です。入力を確認してください。'); };
  if (!input || JSON.stringify(input).length > 2000000 || input.version !== 1 || !Array.isArray(input.assets) || input.assets.length > 300 || !Array.isArray(input.profiles) || input.profiles.length !== 3) fail();
  const ids = new Set();
  for (const a of input.assets) {
    if (!a || !/^[a-f0-9-]{36}$/.test(a.id) || ids.has(a.id) || !Object.hasOwn(FORMATS, a.ext) || FORMATS[a.ext][0] !== a.kind || typeof a.name !== 'string' || a.name.length > 160 || !number(a.size, 1, 300 * 1024 * 1024)) fail();
    ids.add(a.id);
  }
  const profileIds = new Set();
  for (const p of input.profiles) {
    if (!p || !['chat', 'minecraft', 'sing'].includes(p.id) || profileIds.has(p.id) || !number(p.volume, 0, 100) || !Array.isArray(p.rules) || p.rules.length > 100) fail();
    profileIds.add(p.id);
    const rules = new Set();
    for (const r of p.rules) {
      if (!r || typeof r.id !== 'string' || !/^[\w-]{1,80}$/.test(r.id) || rules.has(r.id) || typeof r.name !== 'string' || r.name.length < 1 || r.name.length > 80 || typeof r.enabled !== 'boolean') fail();
      rules.add(r.id);
      if (!['likes', 'gift', 'coins'].includes(r.trigger) || !number(r.threshold, 1, 10000000) || !Number.isInteger(r.threshold) || !['unit', 'streak'].includes(r.coinMode) || !/^\d{0,20}$/.test(r.giftId) || (r.trigger === 'gift' && !r.giftId)) fail();
      if (!number(r.x, 0, 100) || !number(r.y, 0, 100) || !number(r.width, 5, 100) || !number(r.volume, 0, 100) || !number(r.duration, 1, 600) || !number(r.cooldown, 0, 600)) fail();
      if (!r.visualId && !r.audioId) fail();
      if (r.visualId && !input.assets.some(a => a.id === r.visualId && a.kind !== 'audio')) fail();
      if (r.audioId && !input.assets.some(a => a.id === r.audioId && a.kind === 'audio')) fail();
    }
  }
  if (!profileIds.has(input.activeProfile)) fail();
  return clone(input);
}

function createMediaEffects({ directory, port = 19639, now = Date.now }) {
  fs.mkdirSync(path.join(directory, 'assets'), { recursive: true });
  const settingsFile = path.join(directory, 'settings.json');
  const secretFile = path.join(directory, 'token');
  let settings = defaults(), loadError = '';
  try { settings = validateSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') loadError = '演出設定を読み込めません。元のファイルを保護しています。運用センターから診断してください。'; }
  let token;
  try { token = fs.readFileSync(secretFile, 'utf8').trim(); } catch {}
  if (!/^[a-f0-9]{64}$/.test(token || '')) { token = crypto.randomBytes(32).toString('hex'); atomicWrite(secretFile, token); }
  let revision = 0, undo = [], paused = false, muted = false, pausedAt = 0, server = null, starting = null, serverError = '';
  let likes = null, lastEvent = null, outputError = '', calibrationAt = null, checks = { visual: null, audio: null };
  const clients = new Set(), seen = new Map(), cooldowns = new Map();
  const channels = { live: { current: null, queue: [] }, preview: { current: null, queue: [] } };
  const profile = () => settings.profiles.find(p => p.id === settings.activeProfile);
  const assetPath = a => path.join(directory, 'assets', a.id + a.ext);
  function snapshot(channel) { return { current: channels[channel].current, paused, muted, now: paused ? pausedAt : now() }; }
  function publish() { for (const c of clients) { if (!c.res.destroyed) c.res.write('data: ' + JSON.stringify(snapshot(c.channel)) + '\n\n'); } }
  function stop(channel) { for (const [name, state] of Object.entries(channels)) if (!channel || channel === name) { state.current = null; state.queue = []; } publish(); }
  function save(next, expectedRevision) {
    if (loadError) throw new Error(loadError);
    if (expectedRevision !== revision) throw new Error('設定が更新されました。画面を開き直してから保存してください。');
    next = validateSettings(next);
    // Renderer may edit rules, but it may not invent filesystem assets.
    for (const a of next.assets) if (!settings.assets.some(old => JSON.stringify(old) === JSON.stringify(a))) throw new Error('登録済みの素材だけ使用できます。');
    atomicWrite(settingsFile, JSON.stringify(next, null, 2));
    undo.push(clone(settings)); undo = undo.slice(-20); settings = next; revision++;
    checks = { visual: null, audio: null }; calibrationAt = null; likes = null; cooldowns.clear(); stop();
    return state();
  }
  function state() { return { settings: clone(settings), revision, canUndo: undo.length > 0, paused, muted,
    liveClients: [...clients].filter(c => c.channel === 'live').length,
    previewClients: [...clients].filter(c => c.channel === 'preview').length,
    playing: channels.live.current?.name || '', previewPlaying: channels.preview.current?.name || '', queued: channels.live.queue.length,
    lastEvent, error: loadError || serverError || outputError, checks: clone(checks), calibrated: calibrationAt !== null && now() - calibrationAt < 900000, ready: Boolean(server?.listening),
  }; }
  function control(action) {
    if (action === 'stop') stop();
    else if (action === 'mute') { muted = true; publish(); }
    else if (action === 'unmute') { muted = false; publish(); }
    else if (action === 'pause') { if (!paused) { paused = true; pausedAt = now(); publish(); } }
    else if (action === 'resume') { if (paused) { const elapsed = now() - pausedAt; paused = false; for (const s of Object.values(channels)) { if (s.current) { s.current.startedAt += elapsed; s.current.endsAt += elapsed; } for (const j of s.queue) j.expiresAt += elapsed; } publish(); } }
    else if (action === 'undo') {
      if (loadError) throw new Error(loadError);
      if (undo.length) { const previous = undo.at(-1); atomicWrite(settingsFile, JSON.stringify(previous, null, 2)); settings = undo.pop(); revision++; likes = null; cooldowns.clear(); checks = { visual: null, audio: null }; calibrationAt = null; stop(); }
    } else throw new Error('不明な演出操作です。');
    return state();
  }
  function enqueue(rule, channel) {
    if (paused) throw new Error('演出は一時停止中です。上の「演出を再開」を押してください。');
    const s = channels[channel];
    if (s.queue.length >= 20) return false;
    const assets = [rule.visualId, rule.audioId].filter(Boolean).map(id => settings.assets.find(a => a.id === id));
    for (const a of assets) if (!a || !fs.existsSync(assetPath(a))) throw new Error('素材ファイルがありません。再登録してください。');
    s.queue.push({ id: crypto.randomUUID(), name: rule.name, assets, x: rule.x, y: rule.y, width: rule.width,
      volume: rule.volume * profile().volume / 10000, duration: rule.duration, calibration: Boolean(rule.calibration), expiresAt: now() + 30000 });
    tick(); return true;
  }
  function tick() {
    if (paused) return;
    let changed = false;
    for (const s of Object.values(channels)) {
      if (s.current && now() >= s.current.endsAt) { s.current = null; changed = true; }
      if (!s.current) {
        while (s.queue.length && s.queue[0].expiresAt < now()) s.queue.shift();
        if (s.queue.length) { s.current = { ...s.queue.shift(), startedAt: now() }; s.current.endsAt = now() + s.current.duration * 1000; changed = true; }
      }
    }
    if (changed) publish();
  }
  function match(event, previousLikes) {
    return profile().rules.filter(r => r.enabled && (
      event.type === 'like' ? r.trigger === 'likes' && previousLikes !== null && Math.floor(event.total / r.threshold) > Math.floor(previousLikes / r.threshold) :
      event.type === 'gift' && (r.trigger === 'gift' ? r.giftId === event.giftId && event.delta > 0 : r.trigger === 'coins' && (r.coinMode === 'unit' ? event.unitCoins >= r.threshold && event.delta > 0 : event.previousCoins < r.threshold && event.totalCoins >= r.threshold))
    ));
  }
  function validateEvent(e) {
    if (!e || !['like', 'gift', 'reset'].includes(e.type)) throw new Error('イベント種別が不正です。');
    if (e.type === 'like' && !number(e.total, 0, 1e12)) throw new Error('いいね数が不正です。');
    if (e.type === 'gift' && (!/^\d{1,20}$/.test(e.giftId) || !number(e.delta, 0, 1e6) || !number(e.unitCoins, 0, 1e9) || !number(e.totalCoins, 0, 1e12) || !number(e.previousCoins, 0, e.totalCoins))) throw new Error('ギフト値が不正です。');
  }
  function receive(event) {
    validateEvent(event);
    if (typeof event.id !== 'string' || event.id.length > 100 || !event.id) throw new Error('イベントIDがありません。');
    if (seen.has(event.id)) return { matched: [], duplicate: true };
    seen.set(event.id, now()); if (seen.size > 2000) seen.delete(seen.keys().next().value);
    if (event.type === 'reset') { likes = null; cooldowns.clear(); return { matched: [] }; }
    const previous = likes;
    if (event.type === 'like') likes = event.total;
    lastEvent = { type: event.type, at: new Date(now()).toISOString() };
    if (paused) return { matched: [], paused: true };
    const matched = [];
    for (const rule of match(event, previous)) {
      if (cooldowns.has(rule.id) && now() - cooldowns.get(rule.id) < rule.cooldown * 1000) continue;
      try { if (enqueue(rule, 'live')) { cooldowns.set(rule.id, now()); matched.push(rule.name); } }
      catch (error) { outputError = error.message; }
    }
    return { matched };
  }
  function testEvent(event) {
    validateEvent(event);
    const previous = event.type === 'like' ? event.previousLikes : null;
    if (event.type === 'like' && !number(previous, 0, event.total)) throw new Error('開始時のいいね数が不正です。');
    const matched = match(event, previous);
    stop('preview');
    for (const rule of matched) enqueue(rule, 'preview');
    return { matched: matched.map(r => r.name) };
  }
  async function importFiles(files) {
    if (loadError) throw new Error(loadError);
    if (!Array.isArray(files) || files.length > 30 || settings.assets.length + files.length > 300) throw new Error('素材は一度に30件、合計300件まで登録できます。');
    const added = [];
    try {
      let storage = fs.readdirSync(path.join(directory, 'assets')).reduce((sum, name) => sum + fs.statSync(path.join(directory, 'assets', name)).size, 0);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase(), format = FORMATS[ext], stat = await fs.promises.stat(file);
        if (!Object.hasOwn(FORMATS, ext) || !format || !stat.isFile() || !number(stat.size, 1, 300 * 1024 * 1024)) throw new Error('対応する画像・音声・動画（1ファイル300MB以内）を選んでください。');
        storage += stat.size; if (storage > 2 * 1024 ** 3) throw new Error('演出素材の保存容量が2GBを超えます。');
        const a = { id: crypto.randomUUID(), name: path.basename(file).slice(0, 160), ext, kind: format[0], size: stat.size };
        added.push(a); await fs.promises.copyFile(file, assetPath(a), fs.constants.COPYFILE_EXCL);
      }
      if (added.length) {
        const next = { ...settings, assets: [...settings.assets, ...added] };
        validateSettings(next); atomicWrite(settingsFile, JSON.stringify(next, null, 2));
        undo.push(clone(settings)); undo = undo.slice(-20); settings = next; revision++;
      }
      return state();
    } catch (error) { for (const a of added) { try { fs.unlinkSync(assetPath(a)); } catch {} } throw error; }
  }
  function testRule(id) { const rule = profile().rules.find(r => r.id === id); if (!rule) throw new Error('演出が見つかりません。'); stop('preview'); enqueue(rule, 'preview'); return state(); }
  function testAsset(id) { const a = settings.assets.find(a => a.id === id); if (!a) throw new Error('素材が見つかりません。'); stop('preview'); enqueue({ name: a.name, visualId: a.kind !== 'audio' ? id : '', audioId: a.kind === 'audio' ? id : '', x: 50, y: 50, width: 55, volume: 100, duration: 10 }, 'preview'); return state(); }
  function calibration() { stop('preview'); enqueue({ name: '映像・音声の試験', x: 50, y: 50, width: 60, volume: 50, duration: 6, calibration: true }, 'preview'); calibrationAt = now(); return state(); }
  function confirm(kind) {
    if (!['visual', 'audio'].includes(kind)) throw new Error('確認種別が不正です。');
    if (![...clients].some(c => c.channel === 'preview') || calibrationAt === null || now() - calibrationAt > 900000) throw new Error('先に「映像・音声を試験」を実行してください。');
    if (paused || (kind === 'audio' && muted)) throw new Error('一時停止・音声停止を解除してから試験してください。');
    checks[kind] = { at: new Date(now()).toISOString(), profile: profile().name }; return state();
  }
  function preflight() {
    const s = state(), enabled = profile().rules.filter(r => r.enabled).length;
    return { id: 'media-effects', title: '演出の映像・音声', page: 'effects', status: s.error ? 'error' : !enabled ? 'skip' : s.liveClients && !paused && !muted && checks.visual && checks.audio ? 'ok' : 'warn',
      detail: s.error || (!enabled ? '有効な演出はありません。演出画面から素材を登録できます。' : `${profile().name}・${enabled}件。OBS出力${s.liveClients}接続。映像${checks.visual ? '確認済み' : '未確認'}／音声${checks.audio ? '確認済み' : '未確認'}${paused ? '・一時停止中' : ''}${muted ? '・音声停止中' : ''}。録画・配信前にOBS側でも確認してください。`) };
  }
  const url = (channel = 'live') => { if (!server?.listening) throw new Error(serverError || '演出出力を準備中です。'); return `http://127.0.0.1:${server.address().port}/overlay?token=${token}&channel=${channel}`; };
  async function body(req) { const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 8192) throw new Error('リクエストが大きすぎます。'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  async function handle(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    const u = new URL(req.url, 'http://127.0.0.1'), expectedHost = `127.0.0.1:${server.address().port}`;
    if (req.headers.host !== expectedHost || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) { res.writeHead(403).end(); return; }
    const supplied = req.headers.authorization?.replace(/^Bearer /, '') || u.searchParams.get('token');
    if (supplied !== token) { res.writeHead(403).end(); return; }
    if (req.method === 'POST' && u.pathname === '/event') {
      const result = receive(await body(req)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    if (req.method === 'POST' && u.pathname === '/feedback') {
      const data = await body(req);
      if (data.error) { outputError = String(data.error).slice(0, 180); checks = { visual: null, audio: null }; }
      else if (data.ok) outputError = '';
      if (data.finished && ['live', 'preview'].includes(data.channel)) {
        const current = channels[data.channel].current;
        if (current && current.id === data.jobId) { channels[data.channel].current = null; publish(); tick(); }
      }
      res.end('{}'); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    if (u.pathname === '/events') {
      const channel = u.searchParams.get('channel') === 'preview' ? 'preview' : 'live';
      if (clients.size >= 8) { res.writeHead(429).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
      const client = { channel, res }; clients.add(client); res.write('data: ' + JSON.stringify(snapshot(channel)) + '\n\n');
      req.on('close', () => { clients.delete(client); }); return;
    }
    const pages = { '/overlay': ['overlay.html', 'text/html; charset=utf-8'], '/overlay.js': ['overlay.js', 'text/javascript; charset=utf-8'], '/overlay.css': ['overlay.css', 'text/css; charset=utf-8'] };
    if (pages[u.pathname]) {
      const [file, mime] = pages[u.pathname];
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
      const raw = fs.readFileSync(path.join(__dirname, 'media', file), 'utf8').replaceAll('__TOKEN__', token);
      res.end(req.method === 'HEAD' ? undefined : raw); return;
    }
    const id = u.pathname.match(/^\/media\/([a-f0-9-]{36})$/)?.[1], a = settings.assets.find(a => a.id === id);
    if (!a) { res.writeHead(404).end(); return; }
    const file = assetPath(a), size = fs.statSync(file).size;
    res.setHeader('Content-Type', FORMATS[a.ext][1]); res.setHeader('Accept-Ranges', 'bytes');
    let start = 0, end = size - 1;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      if (!range[1]) start = Math.max(0, size - Number(range[2]));
      else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      if (start > end || start >= size || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
      res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Length', end - start + 1);
    if (req.method === 'HEAD') res.end();
    else { const stream = fs.createReadStream(file, { start, end }); stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); }
  }
  async function start() {
    if (server?.listening) return;
    if (starting) return starting;
    starting = new Promise((resolve, reject) => {
      server = http.createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(400); res.end(); }); });
      server.requestTimeout = 5000; server.headersTimeout = 5000;
      server.once('error', error => { serverError = error.code === 'EADDRINUSE' ? '演出出力のポート19639が使用中です。他のMyGamePackを終了して再試行してください。' : '演出出力を開始できませんでした。'; reject(new Error(serverError)); });
      server.listen(port, '127.0.0.1', () => { serverError = ''; resolve(); });
    }).finally(() => { starting = null; });
    return starting;
  }
  const timer = setInterval(tick, 100); timer.unref();
  const heartbeat = setInterval(() => { for (const c of clients) c.res.write(': heartbeat\n\n'); }, 10000); heartbeat.unref();
  function close() { clearInterval(timer); clearInterval(heartbeat); stop(); for (const c of clients) c.res.end(); clients.clear(); server?.close(); }
  return { state, save, control, importFiles, testRule, testAsset, testEvent, calibration, confirm, preflight, receive, tick, snapshot, start, close, url, closePreview: () => stop('preview'),
    bridgeEnv: () => ({ MYGAMEPACK_MEDIA_URL: new URL('/event', url()).href, MYGAMEPACK_MEDIA_TOKEN: token }) };
}
module.exports = { createMediaEffects, validateSettings, defaults, FORMATS };
