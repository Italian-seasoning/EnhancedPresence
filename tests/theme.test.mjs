import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the presence plugin cannot enable or configure a full-client theme', () => {
  const plugin = read('vencord-plugin/EnhancedPresenceUniversal/index.ts');
  assert.doesNotMatch(plugin, /messages-glass|setMessagesGlass|ep-messages-glass/);
  const panel = read('vencord-plugin/EnhancedPresenceUniversal/SuitePanel.tsx');
  assert.doesNotMatch(panel, /document\.documentElement\.style|messagesGlass/);
});

test('Messages is a standalone local theme without other themes option overrides', () => {
  const css = read('themes/PresenceMessages.theme.css');
  assert.match(css, /@name Messages for Discord/);
  assert.match(css, /@author Italian-seasoning/);
  assert.doesNotMatch(css, /@import\b|url\s*\(|--(?:unrounding|panel-labels|ascii-titles|ascii-loader|top-bar-height|small-user-panel)\s*:/i);
  assert.match(css, /data-is-self/);
  assert.match(css, /ep-plus-own-marker/);
  assert.match(css, /prefers-reduced-transparency/);
  assert.match(css, /forced-colors/);
});
