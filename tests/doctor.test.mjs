import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose } from '../presence-engine/doctor.mjs';

test('doctor distinguishes installed plugin files from a live authenticated connection', async () => {
  const home = mkdtempSync(join(tmpdir(), 'presence-doctor-'));
  const root = join(home, 'Library/Application Support/EnhancedPresence');
  mkdirSync(root, { recursive: true });
  try {
    writeFileSync(join(root, 'config.local.json'), JSON.stringify({ enabled: true, output: 'vencord' }), { mode: 0o600 });
    const status = source => writeFileSync(join(root, 'status.local.json'), JSON.stringify({ updatedAt: Date.now(), music: { available: false }, perf: { cpuPercent: 0, rssMB: 30, source } }), { mode: 0o600 });
    for (const [source, expected] of [['ipc', false], ['vencord', true]]) {
      status(source);
      const checks = await diagnose({ home });
      assert.equal(checks.find(c => c.name === 'Vencord plugin is connected')?.ok, expected);
      assert.equal(checks.some(c => /hook is installed/.test(c.name)), false);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
