import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNowPlaying, selectMusicActivity } from '../presence-engine/music.mjs';
import { validateConfig } from '../presence-engine/profiles.mjs';
import { discordActivity, message } from '../shared/protocol.mjs';
import { parseActivity } from '../vencord-plugin/EnhancedPresenceUniversal/client.mjs';

test('real normalized music crosses the Vencord protocol with or without artist metadata', () => {
  for (const artist of ['Artist', undefined, '']) {
    const track = normalizeNowPlaying({ playing: true, bundleIdentifier: 'com.apple.Music', title: 'Track', artist });
    const activity = parseActivity(JSON.stringify(message(track)), '123456789012345678');
    assert.equal(activity.type, 2);
    assert.equal(activity.details, 'Track');
    assert.equal(activity.state, artist || undefined);
  }
});

test('album is music-only metadata; artist stays on the wire and Discord displays both', () => {
  const track = normalizeNowPlaying({ playing: true, bundleIdentifier: 'com.apple.Music', title: 'Track', artist: 'Artist', album: 'Album' });
  assert.equal(track.state, 'Artist');
  assert.equal(message(track).activity.album, 'Album');
  const activity = parseActivity(JSON.stringify(message(track)), '123456789012345678');
  assert.equal(activity.state, 'Artist • Album');
  assert.equal(discordActivity(track).state, 'Artist • Album');
  assert.equal(track.album, 'Album');
});

test('hiding Apple Music also hides its background track', () => {
  const config = validateConfig({ allowlist: ['com.apple.dt.Xcode'], music: { priority: 'music' } });
  const app = { appId: 'com.apple.dt.Xcode' }, snapshot = { appId: app.appId, pid: 1, idleSeconds: 0, inactive: false };
  const track = normalizeNowPlaying({ playing: true, bundleIdentifier: 'com.apple.Music', title: 'Track' });
  assert.equal(selectMusicActivity(app, track, config, app.appId, snapshot), app);
  config.allowlist.push('com.apple.Music');
  assert.equal(selectMusicActivity(app, track, config, app.appId, snapshot), track);
});

test('only Apple Music can publish music even with legacy source selections', () => {
  const config = validateConfig({});
  const app = { appId: 'com.apple.dt.Xcode' };
  const snapshot = { appId: app.appId, pid: 1, idleSeconds: 0, inactive: false };
  for (const appId of ['com.spotify.client', 'com.google.Chrome', 'ai.perplexity.comet']) {
    config.music.sources.push(appId);
    const track = normalizeNowPlaying({ playing: true, bundleIdentifier: appId, title: 'Track' });
    assert.equal(selectMusicActivity(app, track, config, app.appId, snapshot), app);
  }
});
