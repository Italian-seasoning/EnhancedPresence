import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMusicProvider, normalizeNowPlaying, selectMusicActivity } from '../presence-engine/music.mjs';

const now = 1_800_000_000_000;
const track = {
  bundleIdentifier: 'com.spotify.client', playing: true,
  title: 'Example track', artist: 'Example artist',
  elapsedTimeMicros: 30_000_000, durationMicros: 180_000_000,
  timestampEpochMicros: now * 1000
};

test('normalizes actively playing metadata and playback timestamps', () => {
  assert.deepEqual(normalizeNowPlaying(track, now), {
    kind: 'music', appId: 'com.spotify.client', appName: 'Spotify',
    details: 'Example track', state: 'Example artist', privacyLevel: 'limited',
    startTimestamp: now / 1000 - 30, endTimestamp: now / 1000 + 150
  });
});

test('drops stopped, missing, hostile or non-audio data', () => {
  for (const value of [null, [], {}, { ...track, playing: false },
    { ...track, playing: 'true' }, { ...track, title: '\u0000\u202e' },
    { ...track, bundleIdentifier: '../../private' },
    { ...track, isAdvertisement: true }, { ...track, mediaType: 'Video' }]) {
    assert.equal(normalizeNowPlaying(value, now), null);
  }
  const cleaned = normalizeNowPlaying({ ...track, title: ' Track\n name\u202e', artist: 'x'.repeat(200) }, now);
  assert.equal(cleaned.details, 'Track name');
  assert.equal(cleaned.state.length, 128);
  assert.equal(normalizeNowPlaying({ ...track, artist: undefined }, now).state, undefined);
});

test('uses parent player identity and rejects private artwork or unbounded timestamps', () => {
  const value = normalizeNowPlaying({ ...track, bundleIdentifier: 'com.google.Chrome.helper',
    parentApplicationBundleIdentifier: 'com.google.Chrome', artworkUrl: 'http://localhost/cover',
    durationMicros: Infinity, elapsedTimeMicros: -10, timestampEpochMicros: 1 }, now);
  assert.equal(value.appId, 'com.google.Chrome');
  assert.equal(value.appName, 'Google Chrome');
  assert.equal(value.artworkUrl, undefined);
  assert.equal(value.startTimestamp, now / 1000);
  assert.equal(value.endTimestamp, undefined);
  for (const artworkUrl of ['file:///cover.jpg', 'data:image/png;base64,a',
    'https://i.scdn.co.evil.example/cover', 'https://private@i.scdn.co/cover',
    'https://i.scdn.co:8443/cover', 'https://127.0.0.1/cover']) {
    assert.equal(normalizeNowPlaying({ ...track, artworkUrl }, now).artworkUrl, undefined);
  }
  assert.equal(normalizeNowPlaying({ ...track, artworkUrl: 'https://i.scdn.co/image/cover' }, now).artworkUrl,
    'https://i.scdn.co/image/cover');
});

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = [];
  child.kill = signal => { child.kills.push(signal); return true; };
  return child;
}
const send = (child, payload) => child.stdout.write(`${JSON.stringify({ type: 'data', diff: false, payload })}\n`);

test('streams split metadata, suppresses timeline noise, and clears paused or terminated playback', () => {
  const child = fakeChild(), changes = [], states = [], calls = [];
  let clock = now;
  const provider = createMusicProvider({ onChange: value => changes.push(value), onStatus: value => states.push(value),
    now: () => clock, spawnProcess: (...args) => { calls.push(args); return child; } });
  provider.start();
  provider.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/usr/bin/perl');
  assert.deepEqual(calls[0][1].slice(-5), ['stream', '--no-diff', '--micros', '--no-artwork', '--debounce=250']);
  const line = JSON.stringify({ type: 'data', diff: false, payload: track });
  child.stdout.write(line.slice(0, 20));
  assert.equal(provider.current, null);
  child.stdout.write(`${line.slice(20)}\n`);
  assert.equal(provider.current.details, 'Example track');
  clock += 1000;
  send(child, { ...track, elapsedTimeMicros: 31_000_000, timestampEpochMicros: clock * 1000 });
  assert.equal(changes.length, 1);
  send(child, { ...track, playing: false });
  assert.equal(provider.current, null);
  assert.equal(changes.at(-1), null);
  assert.equal(states.at(-1).state, 'idle');
  send(child, track);
  child.emit('close', 1, null);
  assert.equal(provider.current, null);
  assert.equal(states.at(-1).state, 'error');
  assert.equal(changes.at(-1), null);
});

