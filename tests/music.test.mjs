import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMusicGapSuppressor, createMusicProvider, normalizeNowPlaying, selectMusicActivity } from '../presence-engine/music.mjs';

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

test('normalizes an optional bounded album while keeping artist as state', () => {
  const value = normalizeNowPlaying({ ...track, bundleIdentifier: 'com.apple.Music', album: '  Ａlbum\tTitle  ' }, now);
  assert.equal(value.album, 'Ａlbum Title');
  assert.equal(value.state, 'Example artist');
  assert.equal(normalizeNowPlaying({ ...track, album: '  ' }, now).album, undefined);
  assert.equal(normalizeNowPlaying({ ...track, album: 'a'.repeat(129) }, now).album.length, 128);
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
  const snapshot = { appId: 'com.apple.dt.Xcode', pid: 8, idleSeconds: 10, inactive: false };
  const choose = (value = music, options = config, foreground = activity.appId, current = snapshot) => selectMusicActivity(activity, value, options, foreground, current);
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

test('music priority remains visible after app idle or during a private foreground app', () => {
  const music = normalizeNowPlaying({ ...track, bundleIdentifier: 'com.apple.Music' }, now);
  const config = { enabled: true, allowlist: ['com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  assert.equal(selectMusicActivity(null, music, config, 'com.apple.dt.Xcode', { appId: 'com.apple.dt.Xcode', pid: 10, idleSeconds: 900, inactive: false }), music);
  assert.equal(selectMusicActivity(null, music, config, 'com.apple.Passwords', { appId: 'com.apple.Passwords', pid: 11, idleSeconds: 2, inactive: false }), music);
});

test('music is cleared for stale, asleep, locked, quiet, disabled, or unapproved state', () => {
  const music = normalizeNowPlaying({ ...track, bundleIdentifier: 'com.apple.Music' }, now);
  const config = { enabled: true, allowlist: ['com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  const awake = { appId: 'com.apple.dt.Xcode', pid: 10, idleSeconds: 900, inactive: false };
  for (const snapshot of [null, { ...awake, inactive: true }, { ...awake, pid: 0 }, { ...awake, idleSeconds: NaN }]) {
    assert.equal(selectMusicActivity(null, music, config, 'com.apple.dt.Xcode', snapshot), null);
  }
  assert.equal(selectMusicActivity(null, music, config, 'com.apple.dt.Xcode', awake, true), null);
  assert.equal(selectMusicActivity(null, music, { ...config, enabled: false }, 'com.apple.dt.Xcode', awake), null);
  assert.equal(selectMusicActivity(null, music, { ...config, denylist: ['com.apple.Music'] }, 'com.apple.dt.Xcode', awake), null);
});

test('app priority publishes music only while Apple Music is foreground', () => {
  const music = normalizeNowPlaying({ ...track, bundleIdentifier: 'com.apple.Music' }, now);
  const config = { enabled: true, allowlist: ['com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'app' } };
  const idleMusic = { appId: 'com.apple.Music', pid: 10, idleSeconds: 900, inactive: false };
  assert.equal(selectMusicActivity(null, music, config, idleMusic.appId, idleMusic), music);
  const privateApp = { appId: 'com.apple.Passwords', pid: 11, idleSeconds: 2, inactive: false };
  assert.equal(selectMusicActivity(null, music, config, privateApp.appId, privateApp), null);
});

test('music-gap suppression clears the old track and briefly hides only the app fallback', () => {
  let now = 1000;
  const gap = createMusicGapSuppressor({ now: () => now });
  const config = { enabled: true, idleSeconds: 300, allowlist: ['com.apple.dt.Xcode', 'com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  const snapshot = { appId: 'com.apple.dt.Xcode', pid: 8, idleSeconds: 2, inactive: false };
  const codex = { appId: 'com.openai.codex', appName: 'Codex', details: 'Working', startTimestamp: 1 };
  gap.begin(2000);
  assert.equal(gap.shouldSuppress({ activity: codex, activityAllowed: true, config, snapshot }), true);
  now += 1999;
  assert.equal(gap.shouldSuppress({ activity: codex, activityAllowed: true, config, snapshot }), true);
  now += 1;
  assert.equal(gap.shouldSuppress({ activity: codex, activityAllowed: true, config, snapshot }), false);
});

test('music-gap suppression uses the configured positive switch delay and rejects invalid durations', () => {
  let clock = 1000;
  const gap = createMusicGapSuppressor({ now: () => clock });
  const config = { enabled: true, idleSeconds: 300, allowlist: ['com.apple.dt.Xcode', 'com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  const snapshot = { appId: 'com.apple.dt.Xcode', pid: 8, idleSeconds: 2, inactive: false };
  const codex = { appId: 'com.openai.codex', appName: 'Codex', details: 'Working', startTimestamp: 1 };
  const check = () => gap.shouldSuppress({ activity: codex, activityAllowed: true, config, snapshot });

  gap.begin(120_000);
  clock += 2100;
  assert.equal(check(), true);
  clock += 117_900;
  assert.equal(check(), false);

  for (const invalidDuration of [0, -1, NaN, Infinity, undefined]) {
    gap.begin(invalidDuration);
    assert.equal(check(), false);
  }
});

test('music-gap suppression is bypassed and canceled for privacy or app-priority changes', () => {
  const config = { enabled: true, idleSeconds: 300, allowlist: ['com.apple.dt.Xcode', 'com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  const snapshot = { appId: 'com.apple.dt.Xcode', pid: 8, idleSeconds: 2, inactive: false };
  const codex = { appId: 'com.openai.codex', appName: 'Codex', details: 'Working', startTimestamp: 1 };
  const gap = createMusicGapSuppressor({ now: () => now });
  const now = 1000;
  for (const state of [
    { snapshot: null },
    { snapshot: { ...snapshot, inactive: true } },
    { snapshot: { ...snapshot, idleSeconds: 300 } },
    { snapshot: { ...snapshot, appId: 'com.apple.Passwords' } },
    { quietHours: true },
    { config: { ...config, enabled: false } },
    { config: { ...config, music: { ...config.music, enabled: false } } },
    { config: { ...config, music: { ...config.music, priority: 'app' } } },
    { activityAllowed: false }
  ]) {
    gap.begin(2000);
    assert.equal(gap.shouldSuppress({ activity: codex, activityAllowed: true, config, snapshot, ...state }), false);
  }
});

test('the music gap also suppresses a retained app while viewing Discord', () => {
  const gap = createMusicGapSuppressor({ now: () => 1000 });
  const config = { enabled: true, idleSeconds: 300, allowlist: ['com.openai.codex', 'com.apple.Music'], denylist: [], music: { enabled: true, sources: ['com.apple.Music'], priority: 'music' } };
  const activity = { appId: 'com.openai.codex' };
  for (const appId of ['com.hnc.Discord', 'dev.vencord.Vesktop']) {
    gap.begin(2000);
    assert.equal(gap.shouldSuppress({ activity, activityAllowed: true, config, snapshot: { appId, pid: 8, inactive: false, idleSeconds: 2 } }), true);
  }
});
