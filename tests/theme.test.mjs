import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { contrastRatio } from '../vencord-plugin/EnhancedPresenceUniversal/palette.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the presence plugin cannot enable or configure a full-client theme', () => {
  const plugin = read('vencord-plugin/EnhancedPresenceUniversal/index.ts');
  assert.doesNotMatch(plugin, /messages-glass|setMessagesGlass|ep-messages-glass|ep-snapchat|PresenceSnapchat/);
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

const snapchatToken = (css, name) => [...css.matchAll(new RegExp(`--ep-snapchat-${name}:\\s*(#[0-9a-f]{6})`, 'gi'))].map(match => match[1]);

test('Snapchat is a standalone local theme that keeps its rules out of the other theme and plugin', () => {
  const css = read('themes/PresenceSnapchat.theme.css');
  assert.match(css, /@name Snapchat for Discord/);
  assert.match(css, /@author Italian-seasoning/);
  assert.doesNotMatch(css, /@import\b|url\s*\(|--(?:unrounding|panel-labels|ascii-titles|ascii-loader|top-bar-height|small-user-panel)\s*:/i);
  assert.doesNotMatch(css, /--ep-messages-/);
  assert.doesNotMatch(read('themes/PresenceMessages.theme.css'), /--ep-snapchat-/);
  assert.doesNotMatch(read('vencord-plugin/EnhancedPresenceUniversal/suite.css'), /ep-snapchat/);
  for (const hook of [/data-is-self/, /ep-plus-own-marker/, /data-ep-direct-message/, /data-ep-dm-wallpaper/, /data-ep-composer-ready/]) assert.match(css, hook);
  for (const query of [/prefers-reduced-transparency/, /forced-colors/, /prefers-reduced-motion/, /prefers-contrast:\s*more/]) assert.match(css, query);
});

test('Snapchat never presents Snapchat-only message states Discord does not provide', () => {
  const css = read('themes/PresenceSnapchat.theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /content:\s*"[^"]*(?:opened|delivered|screenshot|replay|streak|viewed)/i);
});

test('Snapchat sender labels and yellow fills meet WCAG AA contrast', () => {
  const css = read('themes/PresenceSnapchat.theme.css');
  const [lightMe, darkMe] = snapchatToken(css, 'me'), [lightFriend, darkFriend] = snapchatToken(css, 'friend');
  const [lightChat, darkChat] = ['#FFFFFF', '#121212'];
  for (const [label, color, surface] of [['light me', lightMe, lightChat], ['light friend', lightFriend, lightChat], ['dark me', darkMe, darkChat], ['dark friend', darkFriend, darkChat]]) {
    assert.ok(color, `${label} token missing`);
    assert.ok(contrastRatio(surface, color) >= 4.5, `${label} ${color} does not meet 4.5:1 on ${surface}`);
  }
  const [lightField] = snapchatToken(css, 'field');
  for (const color of [lightMe, lightFriend]) assert.ok(contrastRatio(lightField ?? '#ececef', color) >= 4.5, `${color} does not meet 4.5:1 on the light field`);
  const [lightMeHigh, darkMeHigh] = snapchatToken(css, 'me-high-contrast'), [lightFriendHigh, darkFriendHigh] = snapchatToken(css, 'friend-high-contrast');
  for (const [color, surface] of [[lightMeHigh, lightChat], [lightFriendHigh, lightChat], [darkMeHigh, darkChat], [darkFriendHigh, darkChat]]) assert.ok(contrastRatio(surface, color) >= 7, `${color} does not meet 7:1 on ${surface}`);
  assert.ok(/@media\s*\(prefers-contrast:\s*more\)[\s\S]*?--ep-snapchat-me:\s*var\(--ep-snapchat-me-high-contrast\)/.test(css));
  const [yellow] = snapchatToken(css, 'yellow');
  assert.ok(contrastRatio(yellow, '#000000') >= 4.5, `${yellow} needs black text`);
  assert.match(css, /--ep-snapchat-on-yellow:\s*#000\b/);
});
