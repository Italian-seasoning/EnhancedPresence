const endpoint = 'https://itunes.apple.com/search';
const maxResponseBytes = 128 * 1024;
const maxArtistBytes = 256 * 1024;
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
    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (!authority || !/^is\d+-ssl\.mzstatic\.com$/i.test(authority)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && /^is\d+-ssl\.mzstatic\.com$/.test(url.hostname)
      && !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith('/')
      ? url.href : null;
  } catch { return null; }
}

function artistPageURL(value, artistId) {
  if (!Number.isSafeInteger(artistId) || artistId <= 0 || typeof value !== 'string' || value.length > 2048) return null;
  try {
    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (authority !== 'music.apple.com') return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'music.apple.com' || url.username || url.password || url.port || url.hash) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 4 || !/^[a-z]{2}(?:-[a-z]{2})?$/.test(parts[0]) || parts[1] !== 'artist'
      || !/^[a-z0-9-]+$/i.test(parts[2]) || parts[3] !== String(artistId)) return null;
    url.search = '';
    return url.href;
  } catch { return null; }
}

async function responseBytes(response, limit, request) {
  const length = response.headers?.get?.('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    void Promise.resolve(response.body?.cancel?.()).catch(() => {});
    return null;
  }
  const reader = response.body?.getReader?.();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const result = await Promise.race([reader.read(), request.expired.then(() => null)]);
      if (!result) { void reader.cancel().catch(() => {}); return null; }
      const { done, value } = result;
      if (done) break;
      size += value.byteLength;
      if (size > limit) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return Buffer.concat(chunks, size);
}

function htmlPortrait(bytes) {
  const html = bytes.toString('utf8');
  const start = /<head(?:\s|>)/i.exec(html);
  if (!start) return null;
  let head = html.slice(start.index).split(/<\/head\s*>/i, 1)[0];
  head = head.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const tag of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.create(null);
    for (const match of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').replace(/&amp;/gi, '&');
    }
    if (attrs.property?.toLowerCase() === 'og:image' || attrs.name?.toLowerCase() === 'og:image') {
      const valid = artworkURL(attrs.content);
      if (valid) return valid;
    }
  }
  return null;
}

export function createMusicImagesLookup({ fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const tracks = new Map(), artists = new Map(), trackFlight = new Map(), artistFlight = new Map(), requestTimes = [];

  function remember(cache, key, value, at, short = false) {
    cache.delete(key);
    cache.set(key, { value, expiresAt: at + (value && !short ? positiveTTL : negativeTTL) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }

  function cached(cache, key, time) {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= time) { cache.delete(key); return undefined; }
    cache.delete(key); cache.set(key, entry);
    return entry.value;
  }

  async function fetchWithin(url, headers, deadline) {
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    while (requestTimes.length && now() - requestTimes[0] >= 60_000) requestTimes.shift();
    if (requestTimes.length >= maxRequestsPerMinute) return null;
    requestTimes.push(now());
    const controller = new AbortController();
    let timer, expire;
    const expired = new Promise(resolve => { expire = resolve; });
    const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); expire(); resolve(null); }, remaining); });
    const work = (async () => {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers, signal: controller.signal });
      if (!response?.ok || response.redirected) { try { await response?.body?.cancel?.(); } catch {} return null; }
      return { response, controller, timer, expired, close: () => clearTimeout(timer) };
    })();
    const result = await Promise.race([work.catch(() => null), timeout]);
    if (!result) clearTimeout(timer);
    return result;
  }

  async function artistLookup(id, page, deadline) {
    const hit = cached(artists, id, now());
    if (hit !== undefined) return hit;
    if (artistFlight.has(id)) return artistFlight.get(id);
    const promise = (async () => {
      try {
        const fetched = await fetchWithin(page, { accept: 'text/html' }, deadline);
        if (!fetched) return null;
        const { response } = fetched;
        if (!/^text\/html\b/i.test(response.headers?.get?.('content-type') ?? '')) { fetched.close(); return null; }
        const reader = response.body?.getReader?.();
        if (!reader) { fetched.close(); return null; }
        const chunks = [];
        let size = 0, found = null;
        try {
          while (size < maxArtistBytes) {
            const result = await Promise.race([reader.read(), fetched.expired.then(() => null)]);
            if (!result) { void reader.cancel().catch(() => {}); break; }
            const { done, value } = result;
            if (done) break;
            const take = value.subarray(0, Math.min(value.byteLength, maxArtistBytes - size));
            chunks.push(Buffer.from(take)); size += take.byteLength;
            found = htmlPortrait(Buffer.concat(chunks, size));
            if (found) { void reader.cancel().catch(() => {}); break; }
            if (take.byteLength < value.byteLength) { void reader.cancel().catch(() => {}); break; }
          }
          if (!found && size >= maxArtistBytes) void reader.cancel().catch(() => {});
        } finally { reader.releaseLock?.(); }
        fetched.close();
        remember(artists, id, found, now());
        return found;
      } catch { remember(artists, id, null, now()); return null; }
    })().finally(() => artistFlight.delete(id));
    artistFlight.set(id, promise);
    return promise;
  }

  async function query(input, deadline) {
    const url = new URL(endpoint);
    url.searchParams.set('term', `${input.title} ${input.artist} ${input.album}`);
    url.searchParams.set('media', 'music'); url.searchParams.set('entity', 'song'); url.searchParams.set('limit', '10');
    const fetched = await fetchWithin(url, { accept: 'application/json' }, deadline);
    if (!fetched) return null;
    const bytes = await responseBytes(fetched.response, maxResponseBytes, fetched);
    fetched.close();
    if (!bytes) return null;
    let body;
    try { body = JSON.parse(bytes.toString('utf8')); } catch { return null; }
    if (!Array.isArray(body?.results)) return null;
    const title = normalized(input.title), artist = normalized(input.artist), album = normalized(input.album);
    for (const result of body.results.slice(0, 10)) {
      if (normalized(result?.trackName ?? '') !== title || normalized(result?.artistName ?? '') !== artist
        || normalized(result?.collectionName ?? '') !== album) continue;
      const albumArtworkUrl = artworkURL(result.artworkUrl100 ?? result.artworkUrl60);
      if (!albumArtworkUrl) return null;
      const artistId = result.artistId;
      const page = artistPageURL(result.artistViewUrl, artistId);
      if (!page) return { albumArtworkUrl };
      const artistArtworkUrl = await artistLookup(artistId, page, deadline);
      return artistArtworkUrl ? { albumArtworkUrl, artistArtworkUrl } : { albumArtworkUrl };
    }
    return null;
  }

  return async input => {
    const request = validRequest(input);
    if (!request) return null;
    const key = ['title', 'artist', 'album'].map(field => normalized(request[field])).join('\u001f');
    const time = now();
    const hit = cached(tracks, key, time);
    if (hit !== undefined) return hit;
    if (trackFlight.has(key)) return trackFlight.get(key);
    const deadline = time + timeoutMs;
    const promise = query(request, deadline).then(value => {
      // A valid album with no artist portrait gets the short miss TTL so the
      // portrait can be retried without repeatedly querying on every heartbeat.
      const hasPortrait = value && typeof value.artistArtworkUrl === 'string';
      remember(tracks, key, value, now(), !hasPortrait);
      return value;
    }).catch(() => { remember(tracks, key, null, now()); return null; }).finally(() => trackFlight.delete(key));
    trackFlight.set(key, promise);
    return promise;
  };
}
