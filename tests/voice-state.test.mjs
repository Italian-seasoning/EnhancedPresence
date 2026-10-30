import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVoiceSnapshot, normalizeVoiceCommand, voiceCommandIsCurrent } from '../vencord-plugin/EnhancedPresenceUniversal/voice-state.mjs';

const snapshot = (overrides = {}) => ({
  version: 1, updatedAt: 10000, channelId: '123456789012345678', channelName: 'General',
  selfMute: false, selfDeaf: false,
  speakers: [{ id: '223456789012345678', name: 'Alex', speaking: true }], ...overrides
});

test('voice snapshots expose only bounded display state and accept the exact freshness limit', () => {
  const value = normalizeVoiceSnapshot(snapshot({ token: 'ignored' }), 15000);
  assert.deepEqual(value, {
    version: 1, updatedAt: 10000, channelId: '123456789012345678', channelName: 'General',
    selfMute: false, selfDeaf: false,
    speakers: [{ id: '223456789012345678', name: 'Alex', speaking: true }]
  });
});

test('voice snapshots fail closed on stale, future, malformed or disconnected state', () => {
  assert.equal(normalizeVoiceSnapshot(snapshot(), 15001), null);
  assert.equal(normalizeVoiceSnapshot(snapshot({ updatedAt: 20000 }), 10000), null);
  assert.equal(normalizeVoiceSnapshot(snapshot({ channelId: null }), 10000), null);
  assert.equal(normalizeVoiceSnapshot(snapshot({ selfMute: 'false' }), 10000), null);
  assert.equal(normalizeVoiceSnapshot(null, 10000), null);
});

test('voice names and speaker lists are bounded and safe to display', () => {
  const value = normalizeVoiceSnapshot(snapshot({
    channelName: 'General\n@everyone',
    speakers: Array.from({ length: 12 }, (_, i) => ({ id: `${i + 1}23456789012345678`, name: `User ${i}`, speaking: i % 2 === 0 }))
  }), 10000);
  assert.equal(value.channelName, 'General @everyone');
  assert.equal(value.speakers.length, 8);
  assert.equal(value.speakers[0].speaking, true);
  assert.equal(normalizeVoiceSnapshot(snapshot({ speakers: [{ id: 'bad', name: 'User', speaking: true }] }), 10000), null);
});

test('native voice commands accept only explicit mute/deafen desired states', () => {
  const mute = { version: 1, id: '7B24F2C1-9EEA-4AF4-A1BC-251CDD0FCEAB', createdAt: 10000,
    channelId: '123456789012345678', action: 'mute', value: true };
  assert.deepEqual(normalizeVoiceCommand(mute, 10000), { ...mute, id: mute.id.toLowerCase() });
  assert.equal(normalizeVoiceCommand({ ...mute, action: 'shell' }, 10000), null);
  assert.equal(normalizeVoiceCommand({ ...mute, value: 1 }, 10000), null);
  assert.equal(normalizeVoiceCommand({ ...mute, channelId: '../Discord' }, 10000), null);
});

test('HUD commands expire and are bound to the currently connected voice channel', () => {
  const command = normalizeVoiceCommand({ version: 1, id: '7B24F2C1-9EEA-4AF4-A1BC-251CDD0FCEAB',
    createdAt: 10000, channelId: '123456789012345678', action: 'deafen', value: false }, 10000);
  assert.equal(voiceCommandIsCurrent(command, '123456789012345678', 12000), true);
  assert.equal(voiceCommandIsCurrent(command, '123456789012345678', 12001), false);
  assert.equal(voiceCommandIsCurrent(command, '223456789012345678', 11000), false);
  assert.equal(voiceCommandIsCurrent(command, null, 11000), false);
});
