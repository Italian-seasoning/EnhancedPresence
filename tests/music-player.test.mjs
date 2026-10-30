import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createMusicProvider } from '../presence-engine/music.mjs';
import { clearLocalPlayback, normalizeLocalPlayback, readLocalPlayerEnabled, setLocalPlayerEnabled, writeLocalPlayback } from '../presence-engine/local-music.mjs';
import { controlMusic, isLocalPlayerEnabled, readLocalMusicArtwork, readLocalPlayback } from '../vencord-plugin/EnhancedPresenceUniversal/music-player.mjs';

const now = 1_800_000_000_000;
const track = {
  bundleIdentifier: 'com.apple.Music', parentApplicationBundleIdentifier: 'com.apple.Music',
  title: 'Example song', artist: 'Example artist', album: 'Example album', playing: true,
  playbackRate: 1, durationMicros: 240_000_000, elapsedTimeMicros: 12_000_000,
  timestampEpochMicros: now * 1000, artworkUrl: 'https://is1-ssl.mzstatic.com/image/cover'
};
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ep-music-player-'));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}
const send = (child, payload) => child.stdout.write(`${JSON.stringify({ type: 'data', diff: false, payload })}\n`);

test('player stream keeps paused Apple Music local while shared presence still clears', t => {
  const root = fixture(t), child = fakeChild(), shared = [], local = [];
  const provider = createMusicProvider({ onChange: value => shared.push(value), onPlayback: value => local.push(value), now: () => now, spawnProcess: () => child });
  provider.start(); send(child, track);
  assert.equal(shared.at(-1).state, 'Example artist');
  assert.equal(shared.at(-1).album, 'Example album');
  assert.equal(local.at(-1).playing, true);
  send(child, { ...track, playing: false, playbackRate: 0 });
  assert.equal(shared.at(-1), null);
  assert.equal(local.at(-1).playing, false);
  assert.equal(local.at(-1).album, 'Example album');
  assert.equal(local.at(-1).artworkUrl, track.artworkUrl);
  provider.stop();
  assert.equal(local.at(-1), null);
  clearLocalPlayback(root);
});

test('refreshes stable tracks while the provider is healthy, preserves paused time and clears on provider error', async t => {
  const child = fakeChild(), playback = [];
  let clock = now;
  const provider = createMusicProvider({ now: () => clock, onPlayback: value => playback.push(value),
    playbackHeartbeatMs: 10, spawnProcess: () => child });
  provider.start(); send(child, track);
  const initial = playback.at(-1);
  clock += 100_000;
  await new Promise(resolve => setTimeout(resolve, 25));
  const playing = playback.at(-1);
  assert.equal(playing.updatedAt, clock);
  assert.ok(playing.elapsedSeconds > initial.elapsedSeconds);

  send(child, { ...track, playing: false, playbackRate: 0, elapsedTimeMicros: 50_000_000,
    timestampEpochMicros: clock * 1000 });
  const paused = playback.at(-1);
  clock += 120_000;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(playback.at(-1).updatedAt, clock);
  assert.equal(playback.at(-1).elapsedSeconds, paused.elapsedSeconds);

  const beforeFailure = playback.length;
  child.emit('close', 1, null);
  assert.equal(playback.at(-1), null);
  clock += 120_000;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(playback.length, beforeFailure + 1);
  provider.stop();
});

test('local preference has private defaults and safe atomic updates', t => {
  const root = fixture(t);
  assert.equal(readLocalPlayerEnabled(root), false);
  setLocalPlayerEnabled(root, true);
  assert.equal(readLocalPlayerEnabled(root), true);
  const file = join(root, 'music.local.settings.json');
  assert.equal(lstatSync(file).mode & 0o777, 0o600);
  assert.throws(() => setLocalPlayerEnabled(root, 'true'), /setting/);
  assert.equal(readLocalPlayerEnabled(root), true);
});

