import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('native helper distinguishes stale, paused and connected activity and rejects remote settings', { skip: process.platform !== 'darwin', timeout: 120000 }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'presence-helper-'));
  try {
    const binary = join(scratch, 'helper');
    execFileSync('swiftc', ['-module-cache-path', join(tmpdir(), 'enhanced-presence-swift-cache'), fileURLToPath(new URL('../native/Helper.swift', import.meta.url)), '-o', binary], { timeout: 100000 });
    assert.match(execFileSync(binary, ['--self-test'], { encoding: 'utf8', timeout: 2000 }), /Helper checks passed/);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
