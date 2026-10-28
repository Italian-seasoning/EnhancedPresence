import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installHooks, removeHooks } from '../presence-engine/hooks.mjs';

const setup = initial => {
  const path = join(mkdtempSync(join(tmpdir(), 'ep-hooks-')), 'settings.json');
  if (initial) writeFileSync(path, JSON.stringify(initial));
  return path;
};
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const cmd = '/usr/bin/node /x/presence-engine/agent-hook.sh';

test('install keeps other settings and hooks, backs up once, and is idempotent', () => {
  const other = { hooks: [{ type: 'command', command: 'echo keep' }] };
  const path = setup({ theme: 'dark', hooks: { Stop: [other] } });
  installHooks(path, cmd); installHooks(path, cmd);
  const s = read(path);
  assert.equal(s.theme, 'dark');
  assert.equal(s.hooks.Stop.length, 2);
  assert.deepEqual(s.hooks.Stop[0], other);
  for (const e of ['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop']) assert.equal(s.hooks[e].filter(x => x.hooks[0].command === cmd).length, 1);
  assert.equal(s.hooks.Stop.at(-1).hooks[0].timeout, 3);
  assert.deepEqual(read(`${path}.enhancedpresence.bak`), { theme: 'dark', hooks: { Stop: [other] } });
});

test('install creates settings when missing; a changed path replaces ours; remove leaves others', () => {
  const path = setup();
  installHooks(path, cmd); installHooks(path, '/n /y/agent-hook.sh');
  assert.equal(read(path).hooks.Stop.length, 1);
  assert.equal(read(path).hooks.Stop[0].hooks[0].command, '/n /y/agent-hook.sh');
  const mixed = setup({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } });
  installHooks(mixed, cmd); removeHooks(mixed);
  assert.deepEqual(read(mixed).hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] });
});

test('malformed settings are left untouched', () => {
  const path = setup(); writeFileSync(path, '{ nope');
  assert.throws(() => installHooks(path, cmd));
  assert.equal(readFileSync(path, 'utf8'), '{ nope');
  assert.equal(existsSync(`${path}.enhancedpresence.bak`), false);
});

test('codex install uses its three events with async, and remove clears every event', async () => {
  const { codexEvents } = await import('../presence-engine/hooks.mjs');
  const path = setup();
  installHooks(path, cmd, codexEvents, { async: true });
  assert.deepEqual(Object.keys(read(path).hooks).sort(), [...codexEvents].sort());
  assert.equal(read(path).hooks.Stop[0].hooks[0].async, true);
  removeHooks(path);
  assert.deepEqual(read(path).hooks, {});
});
