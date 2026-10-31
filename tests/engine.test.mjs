import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceEngine, publicActivity } from '../presence-engine/engine.mjs';
import { profiles, validateConfig } from '../presence-engine/profiles.mjs';
import { discordActivity } from '../shared/protocol.mjs';
const snapshot = (appId = 'com.roblox.RobloxPlayer', extra = {}) => ({ appId, pid: 123, idleSeconds: 0, inactive: false, ...extra });

test('installed Roblox Studio bundle identifier is detected', async () => {
  const activity = await new PresenceEngine().update(snapshot('com.Roblox.RobloxStudio'));
  assert.equal(activity?.appName, 'Roblox Studio');
});

test('creative and productivity apps use verified macOS identifiers and public labels', async () => {
  const expected = {
    'com.pixelmatorteam.pixelmator.x': 'Pixelmator Pro',
    'com.apple.FinalCut': 'Final Cut Pro',
    'com.apple.motionapp': 'Motion',
    'com.figma.Desktop': 'Figma',
    'com.todesktop.2601167vjw8xe': 'Paper',
    'com.scenegroup.cavalry': 'Cavalry',
    'org.godotengine.godot': 'Godot',
    'com.apple.iWork.Pages': 'Pages',
    'com.apple.Numbers': 'Numbers',
    'com.obsproject.obs-studio': 'OBS Studio'
  };
  const engine = new PresenceEngine({ switchDelaySeconds: 0 });
  for (const [id, name] of Object.entries(expected)) {
    assert.equal((await engine.update(snapshot(id)))?.appName, name);
  }
});

test('expanded coverage still clears password managers, private apps and Discord clients', async () => {
  const ids = ['com.apple.Passwords', 'org.keepassxc.keepassxc', 'dev.vencord.Vesktop', 'com.apple.FaceTime'];
  const engine = new PresenceEngine({ allowlist: ids, profiles: Object.fromEntries(ids.map(id => [id, { name: 'App', details: 'Using app' }])) });
  for (const id of ids) assert.equal(await engine.update(snapshot(id)), null);
});

test('all curated profiles produce safe app-aware activity', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 0 });
  for (const id of Object.keys(profiles)) {
    const activity = await engine.update(snapshot(id, { windowTitle: 'SECRET', document: '/private/file', appName: 'SECRET' }), 200000);
    if (!engine.config.allowlist.includes(id)) { assert.equal(activity, null); continue; }
    assert.equal(activity.appName, profiles[id][0]);
    assert.equal(JSON.stringify(activity).includes('SECRET'), false);
    assert.equal(JSON.stringify(activity).includes('/private'), false);
    assert.equal(activity.largeImage, undefined);
  }
});
test('sessions survive repeated snapshots but reset on switch, PID restart, idle and pause', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 0 });
  assert.equal((await engine.update(snapshot(), 100000)).startTimestamp, 100);
  assert.equal((await engine.update(snapshot(), 110000)).startTimestamp, 100);
  assert.equal((await engine.update(snapshot('com.apple.Safari'), 120000)).startTimestamp, 120);
  assert.equal((await engine.update(snapshot('com.apple.Safari', { pid: 456 }), 130000)).startTimestamp, 130);
  assert.equal(await engine.update(snapshot('com.apple.Safari', { idleSeconds: 300 })), null);
  assert.equal((await engine.update(snapshot(), 140000)).startTimestamp, 140);
  engine.config.enabled = false;
  assert.equal(await engine.update(snapshot()), null);
});
test('replacement waits sixty stable seconds and preserves the foreground entry timestamp', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 60 });
  const first = await engine.update(snapshot(undefined, { launchTimestamp: 90, runningApps: { 'com.roblox.RobloxPlayer': [123] } }), 100000);
  const switching = snapshot('com.apple.Safari', { launchTimestamp: 105, runningApps: { 'com.roblox.RobloxPlayer': [123], 'com.apple.Safari': [123] } });
  assert.deepEqual(await engine.update(switching, 110000), first);
  assert.equal(engine.nextDeadline(110000), 60000);
  assert.deepEqual(await engine.update(switching, 169999), first);
  const switched = await engine.update(switching, 170000);
  assert.equal(switched.appId, 'com.apple.Safari');
  assert.equal(switched.startTimestamp, 105);
  assert.equal(engine.pending, null);
  assert.equal(engine.nextDeadline(170000), null);
});

