import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('settings changes clear a running presence without waiting for another detector event', { timeout: 8000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'presence-runtime-'));
  const config = join(root, 'config.local.json');
  const save = value => { writeFileSync(`${config}.new`, JSON.stringify(value), { mode: 0o600 }); renameSync(`${config}.new`, config); };
  save({ enabled: true, switchDelaySeconds: 0, trackingEnabled: false, music: { enabled: false, sources: [], priority: 'music' } });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../presence-engine/main.mjs', import.meta.url)), '--config', config]);
  const messages = [];
  let buffer = '';
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      messages.push(JSON.parse(buffer.slice(0, index))); buffer = buffer.slice(index + 1);
    }
  });
  const until = async predicate => {
    const deadline = Date.now() + 2500;
    while (!predicate()) { if (Date.now() >= deadline) throw Error('Runtime did not apply the settings change'); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  try {
    child.stdin.write(JSON.stringify({ appId: 'com.apple.Safari', pid: 123, idleSeconds: 0, inactive: false }) + '\n');
    await until(() => messages.some(m => m.type === 'presence_update'));
    const before = messages.length;
    save({ enabled: false, trackingEnabled: false });
    await until(() => messages.slice(before).some(m => m.type === 'presence_clear'));
    assert.equal(messages.at(-1).type, 'presence_clear');
  } finally { child.kill(); await new Promise(resolve => child.once('exit', resolve)); rmSync(root, { recursive: true, force: true }); }
});
