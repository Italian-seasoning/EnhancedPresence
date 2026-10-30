import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyCollections, validateCollections, saveMessage, updateSavedMessage,
  removeSavedMessage, searchSavedMessages, saveWorkspace, removeWorkspace,
  serializeCollections, parseCollections
} from '../vencord-plugin/EnhancedPresenceUniversal/collections.mjs';

const accountA = '12345678901234567';
const accountB = '76543210987654321';
const firstMessage = { channelId: '23456789012345678', messageId: '34567890123456789', guildId: '45678901234567890', label: 'Build notes', note: 'Check the contrast', tags: ['design', 'discord'] };

test('creates an empty account-scoped collection document', () => {
  assert.deepEqual(emptyCollections(accountA), { version: 1, accountId: accountA, savedMessages: [], workspaces: [] });
  assert.throws(() => emptyCollections('not-a-snowflake'), /account/i);
});

test('saves only an explicit message reference and bounded user metadata', () => {
  const state = saveMessage(emptyCollections(accountA), firstMessage);
  assert.equal(state.accountId, accountA);
  assert.equal(state.savedMessages.length, 1);
  assert.deepEqual(Object.keys(state.savedMessages[0]).sort(), ['channelId', 'guildId', 'label', 'messageId', 'note', 'savedAt', 'tags'].sort());
  assert.equal(state.savedMessages[0].channelId, firstMessage.channelId);
  assert.equal(state.savedMessages[0].messageId, firstMessage.messageId);
  assert.equal(JSON.stringify(state).includes('content'), false);
  assert.equal(JSON.stringify(state).includes('Build notes'), true);
  assert.notEqual(state, emptyCollections(accountA));
  assert.throws(() => saveMessage(state, { ...firstMessage, content: 'copy the whole message' }), /field/i);
  assert.throws(() => saveMessage(state, { ...firstMessage, messageId: 'https://discord.com/channels/1/2/3' }), /message/i);
  assert.throws(() => saveMessage(state, { ...firstMessage, tags: Array(13).fill('tag') }), /tag/i);
  assert.throws(() => saveMessage(state, { ...firstMessage, note: 'x'.repeat(2001) }), /note/i);
  assert.equal(state.savedMessages[0].note, 'Check the contrast');
});

test('saving a duplicate does not erase existing notes or create duplicate entries', () => {
  const state = saveMessage(emptyCollections(accountA), firstMessage);
  const duplicate = saveMessage(state, { channelId: firstMessage.channelId, messageId: firstMessage.messageId });
  assert.equal(duplicate.savedMessages.length, 1);
  assert.equal(duplicate.savedMessages[0].note, 'Check the contrast');
  assert.equal(duplicate.savedMessages[0].label, 'Build notes');
  assert.equal(duplicate.savedMessages[0].savedAt, state.savedMessages[0].savedAt);
});

test('edits and removes a saved reference by channel and message ID', () => {
  let state = saveMessage(emptyCollections(accountA), firstMessage);
  state = updateSavedMessage(state, { channelId: firstMessage.channelId, messageId: firstMessage.messageId, note: 'Updated note', tags: ['updated'] });
  assert.equal(state.savedMessages[0].note, 'Updated note');
  assert.deepEqual(state.savedMessages[0].tags, ['updated']);
  assert.throws(() => updateSavedMessage(state, { channelId: firstMessage.channelId, messageId: firstMessage.messageId, accountId: accountB }), /field/i);
  assert.throws(() => updateSavedMessage(state, { channelId: firstMessage.channelId, messageId: '99999999999999999', note: 'missing' }), /saved/i);
  state = removeSavedMessage(state, { channelId: firstMessage.channelId, messageId: firstMessage.messageId });
  assert.deepEqual(state.savedMessages, []);
  assert.deepEqual(removeSavedMessage(state, { channelId: firstMessage.channelId, messageId: firstMessage.messageId }), state);
});

test('searches saved labels, notes and tags without inspecting message contents', () => {
  const state = saveMessage(emptyCollections(accountA), firstMessage);
  assert.equal(searchSavedMessages(state, 'CONTRAST').length, 1);
  assert.equal(searchSavedMessages(state, 'discord').length, 1);
  assert.equal(searchSavedMessages(state, 'hidden message body').length, 0);
  assert.equal(searchSavedMessages(state, '').length, 1);
  assert.throws(() => searchSavedMessages(state, 'x'.repeat(257)), /search/i);
});

test('creates, updates and removes named channel shortcut workspaces', () => {
  let state = saveWorkspace(emptyCollections(accountA), { id: 'friends', name: 'Friends', channels: [{ channelId: firstMessage.channelId, guildId: firstMessage.guildId, label: 'Chat' }] });
  assert.equal(state.workspaces.length, 1);
  assert.deepEqual(state.workspaces[0].channels, [{ channelId: firstMessage.channelId, guildId: firstMessage.guildId, label: 'Chat' }]);
  state = saveWorkspace(state, { id: 'friends', name: 'Weekend', channels: [{ channelId: '56789012345678901', label: 'New channel' }] });
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.workspaces[0].name, 'Weekend');
  assert.equal(state.workspaces[0].channels.length, 1);
  assert.throws(() => saveWorkspace(state, { id: '../bad', name: 'Friends', channels: [] }), /workspace/i);
  assert.throws(() => saveWorkspace(state, { id: 'friends', name: 'Bad', channels: [{ channelId: firstMessage.channelId }, { channelId: firstMessage.channelId }] }), /duplicate/i);
  assert.throws(() => saveWorkspace(state, { id: 'friends', name: 'Bad', channels: [{ channelId: 'nope' }] }), /channel/i);
  assert.equal(state.workspaces[0].name, 'Weekend');
  state = removeWorkspace(state, 'friends');
  assert.deepEqual(state.workspaces, []);
});

test('exports and imports the versioned snapshot only for its owning account', () => {
  const saved = saveMessage(emptyCollections(accountA), firstMessage);
  const original = saveWorkspace(saved, { id: 'personal', name: 'Personal', channels: [{ channelId: firstMessage.channelId }] });
  const encoded = serializeCollections(original);
  assert.deepEqual(parseCollections(encoded, accountA), original);
  assert.throws(() => parseCollections(encoded, accountB), /account/i);
  assert.throws(() => parseCollections('{bad', accountA), /import/i);
  const changedVersion = JSON.parse(encoded); changedVersion.version = 2;
  assert.throws(() => parseCollections(JSON.stringify(changedVersion), accountA), /version/i);
  const privateCopy = JSON.parse(encoded); privateCopy.savedMessages[0].content = 'unselected message history';
  assert.throws(() => parseCollections(JSON.stringify(privateCopy), accountA), /field/i);
  assert.deepEqual(original, parseCollections(encoded, accountA));
});

test('validates the whole document and rejects oversized or polluted imports', () => {
  const base = emptyCollections(accountA);
  assert.throws(() => validateCollections({ ...base, savedMessages: Array(501).fill(firstMessage) }, accountA), /limit/i);
  assert.throws(() => validateCollections({ ...base, unknown: true }, accountA), /field/i);
  const polluted = JSON.parse('{"version":1,"accountId":"12345678901234567","savedMessages":[],"workspaces":[],"__proto__":{"admin":true}}');
  assert.throws(() => validateCollections(polluted, accountA), /field/i);
  assert.throws(() => validateCollections({ ...base, accountId: accountB }, accountA), /account/i);
  const valid = saveMessage(base, firstMessage);
  assert.deepEqual(validateCollections(valid, accountA), valid);
});
