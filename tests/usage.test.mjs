import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageTracker } from '../presence-engine/usage.mjs';
import { validateConfig } from '../presence-engine/profiles.mjs';

const app = 'com.roblox.RobloxPlayer';
const other = 'com.apple.Safari';
const snapshot = (appId = app, extra = {}) => ({ appId, pid: 123, idleSeconds: 0, inactive: false, ...extra });
const fixture = t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'presence-usage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test('usage follows actual foreground visits independently of delayed presence', t => {
  const tracker = new UsageTracker({ root: fixture(t) });
  const c = validateConfig({});
  tracker.observe(snapshot(), c, 100000);
  tracker.observe(snapshot(other), c, 110000);
  tracker.observe(snapshot(), c, 115000);
  assert.deepEqual(tracker.summary(125000), {
    [app]: { todaySeconds: 20, totalSeconds: 20, sessionSeconds: 10 },
    [other]: { todaySeconds: 5, totalSeconds: 5, sessionSeconds: 0 }
  });
});
test('usage stops at idle expiry and excludes hidden, blocked, paused and disabled tracking', t => {
  const tracker = new UsageTracker({ root: fixture(t) });
  const c = validateConfig({ idleSeconds: 30 });
  tracker.observe(snapshot(), c, 100000);
  tracker.observe(snapshot(app, { idleSeconds: 40 }), c, 140000);
  assert.equal(tracker.summary(150000)[app].totalSeconds, 30);
  tracker.observe(snapshot('com.apple.mail'), c, 150000);
  tracker.observe(snapshot(other), { ...c, allowlist: [app] }, 160000);
  tracker.observe(snapshot(other), { ...c, enabled: false }, 170000);
  tracker.observe(snapshot(other), { ...c, trackingEnabled: false }, 180000);
  tracker.observe(snapshot(other, { inactive: true }), c, 190000);
  assert.equal(tracker.summary(200000)[app].totalSeconds, 30);
  assert.equal(tracker.summary(200000)[other], undefined);
});
test('usage splits foreground time at local midnight', t => {
  const tracker = new UsageTracker({ root: fixture(t) });
  const start = new Date(2026, 9, 21, 23, 59, 50).getTime();
  tracker.observe(snapshot(), validateConfig({}), start);
  assert.deepEqual(tracker.summary(start + 20000)[app], { todaySeconds: 10, totalSeconds: 20, sessionSeconds: 20 });
});
test('private atomic checkpoints are sparse and restart downtime is excluded', t => {
  const root = fixture(t);
  const file = path.join(root, 'usage.local.json');
  const c = validateConfig({});
  const tracker = new UsageTracker({ root });
  tracker.observe(snapshot(app, { documentName: 'SECRET' }), c, 100000);
  tracker.flush(115000);
  const first = fs.statSync(file);
  assert.equal(first.mode & 0o777, 0o600);
  tracker.observe(snapshot(), c, 130000);
  tracker.flush(150000);
  assert.equal(fs.statSync(file).ino, first.ino);
  tracker.observe(snapshot(), c, 160000);
  tracker.flush(175000);
  assert.notEqual(fs.statSync(file).ino, first.ino);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('SECRET'), false);
  assert.equal(JSON.parse(raw).totals[app], 75000);
  assert.deepEqual(fs.readdirSync(root), ['usage.local.json']);
  const restarted = new UsageTracker({ root });
  assert.equal(restarted.summary(500000)[app].totalSeconds, 75);
  restarted.observe(snapshot(), c, 500000);
  assert.equal(restarted.summary(510000)[app].totalSeconds, 85);
  restarted.suspend(510000);
  assert.equal(new UsageTracker({ root }).summary(600000)[app].totalSeconds, 85);
});
test('missing detector observations cannot extend attribution past forty-five seconds', t => {
  const tracker = new UsageTracker({ root: fixture(t) });
  tracker.observe(snapshot(), validateConfig({}), 100000);
  assert.equal(tracker.summary(130000)[app].totalSeconds, 30);
  assert.equal(tracker.summary(200000)[app].totalSeconds, 45);
  tracker.flush(210000);
  assert.equal(tracker.summary(220000)[app].totalSeconds, 45);
});
test('corrupt saved totals are preserved and reported instead of overwritten', t => {
  const root = fixture(t);
  const file = path.join(root, 'usage.local.json');
  fs.writeFileSync(file, '{broken', { mode: 0o600 });
  assert.throws(() => new UsageTracker({ root }), /Cannot load local usage data/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});
