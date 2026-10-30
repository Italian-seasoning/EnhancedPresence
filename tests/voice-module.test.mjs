import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceModule } from '../vencord-plugin/EnhancedPresenceUniversal/voice.mjs';

const fresh = (overrides = {}) => ({ version: 1, updatedAt: 10000, channelId: '123456789012345678', channelName: 'General',
  selfMute: false, selfDeaf: false, speakers: [], ...overrides });

test('voice module publishes state, applies only fresh same-channel explicit commands and clears on stop', async () => {
  let now = 10000, snapshot = fresh(), timer, cadence;
  const writes = [], mutes = [], deafens = [];
  let command = { version: 1, id: '7b24f2c1-9eea-4af4-a1bc-251cdd0fceab', createdAt: 10000,
    channelId: snapshot.channelId, action: 'mute', value: true };
  const voice = createVoiceModule({
    enabled: () => true, readSnapshot: () => snapshot, now: () => now,
    setSelfMute: value => mutes.push(value), setSelfDeaf: value => deafens.push(value),
    native: { writeVoiceState: async value => writes.push(value), takeVoiceHUDCommand: async () => command },
    every: (callback, milliseconds) => { timer = callback; cadence = milliseconds; return 1; }, cancel: () => { timer = undefined; }
  });

  await voice.start();
  assert.equal(cadence, 1000);
  assert.equal(voice.snapshot.channelId, snapshot.channelId);
  assert.deepEqual(mutes, [true]);
  assert.deepEqual(deafens, []);
  command = { ...command, id: '8b24f2c1-9eea-4af4-a1bc-251cdd0fceab', action: 'deafen', value: true, channelId: '223456789012345678' };
  await voice.refresh();
  assert.deepEqual(deafens, []);

  now += 3000;
  snapshot = fresh({ updatedAt: now, selfMute: true });
  command = null;
  await voice.refresh();
  assert.equal(writes.filter(value => value !== null).length, 2);

  await voice.stop();
  assert.equal(timer, undefined);
  assert.equal(voice.snapshot, null);
  assert.equal(writes.at(-1), null);
});

test('voice module clears native state when the call ends or the feature is disabled', async () => {
  let enabled = true, snapshot = fresh(), timer;
  const writes = [];
  const voice = createVoiceModule({ enabled: () => enabled, readSnapshot: () => snapshot, now: () => 10000,
    setSelfMute() {}, setSelfDeaf() {}, native: { writeVoiceState: async value => writes.push(value), takeVoiceHUDCommand: async () => null },
    every: callback => { timer = callback; return 1; }, cancel: () => { timer = undefined; } });

  await voice.start();
  snapshot = null;
  await voice.refresh();
  assert.equal(writes.at(-1), null);
  enabled = false;
  snapshot = fresh();
  await voice.refresh();
  assert.equal(writes.at(-1), null);
  await voice.stop();
  assert.equal(timer, undefined);
});
