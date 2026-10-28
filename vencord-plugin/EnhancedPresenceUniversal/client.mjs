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
  const valid = x => typeof x === 'string' && x.length >= 1 && x.length <= 128 && !/[\x00-\x1f]/.test(x);
  if (!a || !valid(a.appId) || !valid(a.appName) || !valid(a.details) || a.privacyLevel !== 'limited' || !Number.isSafeInteger(a.startTimestamp) || a.startTimestamp <= 0 || a.startTimestamp > Date.now() / 1000 + 60) throw Error('Invalid activity');
  if (a.kind !== undefined && !['app', 'music'].includes(a.kind)) throw Error('Invalid activity kind');
  const music = a.kind === 'music';
  // Only these public normalized fields cross into Discord. Metadata is discarded.
  const activity = { application_id: applicationId, name: a.appName, details: a.details, type: music ? 2 : 0, flags: 1, timestamps: { start: a.startTimestamp * 1000 } };
  if (a.state !== undefined) {
    if (!valid(a.state) || (!music && !/^(Media|Cut|Edit|Fusion|Color|Fairlight|Deliver) page$/.test(a.state))) throw Error('Invalid workspace');
    activity.state = a.state;
  }
  if (a.endTimestamp !== undefined) {
    if (!music || !Number.isSafeInteger(a.endTimestamp) || a.endTimestamp <= a.startTimestamp || a.endTimestamp - a.startTimestamp > 86400) throw Error('Invalid playback time');
    activity.timestamps.end = a.endTimestamp * 1000;
  }
  if (a.artworkUrl !== undefined) {
    if (!music || !validMusicArtwork(a.artworkUrl)) throw Error('Invalid music artwork');
    activity.assets = { large_image: a.artworkUrl, large_text: a.details };
  }
  if (a.largeImage !== undefined) {
    if (!/^[a-z0-9_-]{1,64}$/.test(a.largeImage) || !valid(a.largeText)) throw Error('Invalid asset');
    if (!activity.assets) activity.assets = { large_image: a.largeImage, large_text: a.largeText };
  }
  return activity;
}

export function createClient({ getSettings, dispatch, socketFactory, resolveAsset = async () => undefined, shouldPublishMusic = () => true, status = () => {}, clock = () => Date.now(), timers = globalThis }) {
  let socket, retryTimer, watchdog, running = false, retry = 1000, freshAt = 0, revision = 0, latestMusic, published;
  const publish = activity => { const key = JSON.stringify(activity); if (key !== published) { published = key; dispatch(activity); } };
  const clear = () => { revision++; publish(null); };
  const validSettings = s => !s.paused && /^\d{17,20}$/.test(s.applicationId) && /^[a-f0-9]{64}$/.test(s.bridgeToken);
  function connect() {
    if (!running) return;
    const s = getSettings();
    if (!validSettings(s)) { clear(); status('Paused or missing configuration'); return; }
    status('Connecting');
    const ws = socketFactory('ws://127.0.0.1:43821'); socket = ws; freshAt = clock();
    ws.onopen = () => {
      if (ws !== socket || !running) return;
      retry = 1000; freshAt = clock(); status('Connected');
      ws.send(JSON.stringify({ type: 'hello', protocol: 1, token: s.bridgeToken }));
    };
    ws.onmessage = async event => {
      if (ws !== socket || !running) return;
      const current = getSettings();
      if (!validSettings(current) || current.applicationId !== s.applicationId || current.bridgeToken !== s.bridgeToken) { clear(); ws.close(); return; }
      try {
        let activity = parseActivity(event.data, current.applicationId);
        freshAt = clock();
        if (activity === undefined) {
          if (!latestMusic) return;
          activity = parseActivity(latestMusic, current.applicationId);
        } else latestMusic = activity?.type === 2 ? event.data : undefined;
        if (activity === null) { clear(); return; }
        if (activity.type === 2 && !shouldPublishMusic(activity)) { clear(); return; }
        const version = ++revision;
        if (current.appIcons === false) delete activity.assets;
        if (!activity.assets && current.appIcons === true) {
          const icon = appIcon(JSON.parse(activity.type === 2 ? latestMusic : event.data).activity.appId);
          if (icon) activity.assets = { large_image: icon, large_text: activity.name };
        }
        if (activity.assets) {
          const key = activity.assets.large_image;
          let resolved;
          let timeout;
          try { resolved = await Promise.race([resolveAsset(s.applicationId, key), new Promise(r => { timeout = timers.setTimeout(() => r(undefined), 1500); })]); } catch { /* omit unavailable icons */ }
          finally { timers.clearTimeout(timeout); }
          if (resolved) activity.assets.large_image = resolved;
          else delete activity.assets;
        }
        if (version === revision && ws === socket && running && validSettings(getSettings()) && (activity.type !== 2 || shouldPublishMusic(activity))) publish(activity);
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
