import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('companion installation is paused and hooks are opt-in, preserving settings on reinstall', { skip: process.platform !== 'darwin' }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'presence-install-'));
  const home = join(scratch, 'home'), source = join(scratch, 'source');
  try {
    mkdirSync(join(source, 'build', 'MediaRemoteAdapter.framework'), { recursive: true });
    mkdirSync(home);
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude/settings.json'), '{}');
    for (const name of ['presence-engine', 'shared', 'vendor']) cpSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), join(source, name), { recursive: true });
    writeFileSync(join(source, 'build', 'detector'), 'fixture');
    const install = flags => execFileSync(process.execPath, [join(source, 'presence-engine/install.mjs'), '123456789012345678', '--no-start', '--accept-terms', ...flags], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    install([]);
    const config = join(home, 'Library/Application Support/EnhancedPresence/config.local.json');
    assert.equal(JSON.parse(readFileSync(config)).enabled, false);
    assert.equal(existsSync(join(home, 'Library/Application Support/EnhancedPresence/vendor/mediaremote-adapter/src')), false);
    assert.deepEqual(JSON.parse(readFileSync(join(home, '.claude/settings.json'))), {});
    const before = readFileSync(config, 'utf8');
    install(['--with-hooks']);
    assert.match(readFileSync(join(home, '.claude/settings.json'), 'utf8'), /agent-hook.sh/);
    assert.equal(readFileSync(config, 'utf8'), before);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
