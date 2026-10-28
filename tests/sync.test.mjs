import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test("the plugin's profiles.mjs is identical to the engine's", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  assert.equal(read('../vencord-plugin/EnhancedPresenceUniversal/profiles.mjs'), read('../presence-engine/profiles.mjs'));
});
