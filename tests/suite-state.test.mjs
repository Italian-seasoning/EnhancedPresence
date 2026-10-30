import assert from 'node:assert/strict';
import test from 'node:test';
import { featureSettings, collectionsKey, notificationRulesKey } from '../vencord-plugin/EnhancedPresenceUniversal/suite-state.mjs';

test('suite settings ignore the retired theme toggle without rewriting saved settings', () => {
  const current = { user: 'keep', musicPlayer: false, messagesGlass: true };
  assert.deepEqual(featureSettings(current), {
    musicPlayer: false,
    messageShelf: true,
    workspaces: true,
    notifications: true,
    voice: true
  });
  assert.equal(current.user, 'keep');
  assert.equal(current.messagesGlass, true);
  assert.equal('messagesGlass' in featureSettings(undefined), false);
});

test('collection storage is partitioned by a valid Discord account ID', () => {
  assert.notEqual(collectionsKey('12345678901234567'), collectionsKey('23456789012345678'));
  assert.notEqual(notificationRulesKey('12345678901234567'), notificationRulesKey('23456789012345678'));
  assert.throws(() => collectionsKey(''), /account/i);
  assert.throws(() => collectionsKey('../settings'), /account/i);
});
