export const BACKGROUND_PRESETS = Object.freeze({
  sky: { name: 'Sky', css: 'linear-gradient(135deg, #9ec5e8, #d1c9ed)' },
  sage: { name: 'Sage', css: 'linear-gradient(135deg, #a8c5b0, #d9d0b8)' },
  dusk: { name: 'Dusk', css: 'linear-gradient(135deg, #3c4664, #75566d)' },
  charcoal: { name: 'Charcoal', css: 'linear-gradient(135deg, #202632, #3a404a)' }
});
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
function record(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) throw Error('Invalid chat background fields');
}
function background(value) {
  if (value?.kind === 'preset') {
    record(value, ['kind', 'id']);
    if (!Object.hasOwn(BACKGROUND_PRESETS, value.id)) throw Error('Invalid background preset');
    return { kind: 'preset', id: value.id };
  }
  record(value, ['kind', 'data']);
  if (value.kind !== 'photo' || typeof value.data !== 'string' || value.data.length > 650000
    || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw Error('Invalid local background image');
  let prefix;
  try { prefix = atob(value.data.slice('data:image/webp;base64,'.length, 'data:image/webp;base64,'.length + 16)); }
  catch { throw Error('Invalid local background image'); }
  if (!prefix.startsWith('RIFF') || prefix.slice(8, 12) !== 'WEBP') throw Error('Invalid local background image');
  return { kind: 'photo', data: value.data };
}
export function backgroundKey(accountId) {
  if (!snowflake(accountId)) throw Error('Invalid background account');
  return `EnhancedPresencePlus:${accountId}:chat-backgrounds`;
}
export function emptyBackgrounds(accountId) {
  backgroundKey(accountId);
  return { version: 1, accountId, chats: {} };
}
export function validateBackgrounds(value, accountId) {
  backgroundKey(accountId);
  record(value, ['version', 'accountId', 'chats']);
  if (value.version !== 1 || value.accountId !== accountId) throw Error('Invalid background account or version');
  if (!value.chats || Object.getPrototypeOf(value.chats) !== Object.prototype) throw Error('Invalid background chats');
  const entries = Object.entries(value.chats);
  if (entries.length > 32 || JSON.stringify(value).length > 6000000) throw Error('Chat background storage limit reached');
  const chats = {};
  for (const [id, entry] of entries) {
    if (!snowflake(id)) throw Error('Invalid background chat');
    chats[id] = background(entry);
  }
  return { version: 1, accountId, chats };
}
export function setBackground(value, channelId, next) {
  const state = validateBackgrounds(value, value?.accountId);
  if (!snowflake(channelId)) throw Error('Invalid background chat');
  if (next === null) delete state.chats[channelId];
  else state.chats[channelId] = background(next);
  return validateBackgrounds(state, state.accountId);
}
export function backgroundCss(value) {
  if (!value) return undefined;
  const entry = background(value);
  return entry.kind === 'preset' ? BACKGROUND_PRESETS[entry.id].css : `url("${entry.data}")`;
}
