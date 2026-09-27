function connectionOptions(env = process.env) {
  const key = String(env.SIGN_API_KEY || '').trim();
  return { processInitialData: false, ...(key ? { signApiKey: key } : {}) };
}

function redactSecrets(value, key = process.env.SIGN_API_KEY) {
  let text = String(value ?? '');
  if (key) {
    for (const variant of new Set([key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)])) {
      text = text.split(variant).join('[APIキー非表示]');
    }
  }
  return text.replace(/((?:x-api-key|signApiKey|SIGN_API_KEY|apiKey|api_key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1[APIキー非表示]');
}

function retryDelay(error, failureCount) {
  const message = String(error?.message || error);
  const normal = /isn't online|not online|offline/i.test(message) ? 30000 : Math.min(60000, 5000 * 2 ** Math.min(Math.max(0, failureCount - 1), 4));
  // Connector 2.5 preserves Euler's response headers; honor a longer server wait.
  const milliseconds = Number(error?.retryAfter ?? error?.cause?.retryAfter);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.min(2147483647, Math.max(normal, milliseconds)) : normal;
}
module.exports = { connectionOptions, redactSecrets, retryDelay };
