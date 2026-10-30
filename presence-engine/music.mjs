import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { blocked } from './profiles.mjs';
import { normalizeLocalPlayback } from './local-music.mjs';

const playerNames = {
  'com.apple.Music': 'Apple Music', 'com.spotify.client': 'Spotify',
  'com.apple.Safari': 'Safari', 'com.google.Chrome': 'Google Chrome',
  'org.mozilla.firefox': 'Firefox', 'com.brave.Browser': 'Brave',
  'com.microsoft.edgemac': 'Microsoft Edge', 'company.thebrowser.Browser': 'Arc',
  'com.google.Chrome.canary': 'Chrome Canary', 'ai.perplexity.comet': 'Comet', 'com.openai.atlas': 'ChatGPT Atlas'
};
const bundleId = value => typeof value === 'string' && value.length <= 160 && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(value);
const text = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128)
  : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const maxSeconds = 7 * 24 * 60 * 60;
export function selectMusicActivity(activity, track, config, foregroundAppId, snapshot, quietHours = false) {
  if (!snapshot || !bundleId(snapshot.appId) || !Number.isInteger(snapshot.pid) || snapshot.pid <= 0
    || !finite(snapshot.idleSeconds) || snapshot.idleSeconds < 0 || snapshot.inactive !== false || quietHours) return activity;
  if (!track || track.appId !== 'com.apple.Music' || !config.enabled || !config.music.enabled) return activity;
  const allowed = config.music.sources.includes(track.appId);
  if (!allowed || !config.allowlist.includes(track.appId) || config.denylist.includes(track.appId) || blocked.has(track.appId)) return activity;
  return config.music.priority === 'music' || foregroundAppId === track.appId ? track : activity;
}

function publicArtwork(value) {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return;
    if (url.hostname !== 'i.scdn.co' && url.hostname !== 'image-cdn-ak.spotifycdn.com'
      && !/^is\d+-ssl\.mzstatic\.com$/.test(url.hostname)) return;
    return url.href;
  } catch {}
}

export function normalizeNowPlaying(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.playing !== true
    || value.isAdvertisement === true || !finite(now)) return null;
  if (value.mediaType != null && !['MRMediaRemoteMediaTypeMusic', 'kMRMediaRemoteNowPlayingInfoTypeAudio'].includes(value.mediaType)) return null;
  if (finite(value.playbackRate) && value.playbackRate <= 0) return null;
  const appId = bundleId(value.parentApplicationBundleIdentifier) ? value.parentApplicationBundleIdentifier : value.bundleIdentifier;
  const details = text(value.title);
  if (!bundleId(appId) || !details) return null;
  const stampMs = finite(value.timestampEpochMicros) ? value.timestampEpochMicros / 1000 : now;
  const validStamp = stampMs <= now + 5000 && stampMs >= now - maxSeconds * 1000;
  const elapsed = finite(value.elapsedTimeMicros) && value.elapsedTimeMicros >= 0 && value.elapsedTimeMicros <= maxSeconds * 1e6
    ? value.elapsedTimeMicros / 1e6 : 0;
  const duration = finite(value.durationMicros) && value.durationMicros > 0 && value.durationMicros <= maxSeconds * 1e6
    ? value.durationMicros / 1e6 : null;
  let position = elapsed + (validStamp ? Math.max(0, (now - stampMs) / 1000) : 0);
  position = Math.min(position, duration ?? maxSeconds);
  const startTimestamp = Math.floor(now / 1000 - position);
  const result = { kind: 'music', appId, appName: playerNames[appId] ?? appId,
    details, startTimestamp, privacyLevel: 'limited' };
  const artist = text(value.artist);
  const album = text(value.album);
  if (artist) result.state = artist;
  if (album) result.album = album;
  if (duration !== null) result.endTimestamp = startTimestamp + Math.ceil(duration);
  const artwork = publicArtwork(value.artworkUrl);
  if (artwork) result.artworkUrl = artwork;
  return result;
}

