import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, symlinkSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readControls, updateApp, updateIdle, updateBehavior, readRuntimeStatus } from '../vencord-plugin/EnhancedPresenceUniversal/controls.mjs';
import { defaultConfig } from '../presence-engine/profiles.mjs';
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'presence-controls-'));
  const path = join(root, 'config.local.json');
  writeFileSync(path, JSON.stringify({ ...defaultConfig, unrelated: 'preserved', token: 'PRIVATE' }), { mode: 0o600 });
  try { fn(root, path); } finally { rmSync(root, { recursive: true, force: true }); }
}
const id = 'com.blackmagic-design.DaVinciResolve';
test('app manager returns public controls without private config and keeps protected apps blocked', () => fixture((root) => {
  const data = readControls(root);
  assert.equal(data.apps.find(a => a.id === id).visibility, 'allowed');
  const notes = data.apps.find(a => a.id === 'com.apple.Notes');
  assert.deepEqual([notes.name, notes.details, notes.visibility, notes.supportsName], ['Apple Notes', 'Writing notes', 'hidden', false]);
  assert.equal(data.apps.find(a => a.id === 'com.apple.mail').visibility, 'blocked');
  assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
  assert.throws(() => updateApp(root, { id: 'com.apple.mail', visibility: 'allowed' }));
}));
test('app manager allow, hide, block and public edits persist without changing unrelated settings', () => fixture((root, path) => {
  for (const visibility of ['blocked', 'hidden', 'allowed']) {
    assert.equal(updateApp(root, { id, visibility }).apps.find(a => a.id === id).visibility, visibility);
  }
  assert.equal(updateApp(root, { id, visibility: 'allowed', name: 'Resolve', details: 'Making a video' }).apps.find(a => a.id === id).details, 'Making a video');
  assert.equal(updateApp(root, { id, visibility: 'allowed', reset: true }).apps.find(a => a.id === id).name, 'DaVinci Resolve');
  const c = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(c.unrelated, 'preserved'); assert.equal(c.token, 'PRIVATE');
  assert.equal(statSync(path).mode & 0o777, 0o600);
}));
test('invalid app edits and idle durations leave the saved configuration unchanged', () => fixture((root, path) => {
  const before = readFileSync(path, 'utf8');
  for (const input of [{ id: '../elsewhere', visibility: 'allowed' }, { id, visibility: 'invalid' }, { id, visibility: 'allowed', name: 'x', details: 'Bad' }, { id, visibility: 'allowed', name: 'Bad\nname', details: 'Bad' }, { id: 'unknown.app', visibility: 'allowed' }]) assert.throws(() => updateApp(root, input));
  assert.throws(() => updateIdle(root, 1));
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(updateIdle(root, 600).idleSeconds, 600);
}));
test('adding an application requires a bounded new custom profile and explicit allow', () => fixture((root, path) => {
  const appId = 'org.example.notesapp';
  const data = updateApp(root, { id: appId, visibility: 'allowed', create: true, name: 'Example Notes', details: 'Writing notes' });
  const added = data.apps.find(app => app.id === appId);
  assert.deepEqual([added.name, added.details, added.visibility, added.custom, added.editable], ['Example Notes', 'Writing notes', 'allowed', true, true]);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(saved.profiles[appId], { name: 'Example Notes', details: 'Writing notes' });
  assert.ok(saved.allowlist.includes(appId));
  const beforeDuplicate = readFileSync(path, 'utf8');
  assert.throws(() => updateApp(root, { id: appId, visibility: 'allowed', create: true, name: 'Changed', details: 'Changed' }));
  assert.equal(readFileSync(path, 'utf8'), beforeDuplicate);
}));
test('new app creation rejects protected, previously blocked, malformed or unconfirmed profiles without changes', () => fixture((root, path) => {
  const appId = 'org.example.privateapp';
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.denylist.push(appId);
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  const before = readFileSync(path, 'utf8');
  for (const input of [
    { id: '__proto__', visibility: 'allowed', create: true, name: 'Prototype', details: 'Using app' },
    { id: 'constructor', visibility: 'allowed', create: true, name: 'Constructor', details: 'Using app' },
    { id: 'malformed', visibility: 'allowed', create: true, name: 'Malformed', details: 'Using app' },
    { id: 'com.apple.mail', visibility: 'allowed', create: true, name: 'Mail', details: 'Checking mail' },
    { id: appId, visibility: 'allowed', create: true, name: 'Private', details: 'Writing notes' },
    { id: 'org.example.newapp', visibility: 'hidden', create: true, name: 'New app', details: 'Using app' },
    { id: 'org.example.newapp', visibility: 'allowed', create: true, name: 'New\napp', details: 'Using app' },
    { id: 'org.example.newapp', visibility: 'allowed', create: true, name: 'New app', details: 'Using app\u0085' },
    { id: 'org.example.newapp', visibility: 'allowed', name: 'New app', details: 'Using app' }
  ]) assert.throws(() => updateApp(root, input));
  assert.equal(readFileSync(path, 'utf8'), before);
}));
test('app manager rejects symlinked and shared local configuration', () => fixture((root, path) => {
  chmodSync(path, 0o644); assert.throws(() => readControls(root)); chmodSync(path, 0o600);
  renameSync(path, join(root, 'original')); symlinkSync(join(root, 'original'), path); assert.throws(() => readControls(root));
}));
test('per-app name and workspace switches save independently and reject unsupported disclosure', () => fixture((root, path) => {
  let app = updateApp(root, { id, visibility: 'allowed', showName: true }).apps.find(a => a.id === id);
  assert.equal(app.showName, true); assert.equal(app.showContext, false);
  app = updateApp(root, { id, visibility: 'allowed', showContext: true }).apps.find(a => a.id === id);
  assert.equal(app.showName, true); assert.equal(app.showContext, true);
  app = updateApp(root, { id, visibility: 'allowed', showName: false }).apps.find(a => a.id === id);
  assert.equal(app.showName, false); assert.equal(app.showContext, true);
  const before = readFileSync(path, 'utf8');
  assert.throws(() => updateApp(root, { id: 'com.apple.TextEdit', visibility: 'allowed', showContext: true }));
  assert.throws(() => updateApp(root, { id: 'com.apple.mail', visibility: 'blocked', showName: true }));
  assert.equal(readFileSync(path, 'utf8'), before);
}));
test('behavior controls persist bounded changes and pause companion tracking together', () => fixture((root, path) => {
  const data = updateBehavior(root, { enabled: false, switchDelaySeconds: 60, trackingEnabled: false, music: { enabled: true, sources: ['com.apple.Music'], priority: 'app' } });
  assert.equal(data.enabled, false); assert.equal(data.trackingEnabled, false);
  assert.equal(data.switchDelaySeconds, 60);
  assert.deepEqual(data.music, { enabled: true, sources: ['com.apple.Music'], priority: 'app' });
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).unrelated, 'preserved');
  for (const input of [{ enabled: 1 }, { switchDelaySeconds: -1 }, { switchDelaySeconds: 301 }, { switchDelaySeconds: 1.5 }, { trackingEnabled: 'yes' }, { music: { sources: ['unapproved'] } }, { music: { sources: ['com.spotify.client'] } }, { music: { sources: ['browsers'] } }, { music: { priority: 'random' } }, { music: { enabled: false, unknown: true } }, { token: 'overwrite' }]) {
    const before = readFileSync(path, 'utf8');
    assert.throws(() => updateBehavior(root, input));
    assert.equal(readFileSync(path, 'utf8'), before);
  }
  assert.equal(updateBehavior(root, { switchDelaySeconds: 0 }).switchDelaySeconds, 0);
  assert.equal(updateBehavior(root, { switchDelaySeconds: 300 }).switchDelaySeconds, 300);
  assert.equal(statSync(path).mode & 0o777, 0o600);
}));
test('runtime status returns only bounded public fields and falls back to persisted local totals', () => fixture(root => {
  const now = Date.now();
  const date = new Date(now);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  writeFileSync(join(root, 'usage.local.json'), JSON.stringify({ version: 1, totals: { [id]: 90000, 'com.apple.mail': 999000 }, days: { [day]: { [id]: 30000 } } }), { mode: 0o600 });
  let data = readRuntimeStatus(root, now);
  assert.deepEqual(data.usage[id], { totalSeconds: 90, todaySeconds: 30, sessionSeconds: 0 });
  assert.equal(data.usage['com.apple.mail'], undefined); assert.equal(data.stale, true);
  writeFileSync(join(root, 'status.local.json'), JSON.stringify({ updatedAt: now, pending: { appId: id, appName: 'DaVinci Resolve', since: now - 20000, dueAt: now + 40000 }, music: { available: true, source: 'com.apple.Music' }, usage: { [id]: { totalSeconds: 110, todaySeconds: 50, sessionSeconds: 20 } }, token: 'PRIVATE' }), { mode: 0o600 });
  data = readRuntimeStatus(root, now);
  assert.equal(data.pending.appId, id); assert.equal(data.stale, false);
  assert.equal(data.usage[id].sessionSeconds, 20); assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
  assert.equal(readControls(root).usage[id].totalSeconds, 110);
  assert.equal(readRuntimeStatus(root, now + 91000).usage[id].totalSeconds, 90);
  chmodSync(join(root, 'status.local.json'), 0o644);
  assert.throws(() => readRuntimeStatus(root, now));
  assert.equal(updateBehavior(root, { enabled: false }).enabled, false);
}));
test('corrupt usage leaves behavior controls usable and exposes the preserved-data error', () => fixture(root => {
  writeFileSync(join(root, 'usage.local.json'), '{broken', { mode: 0o600 });
  assert.match(readRuntimeStatus(root).usageError, /could not be loaded/i);
  assert.equal(updateBehavior(root, { trackingEnabled: false }).trackingEnabled, false);
}));

test('current activity is bounded and hidden immediately when paused, stale or revoked', () => fixture(root => {
  const now = Date.now();
  const activity = { appId: id, appName: 'DaVinci Resolve', details: 'Editing video', token: 'PRIVATE' };
  const path = join(root, 'status.local.json');
  const save = value => writeFileSync(path, JSON.stringify({ updatedAt: now, music: { available: false }, activity: value }), { mode: 0o600 });
  save(activity);
  assert.deepEqual(readRuntimeStatus(root, now).activity, { appId: id, appName: 'DaVinci Resolve', details: 'Editing video' });
  assert.equal(readRuntimeStatus(root, now + 91000).activity, null);
  updateBehavior(root, { enabled: false });
  assert.equal(readRuntimeStatus(root, now).activity, null);
  updateBehavior(root, { enabled: true });
  updateApp(root, { id, visibility: 'hidden' });
  assert.equal(readRuntimeStatus(root, now).activity, null);
  updateApp(root, { id, visibility: 'allowed' });
  save({ ...activity, details: 'Bad\ntext' });
  assert.throws(() => readRuntimeStatus(root, now), /activity/i);
}));
