const VERSION = 1;
const MAX_BYTES = 2_000_000;
const MAX_SAVED = 500;
const MAX_WORKSPACES = 40;
const MAX_CHANNELS = 100;
const MAX_TAGS = 12;
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);

function record(value, required, optional, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error(`Invalid ${name}`);
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !allowed.has(key))) throw Error(`Invalid ${name} fields`);
  return value;
}

function text(value, max, name, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) throw Error(`Invalid ${name}`);
  return value;
}

function tags(value) {
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw Error('Invalid tags');
  const seen = new Set();
  return value.map(tag => {
    text(tag, 32, 'tag', false);
    const key = tag.trim().toLowerCase();
    if (tag !== tag.trim() || seen.has(key)) throw Error('Invalid duplicate tag');
    seen.add(key);
    return tag;
  });
}

function savedMessage(value) {
  record(value, ['channelId', 'messageId', 'savedAt', 'tags'], ['guildId', 'label', 'note'], 'saved message');
  if (!snowflake(value.channelId) || !snowflake(value.messageId) || (value.guildId !== undefined && !snowflake(value.guildId))) throw Error('Invalid saved message IDs');
  if (!Number.isSafeInteger(value.savedAt) || value.savedAt < 0) throw Error('Invalid saved date');
  const result = { channelId: value.channelId, messageId: value.messageId, savedAt: value.savedAt, tags: tags(value.tags) };
  if (value.guildId !== undefined) result.guildId = value.guildId;
  if (value.label !== undefined) result.label = text(value.label, 80, 'label');
  if (value.note !== undefined) result.note = text(value.note, 2000, 'note');
  return result;
}

function workspaceChannel(value) {
  record(value, ['channelId'], ['guildId', 'label'], 'workspace channel');
  if (!snowflake(value.channelId) || (value.guildId !== undefined && !snowflake(value.guildId))) throw Error('Invalid workspace channel IDs');
  return { channelId: value.channelId, ...(value.guildId !== undefined ? { guildId: value.guildId } : {}), ...(value.label !== undefined ? { label: text(value.label, 80, 'channel label') } : {}) };
}

function workspace(value) {
  record(value, ['id', 'name', 'channels'], [], 'workspace');
  if (typeof value.id !== 'string' || !/^[\w-]{1,64}$/.test(value.id)) throw Error('Invalid workspace ID');
  const name = text(value.name, 64, 'workspace name', false);
  if (name !== name.trim()) throw Error('Invalid workspace name');
  if (!Array.isArray(value.channels) || value.channels.length > MAX_CHANNELS) throw Error('Invalid workspace channels');
  const channels = value.channels.map(workspaceChannel);
  if (new Set(channels.map(channel => channel.channelId)).size !== channels.length) throw Error('Invalid duplicate workspace channel');
  return { id: value.id, name, channels };
}

export function emptyCollections(accountId) {
  if (!snowflake(accountId)) throw Error('Invalid account ID');
  return { version: VERSION, accountId, savedMessages: [], workspaces: [] };
}

export function validateCollections(value, accountId) {
  if (!snowflake(accountId)) throw Error('Invalid account ID');
  record(value, ['version', 'accountId', 'savedMessages', 'workspaces'], [], 'collections');
  if (value.version !== VERSION) throw Error('Unsupported collections version');
  if (value.accountId !== accountId) throw Error('Collections belong to another account');
  if (!Array.isArray(value.savedMessages) || value.savedMessages.length > MAX_SAVED) throw Error('Saved message limit exceeded');
  if (!Array.isArray(value.workspaces) || value.workspaces.length > MAX_WORKSPACES) throw Error('Workspace limit exceeded');
  const savedMessages = value.savedMessages.map(savedMessage);
  if (new Set(savedMessages.map(item => `${item.channelId}\0${item.messageId}`)).size !== savedMessages.length) throw Error('Invalid duplicate saved message');
  const workspaces = value.workspaces.map(workspace);
  if (new Set(workspaces.map(item => item.id)).size !== workspaces.length) throw Error('Invalid duplicate workspace');
  return { version: VERSION, accountId, savedMessages, workspaces };
}

export function saveMessage(state, input) {
  const current = validateCollections(state, state?.accountId);
  record(input, ['channelId', 'messageId'], ['guildId', 'label', 'note', 'tags'], 'message save');
  if (!snowflake(input.channelId) || !snowflake(input.messageId)) throw Error('Invalid message IDs');
  const index = current.savedMessages.findIndex(item => item.channelId === input.channelId && item.messageId === input.messageId);
  if (index < 0 && current.savedMessages.length >= MAX_SAVED) throw Error('Saved message limit exceeded');
  const previous = index < 0 ? {} : current.savedMessages[index];
  const next = savedMessage({
    ...previous,
    channelId: input.channelId,
    messageId: input.messageId,
    savedAt: previous.savedAt ?? Date.now(),
    tags: input.tags ?? previous.tags ?? [],
    ...(input.guildId !== undefined ? { guildId: input.guildId } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.note !== undefined ? { note: input.note } : {})
  });
  if (index < 0) current.savedMessages.unshift(next);
  else current.savedMessages[index] = next;
  return current;
}

export function updateSavedMessage(state, input) {
  const current = validateCollections(state, state?.accountId);
  record(input, ['channelId', 'messageId'], ['label', 'note', 'tags'], 'message update');
  const index = current.savedMessages.findIndex(item => item.channelId === input.channelId && item.messageId === input.messageId);
  if (index < 0) throw Error('Saved message not found');
  current.savedMessages[index] = savedMessage({ ...current.savedMessages[index], ...input });
  return current;
}

export function removeSavedMessage(state, input) {
  const current = validateCollections(state, state?.accountId);
  record(input, ['channelId', 'messageId'], [], 'message removal');
  const remaining = current.savedMessages.filter(item => item.channelId !== input.channelId || item.messageId !== input.messageId);
  return remaining.length === current.savedMessages.length ? current : { ...current, savedMessages: remaining };
}

export function searchSavedMessages(state, query = '') {
  const current = validateCollections(state, state?.accountId);
  const needle = text(query, 256, 'search').trim().toLowerCase();
  return current.savedMessages.filter(item => !needle || [item.label, item.note, ...item.tags].some(value => value?.toLowerCase().includes(needle))).map(item => ({ ...item, tags: [...item.tags] }));
}

export function saveWorkspace(state, input) {
  const current = validateCollections(state, state?.accountId);
  const next = workspace(input);
  const index = current.workspaces.findIndex(item => item.id === next.id);
  if (index < 0 && current.workspaces.length >= MAX_WORKSPACES) throw Error('Workspace limit exceeded');
  if (index < 0) current.workspaces.push(next);
  else current.workspaces[index] = next;
  return current;
}

export function removeWorkspace(state, id) {
  const current = validateCollections(state, state?.accountId);
  if (typeof id !== 'string') throw Error('Invalid workspace ID');
  const remaining = current.workspaces.filter(item => item.id !== id);
  return remaining.length === current.workspaces.length ? current : { ...current, workspaces: remaining };
}

export function serializeCollections(state) {
  const encoded = JSON.stringify(validateCollections(state, state?.accountId));
  if (encoded.length > MAX_BYTES) throw Error('Collections export limit exceeded');
  return encoded;
}

export function parseCollections(encoded, accountId) {
  if (typeof encoded !== 'string' || encoded.length > MAX_BYTES) throw Error('Collections import limit exceeded');
  let parsed;
  try { parsed = JSON.parse(encoded); } catch { throw Error('Collections import is not valid JSON'); }
  return validateCollections(parsed, accountId);
}