test('a replacement never keeps an exited app visible during its delay', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 60 });
  const oldApp = 'com.roblox.RobloxPlayer', nextApp = 'com.apple.Safari';
  const first = snapshot(oldApp, { pid: 123, launchTimestamp: 90, runningApps: { [oldApp]: [123] } });
  const replacement = snapshot(nextApp, { pid: 456, launchTimestamp: 105, runningApps: { [nextApp]: [456] } });
  await engine.update(first, 100000);
  assert.equal(await engine.update(replacement, 110000), null);
  assert.equal(engine.pending?.id, nextApp);
  assert.equal(engine.session, null);
  assert.equal((await engine.update(replacement, 170000)).appId, nextApp);
});

test('default 120 second switch delay holds only the old allowed process, then uses new launch time', async () => {
  const engine = new PresenceEngine();
  const oldApp = 'com.roblox.RobloxPlayer', nextApp = 'com.apple.Safari';
  const first = await engine.update(snapshot(oldApp, { pid: 123, launchTimestamp: 90, runningApps: { [oldApp]: [123] } }), 100000);
  const next = snapshot(nextApp, { pid: 456, launchTimestamp: 105, runningApps: { [oldApp]: [123], [nextApp]: [456] } });
  assert.deepEqual(await engine.update(next, 110000), first);
  assert.equal(engine.nextDeadline(110000), 120000);
  assert.deepEqual(await engine.update(next, 229999), first);
  const switched = await engine.update(next, 230000);
  assert.equal(switched.appId, nextApp);
  assert.equal(switched.startTimestamp, 105);
});

test('retained output is authorized by its own profile, not the current foreground profile', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 60 });
  const oldApp = 'com.roblox.RobloxPlayer', unknownApp = 'org.example.Unlisted';
  const first = await engine.update(snapshot(oldApp, { pid: 123, runningApps: { [oldApp]: [123] } }), 100000);
  const held = await engine.update(snapshot(unknownApp, { pid: 456, runningApps: { [oldApp]: [123] } }), 110000);
  assert.deepEqual(publicActivity(held, engine.config), first);
  assert.equal(publicActivity({ ...held, appId: unknownApp }, engine.config), null);
});

test('unknown foreground holds only a still-running allowed app for the configured delay', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 60 });
  const oldApp = 'com.roblox.RobloxPlayer', unknownApp = 'org.example.Unlisted';
  const first = snapshot(oldApp, { pid: 123, launchTimestamp: 90, runningApps: { [oldApp]: [123] } });
  const unknown = snapshot(unknownApp, { pid: 456, runningApps: { [oldApp]: [123] } });
  await engine.update(first, 100000);
  const held = await engine.update(unknown, 110000);
  assert.equal(held.appId, oldApp);
  assert.equal(await engine.update(unknown, 170000), null);
  assert.equal(engine.session, null);
});