test('disabling the player erases only its current playback snapshot', t => {
  const root = fixture(t), valid = { version: 1, appId: 'com.apple.Music', title: 'Song', artist: 'Artist', album: 'Album',
    playing: true, playbackRate: 1, elapsedSeconds: 12, durationSeconds: 240, updatedAt: now };
  setLocalPlayerEnabled(root, true);
  writeLocalPlayback(root, valid, now);
  assert.equal(readLocalPlayback(root, now).title, 'Song');
  setLocalPlayerEnabled(root, false);
  assert.equal(readLocalPlayerEnabled(root), false);
  assert.equal(isLocalPlayerEnabled(root), false);
  assert.equal(readLocalPlayback(root, now), null);
});

test('normalizes a track without optional album art and tolerates old MediaRemote anchors safely', () => {
  const playback = normalizeLocalPlayback({ ...track, artist: undefined, album: undefined,
    artworkUrl: 'file:///private.jpg', durationMicros: undefined, timestampEpochMicros: (now - 300_000) * 1000 }, now);
  assert.equal(playback.artist, '');
  assert.equal(playback.album, '');
  assert.equal(playback.artworkUrl, undefined);
  assert.equal(playback.durationSeconds, undefined);
  assert.equal(playback.playing, true);
  assert.ok(playback.elapsedSeconds >= 300 && playback.elapsedSeconds < 315);
});

test('playback snapshot validates metadata, limits, freshness, permissions and symlinks', t => {
  const root = fixture(t);
  const valid = { version: 1, appId: 'com.apple.Music', playing: true, updatedAt: now, title: 'Song', artist: 'Artist', album: 'Album',
    artworkUrl: 'https://is1-ssl.mzstatic.com/image/cover', durationSeconds: 240, elapsedSeconds: 12 };
  writeLocalPlayback(root, valid, now);
  assert.equal(readLocalPlayback(root, now).title, 'Song');
  assert.equal(readLocalPlayback(root, now + 91_000), null);
  writeLocalPlayback(root, { ...valid, artworkUrl: 'file:///secret' }, now);
  assert.equal(readLocalPlayback(root, now).artworkUrl, undefined);
  chmodSync(join(root, 'music.local.json'), 0o644);
  assert.equal(readLocalPlayback(root, now), null);
  writeFileSync(join(root, 'external.json'), JSON.stringify(valid), { mode: 0o600 });
  unlinkSync(join(root, 'music.local.json'));
  symlinkSync(join(root, 'external.json'), join(root, 'music.local.json'));
  assert.equal(readLocalPlayback(root, now), null);
});

function writeHelperFile(root, name, value) {
  const file = join(root, name), temporary = join(root, `.${basename(name)}.${randomUUID()}.tmp`);
  writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
  renameSync(temporary, file);
}

function helperResponse(request, update = {}) {
  return { version: 1, id: request.id, ok: true, reason: 'applied', updatedAt: request.createdAt, ...update };
}

test('sends only a private fixed action request and accepts its matching helper response', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  let clock = now, responseValue;
  const result = await controlMusic(root, 'next', {
    now: () => clock,
    sleep: async ms => {
      const request = JSON.parse(readFileSync(join(root, 'music.control.request.json'), 'utf8'));
      assert.deepEqual(Object.keys(request).sort(), ['action', 'createdAt', 'id', 'version']);
      assert.equal(request.action, 'next');
      assert.equal(request.version, 1);
      assert.match(request.id, /^[0-9a-f-]{36}$/);
      assert.equal(lstatSync(join(root, 'music.control.request.json')).mode & 0o777, 0o600);
      responseValue = helperResponse(request);
      writeHelperFile(root, 'music.control.response.json', responseValue);
      assert.equal(lstatSync(join(root, 'music.control.response.json')).mode & 0o777, 0o600);
      clock += ms;
    },
    pollIntervalMs: 10
  });
  assert.equal(result, undefined);
  assert.equal(readLocalPlayerEnabled(root), true);
  assert.equal(lstatSync(join(root, 'music.control.response.json'), { throwIfNoEntry: false }), undefined);
  assert.equal(lstatSync(join(root, 'music.control.request.json'), { throwIfNoEntry: false }), undefined);
});

