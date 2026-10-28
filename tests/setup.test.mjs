import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli = fileURLToPath(new URL('../presence-engine/setup.mjs', import.meta.url));
function run(args) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); }
async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ep-setup-'));
  t.after(() => rm(dir, { recursive: true }));
  return path.join(dir, 'config.json');
}
test('setup creates paused config and refuses to overwrite existing settings', async t => {
  const config = await fixture(t);
  assert.equal(run(['init', '--config', config]).status, 0);
  assert.equal(JSON.parse(await readFile(config, 'utf8')).enabled, false);
  const original = await readFile(config, 'utf8');
  assert.notEqual(run(['init', '--config', config]).status, 0);
  assert.equal(await readFile(config, 'utf8'), original);
});
test('allow/deny and pause/resume preserve unrelated settings', async t => {
  const config = await fixture(t);
  assert.equal(run(['init', '--config', config]).status, 0);
  for (const args of [['allow', 'org.example.app', '--name', 'Example App', '--details', 'Working'], ['deny', 'com.Roblox.RobloxStudio'], ['resume']]) assert.equal(run([...args, '--config', config]).status, 0);
  const c = JSON.parse(await readFile(config, 'utf8'));
  assert.equal(c.profiles['org.example.app'].name, 'Example App');
  assert.ok(c.allowlist.includes('org.example.app')); assert.ok(c.denylist.includes('com.Roblox.RobloxStudio')); assert.equal(c.enabled, true); assert.equal(c.resolve.enabled, false);
  assert.equal(run(['pause', '--config', config]).status, 0);
  assert.equal(JSON.parse(await readFile(config, 'utf8')).enabled, false);
});
test('invalid and sensitive profiles fail without changing saved configuration', async t => {
  const config = await fixture(t);
  assert.equal(run(['init', '--config', config]).status, 0);
  const before = await readFile(config, 'utf8');
  assert.notEqual(run(['allow', 'com.apple.mail', '--name', 'Mail', '--details', 'Reading', '--config', config]).status, 0);
  assert.notEqual(run(['allow', 'org.unknown.app', '--config', config]).status, 0);
  assert.equal(await readFile(config, 'utf8'), before);
});
test('doctor checks pairing/config locally without printing private keys', async t => {
  const config = await fixture(t), pairing = path.join(path.dirname(config), 'bridge.json');
  await writeFile(pairing, JSON.stringify({ token: 'a'.repeat(64) }));
  const missing = run(['doctor', '--config', config, '--bridge-config', pairing]);
  assert.equal(missing.status, 0);
  assert.equal(JSON.parse(missing.stdout).configuration, 'missing');
  assert.equal(missing.stdout.includes('a'.repeat(64)), false);
  await writeFile(config, '{broken');
  assert.equal(JSON.parse(run(['doctor', '--config', config]).stdout).configuration, 'invalid');
});