test('lock, idle, quiet hours, blocked apps and missing snapshots bypass pending retention', async () => {
  const oldApp = 'com.roblox.RobloxPlayer', nextApp = 'com.apple.Safari';
  const makeEngine = () => new PresenceEngine({ switchDelaySeconds: 60 });
  const old = snapshot(oldApp, { pid: 123, launchTimestamp: 90, runningApps: { [oldApp]: [123] } });
  const ordinarySwitch = snapshot(nextApp, { pid: 456, launchTimestamp: 105, runningApps: { [oldApp]: [123], [nextApp]: [456] } });
  for (const invalid of [
    snapshot(nextApp, { inactive: true, runningApps: { [oldApp]: [123] } }),
    snapshot(nextApp, { idleSeconds: 300, runningApps: { [oldApp]: [123] } }),
    null,
    snapshot('com.apple.Passwords', { pid: 789, runningApps: { [oldApp]: [123] } })
  ]) {
    const engine = makeEngine();
    const published = await engine.update(old, 100000);
    assert.deepEqual(await engine.update(ordinarySwitch, 110000), published);
    assert.equal(await engine.update(invalid, 120000), null);
    assert.equal(engine.session, null);
    assert.equal(engine.pending, null);
  }
  const quiet = makeEngine();
  await quiet.update(old, 100000);
  await quiet.update(ordinarySwitch, 110000);
  quiet.config.quietHours = { enabled: true, start: '00:00', end: '23:59' };
  assert.equal(await quiet.update(ordinarySwitch, new Date('2026-10-29T12:00:00Z').getTime()), null);
  assert.equal(quiet.session, null);
  assert.equal(quiet.pending, null);
});
test('pending replacements cancel on a third app, return, PID change and privacy clears', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 60 });
  const id = 'com.roblox.RobloxPlayer';
  const firstInput = snapshot(id, { runningApps: { [id]: [123] } });
  const first = await engine.update(firstInput, 100000);
  await engine.update(snapshot('com.apple.Safari', { runningApps: { [id]: [123] } }), 110000);
  await engine.update(snapshot('com.apple.TextEdit', { runningApps: { [id]: [123] } }), 130000);
  assert.equal(engine.pending.id, 'com.apple.TextEdit');
  assert.equal(engine.pending.dueAt, 190000);
  assert.deepEqual(await engine.update(snapshot(id, { runningApps: { [id]: [123] } }), 140000), first);
  assert.equal(engine.pending, null);
  await engine.update(snapshot(id, { pid: 456, runningApps: { [id]: [123, 456] } }), 150000);
  assert.equal(engine.pending.pid, 456);
  assert.equal((await engine.update(snapshot(id, { pid: 456, runningApps: { [id]: [123, 456] } }), 210000)).startTimestamp, 150);
  for (const invalid of [snapshot('com.apple.mail'), snapshot(undefined, { inactive: true }), snapshot(undefined, { idleSeconds: 300 }), null]) {
    await engine.update(snapshot(id, { runningApps: { [id]: [123] } }), 220000);
    await engine.update(snapshot('com.apple.Safari', { runningApps: { [id]: [123] } }), 230000);
    assert.equal(await engine.update(invalid, 240000), null);
    assert.equal(engine.pending, null);
    assert.equal(engine.session, null);
  }
});
test('revoking the published app while a replacement qualifies clears immediately', async () => {
  const engine = new PresenceEngine({ switchDelaySeconds: 60 });
  await engine.update(snapshot(), 100000);
  await engine.update(snapshot('com.apple.Safari'), 110000);
  engine.config.denylist.push('com.roblox.RobloxPlayer');
  assert.equal(await engine.update(snapshot('com.apple.Safari'), 120000), null);
  assert.equal(engine.nextDeadline(120000), 50000);
  assert.equal((await engine.update(snapshot('com.apple.Safari'), 170000)).startTimestamp, 110);
});
test('retained app activity immediately removes revoked private details', async () => {
  const id = 'com.apple.TextEdit';
  const engine = new PresenceEngine({ disclosure: { [id]: { showName: true, showContext: false } } });
  await engine.update(snapshot(id, { documentName: 'PRIVATE', runningApps: { [id]: [123] } }), 100000);
  await engine.update(snapshot('com.hnc.Discord', { runningApps: { [id]: [123] } }), 110000);
  engine.config.disclosure[id].showName = false;
  assert.equal((await engine.update(snapshot('com.hnc.Discord', { runningApps: { [id]: [123] } }), 120000)).details, 'Editing in TextEdit');
});
test('behavior settings have bounded defaults and validated music sources', () => {
  const c = validateConfig({});
  assert.equal(c.switchDelaySeconds, 120);
  assert.equal(c.trackingEnabled, true);
  assert.deepEqual(c.music, { enabled: true, sources: ['com.apple.Music'], priority: 'app' });
  assert.equal(profiles['com.apple.Music'][0], 'Apple Music');
  assert.equal(profiles['com.spotify.client'][0], 'Spotify');
  for (const bad of [-1, 301, 2.5, '60', null]) assert.throws(() => validateConfig({ switchDelaySeconds: bad }));
  assert.throws(() => validateConfig({ trackingEnabled: 'true' }));
  for (const bad of [null, [], { enabled: 'yes' }, { sources: ['unknown.app'] }, { sources: ['com.spotify.client'] }, { sources: ['browsers'] }, { sources: ['com.apple.Music', 'com.apple.Music'] }, { priority: 'invalid' }]) assert.throws(() => validateConfig({ music: bad }));
  const custom = validateConfig({ music: { enabled: false, sources: [], priority: 'app' } });
  assert.equal(custom.music.enabled, false);
  custom.music.sources.push('com.apple.Music');
  assert.deepEqual(validateConfig({}).music.sources, ['com.apple.Music']);
  const isolated = validateConfig({});
  isolated.denylist.push('com.apple.TextEdit');
  assert.deepEqual(validateConfig({}).denylist, []);
});
test('non-object configuration fails closed instead of enabling defaults', () => {
  for (const invalid of [null, [], 'disabled', false, 0]) assert.throws(() => validateConfig(invalid), /Invalid configuration/);
});
test('sensitive, unknown, denied, asleep, locked, malformed data fail closed', async () => {
  const engine = new PresenceEngine({ allowlist: ['com.apple.mail', 'com.roblox.RobloxPlayer'] });
  for (const value of [null, {}, snapshot('com.apple.mail'), snapshot('unknown.app'), snapshot(undefined, { inactive: true }), snapshot(undefined, { idleSeconds: NaN }), snapshot(undefined, { pid: 0 }), snapshot(undefined, { inactive: undefined })]) assert.equal(await engine.update(value), null);
  engine.config.denylist.push('com.roblox.RobloxPlayer');
  assert.equal(await engine.update(snapshot()), null);
});
test('custom apps require curated labels and assets require explicit uploaded keys', async () => {
  const engine = new PresenceEngine({ allowlist: ['org.example.app'], profiles: { 'org.example.app': { name: 'Example App', details: 'Working' } }, assets: { 'org.example.app': 'example-app' } });
  const activity = await engine.update(snapshot('org.example.app'));
  assert.equal(activity.largeImage, 'example-app');
  assert.equal(discordActivity(activity).assets.large_image, 'example-app');
  assert.throws(() => validateConfig({ assets: { x: 'https://private/image' } }));
  assert.throws(() => validateConfig({ idleSeconds: 0 }));
});
test('Resolve uses only bounded public page/render metadata and failure falls back', async () => {
  const id = 'com.blackmagic-design.DaVinciResolve';
  const engine = new PresenceEngine({ resolve: { enabled: true } }, async () => ({ page: 'color', rendering: false, project: 'SECRET', timeline: 'SECRET' }));
  const activity = await engine.update(snapshot(id));
  assert.equal(activity.details, 'Color grading');
  assert.equal(JSON.stringify(activity).includes('SECRET'), false);
  engine.provider = async () => ({ rendering: true });
  assert.equal((await engine.update(snapshot(id))).details, 'Rendering video');
  engine.provider = async () => { throw Error('SECRET'); };
  assert.ok(['Cooking up a cut', 'Coloring outside the lines', 'Making frames behave', 'One more tiny tweak'].includes((await engine.update(snapshot(id))).details));
});