test('exclusive filesystem lease rejects a second module instance', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  const secondModule = await import('../vencord-plugin/EnhancedPresenceUniversal/music-player.mjs?separate-instance');
  let clock = now, release, waiting = false;
  const gate = new Promise(resolve => { release = resolve; });
  const first = controlMusic(root, 'play', { timeoutMs: 20, now: () => clock, pollIntervalMs: 10,
    sleep: async ms => { if (!waiting) { waiting = true; await gate; } clock += ms; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(lstatSync(join(root, 'music.control.lock')).mode & 0o777, 0o600);
  await assert.rejects(secondModule.controlMusic(root, 'next', { timeoutMs: 20, now: () => clock,
    sleep: async ms => { clock += ms; } }), /already in progress/);
  release();
  await assert.rejects(first, /timeout/i);
  assert.equal(lstatSync(join(root, 'music.control.lock'), { throwIfNoEntry: false }), undefined);
});

test('reclaims only an expired lease with its stale request and response', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  const expiredAt = now - 66_000, expiredId = randomUUID();
  writeHelperFile(root, 'music.control.lock', { version: 1, id: expiredId, createdAt: expiredAt });
  writeHelperFile(root, 'music.control.request.json', { version: 1, id: expiredId, action: 'pause', createdAt: expiredAt });
  writeHelperFile(root, 'music.control.response.json', { version: 1, id: expiredId, ok: true, reason: 'applied', updatedAt: expiredAt });
  await controlMusic(root, 'next', { now: () => now, sleep: async () => {
    const lease = JSON.parse(readFileSync(join(root, 'music.control.lock'), 'utf8'));
    const request = JSON.parse(readFileSync(join(root, 'music.control.request.json'), 'utf8'));
    assert.equal(request.id, lease.id);
    assert.notEqual(request.id, expiredId);
    writeHelperFile(root, 'music.control.response.json', helperResponse(request));
  }, pollIntervalMs: 10 });
  assert.equal(lstatSync(join(root, 'music.control.lock'), { throwIfNoEntry: false }), undefined);
  assert.equal(lstatSync(join(root, 'music.control.request.json'), { throwIfNoEntry: false }), undefined);
});

test('does not replace a fresh orphaned request while claiming a free lease', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  const existing = { version: 1, id: randomUUID(), action: 'pause', createdAt: now };
  writeHelperFile(root, 'music.control.request.json', existing);
  await assert.rejects(controlMusic(root, 'next', { now: () => now }), /already in progress/);
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'music.control.request.json'), 'utf8')), existing);
  assert.equal(lstatSync(join(root, 'music.control.lock'), { throwIfNoEntry: false }), undefined);
});

test('rejects disabled, invalid and concurrent requests without dispatching extras', async t => {
  const root = fixture(t);
  await assert.rejects(controlMusic(root, 'next'), /disabled/);
  setLocalPlayerEnabled(root, true);
  await assert.rejects(controlMusic(root, 'toggle'), /not supported/);
  let clock = now, release, waiting = false;
  const gate = new Promise(resolve => { release = resolve; });
  const first = controlMusic(root, 'play', { timeoutMs: 20, now: () => clock, pollIntervalMs: 10,
    sleep: async ms => { if (!waiting) { waiting = true; await gate; } clock += ms; } });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(controlMusic(root, 'next'), /already in progress/);
  release();
  await assert.rejects(first, /timeout/i);
});

