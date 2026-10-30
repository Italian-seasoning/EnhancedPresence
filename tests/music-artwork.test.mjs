import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicImagesLookup } from '../vencord-plugin/EnhancedPresenceUniversal/music-artwork.mjs';

const request = { appId: 'com.apple.Music', title: 'Ｆｏｏ　　Bar', artist: ' ARTIST ', album: 'Ｃａｓｅ Album' };
const albumArtworkUrl = 'https://is1-ssl.mzstatic.com/image/thumb/album/100x100bb.jpg';
const artistArtworkUrl = 'https://is2-ssl.mzstatic.com/image/thumb/artist/500x500bb.jpg';
const artistViewUrl = 'https://music.apple.com/us/artist/example-artist/12345?uo=4';
const result = (update = {}) => ({ trackName: 'foo Bar', artistName: 'artist', collectionName: 'case album',
  artworkUrl100: albumArtworkUrl, artistId: 12345, artistViewUrl, ...update });
const withoutArtist = (update = {}) => result({ artistId: undefined, artistViewUrl: undefined, ...update });
const catalog = (results = [result()]) => new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 });
const artistPage = (url = artistArtworkUrl) => new Response(`<html><head><meta content="${url}" property="og:image"></head><body>ignored</body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });

test('uses fixed Apple endpoints and exact normalized track identity for album and artist images', async () => {
  const calls = [];
  const lookup = createMusicImagesLookup({ fetchImpl: async (url, options) => {
    const parsed = new URL(url); calls.push({ parsed, options });
    if (parsed.hostname === 'itunes.apple.com') {
      assert.equal(parsed.pathname, '/search');
      assert.equal(parsed.searchParams.get('media'), 'music');
      assert.equal(parsed.searchParams.get('entity'), 'song');
      assert.equal(parsed.searchParams.get('limit'), '10');
      assert.equal(options.redirect, 'error');
      return catalog([result({ collectionName: 'Other Album' }), result({ artistName: 'Other Artist' }), result()]);
    }
    assert.equal(parsed.href, 'https://music.apple.com/us/artist/example-artist/12345');
    return artistPage();
  } });
  assert.deepEqual(await lookup(request), { albumArtworkUrl, artistArtworkUrl });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.signal instanceof AbortSignal));
});

test('rejects non-Apple requests, extra fields and invalid metadata without fetching', async () => {
  let calls = 0;
  const lookup = createMusicImagesLookup({ fetchImpl: async () => { calls++; return catalog(); } });
  for (const invalid of [
    { ...request, appId: 'com.google.Chrome' }, { ...request, extra: 'private' },
    { ...request, title: '' }, { ...request, artist: 'x'.repeat(129) },
    { ...request, album: 'bad\u0085value' }
  ]) assert.equal(await lookup(invalid), null);
  assert.equal(await lookup(null), null);
  assert.equal(calls, 0);
});

test('does not match a near song or accept non-Apple album artwork', async () => {
  const rows = [
    withoutArtist({ collectionName: 'another album' }),
    withoutArtist({ artworkUrl100: 'https://example.com/album.jpg' }),
    withoutArtist({ artworkUrl100: 'http://is1-ssl.mzstatic.com/album.jpg' }),
    withoutArtist({ artworkUrl100: 'https://is1-ssl.mzstatic.com:443/album.jpg' })
  ];
  let index = 0;
  const lookup = createMusicImagesLookup({ fetchImpl: async () => catalog([rows[index++]]) });
  assert.equal(await lookup({ ...request, album: 'different' }), null);
  assert.equal(await lookup({ ...request, title: 'different title' }), null);
  assert.equal(await lookup({ ...request, artist: 'different artist' }), null);
  assert.equal(await lookup({ ...request, title: 'fourth title' }), null);
});

test('fetches an artist page only for a positive safe artist ID and matching canonical path', async () => {
  for (const update of [
    { artistId: 0 }, { artistId: Number.MAX_SAFE_INTEGER + 1 },
    { artistViewUrl: 'https://evil.example/us/artist/example/12345' },
    { artistViewUrl: 'https://user@music.apple.com/us/artist/example/12345' },
    { artistViewUrl: 'https://music.apple.com:443/us/artist/example/12345' },
    { artistViewUrl: 'https://music.apple.com/us/artist/example/54321' },
    { artistViewUrl: 'https://music.apple.com/us/artist/example/12345#fragment' }
  ]) {
    let artistCalls = 0;
    const lookup = createMusicImagesLookup({ fetchImpl: async url => {
      if (new URL(url).hostname === 'itunes.apple.com') return catalog([result(update)]);
      artistCalls++; return artistPage();
    } });
    assert.deepEqual(await lookup(request), { albumArtworkUrl });
    assert.equal(artistCalls, 0);
  }
});

test('reads a bounded artist HTML prefix and cancels as soon as a valid portrait appears', async () => {
  let cancelled = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`<head><meta property='og:image' content='${artistArtworkUrl}'></head>`));
      controller.enqueue(new Uint8Array(256 * 1024));
    },
    cancel() { cancelled++; }
  });
  const lookup = createMusicImagesLookup({ fetchImpl: async url => new URL(url).hostname === 'itunes.apple.com'
    ? catalog() : new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.deepEqual(await lookup(request), { albumArtworkUrl, artistArtworkUrl });
  assert.equal(cancelled, 1);
});

test('keeps album art when the artist portrait is missing, invalid, redirected, or unavailable', async () => {
  const responses = [
    new Response('<head></head>', { status: 200 }),
    artistPage('https://example.com/portrait.jpg'),
    new Response('', { status: 302, headers: { location: 'https://evil.example/' } })
  ];
  for (const next of responses) {
    const lookup = createMusicImagesLookup({ fetchImpl: async url => new URL(url).hostname === 'itunes.apple.com' ? catalog() : next });
    assert.deepEqual(await lookup(request), { albumArtworkUrl });
  }
  const failed = createMusicImagesLookup({ fetchImpl: async url => {
    if (new URL(url).hostname === 'itunes.apple.com') return catalog();
    throw Error('network failure');
  } });
  assert.deepEqual(await failed(request), { albumArtworkUrl });
});

test('caches successes for an hour and misses for a minute', async () => {
  let now = 1000, calls = 0, hasResult = true;
  const lookup = createMusicImagesLookup({ now: () => now, fetchImpl: async url => {
    calls++;
    return new URL(url).hostname === 'itunes.apple.com' ? catalog(hasResult ? [result()] : []) : artistPage();
  } });
  assert.deepEqual(await lookup(request), { albumArtworkUrl, artistArtworkUrl });
  now += 3_599_999; assert.deepEqual(await lookup(request), { albumArtworkUrl, artistArtworkUrl }); assert.equal(calls, 2);
  now += 2; assert.deepEqual(await lookup(request), { albumArtworkUrl, artistArtworkUrl }); assert.equal(calls, 4);
  hasResult = false; now += 3_600_001; assert.equal(await lookup(request), null); assert.equal(calls, 5);
  assert.equal(await lookup(request), null); assert.equal(calls, 5);
  now += 60_001; assert.equal(await lookup(request), null); assert.equal(calls, 6);
});

test('retries the portrait after its one-minute miss window while keeping album art', async () => {
  let now = 1000, artistAvailable = false, calls = 0;
  const lookup = createMusicImagesLookup({ now: () => now, fetchImpl: async url => {
    calls++;
    if (new URL(url).hostname === 'itunes.apple.com') return catalog();
    return artistAvailable ? artistPage() : new Response('<head></head>', { status: 200, headers: { 'content-type': 'text/html' } });
  } });
  assert.deepEqual(await lookup(request), { albumArtworkUrl });
  now += 30_000; artistAvailable = true;
  assert.deepEqual(await lookup(request), { albumArtworkUrl }); assert.equal(calls, 2);
  now += 30_001;
  assert.deepEqual(await lookup(request), { albumArtworkUrl, artistArtworkUrl }); assert.equal(calls, 4);
});

test('deduplicates track and artist requests in flight', async () => {
  let catalogCalls = 0, artistCalls = 0, releaseArtist;
  const lookup = createMusicImagesLookup({ fetchImpl: async url => {
    if (new URL(url).hostname === 'itunes.apple.com') { catalogCalls++; return catalog(); }
    artistCalls++;
    return new Promise(resolve => { releaseArtist = () => resolve(artistPage()); });
  } });
  const first = lookup(request), sameTrack = lookup({ ...request });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(catalogCalls, 1); assert.equal(artistCalls, 1);
  releaseArtist();
  assert.deepEqual(await Promise.all([first, sameTrack]), [
    { albumArtworkUrl, artistArtworkUrl }, { albumArtworkUrl, artistArtworkUrl }
  ]);
});

test('deduplicates portrait downloads for different tracks by artist ID', async () => {
  let artistCalls = 0, releaseArtist;
  const lookup = createMusicImagesLookup({ fetchImpl: async url => {
    if (new URL(url).hostname === 'itunes.apple.com') {
      const title = new URL(url).searchParams.get('term').split(' ')[0];
      return catalog([result({ trackName: title })]);
    }
    artistCalls++;
    return new Promise(resolve => { releaseArtist = () => resolve(artistPage()); });
  } });
  const first = lookup(request), second = lookup({ ...request, title: 'OtherSong' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(artistCalls, 1);
  releaseArtist();
  assert.deepEqual(await Promise.all([first, second]), [
    { albumArtworkUrl, artistArtworkUrl }, { albumArtworkUrl, artistArtworkUrl }
  ]);
});

test('caps track and artist caches at 64 entries and counts page fetches toward ten requests per minute', async () => {
  let now = 0, calls = 0;
  const lookup = createMusicImagesLookup({ now: () => now, fetchImpl: async url => {
    calls++;
    if (new URL(url).hostname === 'itunes.apple.com') {
      const term = new URL(url).searchParams.get('term').split(' ');
      const number = Number(term[0].slice('Track'.length)) + 1;
      return catalog([result({ trackName: term[0], artistName: term[1], collectionName: term[2], artistId: number, artistViewUrl: `https://music.apple.com/us/artist/artist-${number}/${number}` })]);
    }
    return artistPage();
  } });
  for (let i = 0; i < 64; i++) {
    if (i && i % 5 === 0) now += 60_001;
    assert.deepEqual(await lookup({ ...request, title: `Track${i}`, artist: 'Artist', album: 'Album' }), { albumArtworkUrl, artistArtworkUrl });
  }
  now += 60_001;
  assert.deepEqual(await lookup({ ...request, title: 'Track64', artist: 'Artist', album: 'Album' }), { albumArtworkUrl, artistArtworkUrl });
  assert.equal(calls, 130);
  now += 60_001;
  await lookup({ ...request, title: 'Track0', artist: 'Artist', album: 'Album' });
  assert.equal(calls, 132);
});

