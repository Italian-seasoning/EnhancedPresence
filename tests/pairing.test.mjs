import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLocalPairing } from '../vencord-plugin/EnhancedPresenceUniversal/pairing.mjs';
const fixture = { token: 'a'.repeat(64), applicationId: '123456789012345678', ignored: 'PRIVATE_METADATA' };

test('desktop pairing exposes only the validated local key and public application ID', t => {
  const root = mkdtempSync(join(tmpdir(), 'presence-pairing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'bridge.local.json'), JSON.stringify(fixture), { mode: 0o600 });
  assert.deepEqual(readLocalPairing(root), { bridgeToken: fixture.token, applicationId: fixture.applicationId });
});

test('desktop pairing refuses shared files, symlinks, malformed data and non-string credentials', t => {
  const root = mkdtempSync(join(tmpdir(), 'presence-pairing-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, 'bridge.local.json');
  assert.equal(readLocalPairing(root), null);
  writeFileSync(file, JSON.stringify(fixture), { mode: 0o600 });
  if (process.platform !== 'win32') {
    chmodSync(file, 0o644);
    assert.equal(readLocalPairing(root), null);
    chmodSync(file, 0o600);
  }
  for (const value of ['not-json', ' '.repeat(2049), JSON.stringify({ ...fixture, token: [fixture.token] }), JSON.stringify({ ...fixture, applicationId: 'invalid' })]) {
    writeFileSync(file, value);
    assert.equal(readLocalPairing(root), null);
  }
  const target = join(root, 'other.json');
  writeFileSync(target, JSON.stringify(fixture), { mode: 0o600 });
  unlinkSync(file); symlinkSync(target, file);
  assert.equal(readLocalPairing(root), null);
});
