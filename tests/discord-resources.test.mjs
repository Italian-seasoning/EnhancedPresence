import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveDiscordResources } from '../presence-engine/repair.mjs';
test('resolves launcher to newest installed archive and preserves custom paths', async () => {
 const home = await mkdtemp(join(tmpdir(), 'presence-path-'));
 try {
  const launcher = join(home, 'launcher'); await mkdir(launcher);
  await assert.rejects(resolveDiscordResources(launcher, home), /not found/);
  for (const version of ['0.0.9', '0.0.10']) {
   const p = join(home, 'Library/Application Support/discord', `app-${version}`, 'Discord.app/Contents/Resources');
   await mkdir(p, { recursive: true }); await writeFile(join(p, '_app.asar'), 'archive');
  }
  assert.match(await resolveDiscordResources(launcher, home), /app-0.0.10/);
  await writeFile(join(launcher, 'app.asar'), 'custom');
  assert.equal(await resolveDiscordResources(launcher, home), launcher);
 } finally { await rm(home, { recursive: true, force: true }); }
});
