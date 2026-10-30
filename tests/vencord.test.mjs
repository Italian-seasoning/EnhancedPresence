import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from '../vendor/ws/wrapper.mjs';
import { PresenceBridge } from '../presence-engine/websocket.mjs';
import { PresenceEngine } from '../presence-engine/engine.mjs';
import { parseActivity, createClient } from '../vencord-plugin/EnhancedPresenceUniversal/client.mjs';
import { message, discordActivity } from '../shared/protocol.mjs';
import { appIcon } from '../vencord-plugin/EnhancedPresenceUniversal/icons.mjs';
const id = '123456789012345678', token = 'a'.repeat(64);
const fixture = { appId: 'com.roblox.RobloxPlayer', appName: 'Roblox', details: 'Playing Roblox', privacyLevel: 'limited', startTimestamp: 100 };
async function waitFor(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() > deadline) throw Error('Timed out'); await new Promise(r => setTimeout(r, 10)); }
}
test('Vencord conversion drops private metadata, converts seconds and validates protocol', () => {
  const activity = parseActivity(JSON.stringify(message({ ...fixture, project: 'SECRET', windowTitle: 'SECRET', metadata: { private: 'SECRET' } })), id);
  assert.equal(activity.name, 'Roblox'); assert.equal(activity.timestamps.start, 100000);
  assert.equal(JSON.stringify(activity).includes('SECRET'), false);
  assert.equal(parseActivity(JSON.stringify(message(null)), id), null);
  assert.equal(parseActivity('{"type":"heartbeat","protocol":1}', id), undefined);
  for (const text of ['not json', '{"type":"activity","version":1}', JSON.stringify(message({ ...fixture, startTimestamp: -1 })), JSON.stringify(message({ ...fixture, largeImage: 'https://private' }))]) assert.throws(() => parseActivity(text, id));
});
test('music uses Listening with bounded artist, playback timing and approved public artwork', () => {
  const music = { ...fixture, kind: 'music', appId: 'com.spotify.client', appName: 'Spotify', details: 'Track title', state: 'Artist', endTimestamp: 300, artworkUrl: 'https://i.scdn.co/image/album' };
  const activity = parseActivity(JSON.stringify(message(music)), id);
  assert.equal(activity.type, 2); assert.equal(activity.details, 'Track title'); assert.equal(activity.state, 'Artist');
  assert.deepEqual(activity.timestamps, { start: 100000, end: 300000 });
  assert.equal(activity.assets.large_image, music.artworkUrl);
  assert.equal(discordActivity(music).type, 2);
  assert.equal(discordActivity(music).details, 'Track title');
  assert.equal(discordActivity(music).timestamps.end, 300);
  for (const update of [{ kind: 'other' }, { state: 'Bad\nartist' }, { endTimestamp: 50 }, { endTimestamp: 999999999999 }, { artworkUrl: 'http://i.scdn.co/image/album' }, { artworkUrl: 'https://user@i.scdn.co/image/album' }, { artworkUrl: 'https://i.scdn.co:444/image/album' }, { artworkUrl: 'file:///private/art.jpg' }, { artworkUrl: 'https://unapproved.invalid/art.jpg' }]) assert.throws(() => parseActivity(JSON.stringify(message({ ...music, ...update })), id));
  assert.throws(() => parseActivity(JSON.stringify(message({ ...fixture, state: 'Arbitrary private state' })), id));
  assert.throws(() => parseActivity(JSON.stringify(message({ ...fixture, artworkUrl: music.artworkUrl })), id));
});

