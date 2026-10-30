import { existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const musicFile = 'music.local.json';
const settingsFile = 'music.local.settings.json';
const maxAge = 90_000;
const maxTrackSeconds = 24 * 60 * 60;
const controls = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g;
const safeText = value => typeof value === 'string'
  ? value.replace(controls, ' ').replace(/\s+/g, ' ').trim().slice(0, 128)
  : '';
const finiteSeconds = value => Number.isFinite(value) && value >= 0 && value <= maxTrackSeconds;

function privateRoot(root) {
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
    throw Error('Private music settings unavailable');
  }
}

function privateFile(root, name, limit) {
  privateRoot(root);
  const file = join(root, name);
  let stat;
  try { stat = lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit
    || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
    throw Error('Private music data unavailable');
  }
  return { file, data: JSON.parse(readFileSync(file, 'utf8')) };
}

function atomicWrite(root, name, value) {
  privateRoot(root);
  privateFile(root, name, 65536);
  const file = join(root, name), temporary = join(root, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    try { unlinkSync(temporary); } catch { /* Already renamed or not created. */ }
  }
}

export function normalizeLocalPlayback(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isSafeInteger(now)
    || value.isAdvertisement === true) return null;
  const saved = value.version === 1;
  const appId = saved ? value.appId : value.parentApplicationBundleIdentifier ?? value.bundleIdentifier;
  if (appId !== 'com.apple.Music' || typeof value.playing !== 'boolean') return null;
  if (!saved && value.mediaType != null && !['MRMediaRemoteMediaTypeMusic', 'kMRMediaRemoteNowPlayingInfoTypeAudio'].includes(value.mediaType)) return null;
  const title = safeText(value.title);
  if (!title) return null;
  const rate = value.playbackRate ?? (value.playing ? 1 : 0);
  if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 4)) return null;
  const durationMicros = saved ? (value.durationSeconds === undefined ? undefined : value.durationSeconds * 1e6) : value.durationMicros;
  const elapsedTimeMicros = saved ? value.elapsedSeconds * 1e6 : value.elapsedTimeMicros;
  if (durationMicros !== undefined && (!Number.isFinite(durationMicros) || durationMicros <= 0 || durationMicros > maxTrackSeconds * 1e6)) return null;
  if (elapsedTimeMicros !== undefined && (!Number.isFinite(elapsedTimeMicros) || elapsedTimeMicros < 0 || elapsedTimeMicros > maxTrackSeconds * 1e6)) return null;
  const stamp = saved ? value.updatedAt : Number.isFinite(value.timestampEpochMicros) ? Math.floor(value.timestampEpochMicros / 1000) : now;
  if (stamp > now + 5000 || (saved && stamp < now - maxAge)) return null;
  const durationSeconds = Number.isFinite(durationMicros) ? durationMicros / 1e6 : undefined;
  let elapsedSeconds = Number.isFinite(elapsedTimeMicros) ? elapsedTimeMicros / 1e6 : 0;
  if (!saved && value.playing && rate > 0 && Number.isFinite(value.timestampEpochMicros)
    && stamp >= now - maxTrackSeconds * 1000) elapsedSeconds += Math.max(0, (now - stamp) / 1000) * rate;
  if (durationSeconds !== undefined) elapsedSeconds = Math.min(durationSeconds, elapsedSeconds);
  const artworkUrl = publicArtwork(value.artworkUrl);
  return {
    version: 1,
    appId,
    title,
    artist: safeText(value.artist),
    album: safeText(value.album),
    ...(artworkUrl ? { artworkUrl } : {}),
    playing: value.playing,
    playbackRate: rate,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    elapsedSeconds,
    updatedAt: now
  };
}

function publicArtwork(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || (url.hostname !== 'i.scdn.co' && url.hostname !== 'image-cdn-ak.spotifycdn.com'
        && !/^is\d+-ssl\.mzstatic\.com$/.test(url.hostname))) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function writeLocalPlayback(root, value, now = Date.now()) {
  if (value === null) return clearLocalPlayback(root);
  const playback = normalizeLocalPlayback(value, now);
  if (!playback) return clearLocalPlayback(root);
  atomicWrite(root, musicFile, playback);
  return playback;
}

export function readLocalPlayerEnabled(root) {
  try {
    const file = privateFile(root, settingsFile, 1024);
    if (!file) return false;
    const value = file.data;
    if (value.version !== 1 || typeof value.enabled !== 'boolean'
      || Object.keys(value).some(key => !['version', 'enabled'].includes(key))) return false;
    return value.enabled;
  } catch { return false; }
}

export function setLocalPlayerEnabled(root, enabled) {
  if (typeof enabled !== 'boolean') throw Error('Invalid music player setting');
  atomicWrite(root, settingsFile, { version: 1, enabled });
  if (!enabled) clearLocalPlayback(root);
  return { enabled };
}

export function readLocalPlayback(root, now = Date.now()) {
  try {
    const file = privateFile(root, musicFile, 4096);
    if (!file) return null;
    const value = file.data;
    if (value.version !== 1 || value.appId !== 'com.apple.Music' || typeof value.playing !== 'boolean'
      || !Number.isSafeInteger(value.updatedAt) || value.updatedAt > now + 60_000 || now - value.updatedAt > maxAge
      || !safeText(value.title) || safeText(value.title) !== value.title || !safeText(value.artist) && value.artist !== ''
      || !safeText(value.album) && value.album !== '' || !finiteSeconds(value.elapsedSeconds)
      || (value.durationSeconds !== undefined && (!finiteSeconds(value.durationSeconds) || value.durationSeconds === 0))
      || (value.durationSeconds !== undefined && value.elapsedSeconds > value.durationSeconds)
      || !Number.isFinite(value.playbackRate) || value.playbackRate < 0 || value.playbackRate > 4
      || (value.artworkUrl !== undefined && publicArtwork(value.artworkUrl) !== value.artworkUrl)
      || Object.keys(value).some(key => !['version', 'appId', 'title', 'artist', 'album', 'artworkUrl', 'playing',
        'playbackRate', 'durationSeconds', 'elapsedSeconds', 'updatedAt'].includes(key))) return null;
    return value;
  } catch { return null; }
}

export function clearLocalPlayback(root) {
  privateRoot(root);
  const file = privateFile(root, musicFile, 4096);
  if (file) unlinkSync(file.file);
}
