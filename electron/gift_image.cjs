const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function imageUrl(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch { throw new Error('URL is invalid'); }
  if (url.protocol !== 'https:') throw new Error('HTTPS image URL only');
  return url.href;
}

/** Use Electron net.fetch in production so images use the same OS trust as the UI. */
async function fetchGiftImage(url, fetchImage) {
  let current = imageUrl(url);
  const signal = AbortSignal.timeout(10000);
  let response;
  for (let hop = 0; hop <= 5; hop++) {
    response = await fetchImage(current, { signal, redirect: 'manual', credentials: 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new Error('Image redirect has no location');
    if (hop === 5) throw new Error('Too many image redirects');
    current = imageUrl(new URL(location, current).href);
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP Error: ${response.status}`); }
  const mime = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) { await response.body?.cancel(); throw new Error('Response is not an image'); }
  if (Number(response.headers.get('content-length') || 0) > MAX_IMAGE_BYTES) {
    await response.body?.cancel(); throw new Error('Image is too large (max 10MB)');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Image response body is empty');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image is too large (max 10MB)'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  if (!bytes) throw new Error('Image response body is empty');
  return `data:${mime};base64,${Buffer.concat(chunks, bytes).toString('base64')}`;
}

module.exports = { fetchGiftImage, MAX_IMAGE_BYTES };
