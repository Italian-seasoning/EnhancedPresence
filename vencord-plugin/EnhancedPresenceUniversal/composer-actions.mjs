/* Licensed under GPL-3.0-or-later. */
const selector = '[class*="buttons_"] button, [class*="buttons_"] [role="button"], [class*="attachButton_"][role="button"]';
const labelOf = button => (button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();

export function bindComposerActions(root, trigger) {
  let marked = new Set();
  const refresh = () => {
    const actions = [...root.querySelectorAll(selector)].filter(button => button !== trigger
      && !button.closest('[data-ep-composer-toggle]')
      && !button.closest('[type="submit"], [class*="sendButton_"], [class*="submitButton_"]')
      && button.getClientRects().length && labelOf(button).length > 0 && labelOf(button).length <= 120
    ).slice(0, 24).map(button => ({ button, label: labelOf(button) }));
    const next = new Set(actions.map(action => action.button));
    for (const button of marked) if (!next.has(button)) button.removeAttribute('data-ep-composer-action');
    for (const button of next) button.setAttribute('data-ep-composer-action', '');
    marked = next;
    root.toggleAttribute('data-ep-composer-ready', actions.length > 1 && actions.some(action => action.button.matches('[class*="attachButton_"]')));
    return actions;
  };
  const dispose = () => {
    for (const button of marked) button.removeAttribute('data-ep-composer-action');
    marked.clear();
    root.removeAttribute('data-ep-composer-ready');
  };
  refresh();
  return { refresh, dispose };
}

export function activateComposerAction(action, root, expected, current) {
  const { button } = action;
  if (!expected.accountId || !expected.channelId || expected.accountId !== current.accountId || expected.channelId !== current.channelId
    || !root.isConnected || !button.isConnected || !root.contains(button)
    || button.disabled || button.getAttribute('aria-disabled') === 'true' || labelOf(button) !== action.label) return false;
  // Keep transient user activation for native attachment/file pickers.
  button.click();
  return true;
}

export function composerActionPresentation(action) {
  if (action.button.matches('[class*="attachButton_"]')) return { label: 'Attachments', icon: 'attachment', color: '#0a84ff' };
  const entries = [
    [/silent.*typ/i, action.label, 'keyboard', '#bf5af2'],
    [/translat/i, 'Translate', 'translate', '#ff9f0a'],
    [/enhanced presence/i, 'Enhanced Presence+', 'presence', '#30d158'],
    [/gift/i, 'Gift', 'gift', '#ff375f'],
    [/gif/i, 'GIFs', 'gif', '#64d2ff'],
    [/sticker/i, 'Stickers', 'sticker', '#ffd60a'],
    [/emoji/i, 'Emoji', 'emoji', '#ff9f0a']
  ];
  const entry = entries.find(([pattern]) => pattern.test(action.label));
  return entry ? { label: entry[1], icon: entry[2], color: entry[3] } : { label: action.label, icon: 'apps', color: '#5e5ce6' };
}
