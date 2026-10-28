import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstalledIconLookup } from '../vencord-plugin/EnhancedPresenceUniversal/installed-icons.mjs';

test('installed icons accept known bundle IDs, use installed bundles and cache concurrent requests', async () => {
  const files = [], searches = [];
  const lookup = createInstalledIconLookup({ roots: ['/Applications', '/System/Applications'], exists: path => path === '/Applications/Spotify.app', findBundle: async id => { searches.push(id); return ['/System/Applications/Music.app']; }, getFileIcon: async path => { files.push(path); return 'data:image/png;base64,REALICON'; } });
  assert.equal(await lookup('../private'), undefined);
  assert.equal(await lookup('unknown.app'), undefined);
  const icons = await Promise.all([lookup('com.spotify.client'), lookup('com.spotify.client')]);
  assert.equal(icons[0], 'data:image/png;base64,REALICON'); assert.equal(files.length, 1);
  assert.equal(await lookup('com.apple.Music'), 'data:image/png;base64,REALICON');
  assert.deepEqual(searches, ['com.apple.Music']);
  assert.deepEqual(files, ['/Applications/Spotify.app', '/System/Applications/Music.app']);
});
test('installed icon lookup rejects paths outside app roots and unsafe image data', async () => {
  let reads = 0;
  const lookup = createInstalledIconLookup({ roots: ['/Applications'], exists: () => false, findBundle: async () => ['/private/Spotify.app', '/Applications/../private/Spotify.app', '/Applications/Spotify.app/file'], getFileIcon: async () => { reads++; return 'file:///private/data'; } });
  assert.equal(await lookup('com.spotify.client'), undefined); assert.equal(reads, 0);
  const invalid = createInstalledIconLookup({ roots: ['/Applications'], exists: () => true, findBundle: async () => [], getFileIcon: async () => 'https://unapproved.invalid/icon.png' });
  assert.equal(await invalid('com.spotify.client'), undefined);
});