test('disabling the player cancels its pending helper request', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  let clock = now, release, waiting = false;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = controlMusic(root, 'play', { timeoutMs: 100, now: () => clock, pollIntervalMs: 10,
    sleep: async ms => { waiting = true; await gate; clock += ms; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waiting, true);
  assert.notEqual(lstatSync(join(root, 'music.control.request.json')).isFile(), false);
  setLocalPlayerEnabled(root, false);
  release();
  await assert.rejects(pending, /disabled/);
  assert.equal(lstatSync(join(root, 'music.control.request.json'), { throwIfNoEntry: false }), undefined);
});

test('ignores stale and wrong nonce responses until the matching response arrives', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  let clock = now, polls = 0;
  writeHelperFile(root, 'music.control.request.json', { version: 1, id: randomUUID(), action: 'pause', createdAt: now - 11_000 });
  writeHelperFile(root, 'music.control.response.json', { version: 1, id: randomUUID(), ok: true, reason: 'applied', updatedAt: now - 61_000 });
  await controlMusic(root, 'pause', {
    now: () => clock,
    sleep: async ms => {
      const request = JSON.parse(readFileSync(join(root, 'music.control.request.json'), 'utf8'));
      polls++;
      writeHelperFile(root, 'music.control.response.json', helperResponse({ ...request, id: randomUUID() }));
      clock += ms;
      if (polls === 2) writeHelperFile(root, 'music.control.response.json', helperResponse(request));
    }, pollIntervalMs: 10
  });
  assert.equal(polls, 2);
});

test('reports macOS Automation denial with a useful next step', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  await assert.rejects(controlMusic(root, 'play', {
    sleep: async ms => {
      const request = JSON.parse(readFileSync(join(root, 'music.control.request.json'), 'utf8'));
      writeHelperFile(root, 'music.control.response.json', helperResponse(request, { ok: false, reason: 'permission-required' }));
    }, pollIntervalMs: 10
  }), /allow Enhanced Presence Helper to control Music/i);
});

test('fails closed on malformed, shared-mode and symlinked helper responses', async t => {
  const root = fixture(t); setLocalPlayerEnabled(root, true);
  writeHelperFile(root, 'music.control.response.json', '{');
  await assert.rejects(controlMusic(root, 'previous'), /invalid music helper response/i);
  writeFileSync(join(root, 'music.control.response.json'), JSON.stringify({ version: 1, id: randomUUID(), ok: true, reason: 'applied', updatedAt: now }));
  chmodSync(join(root, 'music.control.response.json'), 0o644);
  await assert.rejects(controlMusic(root, 'previous'), /private/i);
  unlinkSync(join(root, 'music.control.response.json'));
  symlinkSync(join(root, 'music.local.settings.json'), join(root, 'music.control.response.json'));
  await assert.rejects(controlMusic(root, 'pause'), /private/i);
});

test('returns bounded cover bytes only for the enabled current local Apple Music track', async t => {
  const root = fixture(t), current = { version: 1, appId: 'com.apple.Music', title: 'Song', artist: 'Artist', album: 'Album',
    playing: true, playbackRate: 1, elapsedSeconds: 12, durationSeconds: 240, updatedAt: now };
  const request = { appId: current.appId, title: current.title, artist: current.artist, album: current.album };
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  setLocalPlayerEnabled(root, true); writeLocalPlayback(root, current, now);
  let calls = 0, release;
  const run = async (file, args, options) => {
    calls++;
    assert.equal(file, '/usr/bin/perl');
    assert.deepEqual(args.slice(-2), ['get', '--micros']);
    assert.equal(options.maxBuffer, 2 * 1024 * 1024);
    return new Promise(resolve => { release = () => resolve({ stdout: JSON.stringify({ parentApplicationBundleIdentifier: 'com.apple.Music',
      bundleIdentifier: 'com.apple.Music', title: 'Song', artist: 'Artist', album: 'Album', playing: true,
      artworkMimeType: 'image/jpeg', artworkData: bytes.toString('base64') }) }); });
  };
  const expected = `data:image/jpeg;base64,${bytes.toString('base64')}`;
  const first = readLocalMusicArtwork(root, request, { run, now: () => now });
  const second = readLocalMusicArtwork(root, request, { run, now: () => now });
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [expected, expected]);
  assert.equal(await readLocalMusicArtwork(root, request, { run, now: () => now }), expected);
  assert.equal(calls, 1);
});

