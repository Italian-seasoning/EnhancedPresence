import assert from 'node:assert/strict';
import test from 'node:test';
import { activateComposerAction, bindComposerActions, composerActionPresentation } from '../vencord-plugin/EnhancedPresenceUniversal/composer-actions.mjs';

function fixture() {
  const buttons = [];
  const attributes = new Map();
  const root = {
    isConnected: true,
    querySelectorAll: () => buttons,
    contains: button => buttons.includes(button),
    toggleAttribute: (key, enabled) => enabled ? attributes.set(key, '') : attributes.delete(key),
    removeAttribute: key => attributes.delete(key)
  };
  const add = (label, { attach = false, submit = false, toggle = false } = {}) => {
    const attrs = new Map(label ? [['aria-label', label]] : []);
    const button = {
      isConnected: true, disabled: false, clicks: 0,
      getAttribute: key => attrs.get(key) ?? null,
      setAttribute: (key, value) => attrs.set(key, value),
      removeAttribute: key => attrs.delete(key),
      getClientRects: () => [{}],
      matches: () => attach,
      closest: selector => selector.includes('composer-toggle') ? (toggle ? button : null) : (submit ? button : null),
      click: () => { button.clicks++; }
    };
    buttons.push(button);
    return button;
  };
  return { root, add, attributes, buttons };
}

test('composer grouping preserves submit and unknown controls and restores originals on teardown', () => {
  const { root, add, attributes, buttons } = fixture();
  const upload = add('More message options', { attach: true });
  const translate = add('Translate');
  const send = add('Send', { submit: true });
  const unknown = add('');
  const toggle = add('More message actions', { toggle: true });
  const binding = bindComposerActions(root, toggle);
  assert.deepEqual(binding.refresh().map(action => action.label), ['More message options', 'Translate']);
  assert.ok(attributes.has('data-ep-composer-ready'));
  assert.equal(upload.getAttribute('data-ep-composer-action'), '');
  for (const button of [send, unknown, toggle]) assert.equal(button.getAttribute('data-ep-composer-action'), null);
  buttons.splice(buttons.indexOf(upload), 1);
  binding.refresh();
  assert.ok(!attributes.has('data-ep-composer-ready'), 'missing native attachment control must restore the standard bar');
  binding.dispose();
  for (const button of [upload, translate]) assert.equal(button.getAttribute('data-ep-composer-action'), null);
});

test('menu actions invoke the original handler synchronously only in the same live composer', () => {
  const { root, add } = fixture();
  add('Attachments', { attach: true });
  const button = add('Translate');
  const binding = bindComposerActions(root, {});
  const action = binding.refresh()[1];
  const context = { accountId: 'account-a', channelId: 'channel-a' };
  const invoke = current => activateComposerAction(action, root, context, current);
  assert.equal(invoke(context), true);
  assert.equal(button.clicks, 1);
  for (const current of [{ ...context, accountId: 'account-b' }, { ...context, channelId: 'channel-b' }, { ...context, accountId: '' }]) assert.equal(invoke(current), false);
  button.disabled = true;
  assert.equal(invoke(context), false);
  button.disabled = false;
  button.setAttribute('aria-disabled', 'true');
  assert.equal(invoke(context), false);
  button.removeAttribute('aria-disabled');
  button.setAttribute('aria-label', 'Changed action');
  assert.equal(invoke(context), false);
  button.setAttribute('aria-label', 'Translate');
  button.isConnected = false;
  assert.equal(invoke(context), false);
  button.isConnected = true;
  root.isConnected = false;
  assert.equal(invoke(context), false);
  assert.equal(button.clicks, 1);
  binding.dispose();
});

test('compact labels preserve toggle intent and unknown plugin actions without reading SVG markup', () => {
  const button = { matches: () => false };
  assert.equal(composerActionPresentation({ button, label: 'Disable Silent Typing' }).label, 'Disable Silent Typing');
  assert.deepEqual(composerActionPresentation({ button, label: 'Open GIF picker' }), { label: 'GIFs', icon: 'gif', color: '#64d2ff' });
  assert.equal(composerActionPresentation({ button, label: 'Open Translate Modal' }).label, 'Translate');
  assert.equal(composerActionPresentation({ button, label: 'Custom action' }).label, 'Custom action');
  assert.equal(composerActionPresentation({ button: { matches: () => true }, label: 'More message options' }).icon, 'attachment');
});