test('music album is bounded, music-only, and supplies album artwork text', () => {
  const music = { ...fixture, kind: 'music', appId: 'com.apple.Music', appName: 'Apple Music', details: 'Track', state: 'Artist', album: 'Album', artworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/album.jpg' };
  const activity = parseActivity(JSON.stringify(message(music)), id);
  assert.equal(activity.details, 'Track');
  assert.equal(activity.state, 'Artist • Album');
  assert.deepEqual(activity.assets, { large_image: music.artworkUrl, large_text: 'Album' });
  const bounded = parseActivity(JSON.stringify(message({ ...music, state: 'a'.repeat(128), album: 'b'.repeat(128) })), id);
  assert.ok(bounded.state.length <= 128);
  assert.throws(() => parseActivity(JSON.stringify(message({ ...fixture, album: 'Album' })), id));
  assert.throws(() => parseActivity(JSON.stringify(message({ ...music, album: 'x'.repeat(129) })), id));
  assert.throws(() => parseActivity(JSON.stringify(message({ ...music, album: 'Bad\u0085Album' })), id));
});
test('opted-in agent project names cross the bridge without accepting paths or arbitrary state', () => {
  const state = 'Project: example-project';
  assert.equal(parseActivity(JSON.stringify(message({ ...fixture, state })), id).state, state);
  for (const value of ['Project: /private/path', 'Project: ' + 'x'.repeat(41), 'Project: Bad\nname']) {
    assert.throws(() => parseActivity(JSON.stringify(message({ ...fixture, state: value })), id));
  }
});
test('client pause/unpause, disconnect/retry, watchdog and stop clear only its own consumer', async () => {
  const published = [], statuses = [], sockets = [], timeouts = [], intervals = []; let now = 0;
  const settings = { applicationId: id, bridgeToken: token, paused: true };
  const timers = { setTimeout(fn, delay) { const x = { fn, delay }; timeouts.push(x); return x; }, clearTimeout(x) { if (x) x.cancelled = true; }, setInterval(fn) { intervals.push(fn); return 1; }, clearInterval() {} };
  const client = createClient({ getSettings: () => settings, dispatch: x => published.push(x), status: x => statuses.push(x), clock: () => now, timers,
    socketFactory(url) { assert.equal(url, 'ws://127.0.0.1:43821'); const s = { sent: [], send(x) { this.sent.push(x); }, close() { this.onclose?.(); } }; sockets.push(s); return s; }
  });
  client.start(); assert.equal(sockets.length, 0);
  settings.paused = false; client.refresh();
  const s = sockets.at(-1); s.onopen();
  assert.notEqual(statuses.at(-1), 'Connected');
  assert.equal(published.at(-1), null);
  assert.deepEqual(JSON.parse(s.sent[0]), { type: 'hello', protocol: 1, token });
  await s.onmessage({ data: JSON.stringify(message(fixture)) }); assert.equal(published.at(-1).name, 'Roblox');
  assert.equal(statuses.at(-1), 'Connected');
  now = 44999; intervals.at(-1)(); assert.equal(published.at(-1).name, 'Roblox');
  now = 45000; intervals.at(-1)(); assert.equal(published.at(-1), null);
  timeouts.find(x => !x.cancelled && x.delay === 1000).fn(); assert.equal(sockets.length, 2);
  client.stop(); const count = published.length;
  await s.onmessage({ data: JSON.stringify(message(fixture)) }); assert.equal(published.length, count);
  settings.paused = true; client.start(); assert.equal(sockets.length, 2); client.stop();
});
test('clear arriving during icon lookup prevents stale publication', async () => {
  let socket, resolve; const outputs = [];
  const settings = { applicationId: id, bridgeToken: token, paused: false };
  const client = createClient({ getSettings: () => settings, dispatch: x => outputs.push(x), socketFactory: () => (socket = { send() {}, close() {} }), resolveAsset: () => new Promise(r => resolve = r) });
  client.start(); socket.onopen();
  const pending = socket.onmessage({ data: JSON.stringify(message({ ...fixture, largeImage: 'roblox', largeText: 'Roblox' })) });
  await socket.onmessage({ data: JSON.stringify(message(null)) });
  resolve('uploaded-asset-id'); await pending;
  assert.equal(outputs.at(-1), null); assert.equal(outputs.some(x => x?.name), false); client.stop();
});
test('automatic app artwork uses a fixed public source and unknown apps cannot choose a URL', async () => {
  let socket; const outputs = [], lookups = [];
  const settings = { applicationId: id, bridgeToken: token, paused: false, appIcons: true };
  const client = createClient({ getSettings: () => settings, dispatch: x => outputs.push(x), socketFactory: () => (socket = { send() {}, close() {} }), resolveAsset: async (_id, key) => { lookups.push(key); return 'mp:verified-image'; } });
  client.start(); socket.onopen();
  await socket.onmessage({ data: JSON.stringify(message(fixture)) });
  assert.equal(lookups[0], appIcon(fixture.appId));
  assert.equal(outputs.at(-1).assets.large_image, 'mp:verified-image');
  assert.equal(outputs.at(-1).assets.large_text, 'Roblox');
  await socket.onmessage({ data: JSON.stringify(message({ ...fixture, appId: 'https://private.invalid', iconUrl: 'https://private.invalid' })) });
  assert.equal(lookups.length, 1);
  assert.equal(outputs.at(-1).assets, undefined);
  settings.appIcons = false;
  await socket.onmessage({ data: JSON.stringify(message(fixture)) });
  assert.equal(outputs.at(-1).assets, undefined);
  await socket.onmessage({ data: JSON.stringify(message({ ...fixture, largeImage: 'roblox', largeText: 'Roblox' })) });
  assert.equal(outputs.at(-1).assets, undefined);
  assert.equal(lookups.length, 1); client.stop();
});
test('automatic icon lookup cannot publish after a privacy clear', async () => {
  let socket, resolve; const outputs = [];
  const client = createClient({ getSettings: () => ({ applicationId: id, bridgeToken: token, paused: false, appIcons: true }), dispatch: x => outputs.push(x), socketFactory: () => (socket = { send() {}, close() {} }), resolveAsset: () => new Promise(r => resolve = r) });
  client.start(); socket.onopen();
  const pending = socket.onmessage({ data: JSON.stringify(message(fixture)) });
  await socket.onmessage({ data: JSON.stringify(message(null)) });
  resolve('mp:verified-image'); await pending;
  assert.equal(outputs.at(-1), null); assert.equal(outputs.some(x => x?.name), false); client.stop();
});

test('music artwork lookup is called only for eligible, enabled Apple Music activity', async t => {
  let socket; const lookups = [], outputs = [];
  const settings = { applicationId: id, bridgeToken: token, paused: false, appIcons: true };
  const artwork = 'https://is1-ssl.mzstatic.com/image/thumb/album.jpg';
  const portrait = 'https://is2-ssl.mzstatic.com/image/thumb/artist.jpg';
  const client = createClient({ getSettings: () => settings, dispatch: x => outputs.push(x), socketFactory: () => (socket = { send() {}, close() {} }),
    shouldPublishMusic: value => value.name === 'Apple Music',
    lookupMusicImages: async request => { lookups.push(request); return { albumArtworkUrl: artwork, artistArtworkUrl: portrait }; },
    resolveAsset: async (_id, url) => url === artwork ? 'mp:verified-album-art' : url === portrait ? 'mp:verified-artist-art' : undefined
  });
  t.after(() => client.stop());
  client.start(); socket.onopen();
  const apple = { ...fixture, kind: 'music', appId: 'com.apple.Music', appName: 'Apple Music', details: 'Track', state: 'Artist', album: 'Album' };
  await socket.onmessage({ data: JSON.stringify(message(apple)) });
  assert.deepEqual(lookups, [{ appId: 'com.apple.Music', title: 'Track', artist: 'Artist', album: 'Album' }]);
  assert.equal(outputs.at(-1).assets.large_image, 'mp:verified-album-art');
  assert.equal(outputs.at(-1).assets.large_text, 'Album');
  assert.equal(outputs.at(-1).assets.small_image, 'mp:verified-artist-art');
  assert.equal(outputs.at(-1).assets.small_text, 'Artist');
  await socket.onmessage({ data: '{"type":"heartbeat","protocol":1}' });
  assert.equal(lookups.length, 1);
  assert.equal(outputs.at(-1).assets.small_image, 'mp:verified-artist-art');
  await socket.onmessage({ data: JSON.stringify(message({ ...apple, appId: 'com.spotify.client' })) });
  assert.equal(lookups.length, 1);
  settings.appIcons = false;
  await socket.onmessage({ data: JSON.stringify(message(apple)) });
  assert.equal(lookups.length, 1);
  settings.appIcons = true;
  const blockedMusic = createClient({ getSettings: () => settings, dispatch: x => outputs.push(x), socketFactory: () => (socket = { send() {}, close() {} }),
    shouldPublishMusic: () => false, lookupMusicImages: async request => { lookups.push(request); return { albumArtworkUrl: artwork }; } });
  t.after(() => blockedMusic.stop());
  blockedMusic.start(); socket.onopen();
  await socket.onmessage({ data: JSON.stringify(message(apple)) });
  assert.equal(lookups.length, 1);
});

test('late album and artist images cannot replace a changed song or republish after pause', async t => {
  let socket; const requests = [], outputs = [], settings = { applicationId: id, bridgeToken: token, paused: false, appIcons: true };
  const client = createClient({ getSettings: () => settings, dispatch: value => outputs.push(value), socketFactory: () => (socket = { send() {}, close() {} }),
    resolveAsset: async (_id, url) => url,
    lookupMusicImages: request => new Promise(resolve => requests.push({ request, resolve })) });
  t.after(() => client.stop());
  client.start(); socket.onopen();
  const first = { ...fixture, kind: 'music', appId: 'com.apple.Music', appName: 'Apple Music', details: 'First', state: 'Artist', album: 'First album' };
  const second = { ...first, details: 'Second', album: 'Second album' };
  const oldPending = socket.onmessage({ data: JSON.stringify(message(first)) });
  const newPending = socket.onmessage({ data: JSON.stringify(message(second)) });
  assert.equal(requests.length, 2);
  requests[1].resolve({ albumArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/second.jpg', artistArtworkUrl: 'https://is2-ssl.mzstatic.com/image/thumb/second-artist.jpg' });
  await newPending;
  requests[0].resolve({ albumArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/first.jpg', artistArtworkUrl: 'https://is2-ssl.mzstatic.com/image/thumb/first-artist.jpg' });
  await oldPending;
  assert.equal(outputs.at(-1).details, 'Second');
  assert.equal(outputs.at(-1).assets.large_text, 'Second album');
  assert.equal(outputs.at(-1).assets.small_text, 'Artist');
  const pausedPending = socket.onmessage({ data: JSON.stringify(message({ ...second, details: 'Paused', album: 'Paused album' })) });
  client.stop();
  requests[2].resolve({ albumArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/paused.jpg', artistArtworkUrl: 'https://is2-ssl.mzstatic.com/image/thumb/paused-artist.jpg' });
  await pausedPending;
  assert.equal(outputs.at(-1), null);
  client.start(); socket.onopen();
  const disconnectedPending = socket.onmessage({ data: JSON.stringify(message({ ...second, details: 'Disconnected', album: 'Disconnected album' })) });
  socket.onclose();
  requests[3].resolve({ albumArtworkUrl: 'https://is1-ssl.mzstatic.com/image/thumb/disconnected.jpg', artistArtworkUrl: 'https://is2-ssl.mzstatic.com/image/thumb/disconnected-artist.jpg' });
  await disconnectedPending;
  assert.equal(outputs.at(-1), null);
});
test('music yields to another integration and resumes on heartbeat without duplicate dispatches', async t => {
  let socket, occupied = true; const outputs = [];
  const client = createClient({ getSettings: () => ({ applicationId: id, bridgeToken: token, paused: false }), shouldPublishMusic: () => !occupied, dispatch: value => outputs.push(value), socketFactory: () => (socket = { send() {}, close() {} }) });
  t.after(() => client.stop());
  client.start(); socket.onopen();
  const music = { ...fixture, kind: 'music', details: 'Track title', state: 'Artist' };
  await socket.onmessage({ data: JSON.stringify(message(music)) });
  assert.equal(outputs.some(value => value?.type === 2), false);
  occupied = false;
  await socket.onmessage({ data: '{"type":"heartbeat","protocol":1}' });
  assert.equal(outputs.at(-1).type, 2);
  const count = outputs.length;
  await socket.onmessage({ data: '{"type":"heartbeat","protocol":1}' });
  assert.equal(outputs.length, count);
  occupied = true;
  await socket.onmessage({ data: '{"type":"heartbeat","protocol":1}' });
  assert.equal(outputs.at(-1), null);
  await socket.onmessage({ data: JSON.stringify(message(null)) });
  occupied = false;
  await socket.onmessage({ data: '{"type":"heartbeat","protocol":1}' });
  assert.equal(outputs.at(-1), null); client.stop();
});
test('synthetic engine → authenticated loopback WebSocket → mocked Vencord dispatcher', async t => {
  const bridge = new PresenceBridge(token, { port: 0 });
  const port = await bridge.start(); const outputs = [], sockets = [];
  const client = createClient({ getSettings: () => ({ applicationId: id, bridgeToken: token, paused: false }), dispatch: x => outputs.push(x),
    socketFactory: () => { const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://discord.com' }); sockets.push(ws); return ws; }
  });
  t.after(async () => { client.stop(); for (const ws of sockets) ws.terminate(); await bridge.stop(); });
  const engine = new PresenceEngine({ switchDelaySeconds: 0 });
  bridge.update(await engine.update({ appId: fixture.appId, pid: 123, inactive: false, idleSeconds: 0 }, 100000));
  client.start(); await waitFor(() => outputs.some(x => x?.name === 'Roblox'));
  assert.equal(bridge.server.address().address, '127.0.0.1');
  assert.equal(bridge.authenticatedCount(), 1);
  bridge.update(await engine.update({ appId: 'com.apple.mail', pid: 456, inactive: false, idleSeconds: 0 }));
  await waitFor(() => outputs.at(-1) === null);
  const unauth = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://discord.com' });
  let leaked = false; unauth.on('message', () => leaked = true); await once(unauth, 'open');
  const closed = once(unauth, 'close'); unauth.send(JSON.stringify({ type: 'hello', protocol: 1, token: 'b'.repeat(64) })); await closed;
  assert.equal(leaked, false);
  const rejected = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://example.invalid' });
  await once(rejected, 'error');
  await bridge.stop(); await waitFor(() => outputs.at(-1) === null);
  assert.equal(bridge.authenticatedCount(), 0);
});
