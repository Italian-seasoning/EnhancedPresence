// GPL-3.0-or-later. Vencord-specific client, without app detection or account APIs.
import { appIcon, validMusicArtwork } from './icons.mjs';
export function parseActivity(text, applicationId) {
  if (typeof text !== 'string' || text.length > 8192 || !/^\d{17,20}$/.test(applicationId)) throw Error('Invalid input');
  const m = JSON.parse(text);
  if (m.protocol !== 1) throw Error('Unsupported protocol');
  if (m.type === 'presence_clear') return null;
  if (m.type === 'heartbeat') return undefined;
  if (m.type !== 'presence_update') throw Error('Unsupported message');
  const a = m.activity;
  const valid = x => typeof x === 'string' && x.length >= 1 && x.length <= 128 && !/[\x00-\x1f\x7f-\x9f]/.test(x);
  if (!a || !valid(a.appId) || !valid(a.appName) || !valid(a.details) || a.privacyLevel !== 'limited' || !Number.isSafeInteger(a.startTimestamp) || a.startTimestamp <= 0 || a.startTimestamp > Date.now() / 1000 + 60) throw Error('Invalid activity');
  if (a.kind !== undefined && !['app', 'music'].includes(a.kind)) throw Error('Invalid activity kind');
  const music = a.kind === 'music';
  if (a.album !== undefined && (!music || !valid(a.album))) throw Error('Invalid album');
  // Only these public normalized fields cross into Discord. Metadata is discarded.
  const activity = { application_id: applicationId, name: a.appName, details: a.details, type: music ? 2 : 0, flags: 1, timestamps: { start: a.startTimestamp * 1000 } };
  if (a.state !== undefined) {
    if (!valid(a.state) || (!music && !/^(?:(Media|Cut|Edit|Fusion|Color|Fairlight|Deliver) page|Project: [\w .-]{1,40})$/.test(a.state))) throw Error('Invalid workspace');
  }
  if (music && a.album !== undefined) {
    const labels = [a.state?.slice(0, 62), a.album.slice(0, 62)].filter(Boolean);
    if (labels.length) activity.state = labels.join(' • ').slice(0, 128);
  } else if (a.state !== undefined) activity.state = a.state;
  if (a.endTimestamp !== undefined) {
    if (!music || !Number.isSafeInteger(a.endTimestamp) || a.endTimestamp <= a.startTimestamp || a.endTimestamp - a.startTimestamp > 86400) throw Error('Invalid playback time');
    activity.timestamps.end = a.endTimestamp * 1000;
  }
  if (a.artworkUrl !== undefined) {
    if (!music || !validMusicArtwork(a.artworkUrl)) throw Error('Invalid music artwork');
    activity.assets = { large_image: a.artworkUrl, large_text: a.album ?? a.details };
  }
  if (a.largeImage !== undefined) {
    if (!/^[a-z0-9_-]{1,64}$/.test(a.largeImage) || !valid(a.largeText)) throw Error('Invalid asset');
    if (!activity.assets) activity.assets = { large_image: a.largeImage, large_text: a.largeText };
  }
  return activity;
}

