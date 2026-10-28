import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Explicitly opt in: this checks the real desktop's input clock, not a fixture.
test('native detector idle agrees with an independent session input clock query', {
  skip: process.platform !== 'darwin' || process.env.ENHANCED_PRESENCE_NATIVE_SMOKE !== '1',
  timeout: 10000
}, async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'presence-native-clock-'));
  const reference = join(scratch, 'session-clock');
  let child;
  try {
    // HID and session event tables can reset independently. Query the same
    // session table with the C constant to catch an incorrect Swift event type.
    execFileSync('/usr/bin/xcrun', ['clang', '-x', 'c', '-', '-framework', 'CoreGraphics', '-o', reference], {
      input: '#include <CoreGraphics/CoreGraphics.h>\n#include <stdio.h>\nint main(void) { printf("%.9f\\n", CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType)); return 0; }\n',
      timeout: 5000, stdio: ['pipe', 'pipe', 'pipe']
    });
    const sessionIdle = () => {
      const idle = Number(execFileSync(reference, { encoding: 'utf8', timeout: 3000 }).trim());
      assert.ok(Number.isFinite(idle) && idle >= 0, 'Session idle clock unavailable');
      return idle;
    };
    const before = sessionIdle();
    child = spawn(fileURLToPath(new URL('../build/detector', import.meta.url)));
    const snapshot = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(Error('No native detector snapshot')), 4000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Detector exited before snapshot')); });
      child.stdout.on('data', chunk => {
        output += chunk;
        if (!output.includes('\n')) return;
        clearTimeout(timer);
        try { resolve(JSON.parse(output.split('\n')[0])); } catch (error) { reject(error); }
      });
    });
    const after = sessionIdle();
    assert.ok(Number.isFinite(snapshot.idleSeconds) && snapshot.idleSeconds >= 0);
    // Input can reset the clock during sampling; keep both bounds reset-safe.
    assert.ok(snapshot.idleSeconds >= Math.min(before, after) - 5 && snapshot.idleSeconds <= Math.max(before, after) + 5,
      `Detector idle ${snapshot.idleSeconds}s is outside session idle ${before}s to ${after}s`);
  } finally {
    child?.kill();
    rmSync(scratch, { recursive: true, force: true });
  }
});
