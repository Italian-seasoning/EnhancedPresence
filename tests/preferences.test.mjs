import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceEngine } from '../presence-engine/engine.mjs';
import { inQuietHours, validateConfig } from '../presence-engine/profiles.mjs';

const at = (h, m = 0) => new Date(2026, 9, 28, h, m);
const snap = { appId: 'com.apple.dt.Xcode', pid: 5, idleSeconds: 0, inactive: false };

test('quiet hours handle ranges that wrap past midnight', () => {
  const q = { enabled: true, start: '23:00', end: '07:00' };
  assert.equal(inQuietHours(q, at(23, 30)), true);
  assert.equal(inQuietHours(q, at(3)), true);
  assert.equal(inQuietHours(q, at(7)), false);
  assert.equal(inQuietHours(q, at(12)), false);
  assert.equal(inQuietHours({ ...q, enabled: false }, at(3)), false);
  assert.equal(inQuietHours({ enabled: true, start: '09:00', end: '17:00' }, at(10)), true);
});

test('engine clears presence during quiet hours and shows it afterwards', async () => {
  const engine = new PresenceEngine({ quietHours: { enabled: true, start: '23:00', end: '07:00' } });
  assert.equal(await engine.update(snap, at(2).getTime()), null);
  assert.equal((await engine.update(snap, at(12).getTime())).appId, 'com.apple.dt.Xcode');
});

test('custom phrases replace the built-in list and are validated', async () => {
  const engine = new PresenceEngine({ agent: { enabled: false }, phrases: { 'com.apple.dt.Xcode': ['Only this phrase'] } });
  assert.equal((await engine.update(snap, at(12).getTime())).details, 'Only this phrase');
  for (const bad of [{ x: [] }, { x: ['a'] }, { 'bad id': ['okay'] }, { x: 'text' }]) assert.throws(() => validateConfig({ phrases: bad }));
  assert.throws(() => validateConfig({ quietHours: { enabled: true, start: '25:00', end: '07:00' } }));
});