export function createClient({ getSettings, dispatch, socketFactory, resolveAsset = async () => undefined, lookupMusicImages = async () => null, shouldPublishMusic = () => true, status = () => {}, clock = () => Date.now(), timers = globalThis }) {
  let socket, retryTimer, watchdog, running = false, retry = 1000, freshAt = 0, revision = 0, latestMusic, musicImageCache, published;
  const publish = activity => { const key = JSON.stringify(activity); if (key !== published) { published = key; dispatch(activity); } };
  const clear = () => { revision++; musicImageCache = undefined; publish(null); };
  const validSettings = s => !s.paused && /^\d{17,20}$/.test(s.applicationId) && /^[a-f0-9]{64}$/.test(s.bridgeToken);
  function connect() {
    if (!running) return;
    const s = getSettings();
    if (!validSettings(s)) { clear(); status('Paused or missing configuration'); return; }
    status('Connecting');
    const ws = socketFactory('ws://127.0.0.1:43821'); socket = ws; freshAt = clock();
    ws.onopen = () => {
      if (ws !== socket || !running) return;
      retry = 1000; freshAt = clock();
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, token: s.bridgeToken }));
    };
    ws.onmessage = async event => {
      if (ws !== socket || !running) return;
      const current = getSettings();
      if (!validSettings(current) || current.applicationId !== s.applicationId || current.bridgeToken !== s.bridgeToken) { clear(); ws.close(); return; }
      try {
        let activity = parseActivity(event.data, current.applicationId);
        let musicSource;
        freshAt = clock(); status('Connected');
        if (activity === undefined) {
          if (!latestMusic) return;
          musicSource = JSON.parse(latestMusic).activity;
          activity = parseActivity(latestMusic, current.applicationId);
        } else {
          latestMusic = activity?.type === 2 ? event.data : undefined;
          if (activity?.type === 2) musicSource = JSON.parse(event.data).activity;
        }
        if (activity === null) { clear(); return; }
        if (activity.type === 2 && !shouldPublishMusic(activity)) { clear(); return; }
        const version = ++revision;
        if (current.appIcons === false) delete activity.assets;
        if (activity.type === 2 && current.appIcons === true
          && musicSource?.appId === 'com.apple.Music'
          && (!activity.assets || validMusicArtwork(activity.assets.large_image))
          && [musicSource.details, musicSource.state, musicSource.album].every(value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f-\x9f]/.test(value))) {
          try {
            const request = { appId: musicSource.appId, title: musicSource.details, artist: musicSource.state, album: musicSource.album };
            const key = JSON.stringify([current.applicationId, request.appId, request.title, request.artist, request.album]);
            let images;
            if (musicImageCache?.key === key && musicImageCache.retryAt > clock()) images = musicImageCache.images;
            else {
              images = await lookupMusicImages(request);
              const latestSettings = getSettings();
              if (version !== revision || ws !== socket || !running || !validSettings(latestSettings)
                || latestSettings.applicationId !== s.applicationId || latestSettings.bridgeToken !== s.bridgeToken
                || latestSettings.appIcons !== true || !shouldPublishMusic(activity)) return;
              const albumArtworkUrl = validMusicArtwork(images?.albumArtworkUrl) ? images.albumArtworkUrl : undefined;
              const artistArtworkUrl = validMusicArtwork(images?.artistArtworkUrl) ? images.artistArtworkUrl : undefined;
              musicImageCache = { key, images: albumArtworkUrl ? { albumArtworkUrl, ...(artistArtworkUrl ? { artistArtworkUrl } : {}) } : null,
                retryAt: clock() + (albumArtworkUrl && artistArtworkUrl ? 60 * 60 * 1000 : 60 * 1000) };
            }
            if (version !== revision || ws !== socket || !running) return;
            if (images && typeof images === 'object') {
              const album = validMusicArtwork(images.albumArtworkUrl) ? images.albumArtworkUrl : null;
              const artist = validMusicArtwork(images.artistArtworkUrl) ? images.artistArtworkUrl : null;
              if (album) activity.assets = { ...(activity.assets ?? {}), large_image: album, large_text: musicSource.album };
              if (artist) {
                activity.assets ??= {};
                activity.assets.small_image = artist;
                activity.assets.small_text = musicSource.state;
              }
            }
          } catch { /* Missing cover art never interrupts presence. */ }
        }
        if (version !== revision || ws !== socket || !running || !validSettings(getSettings())) return;
        if (activity.type === 2 && !shouldPublishMusic(activity)) { clear(); return; }
        if (!activity.assets && current.appIcons === true) {
          const icon = appIcon(JSON.parse(activity.type === 2 ? latestMusic : event.data).activity.appId);
          if (icon) activity.assets = { large_image: icon, large_text: activity.name };
        }
        if (activity.assets) {
          const keys = ['large_image', 'small_image'].filter(key => typeof activity.assets[key] === 'string');
          const resolved = await Promise.all(keys.map(async key => {
            let timeout;
            try {
              const value = await Promise.race([resolveAsset(s.applicationId, activity.assets[key]), new Promise(r => { timeout = timers.setTimeout(() => r(undefined), 1500); })]);
              return [key, value];
            } catch { return [key, undefined]; }
            finally { timers.clearTimeout(timeout); }
          }));
          const latestSettings = getSettings();
          if (version !== revision || ws !== socket || !running || !validSettings(latestSettings)
            || latestSettings.applicationId !== s.applicationId || latestSettings.bridgeToken !== s.bridgeToken
            || latestSettings.appIcons !== current.appIcons || (activity.type === 2 && !shouldPublishMusic(activity))) return;
          for (const [key, value] of resolved) {
            if (value) activity.assets[key] = value;
            else if (key === 'large_image' && activity.assets.large_image && validMusicArtwork(activity.assets.large_image)) continue;
            else delete activity.assets[key];
          }
          if (!activity.assets.large_image && !activity.assets.small_image) delete activity.assets;
        }
        const finalSettings = getSettings();
        if (version === revision && ws === socket && running && validSettings(finalSettings)
          && finalSettings.applicationId === s.applicationId && finalSettings.bridgeToken === s.bridgeToken
          && finalSettings.appIcons === current.appIcons && (activity.type !== 2 || shouldPublishMusic(activity))) publish(activity);
      } catch { clear(); status('Invalid engine message'); ws.close(); }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (ws !== socket) return;
      socket = undefined; latestMusic = undefined; clear(); status('Disconnected');
      if (running && validSettings(getSettings())) {
        retryTimer = timers.setTimeout(connect, retry); retry = Math.min(retry * 2, 30000);
      }
    };
  }
  return {
    start() {
      if (running) return;
      running = true; connect();
      watchdog = timers.setInterval(() => {
        if (socket && clock() - freshAt >= 45000) { clear(); socket.close(); }
      }, 15000);
    },
    stop() {
      running = false; timers.clearTimeout(retryTimer); timers.clearInterval(watchdog);
      const old = socket; socket = undefined; latestMusic = undefined; old?.close(); clear(); status('Stopped');
    },
    refresh() { this.stop(); this.start(); }
  };
}