test('limits all catalog and artist HTTP requests to ten per minute and caps bodies', async () => {
  let now = 0, calls = 0;
  const lookup = createMusicImagesLookup({ now: () => now, fetchImpl: async url => {
    calls++;
    if (new URL(url).hostname !== 'itunes.apple.com') return artistPage();
    const [title, artist, album] = new URL(url).searchParams.get('term').split(' ');
    const digits = title.replace(/\D/g, '');
    const artistId = digits ? Number(digits) + 100 : 999;
    return catalog([result({ trackName: title, artistName: artist, collectionName: album, artistId, artistViewUrl: `https://music.apple.com/us/artist/artist-${artistId}/${artistId}` })]);
  } });
  for (let i = 0; i < 5; i++) await lookup({ ...request, title: `Rate${i}`, artist: `Artist${i}`, album: `Album${i}` });
  assert.equal(calls, 10);
  assert.deepEqual(await lookup({ ...request, title: 'RateLimited', artist: 'Limited', album: 'Limited' }), null);
  assert.equal(calls, 10);
  now += 60_001;
  assert.deepEqual(await lookup({ ...request, title: 'RateLimited', artist: 'Limited', album: 'Limited' }), { albumArtworkUrl, artistArtworkUrl });
  assert.equal(calls, 12);

  const huge = new Response(new Uint8Array(128 * 1024 + 1), { status: 200 });
  const limited = createMusicImagesLookup({ fetchImpl: async () => huge });
  assert.equal(await limited({ ...request, title: 'Oversized' }), null);
});

