const defaults = Object.freeze({
  musicPlayer: true,
  messageShelf: true,
  workspaces: true,
  notifications: true,
  voice: true
});

const validAccount = id => typeof id === 'string' && /^\d{17,20}$/.test(id);

export function featureSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
    key, typeof source[key] === 'boolean' ? source[key] : fallback
  ]));
}

export function collectionsKey(accountId) {
  if (!validAccount(accountId)) throw Error('Invalid account ID');
  return `EnhancedPresencePlus:${accountId}:collections`;
}

export function featuresKey(accountId) {
  if (!validAccount(accountId)) throw Error('Invalid account ID');
  return `EnhancedPresencePlus:${accountId}:features`;
}

export function notificationRulesKey(accountId) {
  if (!validAccount(accountId)) throw Error('Invalid account ID');
  return `EnhancedPresencePlus:${accountId}:notification-rules`;
}