test('stop terminates the child, rejects late events, and supports explicit restart', () => {
  const child = fakeChild(), second = fakeChild(), changes = [];
  const children = [child, second];
  const provider = createMusicProvider({ onChange: value => changes.push(value), now: () => now,
    spawnProcess: () => children.shift() });
  provider.start();
  send(child, track);
  provider.stop();
  assert.deepEqual(child.kills, ['SIGTERM']);
  assert.equal(provider.current, null);
  provider.start();
  send(child, track);
  assert.equal(provider.current, null);
  send(second, track);
  assert.equal(provider.current.appId, 'com.spotify.client');
  second.emit('error', Error('PRIVATE PATH'));
  assert.equal(provider.current, null);
  provider.stop();
});

test('an unresponsive startup is terminated without polling or retaining music', async () => {
  const child = fakeChild(), states = [];
  const provider = createMusicProvider({ spawnProcess: () => child, startupTimeoutMs: 5, onStatus: value => states.push(value) });
  provider.start();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(child.kills, ['SIGTERM']);
  assert.equal(provider.current, null);
  assert.deepEqual(states.at(-1), { state: 'error', reason: 'provider-timeout' });
});

test('malformed and oversized frames fail closed without exposing process errors', () => {
  for (const frame of ['not json\n', 'a'.repeat(65537), '{"type":"data","diff":true,"payload":{}}\n']) {
    const child = fakeChild(), states = [];
    const provider = createMusicProvider({ now: () => now, onStatus: value => states.push(value), spawnProcess: () => child });
    provider.start();
    send(child, track);
    child.stdout.write(frame);
    assert.equal(provider.current, null);
    assert.equal(states.at(-1).state, 'error');
    assert.deepEqual(child.kills, ['SIGTERM']);
  }
  const states = [];
  const provider = createMusicProvider({ onStatus: value => states.push(value), spawnProcess: () => { throw Error('SECRET'); } });
  assert.doesNotThrow(() => provider.start());
  assert.equal(provider.current, null);
  assert.equal(states.at(-1).state, 'error');
  assert.equal(JSON.stringify(states).includes('SECRET'), false);
});

test('Apple Music selection respects visibility, pause and foreground priority', () => {
  const activity = { appId: 'com.apple.dt.Xcode', details: 'Developing' };
  const music = normalizeNowPlaying({ ...track, bundleIdentifier: 'com.apple.Music' }, now);
  const config = { enabled: true, allowlist: [music.appId], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  const choose = (value = music, options = config, foreground = activity.appId) => selectMusicActivity(activity, value, options, foreground);
  assert.equal(choose(), music);
  assert.equal(choose(null), activity);
  assert.equal(choose(music, { ...config, enabled: false }), activity);
  assert.equal(choose(music, { ...config, music: { ...config.music, enabled: false } }), activity);
  assert.equal(choose(music, { ...config, music: { ...config.music, sources: [] } }), activity);
  assert.equal(choose(music, { ...config, denylist: [music.appId] }), activity);
  assert.equal(choose({ ...music, appId: 'com.apple.mail' }, { ...config, music: { ...config.music, sources: ['com.apple.mail'] } }), activity);
  const foregroundOnly = { ...config, music: { ...config.music, priority: 'app' } };
  assert.equal(choose(music, foregroundOnly), activity);
  assert.equal(choose(music, foregroundOnly, music.appId), music);
  assert.equal(choose(music, { ...config, allowlist: [] }), activity);
});
