const MAX_RULES = 24;
const MAX_GROUPS = 32;
const ID = /^\d{1,22}$/;
const RULE_ID = /^[a-zA-Z0-9_-]{1,40}$/;
const clean = (value, limit) => typeof value === 'string' && value.length <= limit
  && !/[\u0000-\u001f\u007f-\u009f]/.test(value) ? value.trim() : null;

export function validateNotificationRules(value) {
  if (!Array.isArray(value)) throw Error('Invalid notification rules');
  if (value.length > MAX_RULES) throw Error('Too many notification rules');
  const ids = new Set();
  return value.map(input => {
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !['id', 'enabled', 'action', 'personId', 'channelId', 'keyword'].includes(key))) throw Error('Invalid notification rule');
    const id = clean(input.id, 40);
    if (!id || !RULE_ID.test(id) || ids.has(id) || typeof input.enabled !== 'boolean'
      || !['mute', 'group'].includes(input.action)) throw Error('Invalid notification rule');
    ids.add(id);
    const personId = input.personId === undefined ? undefined : clean(input.personId, 22);
    const channelId = input.channelId === undefined ? undefined : clean(input.channelId, 22);
    const keyword = input.keyword === undefined ? undefined : clean(input.keyword, 80);
    if ((personId !== undefined && (!personId || !ID.test(personId)))
      || (channelId !== undefined && (!channelId || !ID.test(channelId)))
      || (keyword !== undefined && (!keyword || keyword.length > 80))) throw Error('Invalid notification rule');
    if (personId === undefined && channelId === undefined && keyword === undefined) throw Error('A notification rule needs a criterion');
    return { id, enabled: input.enabled, action: input.action,
      ...(personId ? { personId } : {}), ...(channelId ? { channelId } : {}), ...(keyword ? { keyword } : {}) };
  });
}

function safeNotification(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, channelId, authorId } = value;
  const content = clean(value.content, 4096);
  if (![id, channelId, authorId].every(item => typeof item === 'string' && ID.test(item)) || content === null) return null;
  const authorName = clean(value.authorName ?? '', 128);
  const channelName = clean(value.channelName ?? '', 128);
  return { id, channelId, authorId, authorName: authorName ?? '', channelName: channelName ?? '', content };
}

export function matchNotificationRule(rules, notification) {
  const input = safeNotification(notification);
  if (!input) return null;
  let validated;
  try { validated = validateNotificationRules(rules); } catch { return null; }
  const content = input.content.toLocaleLowerCase('en-US');
  return validated.find(rule => rule.enabled
    && (!rule.personId || rule.personId === input.authorId)
    && (!rule.channelId || rule.channelId === input.channelId)
    && (!rule.keyword || content.includes(rule.keyword.toLocaleLowerCase('en-US')))) ?? null;
}

export function previewNotificationRule(rule, notification) {
  try {
    const validated = validateNotificationRules([rule]);
    const match = matchNotificationRule(validated, notification);
    return { matches: Boolean(match), action: match?.action ?? null };
  } catch { return { matches: false, action: null }; }
}

export function shouldShowDesktopNotification(message, router, { getChannel, currentUserId } = {}) {
  try {
    if (!message || typeof message !== 'object' || Array.isArray(message)
      || message.author?.id === currentUserId) return true;
    const channelId = message.channel_id;
    const authorId = message.author?.id;
    if (typeof channelId !== 'string' || !ID.test(channelId) || typeof authorId !== 'string' || !ID.test(authorId)) return true;
    const channel = getChannel?.(channelId);
    const outcome = router?.route({
      id: message.id, channelId, authorId,
      authorName: message.author.global_name ?? message.author.username ?? '',
      channelName: channel?.name ?? '', content: message.content
    });
    return outcome === 'notify';
  } catch { return true; }
}

export function createNotificationRouter({ getRules, getEnabled, emitGroup = () => {}, now = Date.now, maxGroups = MAX_GROUPS } = {}) {
  let active = false;
  const groups = new Map();
  const limit = Number.isInteger(maxGroups) ? Math.max(1, Math.min(MAX_GROUPS, maxGroups)) : MAX_GROUPS;
  function snapshot() { return [...groups.values()].map(group => ({ ...group })); }
  function clearGroups() { groups.clear(); }
  function route(notification) {
    if (!active) return 'notify';
    let enabled = false, rules;
    try { enabled = getEnabled?.() === true; rules = getRules?.(); } catch { return 'notify'; }
    if (!enabled) return 'notify';
    const safe = safeNotification(notification);
    const rule = matchNotificationRule(rules, safe);
    if (!safe || !rule) return 'notify';
    if (rule.action === 'mute') return 'muted';
    const key = `${rule.id}/${safe.channelId}/${safe.authorId}`;
    const observedAt = now();
    const time = Number.isSafeInteger(observedAt) && observedAt >= 0 ? observedAt : Date.now();
    const previous = groups.get(key);
    const group = {
      ruleId: rule.id, channelId: safe.channelId, authorId: safe.authorId,
      authorName: safe.authorName, channelName: safe.channelName,
      count: (previous?.count ?? 0) + 1, firstAt: previous?.firstAt ?? time, lastAt: time
    };
    groups.delete(key);
    groups.set(key, group);
    while (groups.size > limit) groups.delete(groups.keys().next().value);
    try { emitGroup({ ...group }); } catch { return 'notify'; }
    return 'grouped';
  }
  return {
    route,
    snapshot,
    clearGroups,
    start() { active = true; },
    stop() { active = false; clearGroups(); }
  };
}
