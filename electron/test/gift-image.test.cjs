const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchGiftImage, MAX_IMAGE_BYTES } = require('../gift_image.cjs');
const png = () => new Response(Uint8Array.of(137, 80, 78, 71), { headers: { 'content-type': 'image/png; charset=binary' } });

test('gift images: returns data URL even when Electron response.url is empty', async () => {
  let init;
  const result = await fetchGiftImage('https://example.com/a.png', async (_url, options) => { init = options; return png(); });
  assert.equal(result, 'data:image/png;base64,iVBORw==');
  assert.equal(init.redirect, 'manual');
  assert.equal(init.credentials, 'omit');
  assert(init.signal instanceof AbortSignal);
});
test('gift images: resolves HTTPS redirects and rejects downgrade before fetching', async () => {
  const calls = [];
  const fetcher = async url => { calls.push(url); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/b.png' } }) : png(); };
  await fetchGiftImage('https://example.com/a.png', fetcher);
  assert.deepEqual(calls, ['https://example.com/a.png', 'https://example.com/b.png']);
  let count = 0;
  await assert.rejects(fetchGiftImage('https://example.com/a.png', async () => { count++; return new Response(null, { status: 302, headers: { location: 'http://example.com/b.png' } }); }), /HTTPS/);
  assert.equal(count, 1);
  await assert.rejects(fetchGiftImage('file:///secret', fetcher), /HTTPS/);
});
test('gift images: rejects missing and looping redirects', async () => {
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => new Response(null, { status: 302 })), /no location/);
  let count = 0;
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => { count++; return new Response(null, { status: 302, headers: { location: '/a' } }); }), /Too many/);
  assert.equal(count, 6);
});
test('gift images: rejects error, non-image and empty responses', async () => {
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => new Response('missing', { status: 404 })), /HTTP Error: 404/);
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => new Response('<html>')), /not an image/);
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => new Response('', { headers: { 'content-type': 'image/png' } })), /empty/);
});
test('gift images: enforces both declared and streamed size limits', async () => {
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => new Response('x', { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } })), /too large/);
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => new Response(new Uint8Array(MAX_IMAGE_BYTES + 1), { headers: { 'content-type': 'image/png' } })), /too large/);
});
test('gift images: propagates network failure for the editor retry UI', async () => {
  await assert.rejects(fetchGiftImage('https://example.com/a', async () => { throw new Error('offline'); }), /offline/);
});
