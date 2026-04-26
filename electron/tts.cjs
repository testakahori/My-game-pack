// VOICEVOX / AivisSpeech 共通APIラッパー
// どちらもVOICEVOX互換HTTPAPIなので同じコードで動く

const http = require('http');

const ENGINE_PORTS = {
  voicevox: 50021,
  aivis: 10101
};

// Node http モジュールでGETリクエスト
function httpGet(port, path, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Node http モジュールでPOSTリクエスト
function httpPost(port, path, body, contentType = 'application/json', timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const bodyBuf = typeof body === 'string' ? Buffer.from(body) : body;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': bodyBuf.length
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

async function checkEngine(engine) {
  const port = ENGINE_PORTS[engine];
  try {
    const res = await httpGet(port, '/version', 2000);
    return res.status === 200;
  } catch {
    return false;
  }
}

async function getSpeakers(engine) {
  const port = ENGINE_PORTS[engine];
  const res = await httpGet(port, '/speakers', 5000);
  if (res.status !== 200) throw new Error('スピーカー一覧の取得に失敗しました');
  return JSON.parse(res.body);
}

// speakers APIのレスポンスをフラットなリストに変換
// [{ label: "四国めたん（ノーマル）", id: 2 }, ...]
function flattenSpeakers(speakers) {
  const list = [];
  for (const speaker of speakers) {
    for (const style of speaker.styles) {
      list.push({
        label: `${speaker.name}（${style.name}）`,
        id: style.id
      });
    }
  }
  return list;
}

async function synthesize(engine, text, speakerId, speedScale = 1.0, pitchScale = 0.0, intonationScale = 1.0) {
  const port = ENGINE_PORTS[engine];

  // Step 1: audio_query
  const queryRes = await httpPost(
    port,
    `/audio_query?speaker=${speakerId}&text=${encodeURIComponent(text)}`,
    '',
    'application/json',
    10000
  );
  if (queryRes.status !== 200) throw new Error(`audio_query失敗: ${queryRes.status}`);

  const query = JSON.parse(queryRes.body.toString());
  query.speedScale = speedScale;
  query.pitchScale = pitchScale;
  query.intonationScale = intonationScale;

  // Step 2: synthesis
  const synthRes = await httpPost(
    port,
    `/synthesis?speaker=${speakerId}`,
    JSON.stringify(query),
    'application/json',
    15000
  );
  if (synthRes.status !== 200) throw new Error(`synthesis失敗: ${synthRes.status}`);

  return synthRes.body; // すでにBuffer
}

module.exports = { checkEngine, getSpeakers, flattenSpeakers, synthesize };
