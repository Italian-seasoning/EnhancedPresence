import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArguments, requiredTools, companionArgs, validateManagedRevision, VENCORD_REV, pnpmPackage } from '../scripts/quickstart.mjs';

test('quickstart rejects missing option values, unknown flags and invalid application IDs', () => {
  assert.throws(() => parseArguments(['--application-id']), /requires a value/);
  assert.throws(() => parseArguments(['--vencord', '--standalone']), /requires a value/);
  assert.throws(() => parseArguments(['--surprise']), /Unknown option/);
  assert.throws(() => parseArguments(['--application-id', 'token']), /17 to 20 digits/);
});

test('standalone preflight does not require Vencord build tools', () => {
  assert.deepEqual(requiredTools(true), ['swiftc', 'cmake']);
  assert.deepEqual(requiredTools(false), ['swiftc', 'cmake', 'git', 'npx', 'xcodebuild']);
});

test('setup uses the exact upstream pnpm version without a global version-switching shim', () => {
  assert.equal(pnpmPackage({ packageManager: 'pnpm@12.15.0' }), 'pnpm@12.15.0');
  for (const value of ['pnpm@latest', 'other@12.15.0', undefined]) assert.throws(() => pnpmPackage({ packageManager: value }));
});

test('hooks are opt-in and flags reach the companion installer', () => {
  assert.ok(companionArgs({ standalone: true, withHooks: false }).includes('--no-hooks'));
  assert.ok(companionArgs({ standalone: false, withHooks: true }).includes('--with-hooks'));
  assert.equal(companionArgs({ withHooks: false }).includes('--with-hooks'), false);
});

test('managed Vencord checkouts must stay at the tested revision', () => {
  assert.doesNotThrow(() => validateManagedRevision(VENCORD_REV));
  assert.throws(() => validateManagedRevision('different-revision'), /expected tested Vencord revision/);
});
