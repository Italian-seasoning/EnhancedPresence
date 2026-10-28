import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceEngine } from '../presence-engine/engine.mjs';
import { safeName } from '../presence-engine/names.mjs';
import { validateConfig } from '../presence-engine/profiles.mjs';
const text = 'com.apple.TextEdit';
const resolve = 'com.blackmagic-design.DaVinciResolve';
const snapshot = (appId, extra = {}) => ({ appId, pid: 123, inactive: false, idleSeconds: 0, ...extra });
test('names default to private and toggling one app cannot expose another', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 0, disclosure: { [text]: { showName: true, showContext: false } } });
  assert.equal((await engine.update(snapshot(text, { documentName: 'Bedtime routine.txt — Edited' }))).details, 'Editing in TextEdit · “Bedtime routine”');
  assert.equal((await engine.update(snapshot('com.apple.FinalCut', { documentName: 'PRIVATE PROJECT' }))).details.includes('PRIVATE PROJECT'), false);
  engine.config.disclosure[text].showName = false;
  assert.equal((await engine.update(snapshot(text, { documentName: 'PRIVATE' }))).details, 'Editing in TextEdit');
});
test('hidden, blocked, idle and private apps never expose names', async () => {
  const engine = new PresenceEngine({ disclosure: { [text]: { showName: true, showContext: false } }, denylist: [text] });
  assert.equal(await engine.update(snapshot(text, { documentName: 'PRIVATE' })), null);
  engine.config.denylist = [];
  assert.equal(await engine.update(snapshot(text, { documentName: 'PRIVATE', idleSeconds: 300 })), null);
  engine.config.allowlist = [];
  assert.equal(await engine.update(snapshot(text, { documentName: 'PRIVATE' })), null);
  assert.throws(() => validateConfig({ disclosure: { 'com.apple.mail': { showName: true, showContext: false } } }));
});
test('names reject paths, URLs, controls, untitled windows and oversized input', () => {
  for (const value of ['/Users/private/doc', 'file:///private', 'https://private', 'C:\\private', 'Bad\nname', 'Bad\u202ename', 'Untitled', 'Untitled 2', 'x'.repeat(81), {}, null]) assert.equal(safeName(value), undefined);
  assert.equal(safeName('Bedtime routine.rtf — Edited'), 'Bedtime routine');
});
test('Resolve project and page controls are independent and revoke immediately', async () => {
  let requestedNames;
  const engine = new PresenceEngine({ disclosure: { [resolve]: { showName: false, showContext: true } } }, async options => { requestedNames = options.showName; return { page: 'color', projectName: 'Bedtime routine', rendering: false }; });
  let activity = await engine.update(snapshot(resolve));
  assert.equal(requestedNames, false); assert.equal(activity.details, 'Color grading'); assert.equal(activity.state, 'Color page');
  engine.config.disclosure[resolve] = { showName: true, showContext: false };
  activity = await engine.update(snapshot(resolve));
  assert.equal(requestedNames, true); assert.ok(activity.details.includes('“Bedtime routine”')); assert.equal(activity.state, undefined);
  engine.config.disclosure[resolve] = { showName: false, showContext: false };
  assert.equal((await engine.update(snapshot(resolve))).details.includes('Bedtime routine'), false);
});
test('unavailable metadata uses generic activity and keeps the session timer', async () => {
  const engine = new PresenceEngine({ disclosure: { [resolve]: { showName: true, showContext: true } } }, async () => null);
  assert.equal((await engine.update(snapshot(resolve), 100000)).startTimestamp, 100);
  assert.equal((await engine.update(snapshot(resolve), 110000)).startTimestamp, 100);
});
test('name choices cannot mutate defaults or another configuration', () => {
  const first = validateConfig({});
  first.disclosure[text] = { showName: true, showContext: false };
  assert.deepEqual(validateConfig({}).disclosure, {});
});