test('aborts the total catalog-to-artist budget after two seconds and preserves album art', async () => {
  let artistSignal;
  const lookup = createMusicImagesLookup({ fetchImpl: async (url, options) => {
    if (new URL(url).hostname === 'itunes.apple.com') return catalog();
    return new Promise((resolve, reject) => {
      artistSignal = options.signal;
      artistSignal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
    });
  } });
  const started = Date.now();
  assert.deepEqual(await lookup(request), { albumArtworkUrl });
  assert.ok(Date.now() - started < 2600);
  assert.equal(artistSignal.aborted, true);
});

test('keeps the deadline active while catalog and artist response bodies are stalled', async () => {
  const stalled = () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), { status: 200, headers: { 'content-type': 'text/html' } });
  const lookup = createMusicImagesLookup({ fetchImpl: async url => new URL(url).hostname === 'itunes.apple.com' ? catalog() : stalled() });
  const started = Date.now();
  assert.deepEqual(await lookup(request), { albumArtworkUrl });
  assert.ok(Date.now() - started < 2600);
});

test('applies the deadline to the catalog response body after headers arrive', async () => {
  const lookup = createMusicImagesLookup({ fetchImpl: async () => new Response(
    new ReadableStream({ pull() { return new Promise(() => {}); } }),
    { status: 200, headers: { 'content-type': 'application/json' } }) });
  const started = Date.now();
  assert.equal(await lookup(request), null);
  assert.ok(Date.now() - started < 2600);
});

test('cancels the artist stream when the 256 KiB HTML prefix is reached', async () => {
  let cancelled = 0;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(64 * 1024)); }, cancel() { cancelled++; } });
  const lookup = createMusicImagesLookup({ fetchImpl: async url => new URL(url).hostname === 'itunes.apple.com'
    ? catalog() : new Response(body, { status: 200, headers: { 'content-type': 'text/html' } }) });
  assert.deepEqual(await lookup(request), { albumArtworkUrl });
  assert.equal(cancelled, 1);
});