export function createMusicProvider({ onChange = () => {}, onStatus = () => {}, onPlayback = () => {},
  spawnProcess = spawn, now = Date.now, startupTimeoutMs = 10000, playbackHeartbeatMs = 30000,
  adapterPath = fileURLToPath(new URL('../vendor/mediaremote-adapter/bin/mediaremote-adapter.pl', import.meta.url)),
  frameworkPath = fileURLToPath(new URL('../build/MediaRemoteAdapter.framework', import.meta.url))
} = {}) {
  let child = null, current = null, identity = null, startupTimer = null, playbackTimer = null, lastStatus = '';
  let playbackIdentity = null, playbackUpdatedAt = 0, currentPlayback = null;
  function status(state, reason) {
    const value = { state, ...(reason ? { reason } : {}) };
    const encoded = JSON.stringify(value);
    if (encoded !== lastStatus) { lastStatus = encoded; onStatus(value); }
  }
  function publish(value) {
    if (JSON.stringify(value) === JSON.stringify(current)) return;
    current = value;
    onChange(value);
  }
  function publishPlayback(value) {
    const playback = value ? normalizeLocalPlayback(value, now()) : null;
    currentPlayback = playback;
    const key = playback && JSON.stringify([playback.appId, playback.title, playback.artist, playback.album,
      playback.artworkUrl, playback.playing, playback.playbackRate, playback.durationSeconds]);
    const time = now();
    if (key === playbackIdentity && (key === null || time - playbackUpdatedAt < 5000)) return;
    playbackIdentity = key;
    playbackUpdatedAt = time;
    onPlayback(playback);
  }
  function refreshPlayback() {
    if (!child || !currentPlayback) return;
    const time = now();
    let elapsedSeconds = currentPlayback.elapsedSeconds;
    if (currentPlayback.playing) elapsedSeconds += Math.max(0, (time - currentPlayback.updatedAt) / 1000) * currentPlayback.playbackRate;
    if (currentPlayback.durationSeconds !== undefined) elapsedSeconds = Math.min(currentPlayback.durationSeconds, elapsedSeconds);
    currentPlayback = { ...currentPlayback, elapsedSeconds, updatedAt: time };
    playbackUpdatedAt = time;
    onPlayback(currentPlayback);
  }
  function terminate() {
    const old = child;
    child = null;
    clearTimeout(startupTimer);
    startupTimer = null;
    clearInterval(playbackTimer);
    playbackTimer = null;
    old?.kill('SIGTERM');
    identity = null;
    publish(null);
    publishPlayback(null);
  }
  function fail(reason) { terminate(); status('error', reason); }
  return {
    get current() { return current; },
    start() {
      if (child) return;
      status('starting');
      let process;
      try {
        process = spawnProcess('/usr/bin/perl', [adapterPath, frameworkPath,
          'stream', '--no-diff', '--micros', '--no-artwork', '--debounce=250'],
        { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch { fail('provider-unavailable'); return; }
      child = process;
      if (typeof playbackHeartbeatMs === 'number' && playbackHeartbeatMs > 0) {
        playbackTimer = setInterval(refreshPlayback, playbackHeartbeatMs);
        playbackTimer.unref?.();
      }
      let buffer = '';
      startupTimer = setTimeout(() => { if (child === process) fail('provider-timeout'); }, startupTimeoutMs);
      startupTimer.unref?.();
      process.stderr.resume();
      process.stdout.setEncoding('utf8');
      process.stdout.on('data', chunk => {
        if (child !== process) return;
        buffer += chunk;
        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          if (newline > 65536) { fail('invalid-provider-data'); return; }
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { fail('invalid-provider-data'); return; }
          if (message?.type !== 'data' || message.diff !== false || !message.payload
            || typeof message.payload !== 'object' || Array.isArray(message.payload)) {
            fail('invalid-provider-data'); return;
          }
          clearTimeout(startupTimer);
          startupTimer = null;
          const value = normalizeNowPlaying(message.payload, now());
          publishPlayback(message.payload);
          const nextIdentity = value ? JSON.stringify([value.appId, value.details, value.state,
            text(message.payload.uniqueIdentifier)]) : null;
          if (value && current && nextIdentity === identity
            && (!finite(message.payload.elapsedTimeMicros) || Math.abs(value.startTimestamp - current.startTimestamp) <= 2)) {
            if (value.endTimestamp !== undefined) value.endTimestamp += current.startTimestamp - value.startTimestamp;
            value.startTimestamp = current.startTimestamp;
          }
          identity = nextIdentity;
          publish(value);
          status(value ? 'playing' : 'idle');
        }
        if (buffer.length > 65536) fail('invalid-provider-data');
      });
      process.on('error', () => { if (child === process) fail('provider-unavailable'); });
      process.on('close', () => { if (child === process) fail('provider-exited'); });
    },
    stop() { terminate(); status('stopped'); }
  };
}
