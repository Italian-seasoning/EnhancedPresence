import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackPosition } from '../vencord-plugin/EnhancedPresenceUniversal/music-timing.mjs';

test('a visible player catches up to an older playback snapshot without accumulating timer drift', () => {
  const track = { playing: true, elapsedSeconds: 20, durationSeconds: 200, updatedAt: 10000, playbackRate: 1 };
  assert.equal(playbackPosition(track, 25000), 35);
  assert.equal(playbackPosition(track, 27000), 37);
});

test('pause, seek, playback rate and end-of-track use the latest source anchor', () => {
  const track = { playing: false, elapsedSeconds: 20, durationSeconds: 200, updatedAt: 10000, playbackRate: 0 };
  assert.equal(playbackPosition(track, 40000), 20);
  assert.equal(playbackPosition({ ...track, playing: true, playbackRate: 2 }, 13000), 26);
  assert.equal(playbackPosition({ ...track, playing: true, elapsedSeconds: 120, playbackRate: 1, updatedAt: 40000 }, 42000), 122);
  assert.equal(playbackPosition({ ...track, playing: true, elapsedSeconds: 199, playbackRate: 1 }, 15000), 200);
});

test('missing snapshots and clock skew never create negative or invalid positions', () => {
  assert.equal(playbackPosition(null, 10000), 0);
  assert.equal(playbackPosition({ playing: true, elapsedSeconds: 20, updatedAt: 20000 }, 10000), 20);
});
