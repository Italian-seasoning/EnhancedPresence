const endpoint = 'https://itunes.apple.com/search';
const maxResponseBytes = 128 * 1024;
const maxRequestsPerMinute = 10;
const maxEntries = 64;
const positiveTTL = 60 * 60 * 1000;
const negativeTTL = 60 * 1000;
const timeoutMs = 2000;
const control = /[\u0000-\u001f\u007f-\u009f]/;

function validRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const keys = Object.keys(input).sort();
  if (keys.join(',') !== 'album,appId,artist,title' || input.appId !== 'com.apple.Music') return;
  for (const key of ['title', 'artist', 'album']) {
    const value = input[key];
    if (typeof value !== 'string' || value.length < 1 || value.length > 128 || control.test(value) || !value.trim()) return;
  }
  return { appId: input.appId, title: input.title, artist: input.artist, album: input.album };
}

function normalized(value) { return value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim(); }

function artworkURL(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^is\d+-ssl\.mzstatic\.com$/.test(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith('/')
      ? url.href : null;
  } catch { return null; }
}

async function responseBytes(response) {
  const length = response.headers?.get?.('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxResponseBytes) {
    try { await response.body?.cancel?.(); } catch {}
    return null;
  }
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) { await reader.cancel(); return null; }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return Buffer.concat(chunks, size);
}

export function createMusicArtworkLookup({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(), inFlight = new Map(), requestTimes = [];

  function remember(key, value, at) {
    cache.delete(key);
    cache.set(key, { value, expiresAt: at + (value ? positiveTTL : negativeTTL) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  async function query(input) {
    const url = new URL(endpoint);
    url.searchParams.set('term', `${input.title} ${input.artist} ${input.album}`);
    url.searchParams.set('media', 'music');
    url.searchParams.set('entity', 'song');
    url.searchParams.set('limit', '10');
    const controller = new AbortController();
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, timeoutMs); });
    const fetchResult = (async () => {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal });
      if (!response?.ok) { try { await response?.body?.cancel?.(); } catch {} return null; }
      const bytes = await responseBytes(response);
      if (!bytes) return null;
      const body = JSON.parse(bytes.toString('utf8'));
      if (!Array.isArray(body?.results)) return null;
      const title = normalized(input.title), artist = normalized(input.artist), album = normalized(input.album);
      for (const result of body.results.slice(0, 10)) {
        if (normalized(result?.trackName ?? '') !== title
          || normalized(result?.artistName ?? '') !== artist
          || normalized(result?.collectionName ?? '') !== album) continue;
        const art = artworkURL(result.artworkUrl100 ?? result.artworkUrl60);
        if (art) return art;
      }
      return null;
    })();
    try { return await Promise.race([fetchResult.catch(() => null), timeout]); }
    finally { clearTimeout(timer); }
  }

  return async input => {
    const request = validRequest(input);
    if (!request) return null;
    const key = ['title', 'artist', 'album'].map(field => normalized(request[field])).join('\u001f');
    const time = now();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > time) {
      cache.delete(key); cache.set(key, cached);
      return cached.value;
    }
    if (cached) cache.delete(key);
    if (inFlight.has(key)) return inFlight.get(key);
    while (requestTimes.length && time - requestTimes[0] >= 60_000) requestTimes.shift();
    if (requestTimes.length >= maxRequestsPerMinute) return null;
    requestTimes.push(time);
    const promise = query(request).then(value => {
      remember(key, value, now());
      return value;
    }).catch(() => {
      remember(key, null, now());
      return null;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}