test('accepts a bounded local WebP image after matching the current Apple Music track', async t => {
  const root = fixture(t), current = { version: 1, appId: 'com.apple.Music', title: 'WebP Song', artist: 'Artist', album: 'Album',
    playing: true, playbackRate: 1, elapsedSeconds: 8, durationSeconds: 200, updatedAt: now };
  setLocalPlayerEnabled(root, true); writeLocalPlayback(root, current, now);
  const request = { appId: current.appId, title: current.title, artist: current.artist, album: current.album };
  const image = Buffer.alloc(16); image.write('RIFF', 0); image.writeUInt32LE(8, 4); image.write('WEBP', 8); image.write('VP8 ', 12);
  const run = async () => ({ stdout: JSON.stringify({ bundleIdentifier: current.appId,
    parentApplicationBundleIdentifier: current.appId, title: current.title, artist: current.artist, album: current.album,
    artworkMimeType: 'image/webp', artworkData: image.toString('base64') }) });
  assert.equal(await readLocalMusicArtwork(root, request, { run, now: () => now }), `data:image/webp;base64,${image.toString('base64')}`);
});

test('rejects noncurrent, disabled, malformed, mismatched and oversized local artwork', async t => {
  const root = fixture(t), current = { version: 1, appId: 'com.apple.Music', title: 'Song', artist: 'Artist', album: 'Album',
    playing: true, playbackRate: 1, elapsedSeconds: 12, durationSeconds: 240, updatedAt: now };
  const request = { appId: current.appId, title: current.title, artist: current.artist, album: current.album };
  writeLocalPlayback(root, current, now);
  setLocalPlayerEnabled(root, true);
  let calls = 0;
  const run = async (_file, _args, _options) => { calls++; return { stdout: JSON.stringify({ parentApplicationBundleIdentifier: 'com.apple.Music',
    title: 'Another song', artist: 'Artist', album: 'Album', artworkMimeType: 'image/jpeg', artworkData: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') }) }; };
  assert.equal(await readLocalMusicArtwork(root, request, { run, now: () => now }), null);
  assert.equal(calls, 1);
  assert.equal(await readLocalMusicArtwork(root, { ...request, title: 'Other local song' }, { run, now: () => now }), null);
  assert.equal(calls, 1);
  const bad = [
    { artworkMimeType: 'image/svg+xml', artworkData: Buffer.from('<svg/>').toString('base64') },
    { artworkMimeType: 'image/png', artworkData: Buffer.from([0xff, 0xd8, 0xff]).toString('base64') },
    { artworkMimeType: 'image/jpeg', artworkData: '!!!=' },
    { artworkMimeType: 'image/jpeg', artworkData: Buffer.alloc(1024 * 1024 + 1, 1).toString('base64') }
  ];
  for (const [index, image] of bad.entries()) {
    const title = `Bad${index}`;
    writeLocalPlayback(root, { ...current, title }, now);
    assert.equal(await readLocalMusicArtwork(root, { ...request, title }, { run: async () => ({ stdout: JSON.stringify({
      bundleIdentifier: 'com.apple.Music', parentApplicationBundleIdentifier: 'com.apple.Music',
      title, artist: 'Artist', album: 'Album', ...image }) }), now: () => now }), null);
  }
  setLocalPlayerEnabled(root, false);
  calls = 0;
  assert.equal(await readLocalMusicArtwork(root, request, { run, now: () => now }), null);
  assert.equal(calls, 0);
});
