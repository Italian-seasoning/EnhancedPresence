import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contrastRatio } from '../vencord-plugin/EnhancedPresenceUniversal/palette.mjs';

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

test('high-contrast Messages blue keeps outgoing white text at WCAG AA contrast', () => {
  const css = read('themes/PresenceMessages.theme.css');
  const highContrastBlue = css.match(/--ep-messages-blue-high-contrast:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(highContrastBlue);
  assert.ok(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*?--ep-messages-blue:\s*var\(--ep-messages-blue-high-contrast\)/.test(css));
  assert.ok(contrastRatio(highContrastBlue, '#FFFFFF') >= 4.5, `${highContrastBlue} does not meet 4.5:1 with white`);
});
