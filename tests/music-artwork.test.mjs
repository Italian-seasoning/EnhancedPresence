import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicArtworkLookup } from '../vencord-plugin/EnhancedPresenceUniversal/music-artwork.mjs';

const request = { appId: 'com.apple.Music', title: 'Ｆｏｏ　　Bar', artist: ' ARTIST ', album: 'Ｃａｓｅ Album' };
const artworkUrl = 'https://is1-ssl.mzstatic.com/image/thumb/album/100x100bb.jpg';
const result = (update = {}) => ({ trackName: 'foo Bar', artistName: 'artist', collectionName: 'case album', artworkUrl100: artworkUrl, ...update });
const response = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('uses a fixed Apple catalog request and matches normalized title, artist and album exactly', async () => {
  let calls = 0;
  const lookup = createMusicArtworkLookup({ fetchImpl: async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://itunes.apple.com');
    assert.equal(parsed.pathname, '/search');
    assert.equal(parsed.searchParams.get('media'), 'music');
    assert.equal(parsed.searchParams.get('entity'), 'song');
    assert.equal(parsed.searchParams.get('limit'), '10');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal instanceof AbortSignal, true);
    return response({ resultCount: 3, results: [
      result({ collectionName: 'Other Album', artworkUrl100: 'https://is9-ssl.mzstatic.com/wrong.jpg' }),
      result({ artistName: 'Other Artist', artworkUrl100: 'https://is9-ssl.mzstatic.com/wrong.jpg' }),
      result()
    ] });
  } });
  assert.equal(await lookup(request), artworkUrl);
  assert.equal(calls, 1);
});

test('rejects non-Apple requests, extra fields and invalid metadata without fetching', async () => {
  let calls = 0;
  const lookup = createMusicArtworkLookup({ fetchImpl: async () => { calls++; return response({ results: [result()] }); } });
  for (const invalid of [
    { ...request, appId: 'com.google.Chrome' }, { ...request, extra: 'secret' },
    { ...request, title: '' }, { ...request, artist: 'x'.repeat(129) },
    { ...request, album: 'bad\u0085value' }
  ]) assert.equal(await lookup(invalid), null);
  assert.equal(await lookup(null), null);
  assert.equal(calls, 0);
});

test('requires exact album and a validated Apple CDN artwork URL', async () => {
  const responses = [
    response({ results: [result({ collectionName: 'another album' })] }),
    response({ results: [result({ artworkUrl100: 'https://example.com/art.jpg' })] }),
    response({ results: [result({ artworkUrl100: 'http://is1-ssl.mzstatic.com/art.jpg' })] }),
    response({ results: [result({ artworkUrl100: 'https://is1-ssl.mzstatic.com:443/art.jpg' })] })
  ];
  const lookup = createMusicArtworkLookup({ fetchImpl: async () => responses.shift() });
  assert.equal(await lookup({ ...request, album: 'different' }), null);
  assert.equal(await lookup({ ...request, title: 'Another track' }), null);
  assert.equal(await lookup({ ...request, artist: 'Another artist' }), null);
  assert.equal(await lookup({ ...request, title: 'Third track' }), null);
});

test('caches successes for an hour and misses for a minute', async () => {
  let now = 1000, calls = 0, hasResult = true;
  const lookup = createMusicArtworkLookup({ now: () => now, fetchImpl: async () => { calls++; return response({ results: hasResult ? [result()] : [] }); } });
  assert.equal(await lookup(request), artworkUrl);
  now += 3_599_999; assert.equal(await lookup(request), artworkUrl); assert.equal(calls, 1);
  now += 2; assert.equal(await lookup(request), artworkUrl); assert.equal(calls, 2);
  hasResult = false; now += 3_600_001; assert.equal(await lookup(request), null); assert.equal(calls, 3);
  assert.equal(await lookup(request), null); assert.equal(calls, 3);
  now += 60_001; assert.equal(await lookup(request), null); assert.equal(calls, 4);
});

test('deduplicates in-flight lookups and caps the metadata cache at 64 entries', async () => {
  let now = 0, calls = 0, release;
  const lookup = createMusicArtworkLookup({ now: () => now, fetchImpl: async () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = lookup(request), second = lookup({ ...request });
  assert.equal(calls, 1);
  release(response({ results: [result()] }));
  assert.deepEqual(await Promise.all([first, second]), [artworkUrl, artworkUrl]);

  let cachedCalls = 0;
  const cached = createMusicArtworkLookup({ now: () => now, fetchImpl: async url => {
    cachedCalls++;
    const title = new URL(url).searchParams.get('term').split(' ')[0];
    return response({ results: [result({ trackName: title })] });
  } });
  for (let i = 0; i < 64; i++) {
    if (i && i % 10 === 0) now += 60_001;
    assert.equal(await cached({ ...request, title: `Track${i}` }), artworkUrl);
  }
  assert.equal(await cached({ ...request, title: 'Track0' }), artworkUrl);
  await cached({ ...request, title: 'Track64' });
  const before = cachedCalls;
  await cached({ ...request, title: 'Track0' }); assert.equal(cachedCalls, before);
  await cached({ ...request, title: 'Track1' }); assert.equal(cachedCalls, before + 1);
});

test('limits API traffic to ten requests per minute and caps response bytes', async () => {
  let now = 0, calls = 0;
  const lookup = createMusicArtworkLookup({ now: () => now, fetchImpl: async () => { calls++; return response({ results: [] }); } });
  for (let i = 0; i < 10; i++) await lookup({ ...request, title: `Miss${i}` });
  assert.equal(await lookup({ ...request, title: 'Miss10' }), null);
  assert.equal(calls, 10);
  now += 60_001;
  assert.equal(await lookup({ ...request, title: 'Miss10' }), null);
  assert.equal(calls, 11);

  const huge = new Response(new Uint8Array(128 * 1024 + 1), { status: 200 });
  const limited = createMusicArtworkLookup({ fetchImpl: async () => huge });
  assert.equal(await limited({ ...request, title: 'Oversized' }), null);
});

test('aborts stalled catalog requests after two seconds and returns a cached miss', async () => {
  let calls = 0, signal;
  const lookup = createMusicArtworkLookup({ fetchImpl: (_url, options) => {
    calls++; signal = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
  } });
  const started = Date.now();
  assert.equal(await lookup(request), null);
  assert.ok(Date.now() - started >= 1900);
  assert.equal(signal.aborted, true);
  assert.equal(await lookup(request), null);
  assert.equal(calls, 1);
});
