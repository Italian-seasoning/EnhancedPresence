import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OutputController } from '../presence-engine/output.mjs';
import { parsePower, saverActive, musicSuspended } from '../presence-engine/power.mjs';
import { parseCpuTime, parsePs } from '../presence-engine/perf.mjs';
import { validateConfig } from '../presence-engine/profiles.mjs';

const fakes = (clients = 0) => {
  const bridge = { clients, updates: [], authenticatedCount() { return this.clients; }, update(a) { this.updates.push(a); }, async stop() {} };
  const rpc = { running: false, sent: [], start() { this.running = true; }, update(a) { this.sent.push(a); }, async stop() { this.running = false; } };
  return { bridge, rpc };
};
const activity = { appName: 'Xcode', details: 'Building' };

test('auto mode: IPC takes over after the grace period without a plugin, and yields when one connects', () => {
  let now = 1000;
  const { bridge, rpc } = fakes(0);
  const out = new OutputController({ bridge, rpc, graceMs: 20000, now: () => now });
  out.update(activity);
  assert.equal(rpc.running, false);
  assert.equal(out.source, 'none');
  now += 20000; out.update();
  assert.equal(rpc.running, true); assert.equal(out.source, 'ipc');
  assert.equal(rpc.sent.at(-1), activity);
  bridge.clients = 1; out.update();
  assert.equal(rpc.running, false); assert.equal(rpc.sent.at(-1), null); assert.equal(out.source, 'vencord');
});

test('vencord mode never uses IPC and ipc mode always does', () => {
  const a = fakes(0), v = new OutputController({ ...a, mode: () => 'vencord', graceMs: 0 });
  v.update(activity); assert.equal(a.rpc.running, false);
  const b = fakes(1), i = new OutputController({ ...b, mode: () => 'ipc' });
  i.update(activity); assert.equal(b.rpc.running, true);
  assert.equal(b.bridge.updates.at(-1), null);
});

test('battery saver rules', () => {
  const battery = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t18%; discharging; 2:10 remaining present: true";
  const power = parsePower(battery, ' lowpowermode         0\n');
  assert.deepEqual(power, { onBattery: true, percent: 18, lowPower: false });
  assert.equal(saverActive('auto', power), true);
  assert.equal(saverActive('auto', { onBattery: true, percent: 80, lowPower: false }), false);
  assert.equal(saverActive('auto', { onBattery: false, percent: 100, lowPower: true }), true);
  assert.equal(parsePower('', '').onBattery, false);
  assert.equal(saverActive('off', power), false); assert.equal(saverActive('on', null), true);
});

test('Automatic Low Power Mode keeps event-driven music while explicit saver and CPU protection suspend it', () => {
  assert.equal(saverActive('auto', { onBattery: false, percent: 100, lowPower: true }), true);
  assert.equal(musicSuspended('auto', false), false);
  assert.equal(musicSuspended('off', false), false);
  assert.equal(musicSuspended('on', false), true);
  for (const mode of ['auto', 'on', 'off']) assert.equal(musicSuspended(mode, true), true);
});

test('performance parsing reads CPU time and keeps only our processes', () => {
  assert.equal(parseCpuTime('1:02.50'), 62.5); assert.equal(parseCpuTime('1-00:00:01'), 86401); assert.ok(Number.isNaN(parseCpuTime('x')));
  const ps = ' 10 51200 0:01.20 /opt/homebrew/bin/node /x/presence-engine/main.mjs --detect\n 11 8192 0:00.40 /x/build/detector\n 12 99999 5:00.00 /usr/bin/other\n 13 20480 0:00.20 /usr/bin/perl /x/vendor/mediaremote-adapter/bin/mediaremote-adapter.pl stream\n 14 16384 0:03.55 /usr/sbin/mediaremoted\n 15 12000 0:00.70 /System/Library/PrivateFrameworks/MediaRemote.framework/Support/mediaremoteagent\n';
  const found = parsePs(ps);
  assert.deepEqual(found.map(p => p.pid), [10, 11, 13]);
  assert.equal(found[0].rssMB, 50);
});

test('new settings validate', () => {
  assert.equal(validateConfig({}).output, 'auto'); assert.equal(validateConfig({}).power.saver, 'auto');
  assert.throws(() => validateConfig({ output: 'other' })); assert.throws(() => validateConfig({ power: { saver: 'maybe' } }));
});

test("the engine's controls.mjs matches the plugin's copy", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../presence-engine/controls.mjs'), read('../vencord-plugin/EnhancedPresenceUniversal/controls.mjs'));
});
