import { execFile } from 'node:child_process';
import { linkSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const actions = new Map([['play', '0'], ['pause', '1'], ['next', '4'], ['previous', '5']]);
const maxAge = 90_000;
const maxArtworkBytes = 1024 * 1024;
const artworkCache = new Map(), artworkInFlight = new Map();
const positiveArtworkTTL = 60 * 60 * 1000, negativeArtworkTTL = 10_000, maxArtworkCache = 8;
const requestFile = 'music.control.request.json', responseFile = 'music.control.response.json', lockFile = 'music.control.lock';
const requestTTL = 10_000, responseTTL = 60_000, lockTTL = 65_000;
const pendingControls = new Set();
const safeText = value => typeof value === 'string'
  ? value.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128)
  : '';
const finiteSeconds = value => Number.isFinite(value) && value >= 0 && value <= 86400;

function readPrivate(root, name, limit) {
  const folder = lstatSync(root);
  if (!folder.isDirectory() || folder.isSymbolicLink()
    || (process.platform !== 'win32' && ((folder.mode & 0o077) !== 0 || folder.uid !== process.getuid?.()))) {
    throw Error('Private music data unavailable');
  }
  const path = join(root, name);
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit
    || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) {
    throw Error('Private music data unavailable');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function removePrivate(root, name, limit, id) {
  const value = readPrivate(root, name, limit);
  if (value && (id === undefined || value.id === id)) unlinkSync(join(root, name));
}

function writeExclusivePrivate(root, name, value) {
  readPrivate(root, name, 4096);
  const path = join(root, name), temporary = join(root, `.${name}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    linkSync(temporary, path);
  } finally {
    try { unlinkSync(temporary); } catch { /* Already linked or not created. */ }
  }
}

function validUUID(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function validRequest(value) {
  return value?.version === 1 && validUUID(value.id) && actions.has(value.action)
    && Number.isSafeInteger(value.createdAt) && value.createdAt > 0
    && Object.keys(value).every(key => ['version', 'id', 'action', 'createdAt'].includes(key));
}
function validLease(value) {
  return value?.version === 1 && validUUID(value.id) && Number.isSafeInteger(value.createdAt) && value.createdAt > 0
    && Object.keys(value).every(key => ['version', 'id', 'createdAt'].includes(key));
}
function validResponse(value) {
  return value?.version === 1 && validUUID(value.id) && typeof value.ok === 'boolean'
    && ['applied', 'permission-required', 'disabled', 'control-failed'].includes(value.reason)
    && (value.ok ? value.reason === 'applied' : value.reason !== 'applied')
    && Number.isSafeInteger(value.updatedAt) && value.updatedAt > 0
    && Object.keys(value).every(key => ['version', 'id', 'ok', 'reason', 'updatedAt'].includes(key));
}

function claimLease(root, lease, time) {
  const previous = readPrivate(root, lockFile, 2048);
  if (previous) {
    if (!validLease(previous)) throw Error('Invalid pending music lock');
    if (time - previous.createdAt <= lockTTL) throw Error('A music action is already in progress');
    reclaimExpiredLease(root, previous, time);
  }
  try { writeExclusivePrivate(root, lockFile, lease); }
  catch (error) { if (error.code === 'EEXIST') throw Error('A music action is already in progress'); throw error; }
}

function removeControlFiles(root, id) {
  for (const name of [lockFile, requestFile, responseFile]) {
    try { removePrivate(root, name, 4096, id); } catch { /* Never remove a replaced or invalid helper file. */ }
  }
}

function reclaimExpiredLease(root, expired, time) {
  const currentPath = join(root, lockFile), tombName = `.${lockFile}.${randomUUID()}.stale`, tombPath = join(root, tombName);
  try { renameSync(currentPath, tombPath); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  let moved;
  try { moved = readPrivate(root, tombName, 2048); }
  catch (error) {
    try { linkSync(tombPath, currentPath); unlinkSync(tombPath); } catch { /* Preserve any competing live lock. */ }
    throw error;
  }
  if (!validLease(moved) || moved.id !== expired.id || moved.createdAt !== expired.createdAt) {
    try { linkSync(tombPath, currentPath); unlinkSync(tombPath); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    throw Error('A music action is already in progress');
  }
  const request = readPrivate(root, requestFile, 4096);
  if (request && (!validRequest(request) || time - request.createdAt <= requestTTL)) {
    try { linkSync(tombPath, currentPath); unlinkSync(tombPath); } catch { /* Preserve the stale lease if recovery cannot complete. */ }
    throw Error(request && validRequest(request) ? 'A music action is already in progress' : 'Invalid pending music action');
  }
  try {
    if (request) removePrivate(root, requestFile, 4096, request.id);
    const response = readPrivate(root, responseFile, 4096);
    if (response) {
      if (!validResponse(response)) throw Error('Invalid music helper response');
      if (time - response.updatedAt > responseTTL) removePrivate(root, responseFile, 4096, response.id);
    }
    unlinkSync(tombPath);
  } catch (error) {
    try {
      const current = readPrivate(root, lockFile, 2048);
      if (!current) linkSync(tombPath, currentPath);
      unlinkSync(tombPath);
    } catch { /* Keep a competing or unrecovered lease intact. */ }
    throw error;
  }
}

function publicArtwork(value) {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (url.hostname === 'i.scdn.co' || url.hostname === 'image-cdn-ak.spotifycdn.com'
        || /^is\d+-ssl\.mzstatic\.com$/.test(url.hostname))) return url.href;
  } catch { /* Untrusted local state is ignored. */ }
}

export function readLocalPlayback(root, now = Date.now()) {
  try {
    const value = readPrivate(root, 'music.local.json', 4096);
    if (!value) return null;
    if (value.version !== 1 || value.appId !== 'com.apple.Music' || typeof value.playing !== 'boolean'
      || !Number.isSafeInteger(value.updatedAt) || value.updatedAt > now + 60_000 || now - value.updatedAt > maxAge
      || !safeText(value.title) || safeText(value.title) !== value.title
      || typeof value.artist !== 'string' || safeText(value.artist) !== value.artist
      || typeof value.album !== 'string' || safeText(value.album) !== value.album
      || !Number.isFinite(value.playbackRate) || value.playbackRate < 0 || value.playbackRate > 4
      || !finiteSeconds(value.elapsedSeconds)
      || (value.durationSeconds !== undefined && (!finiteSeconds(value.durationSeconds) || value.durationSeconds === 0))
      || (value.durationSeconds !== undefined && value.elapsedSeconds > value.durationSeconds)
      || (value.artworkUrl !== undefined && publicArtwork(value.artworkUrl) !== value.artworkUrl)
      || Object.keys(value).some(key => !['version', 'appId', 'title', 'artist', 'album', 'artworkUrl', 'playing',
        'playbackRate', 'durationSeconds', 'elapsedSeconds', 'updatedAt'].includes(key))) return null;
    return value;
  } catch { return null; }
}

export function isLocalPlayerEnabled(root) {
  try {
    const value = readPrivate(root, 'music.local.settings.json', 1024);
    return value?.version === 1 && value.enabled === true
      && Object.keys(value).every(key => ['version', 'enabled'].includes(key));
  } catch { return false; }
}

export function setLocalPlayerEnabled(root, enabled) {
  if (typeof enabled !== 'boolean') throw Error('Invalid music player setting');
  const existing = readPrivate(root, 'music.local.settings.json', 1024);
  if (existing && (existing.version !== 1 || typeof existing.enabled !== 'boolean'
    || Object.keys(existing).some(key => !['version', 'enabled'].includes(key)))) throw Error('Invalid music player setting');
  const settingsPath = join(root, 'music.local.settings.json');
  const temporary = join(root, `.music.local.settings.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, enabled }) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, settingsPath);
  } finally {
    try { unlinkSync(temporary); } catch { /* Already renamed or not created. */ }
  }
  if (!enabled) {
    const snapshot = join(root, 'music.local.json');
    try {
      const stat = lstatSync(snapshot);
      if (!stat.isFile() || stat.isSymbolicLink()
        || (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw Error('Private music data unavailable');
      unlinkSync(snapshot);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { enabled };
}

export async function controlMusic(root, action, { now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  timeoutMs = 60_000, pollIntervalMs = 100 } = {}) {
  if (!isLocalPlayerEnabled(root)) throw Error('Apple Music player is disabled');
  if (!actions.has(action)) throw Error('Music action is not supported');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000
    || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) throw Error('Invalid music control timeout');
  const lock = join(root, '.music-control-pending');
  if (pendingControls.has(lock)) throw Error('A music action is already in progress');
  pendingControls.add(lock);
  let id, claimed = false;
  try {
    const createdAt = now();
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0) throw Error('Local music clock is unavailable');
    id = randomUUID();
    const lease = { version: 1, id, createdAt };
    claimLease(root, lease, createdAt);
    claimed = true;
    const existing = readPrivate(root, requestFile, 4096);
    if (existing) {
      if (!validRequest(existing)) throw Error('Invalid pending music action');
      if (createdAt - existing.createdAt <= requestTTL) throw Error('A music action is already in progress');
      removePrivate(root, requestFile, 4096, existing.id);
    }
    const previous = readPrivate(root, responseFile, 4096);
    if (previous) {
      if (!validResponse(previous)) throw Error('Invalid music helper response');
      if (createdAt - previous.updatedAt > responseTTL) removePrivate(root, responseFile, 4096, previous.id);
    }
    if (!isLocalPlayerEnabled(root)) throw Error('Apple Music player is disabled');
    writeExclusivePrivate(root, requestFile, { ...lease, action });
    const deadline = createdAt + timeoutMs;
    while (now() < deadline) {
      if (!isLocalPlayerEnabled(root)) throw Error('Apple Music player is disabled');
      const activeLease = readPrivate(root, lockFile, 2048);
      if (!validLease(activeLease) || activeLease.id !== id || activeLease.createdAt !== createdAt
        || now() - activeLease.createdAt > lockTTL) throw Error('Apple Music control request was cancelled');
      const activeRequest = readPrivate(root, requestFile, 4096);
      if (activeRequest && (!validRequest(activeRequest) || activeRequest.id !== id
        || now() - activeRequest.createdAt > requestTTL)) throw Error('Apple Music control request expired');
      const response = readPrivate(root, responseFile, 4096);
      if (response) {
        if (!validResponse(response)) throw Error('Invalid music helper response');
        const time = now();
        if (response.updatedAt < createdAt || response.updatedAt > time + 5000 || time - response.updatedAt > responseTTL
          || response.id !== id) {
          const expired = time - response.updatedAt > responseTTL;
          if (expired) removePrivate(root, responseFile, 4096, response.id);
        } else if (response.ok) return;
        else if (response.reason === 'permission-required') throw Error('Allow Enhanced Presence Helper to control Music in macOS Automation settings');
        else if (response.reason === 'disabled') throw Error('Apple Music player was disabled');
        else throw Error('Apple Music could not apply that control');
      }
      await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
    }
    throw Error('Apple Music helper did not respond before the timeout');
  } finally {
    if (id && claimed) removeControlFiles(root, id);
    pendingControls.delete(lock);
  }
}

function artworkRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'album,appId,artist,title' || input.appId !== 'com.apple.Music') return null;
  for (const key of ['title', 'artist', 'album']) {
    if (typeof input[key] !== 'string' || input[key].length < 1 || input[key].length > 128
      || safeText(input[key]) !== input[key]) return null;
  }
  return { appId: input.appId, title: input.title, artist: input.artist, album: input.album };
}

function musicTupleMatches(playback, input) {
  return playback?.appId === input.appId && playback.title === input.title
    && playback.artist === input.artist && playback.album === input.album;
}

function imageData(mime, encoded) {
  const allowed = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] };
  if (typeof encoded !== 'string' || encoded.length > 4 * Math.ceil(maxArtworkBytes / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > maxArtworkBytes || bytes.toString('base64') !== encoded) return null;
  const prefix = allowed[mime];
  if (prefix && !prefix.every((byte, index) => bytes[index] === byte)) return null;
  if (mime === 'image/webp' && (bytes.length < 16 || bytes.toString('ascii', 0, 4) !== 'RIFF'
    || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) !== bytes.length - 8
    || !['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16)))) return null;
  if (!prefix && mime !== 'image/webp') return null;
  return `data:${mime};base64,${encoded}`;
}

export async function readLocalMusicArtwork(root, input, { run = runFile, now = Date.now } = {}) {
  const request = artworkRequest(input);
  const time = now();
  if (!request || !Number.isSafeInteger(time) || !isLocalPlayerEnabled(root)
    || !musicTupleMatches(readLocalPlayback(root, time), request)) return null;
  const key = JSON.stringify([root, request.appId, request.title, request.artist, request.album]);
  const cached = artworkCache.get(key);
  if (cached && cached.expiresAt > time) { artworkCache.delete(key); artworkCache.set(key, cached); return cached.value; }
  if (cached) artworkCache.delete(key);
  if (artworkInFlight.has(key)) return artworkInFlight.get(key);
  const promise = (async () => {
    let value = null;
    try {
      const adapter = join(root, 'vendor', 'mediaremote-adapter', 'bin', 'mediaremote-adapter.pl');
      const framework = join(root, 'build', 'MediaRemoteAdapter.framework');
      const result = await run('/usr/bin/perl', [adapter, framework, 'get', '--micros'], {
        encoding: 'utf8', timeout: 8000, maxBuffer: 2 * 1024 * 1024
      });
      const output = typeof result === 'string' ? result : result.stdout;
      if (typeof output !== 'string' || Buffer.byteLength(output) > 2 * 1024 * 1024) return null;
      const current = JSON.parse(output);
      const source = current?.parentApplicationBundleIdentifier ?? current?.bundleIdentifier;
      if (source !== 'com.apple.Music' || current.isAdvertisement === true
        || safeText(current.title) !== request.title || safeText(current.artist) !== request.artist
        || safeText(current.album) !== request.album) return null;
      const image = imageData(current.artworkMimeType, current.artworkData);
      if (!image) return null;
      if (!isLocalPlayerEnabled(root) || !musicTupleMatches(readLocalPlayback(root, now()), request)) return null;
      value = image;
      return value;
    } catch { return null; }
    finally {
      artworkCache.delete(key);
      artworkCache.set(key, { value, expiresAt: now() + (value ? positiveArtworkTTL : negativeArtworkTTL) });
      while (artworkCache.size > maxArtworkCache) artworkCache.delete(artworkCache.keys().next().value);
    }
  })().finally(() => artworkInFlight.delete(key));
  artworkInFlight.set(key, promise);
  return promise;
}
